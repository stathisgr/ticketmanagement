import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, tx, localDate } from '../db.js';
import { authenticate, requireManager, type JwtUser } from '../auth.js';
import { renderTicket, type PrinterType } from '../print/index.js';
import type { TicketContext } from '../print/template.js';
import { exportAsciiReceipt } from '../fiscal/ascii.js';
import { sendToNetworkPrinter, DRAWER_KICK } from '../print/dispatch.js';

interface SaleItemInput {
  // Σειριακή έκδοση (Φάση 1):
  ticket_type_id?: number;
  qty?: number;
  // Κράτηση θέσης (Φάση 2):
  show_ticket_type_id?: number;
  seat_id?: number;
}
interface SaleInput {
  items: SaleItemInput[];
  payment_method: 'cash' | 'card' | 'bank';
  customer_id?: number;
  printer_type?: PrinterType;
  show_date?: string; // ημερομηνία παράστασης (κρατήσεις θέσεων)
  station?: string;   // όνομα σταθμού (browser) → εκτυπωτής
}

/**
 * Γεννήτρια σειριακών αριθμών εισιτηρίων ανά πώληση.
 * mode='unified': ένας μετρητής (venue.serial_next) για όλα.
 * mode='per_type': πρόθεμα + δικός του μετρητής ανά τύπο (ticket_types.series_prefix/series_next).
 * Παρακάμπτει τυχόν υπάρχοντες αριθμούς (collision-safe). Επιστρέφει και persist() για αποθήκευση μετρητών.
 */
function makeSerialGenerator(venue: any) {
  const mode: 'unified' | 'per_type' = venue?.numbering_mode === 'per_type' ? 'per_type' : 'unified';
  const width = Math.max(1, Number(venue?.serial_width) || 6);
  const exists = db.prepare('SELECT 1 FROM tickets WHERE serial = ?');
  let unifiedN = Math.max(1, Number(venue?.serial_next) || 1);
  const perType = new Map<number, number>(); // ticket_type_id -> next

  function next(tt: any): string {
    if (mode === 'per_type' && tt) {
      const prefix = tt.series_prefix ?? '';
      let n = perType.get(tt.id) ?? Math.max(1, Number(tt.series_next) || 1);
      let s: string;
      do { s = prefix + String(n).padStart(width, '0'); n++; } while (exists.get(s));
      perType.set(tt.id, n);
      return s;
    }
    let s: string;
    do { s = String(unifiedN).padStart(width, '0'); unifiedN++; } while (exists.get(s));
    return s;
  }

  function persist() {
    if (mode === 'unified') {
      db.prepare('UPDATE venue SET serial_next = ? WHERE id = 1').run(unifiedN);
    } else {
      for (const [ttid, n] of perType) db.prepare('UPDATE ticket_types SET series_next = ? WHERE id = ?').run(n, ttid);
    }
  }
  return { next, persist };
}

export default async function salesRoutes(app: FastifyInstance) {
  // Έκδοση πώλησης (εισιτήρια + ταμείο + απόδειξη)
  app.post('/api/sales', { preHandler: authenticate }, async (req, reply) => {
    const body = req.body as SaleInput;
    const user = req.user as JwtUser;
    if (!body?.items?.length) return reply.code(400).send({ error: 'Καμία γραμμή' });
    if (!['cash', 'card', 'bank'].includes(body.payment_method))
      return reply.code(400).send({ error: 'Άκυρος τρόπος πληρωμής' });

    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const fiscal = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    const tplRow = db.prepare('SELECT * FROM print_templates WHERE id = 1').get() as any;
    let tpl: any = {};
    if (tplRow) {
      let p: any = {};
      try { p = JSON.parse(tplRow.params ?? '{}'); } catch { /* default */ }
      tpl = { header: tplRow.header, details: tplRow.details, footer: tplRow.footer, withQr: p.withQr !== false, codePage: p.codePage, escposPageId: p.escposPageId, sizes: p.sizes };
    }
    let qrSerialOnly = false;
    try { qrSerialOnly = JSON.parse(tplRow?.params ?? '{}').qrContent === 'serial'; } catch { /* default */ }

    // Λειτουργία έκδοσης (ενοποιημένη): disabled | ticket_only | cash_register | provider
    const issueMode: string = fiscal?.issue_mode ?? 'ticket_only';
    // Ένδειξη «μη φορολογικό» — όταν το παραστατικό το εκδίδει άλλος (ταμειακή) ή κανένας.
    const legalNote = (issueMode === 'ticket_only' || issueMode === 'cash_register') ? (fiscal?.legal_note ?? 'Δεν αποτελεί φορολογικό παραστατικό') : '';

    // Εκτυπωτής: από τον σταθμό (αν δηλωμένος) αλλιώς ο προεπιλεγμένος.
    let targetPrinter: any = null;
    if (body.station) {
      const st = db.prepare('SELECT * FROM stations WHERE name = ?').get(body.station) as any;
      if (st?.printer_id) targetPrinter = db.prepare('SELECT * FROM printers WHERE id = ?').get(st.printer_id);
    }
    if (!targetPrinter) targetPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();

    const printerType: PrinterType = body.printer_type
      ?? (targetPrinter?.type as PrinterType)
      ?? (tplRow?.printer_type as PrinterType)
      ?? (venue?.default_printer_type as PrinterType)
      ?? 'escpos80';

    const serialGen = makeSerialGenerator(venue);

    let result;
    try {
      result = tx(() => {
      const saleInfo = db
        .prepare(
          `INSERT INTO sales (datetime, user_id, customer_id, payment_method, total, vat_total, source)
           VALUES (datetime('now','localtime'), ?, ?, ?, 0, 0, 'local')`
        )
        .run(user.id, body.customer_id ?? null, body.payment_method);
      const saleId = Number(saleInfo.lastInsertRowid);

      let total = 0;
      let vatTotal = 0;
      const previews: any[] = [];

      // Όταν την απόδειξη την κόβει η ταμειακή (ΦΗΜ), το εισιτήριο ΔΕΝ είναι φορολογικό στοιχείο.
      const legalNote = fiscal?.mode === 'cash_register_file' ? 'Δεν αποτελεί φορολογικό παραστατικό' : '';

      const mkCtx = (over: Partial<TicketContext>): TicketContext => ({
        venueName: venue?.name ?? '',
        vatNumber: venue?.vat_number,
        address: venue?.address,
        cityLine: [venue?.postal_code, venue?.city].filter(Boolean).join(' '),
        phone: venue?.phone,
        email: venue?.email,
        title: '',
        qty: 1,
        unitPrice: 0,
        lineTotal: 0,
        vatRate: 0,
        serial: '',
        datetime: new Date().toLocaleString('el-GR'),
        paymentMethod: labelPayment(body.payment_method),
        legalNote,
        ...over,
      });

      for (const item of body.items) {
        // --- Event χωρίς θέσεις (general): qty εισιτήρια, show-linked, χωρίς θέση ---
        if (item.show_ticket_type_id != null && item.seat_id == null) {
          const stt = db.prepare('SELECT * FROM show_ticket_types WHERE id = ?').get(item.show_ticket_type_id) as any;
          if (!stt) throw new Error('Άγνωστο είδος εισιτηρίου θεάματος');
          const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(stt.show_id) as any;
          const showDate = body.show_date ?? (show?.valid_from ?? show?.starts_at ?? '').slice(0, 10);
          const qty = Math.max(1, Number(item.qty) || 1);
          if (show?.capacity > 0) {
            const sold = (db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE show_id = ? AND show_date = ? AND cancelled_at IS NULL').get(stt.show_id, showDate) as any).c;
            if (sold + qty > show.capacity) throw new Error(`Υπέρβαση χωρητικότητας event (${show.capacity}).`);
          }
          const seatTt = stt.ticket_type_id ? db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(stt.ticket_type_id) : null;
          const lineTotal = +(Number(stt.price) * qty).toFixed(2);
          total += lineTotal;
          vatTotal += +((lineTotal * stt.vat_rate) / (100 + stt.vat_rate)).toFixed(2);
          const itemInfo = db.prepare(
            `INSERT INTO sale_items (sale_id, ticket_type_id, show_id, show_date, title, qty, unit_price, vat_rate, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(saleId, stt.ticket_type_id ?? null, stt.show_id, showDate, stt.title, qty, stt.price, stt.vat_rate, lineTotal);
          const saleItemId = Number(itemInfo.lastInsertRowid);
          for (let i = 0; i < qty; i++) {
            const serial = serialGen.next(seatTt);
            const qrPayload = qrSerialOnly ? serial : `${serial}|${randomUUID()}`;
            db.prepare(
              `INSERT INTO tickets (sale_item_id, serial, qr_payload, show_id, show_date, printed_at)
               VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))`
            ).run(saleItemId, serial, qrPayload, stt.show_id, showDate);
            previews.push(renderTicket(mkCtx({ title: stt.title, subtitle: show?.title, show: show?.title, unitPrice: stt.price, lineTotal: stt.price, vatRate: stt.vat_rate, serial, qrPayload }), printerType, tpl));
          }
          continue;
        }
        // --- Κράτηση θέσης (Φάση 2) ---
        if (item.seat_id != null && item.show_ticket_type_id != null) {
          const stt = db.prepare('SELECT * FROM show_ticket_types WHERE id = ?').get(item.show_ticket_type_id) as any;
          if (!stt) throw new Error('Άγνωστο είδος εισιτηρίου θεάματος');
          const seat = db.prepare('SELECT * FROM seats WHERE id = ?').get(item.seat_id) as any;
          if (!seat || seat.kind !== 'seat') throw new Error('Μη έγκυρη θέση');
          const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(stt.show_id) as any;
          const showDate = body.show_date ?? (show?.valid_from ?? show?.starts_at ?? '').slice(0, 10);
          // Guard: η θέση μπορεί να έχει πουληθεί online (κατέβηκε με sync).
          const onlineTaken = db.prepare(
            'SELECT 1 FROM online_sold_seats WHERE show_id = ? AND show_date = ? AND seat_id = ?'
          ).get(stt.show_id, showDate, seat.id);
          if (onlineTaken) throw new Error(`Η θέση ${seat.display_name ?? seat.id} έχει πουληθεί online`);
          const seatTt = stt.ticket_type_id ? db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(stt.ticket_type_id) : null;

          const lineTotal = +Number(stt.price).toFixed(2);
          const lineVat = +((lineTotal * stt.vat_rate) / (100 + stt.vat_rate)).toFixed(2);
          total += lineTotal;
          vatTotal += lineVat;

          const itemInfo = db
            .prepare(
              `INSERT INTO sale_items (sale_id, ticket_type_id, show_id, show_date, seat_id, title, qty, unit_price, vat_rate, line_total)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
            )
            .run(saleId, stt.ticket_type_id ?? null, stt.show_id, showDate, seat.id, stt.title, stt.price, stt.vat_rate, lineTotal);
          const saleItemId = Number(itemInfo.lastInsertRowid);

          const serial = serialGen.next(seatTt);
          const qrPayload = qrSerialOnly ? serial : `${serial}|${randomUUID()}`;
          // Το UNIQUE index (show_id, show_date, seat_id) αποτρέπει διπλο-κράτηση ανά ημερομηνία → πετάει σφάλμα.
          db.prepare(
            `INSERT INTO tickets (sale_item_id, serial, qr_payload, show_id, show_date, seat_id, printed_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
          ).run(saleItemId, serial, qrPayload, stt.show_id, showDate, seat.id);

          previews.push(
            renderTicket(
              mkCtx({
                title: stt.title,
                subtitle: show?.title,
                show: show?.title,
                seat: seat.display_name,
                unitPrice: stt.price,
                lineTotal: stt.price,
                vatRate: stt.vat_rate,
                serial,
                qrPayload,
              }),
              printerType,
              tpl
            )
          );
          continue;
        }

        // --- Σειριακή έκδοση (Φάση 1) ---
        const tt = db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(item.ticket_type_id) as any;
        if (!tt) throw new Error('Άγνωστος τύπος εισιτηρίου: ' + item.ticket_type_id);
        const qty = Math.max(1, Number(item.qty) || 1);
        const lineTotal = +(tt.price * qty).toFixed(2);
        const lineVat = +((lineTotal * tt.vat_rate) / (100 + tt.vat_rate)).toFixed(2);
        total += lineTotal;
        vatTotal += lineVat;

        const itemInfo = db
          .prepare(
            `INSERT INTO sale_items (sale_id, ticket_type_id, title, qty, unit_price, vat_rate, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(saleId, tt.id, tt.title, qty, tt.price, tt.vat_rate, lineTotal);
        const saleItemId = Number(itemInfo.lastInsertRowid);

        // Ένα ticket record ανά τεμάχιο
        for (let i = 0; i < qty; i++) {
          const serial = serialGen.next(tt);
          const qrPayload = qrSerialOnly ? serial : `${serial}|${randomUUID()}`;
          db.prepare(
            `INSERT INTO tickets (sale_item_id, serial, qr_payload, printed_at) VALUES (?, ?, ?, datetime('now','localtime'))`
          ).run(saleItemId, serial, qrPayload);

          const ctx: TicketContext = {
            venueName: venue?.name ?? '',
            vatNumber: venue?.vat_number,
            address: venue?.address,
            cityLine: [venue?.postal_code, venue?.city].filter(Boolean).join(' '),
            phone: venue?.phone,
            email: venue?.email,
            title: tt.title,
            subtitle: tt.subtitle,
            qty: 1,
            unitPrice: tt.price,
            lineTotal: tt.price,
            vatRate: tt.vat_rate,
            serial,
            datetime: new Date().toLocaleString('el-GR'),
            paymentMethod: labelPayment(body.payment_method),
            legalNote,
            qrPayload,
          };
          previews.push(renderTicket(ctx, printerType, tpl));
        }
      }

      total = +total.toFixed(2);
      vatTotal = +vatTotal.toFixed(2);
      db.prepare('UPDATE sales SET total = ?, vat_total = ? WHERE id = ?').run(total, vatTotal, saleId);

      // Ταμειακή κίνηση (πίστωση/είσπραξη)
      db.prepare(
        `INSERT INTO till_movements (datetime, user_id, sale_id, credit, method, reason)
         VALUES (datetime('now','localtime'), ?, ?, ?, ?, 'Πώληση')`
      ).run(user.id, saleId, total, body.payment_method);

      // Απόδειξη ταμειακής μέσω ASCII — μόνο σε λειτουργία «Εισιτήριο + Ταμειακή».
      let receiptFile: string | null = null;
      if (issueMode === 'cash_register' && fiscal?.export_folder) {
        const lines = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
        receiptFile = exportAsciiReceipt(fiscal.export_folder, {
          receiptNo: String(saleId).padStart(6, '0'),
          datetime: new Date().toISOString(),
          paymentMethod: body.payment_method,
          total,
          vatTotal,
          lines: lines.map((l) => ({
            description: l.title,
            qty: l.qty,
            unitPrice: l.unit_price,
            vatRate: l.vat_rate,
            lineTotal: l.line_total,
          })),
        });
        db.prepare("UPDATE sales SET fiscal_status = 'queued' WHERE id = ?").run(saleId);
      }

      serialGen.persist();
      return { saleId, total, vatTotal, tickets: previews, receiptFile };
      });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/UNIQUE|constraint/i.test(msg)) {
        return reply.code(409).send({ error: 'Κάποια θέση κρατήθηκε ήδη — ανανεώστε τη διαθεσιμότητα.' });
      }
      return reply.code(400).send({ error: msg });
    }

    // Άμεση αποστολή στον εκτυπωτή του σταθμού (δικτυακός) → χωρίς browser print.
    let dispatched = false;
    let dispatchInfo: string | undefined;
    if (issueMode !== 'disabled' && targetPrinter && targetPrinter.connection === 'network') {
      const tickets = (result as any).tickets as any[];
      try {
        if (printerType === 'zpl') {
          const zpl = tickets.map((t) => t.zpl ?? '').join('');
          await sendToNetworkPrinter(targetPrinter.address ?? '', Buffer.from(zpl, 'utf-8'));
        } else {
          const parts: Buffer[] = [];
          if (targetPrinter.drawer_kick) parts.push(DRAWER_KICK);
          for (const t of tickets) if (t.payloadBase64) parts.push(Buffer.from(t.payloadBase64, 'base64'));
          await sendToNetworkPrinter(targetPrinter.address ?? '', Buffer.concat(parts));
        }
        dispatched = true;
      } catch (e) {
        dispatchInfo = (e as Error).message; // αποτυχία αποστολής → fallback σε browser
      }
    }
    // Ο client τυπώνει από browser ΜΟΝΟ αν δεν στάλθηκε ήδη από τον server.
    const printTicket = issueMode !== 'disabled' && !dispatched;
    return { ...result, dispatched, dispatchInfo, printTicket, printerName: targetPrinter?.name ?? null };
  });

  // Λίστα πωλήσεων ημέρας (για επανεκτύπωση)
  app.get('/api/sales', { preHandler: authenticate }, async (req) => {
    const { date } = req.query as { date?: string };
    const day = date ?? localDate();
    const user = req.user as JwtUser;
    // cashier βλέπει μόνο δικές του· manager όλες
    const base =
      `SELECT s.*, u.username FROM sales s LEFT JOIN users u ON u.id = s.user_id
       WHERE date(s.datetime) = ?`;
    const sql = user.role === 'manager' ? base : base + ' AND s.user_id = ?';
    const rows =
      user.role === 'manager'
        ? db.prepare(base + ' ORDER BY s.id DESC').all(day)
        : db.prepare(sql + ' ORDER BY s.id DESC').all(day, user.id);
    return rows;
  });

  // Λεπτομέρειες πώλησης + εισιτήρια (επανεκτύπωση)
  app.get('/api/sales/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as any;
    if (!sale) return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
    const tickets = db
      .prepare(
        `SELECT t.* FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id WHERE si.sale_id = ?`
      )
      .all(id);
    return { sale, items, tickets };
  });

  // Λίστα εκδοθέντων εισιτηρίων. Ταμίας: μόνο σήμερα & δικά του. Manager: εύρος from..to & όλα.
  app.get('/api/tickets', { preHandler: authenticate }, async (req) => {
    const user = req.user as JwtUser;
    const { from, to } = req.query as { from?: string; to?: string };
    const todayStr = localDate();
    const fromDate = user.role === 'manager' ? (from ?? todayStr) : todayStr;
    const toDate = user.role === 'manager' ? (to ?? fromDate) : todayStr;

    const params: (string | number)[] = [fromDate, toDate];
    let sql =
      `SELECT t.id, t.serial, t.show_date, t.printed_at, t.checked_in_at,
              t.cancelled_at, t.cancel_reason,
              s.datetime, s.payment_method, s.id AS sale_id,
              si.title, si.unit_price,
              seat.display_name AS seat, sh.title AS show_title,
              u.username
       FROM tickets t
       JOIN sale_items si ON si.id = t.sale_item_id
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN seats seat ON seat.id = t.seat_id
       LEFT JOIN shows sh ON sh.id = t.show_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE date(s.datetime) BETWEEN ? AND ?`;
    if (user.role !== 'manager') { sql += ' AND s.user_id = ?'; params.push(user.id); }
    sql += ' ORDER BY t.id DESC LIMIT 1000';
    return db.prepare(sql).all(...params);
  });

  // Επανεκτύπωση εισιτηρίου (π.χ. αν καταστραφεί το χαρτί). Αυξάνει τον μετρητή επανεκτυπώσεων.
  app.post('/api/tickets/:id/reprint', { preHandler: authenticate }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const user = req.user as JwtUser;
    const t = db
      .prepare(
        `SELECT t.*, si.title, si.unit_price, si.vat_rate, si.ticket_type_id,
                s.payment_method, s.user_id
         FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id JOIN sales s ON s.id = si.sale_id
         WHERE t.id = ?`
      )
      .get(id) as any;
    if (!t) return reply.code(404).send({ error: 'Δεν βρέθηκε εισιτήριο' });
    // Ο ταμίας επανεκτυπώνει μόνο δικά του εισιτήρια.
    if (user.role !== 'manager' && t.user_id !== user.id)
      return reply.code(403).send({ error: 'Δεν επιτρέπεται' });

    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const fiscal = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    const issueMode: string = fiscal?.issue_mode ?? 'ticket_only';
    const legalNote = (issueMode === 'ticket_only' || issueMode === 'cash_register') ? (fiscal?.legal_note ?? 'Δεν αποτελεί φορολογικό παραστατικό') : '';
    const tplRow = db.prepare('SELECT * FROM print_templates WHERE id = 1').get() as any;
    let tpl: any = {};
    if (tplRow) {
      let p: any = {};
      try { p = JSON.parse(tplRow.params ?? '{}'); } catch { /* default */ }
      tpl = { header: tplRow.header, details: tplRow.details, footer: tplRow.footer, withQr: p.withQr !== false, codePage: p.codePage, escposPageId: p.escposPageId, sizes: p.sizes };
    }
    // Εκτυπωτής σταθμού (αν δηλωμένος) αλλιώς προεπιλεγμένος.
    const body = (req.body ?? {}) as { station?: string };
    let targetPrinter: any = null;
    if (body.station) {
      const st = db.prepare('SELECT * FROM stations WHERE name = ?').get(body.station) as any;
      if (st?.printer_id) targetPrinter = db.prepare('SELECT * FROM printers WHERE id = ?').get(st.printer_id);
    }
    if (!targetPrinter) targetPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    const printerType: PrinterType = (targetPrinter?.type as PrinterType) ?? (tplRow?.printer_type as PrinterType) ?? (venue?.default_printer_type as PrinterType) ?? 'escpos80';

    const tt = t.ticket_type_id ? (db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(t.ticket_type_id) as any) : null;
    const seat = t.seat_id ? (db.prepare('SELECT * FROM seats WHERE id = ?').get(t.seat_id) as any) : null;
    const show = t.show_id ? (db.prepare('SELECT * FROM shows WHERE id = ?').get(t.show_id) as any) : null;

    const ctx: TicketContext = {
      venueName: venue?.name ?? '',
      vatNumber: venue?.vat_number,
      address: venue?.address,
      cityLine: [venue?.postal_code, venue?.city].filter(Boolean).join(' '),
      phone: venue?.phone,
      email: venue?.email,
      title: t.title,
      subtitle: tt?.subtitle ?? show?.title,
      qty: 1,
      unitPrice: t.unit_price,
      lineTotal: t.unit_price,
      vatRate: t.vat_rate,
      serial: t.serial,
      datetime: formatGr(t.printed_at),  // ΑΡΧΙΚΗ ημ/ώρα έκδοσης (όχι τρέχουσα)
      paymentMethod: labelPayment(t.payment_method),
      seat: seat?.display_name,
      show: show?.title,
      legalNote,
      qrPayload: t.qr_payload ?? t.serial,
    };
    const rendered = renderTicket(ctx, printerType, tpl);
    db.prepare('UPDATE tickets SET reprinted_count = reprinted_count + 1 WHERE id = ?').run(id);

    // Άμεση αποστολή στον δικτυακό εκτυπωτή· αλλιώς ο client τυπώνει από browser.
    let dispatched = false; let dispatchInfo: string | undefined;
    if (targetPrinter && targetPrinter.connection === 'network') {
      try {
        if (printerType === 'zpl') await sendToNetworkPrinter(targetPrinter.address ?? '', Buffer.from(rendered.zpl ?? '', 'utf-8'));
        else if (rendered.payloadBase64) {
          const parts: Buffer[] = [];
          if (targetPrinter.drawer_kick) parts.push(DRAWER_KICK);
          parts.push(Buffer.from(rendered.payloadBase64, 'base64'));
          await sendToNetworkPrinter(targetPrinter.address ?? '', Buffer.concat(parts));
        }
        dispatched = true;
      } catch (e) { dispatchInfo = (e as Error).message; }
    }
    return { ...rendered, reprint: true, dispatched, dispatchInfo, printTicket: !dispatched };
  });

  // Ακύρωση εισιτηρίου (ΜΟΝΟ Διαχειριστής). Το εισιτήριο ΔΕΝ διαγράφεται:
  // διατηρείται ο αριθμός + σήμανση/αιτία/χρόνος/χρήστης (audit). Γίνεται αντιλογισμός
  // (επιστροφή) στο ταμείο και αφαιρείται η αξία από έσοδα/ΦΠΑ.
  app.post('/api/tickets/:id/cancel', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const user = req.user as JwtUser;
    const reason = String(((req.body ?? {}) as any).reason ?? '').trim();
    if (!reason) return reply.code(400).send({ error: 'Απαιτείται αιτία ακύρωσης' });
    const t = db.prepare(
      `SELECT t.id, t.serial, t.cancelled_at, si.id AS si_id, si.unit_price, si.vat_rate,
              s.id AS sale_id, s.payment_method
       FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id JOIN sales s ON s.id = si.sale_id
       WHERE t.id = ?`
    ).get(id) as any;
    if (!t) return reply.code(404).send({ error: 'Δεν βρέθηκε εισιτήριο' });
    if (t.cancelled_at) return reply.code(409).send({ error: 'Το εισιτήριο είναι ήδη ακυρωμένο' });
    const unit = +Number(t.unit_price || 0).toFixed(2);
    const vat = +((unit * (t.vat_rate || 0)) / (100 + (t.vat_rate || 0))).toFixed(2);
    tx(() => {
      db.prepare("UPDATE tickets SET cancelled_at = datetime('now','localtime'), cancelled_by = ?, cancel_reason = ? WHERE id = ?")
        .run(user.id, reason, id);
      // Καθαρή εικόνα εσόδων: μειώνεται το παραστατικό κατά την αξία του εισιτηρίου.
      db.prepare('UPDATE sale_items SET qty = MAX(0, qty - 1), line_total = ROUND(MAX(0, line_total - ?), 2) WHERE id = ?')
        .run(unit, t.si_id);
      db.prepare('UPDATE sales SET total = ROUND(MAX(0, total - ?), 2), vat_total = ROUND(MAX(0, vat_total - ?), 2) WHERE id = ?')
        .run(unit, vat, t.sale_id);
      // Αντιλογισμός (επιστροφή) στο ταμείο — αρνητική κίνηση.
      db.prepare(
        `INSERT INTO till_movements (datetime, user_id, sale_id, credit, method, reason)
         VALUES (datetime('now','localtime'), ?, ?, ?, ?, ?)`
      ).run(user.id, t.sale_id, -unit, t.payment_method, `Ακύρωση εισιτηρίου ${t.serial}`);
    });
    return { ok: true, serial: t.serial, refund: unit };
  });
}

function labelPayment(m: string): string {
  return m === 'cash' ? 'ΜΕΤΡΗΤΑ' : m === 'card' ? 'ΚΑΡΤΑ' : 'ΤΡΑΠΕΖΑ';
}

/** 'YYYY-MM-DD HH:MM:SS' → 'DD/MM/YYYY HH:MM' (για επανεκτύπωση με αρχική ώρα). */
function formatGr(dt?: string): string {
  if (!dt) return '';
  const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : dt;
}
