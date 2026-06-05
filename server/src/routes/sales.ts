import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, tx, localDate, kindClause } from '../db.js';
import { authenticate, requireManager, type JwtUser } from '../auth.js';
import { renderTicket, renderRetail, type PrinterType } from '../print/index.js';
import type { TicketContext } from '../print/template.js';
import { exportAsciiReceipt } from '../fiscal/ascii.js';
import { sendToNetworkPrinter, DRAWER_KICK } from '../print/dispatch.js';
import { issueForSale, creditForSale } from '../fiscal/issue.js';
import { sendEmail, emailCfg, receiptEmailHtml } from '../online/email.js';

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
  viva_transaction_id?: string; // αριθμός συναλλαγής Viva (κάρτα) → δήλωση POS στον πάροχο
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
    const customer = body.customer_id ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(body.customer_id) as any) : null;
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

    // Συλλέγουμε τα contexts μέσα στη συναλλαγή και ΤΥΠΩΝΟΥΜΕ ΜΕΤΑ (ώστε, σε λειτουργία
    // παρόχου, να προλάβει να εκδοθεί το ΑΠΥ και να μπει το ΜΑΡΚ πάνω στο εισιτήριο).
    const renderCtx: TicketContext[] = [];
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
        customerName: customer?.full_name ?? '',
        customerVat: customer?.vat_number ?? '',
        ...over,
      });

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
            renderCtx.push(mkCtx({ title: stt.title, subtitle: show?.title, show: show?.title, showDate: dmyShow(showDate), showTime: show?.start_time ?? '', unitPrice: stt.price, lineTotal: stt.price, vatRate: stt.vat_rate, serial, qrPayload }));
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

          renderCtx.push(mkCtx({
            title: stt.title,
            subtitle: show?.title,
            show: show?.title,
            showDate: dmyShow(showDate),
            showTime: show?.start_time ?? '',
            seat: seat.display_name,
            unitPrice: stt.price,
            lineTotal: stt.price,
            vatRate: stt.vat_rate,
            serial,
            qrPayload,
          }));
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
          renderCtx.push(ctx);
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
      return { saleId, total, vatTotal, receiptFile };
      });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/UNIQUE|constraint/i.test(msg)) {
        return reply.code(409).send({ error: 'Κάποια θέση κρατήθηκε ήδη — ανανεώστε τη διαθεσιμότητα.' });
      }
      return reply.code(400).send({ error: msg });
    }

    // Λειτουργία παρόχου: έκδοση ΑΠΥ ΤΩΡΑ (μετά τη συναλλαγή) ώστε να μπει το ΜΑΡΚ στο εισιτήριο.
    let fiscalResult: { ok: boolean; mark?: string; qrUrl?: string; providerUrl?: string; isNew?: boolean; error?: string } | null = null;
    if (issueMode === 'provider') {
      try { fiscalResult = await issueForSale(result.saleId, { vivaTxId: body.viva_transaction_id }); }
      catch (e) { fiscalResult = { ok: false, error: (e as Error).message }; }
      // Αν ο πελάτης έχει δώσει email → στέλνουμε 2ο email με σύνδεσμο προς το επίσημο PDF του παρόχου.
      // (Άγνωστος πελάτης = λιανικής → μόνο εκτύπωση.)
      try {
        const cust = body.customer_id ? (db.prepare('SELECT full_name, email FROM customers WHERE id = ?').get(body.customer_id) as any) : null;
        if (fiscalResult?.ok && fiscalResult.isNew && cust?.email && emailCfg()) {
          const head = db.prepare(
            `SELECT s.title AS show_title, si.show_date FROM sale_items si LEFT JOIN shows s ON s.id = si.show_id WHERE si.sale_id = ? LIMIT 1`
          ).get(result.saleId) as any;
          const seatRows = db.prepare(
            `SELECT COALESCE(se.display_name, se.row_label || se.col_label) AS lbl
               FROM sale_items si LEFT JOIN seats se ON se.id = si.seat_id WHERE si.sale_id = ? AND si.seat_id IS NOT NULL`
          ).all(result.saleId) as any[];
          await sendEmail(
            cust.email,
            `Απόδειξη Παροχής Υπηρεσιών — ${head?.show_title ?? 'Αγορά'}`,
            receiptEmailHtml({
              name: cust.full_name, showTitle: head?.show_title, showDate: head?.show_date,
              seats: seatRows.map((r) => r.lbl).filter(Boolean).join(', '),
              total: Number(result.total) || 0, mark: fiscalResult.mark,
              link: fiscalResult.providerUrl ?? fiscalResult.qrUrl, venueName: venue?.name,
              payment: body.payment_method === 'card' ? 'Κάρτα' : 'Μετρητά',
            }),
          );
        }
      } catch { /* η αποτυχία email δεν επηρεάζει την πώληση */ }
    }
    // Τύπωμα εισιτηρίων (με ΜΑΡΚ αν εκδόθηκε· σε λειτουργία παρόχου φεύγει η ένδειξη «μη φορολογικό»).
    // Αν εκδόθηκε ΜΑΡΚ και η φόρμα δεν το περιλαμβάνει, προστίθεται αυτόματα ΜΑΡΚ + QR myDATA στο υποσέλιδο.
    let tplForRender = tpl;
    if (fiscalResult?.mark) {
      const footer = String(tpl.footer ?? '');
      if (!/\{\{\s*mark\s*\}\}/i.test(footer)) {
        tplForRender = { ...tpl, footer: footer + '\n[c]ΜΑΡΚ: {{mark}}' + (fiscalResult.qrUrl ? '\n[c][qrmark]' : '') };
      }
    }
    // Πώληση εμπορικών προϊόντων → ΜΙΑ τυποποιημένη ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ (όλα τα είδη μαζί + ΦΠΑ ανά
    // συντελεστή), όχι ξεχωριστά εισιτήρια. Υπηρεσίες/εισιτήρια → ως έχει (ένα εισιτήριο ανά είδος).
    const isProductSale = !!db.prepare(
      'SELECT 1 FROM sale_items si JOIN ticket_types tt ON tt.id = si.ticket_type_id WHERE si.sale_id = ? AND tt.kind = 1 LIMIT 1'
    ).get(result.saleId);
    let tickets;
    if (isProductSale) {
      // Μία ενοποιημένη Απόδειξη Λιανικής (επεξεργάσιμη φόρμα retail· είδη+ΦΠΑ+σύνολα αυτόματα).
      tickets = [renderRetail(buildRetailReceipt(result.saleId), printerType, retailForm())];
    } else {
      tickets = renderCtx.map((c) =>
        renderTicket({
          ...c, mark: fiscalResult?.mark, markQr: fiscalResult?.qrUrl,
          series: fiscalResult?.series, aa: fiscalResult?.aa, docType: fiscalResult?.docType,
          total: result.total,
          legalNote: issueMode === 'provider' ? '' : c.legalNote,
        }, printerType, tplForRender));
    }
    (result as any).tickets = tickets;

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
    return { ...result, tickets, dispatched, dispatchInfo, printTicket, printerName: targetPrinter?.name ?? null, fiscal: fiscalResult };
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
    const { from, to, kind } = req.query as { from?: string; to?: string; kind?: string };
    const todayStr = localDate();
    const fromDate = user.role === 'manager' ? (from ?? todayStr) : todayStr;
    const toDate = user.role === 'manager' ? (to ?? fromDate) : todayStr;

    const params: (string | number)[] = [fromDate, toDate];
    let sql =
      `SELECT t.id, t.serial, t.show_date, t.printed_at, t.checked_in_at,
              t.cancelled_at, t.cancel_reason, t.cancel_approver,
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
       WHERE date(s.datetime) BETWEEN ? AND ?` + kindClause(kind, 's');
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
                s.payment_method, s.user_id, s.total AS sale_total,
                c.full_name AS customer_name, c.vat_number AS customer_vat
         FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id JOIN sales s ON s.id = si.sale_id
         LEFT JOIN customers c ON c.id = s.customer_id
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
      showDate: dmyShow(t.show_date),
      showTime: show?.start_time ?? '',
      legalNote: t.fiscal_mark ? '' : legalNote,
      qrPayload: t.qr_payload ?? t.serial,
      // Στοιχεία παραστατικού αποθηκευμένα στο εισιτήριο → επανεκτύπωση εισιτηρίου+απόδειξης.
      customerName: t.customer_name ?? '',
      customerVat: t.customer_vat ?? '',
      docType: t.fiscal_doc_type ?? '',
      series: t.fiscal_series ?? '',
      aa: t.fiscal_aa ?? '',
      mark: t.fiscal_mark ?? '',
      markQr: t.fiscal_qr ?? '',
      total: t.sale_total != null ? Number(t.sale_total) : undefined,
    };
    // Αν το εισιτήριο φέρει ΜΑΡΚ και η φόρμα δεν το περιλαμβάνει, προστίθεται αυτόματα ΜΑΡΚ + QR.
    let tpl2 = tpl;
    if (t.fiscal_mark) {
      const footer = String(tpl.footer ?? '');
      if (!/\{\{\s*mark\s*\}\}/i.test(footer)) {
        tpl2 = { ...tpl, footer: footer + '\n[c]ΜΑΡΚ: {{mark}}' + (t.fiscal_qr ? '\n[c][qrmark]' : '') };
      }
    }
    // Αν η πώληση είναι εμπορικά προϊόντα → επανεκτύπωση της ΑΠΟΔΕΙΞΗΣ ΛΙΑΝΙΚΗΣ (ενοποιημένη), όχι εισιτηρίου.
    const saleIdR = (db.prepare('SELECT sale_id FROM sale_items WHERE id = ?').get(t.sale_item_id) as any)?.sale_id;
    const rendered = (saleIdR && saleIsProduct(saleIdR))
      ? renderRetail(buildRetailReceipt(saleIdR), printerType, retailForm())
      : renderTicket(ctx, printerType, tpl2);
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

  // Εκτύπωση/επανεκτύπωση ΑΠΟΔΕΙΞΗΣ ΛΙΑΝΙΚΗΣ (προϊόντα) — ενοποιημένη, όλα τα είδη μαζί.
  app.post('/api/fiscal/documents/retail-print', { preHandler: requireManager }, async (req, reply) => {
    const { saleId } = (req.body ?? {}) as { saleId?: number };
    if (!saleId) return reply.code(400).send({ error: 'Λείπει το saleId.' });
    const venue = db.prepare('SELECT default_printer_type FROM venue WHERE id = 1').get() as any;
    const targetPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get() as any;
    const printerType: PrinterType = (targetPrinter?.type as PrinterType) ?? (venue?.default_printer_type as PrinterType) ?? 'escpos80';
    const r = renderRetail(buildRetailReceipt(Number(saleId)), printerType, retailForm());
    return { previews: [r.preview] };
  });

  // Εκτύπωση ΠΙΣΤΩΤΙΚΟΥ (όχι εισιτηρίου) — δείχνει στοιχεία πιστωτικού: τύπο, σειρά/ΑΑ, ΜΑΡΚ, είδη.
  app.post('/api/fiscal/documents/credit-print', { preHandler: requireManager }, async (req, reply) => {
    const { docId } = (req.body ?? {}) as { docId?: number };
    const doc = db.prepare("SELECT * FROM fiscal_documents WHERE id = ? AND role = 'credit'").get(Number(docId)) as any;
    if (!doc) return reply.code(404).send({ error: 'Δεν βρέθηκε πιστωτικό' });
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(doc.sale_id) as any;
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(doc.sale_id) as any[];
    const customer = sale?.customer_id ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id) as any) : null;
    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const tplRow = db.prepare('SELECT * FROM print_templates WHERE id = 1').get() as any;
    let tpl: any = {};
    if (tplRow) {
      let p: any = {}; try { p = JSON.parse(tplRow.params ?? '{}'); } catch { /* default */ }
      tpl = { header: tplRow.header, details: tplRow.details, footer: tplRow.footer, withQr: p.withQr !== false, codePage: p.codePage, escposPageId: p.escposPageId, sizes: p.sizes };
    }
    const targetPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get() as any;
    const printerType: PrinterType = (targetPrinter?.type as PrinterType) ?? (tplRow?.printer_type as PrinterType) ?? (venue?.default_printer_type as PrinterType) ?? 'escpos80';
    let tpl2 = tpl;
    if (doc.mark) {
      const footer = String(tpl.footer ?? '');
      if (!/\{\{\s*mark\s*\}\}/i.test(footer)) tpl2 = { ...tpl, footer: footer + '\n[c]ΜΑΡΚ: {{mark}}' + (doc.qr_url ? '\n[c][qrmark]' : '') };
    }
    const dtv = (s?: string) => (s ? s.replace('T', ' ').slice(0, 16) : '');
    const previews = items.map((it: any) => {
      const show = it.show_id ? (db.prepare('SELECT title FROM shows WHERE id = ?').get(it.show_id) as any) : null;
      const seat = it.seat_id ? (db.prepare('SELECT display_name FROM seats WHERE id = ?').get(it.seat_id) as any) : null;
      const r = renderTicket({
        venueName: venue?.name ?? '', vatNumber: venue?.vat_number, address: venue?.address,
        cityLine: [venue?.postal_code, venue?.city].filter(Boolean).join(' '), phone: venue?.phone, email: venue?.email,
        title: it.title, subtitle: show?.title, qty: Number(it.qty) || 1, unitPrice: it.unit_price, lineTotal: it.line_total, vatRate: it.vat_rate,
        serial: '', datetime: dtv(doc.created_at), paymentMethod: 'ΕΠΙΣΤΡΟΦΗ', seat: seat?.display_name, show: show?.title, legalNote: '',
        customerName: customer?.full_name ?? '', customerVat: customer?.vat_number ?? '',
        docType: 'ΠΙΣΤΩΤΙΚΟ ΣΤΟΙΧ. ΛΙΑΝΙΚΗΣ', series: doc.series, aa: String(doc.aa), mark: doc.mark, markQr: doc.qr_url,
        total: Number(doc.total), qrPayload: doc.mark ?? '',
      }, printerType, tpl2);
      return (r as any).preview as string;
    });
    return { previews };
  });

  // Έκδοση Πιστωτικού για επιλεγμένα παραστατικά (σελίδα «Παραστατικά»): εκδίδει ΠΑΠΥ στον πάροχο
  // ΚΑΙ κάνει πλήρη τοπικό αντιλογισμό (ακύρωση εισιτηρίων, μείωση τζίρου/ΦΠΑ, αρνητική κίνηση ταμείου)
  // ώστε η επιστροφή να ΜΗΝ μετράει ως έσοδο.
  app.post('/api/fiscal/documents/credit', { preHandler: requireManager }, async (req, reply) => {
    const { saleIds, reason } = (req.body ?? {}) as { saleIds?: number[]; reason?: string };
    if (!Array.isArray(saleIds) || !saleIds.length) return reply.code(400).send({ error: 'Δεν επιλέχθηκαν παραστατικά.' });
    const user = req.user as JwtUser;
    const why = (reason && reason.trim()) || 'Έκδοση πιστωτικού / επιστροφή';
    const results: { saleId: number; ok: boolean; mark?: string; error?: string }[] = [];
    for (const sid of saleIds) {
      const saleId = Number(sid);
      try {
        // 1) ΠΡΩΤΑ το παραστατικό (διαβάζει είδη/ποσά στις αρχικές τιμές).
        const credit = await creditForSale(saleId, why);
        if (!credit || !credit.ok) { results.push({ saleId, ok: false, error: credit?.error ?? 'Αποτυχία έκδοσης πιστωτικού' }); continue; }
        // 2) Τοπικός αντιλογισμός όλων των μη-ακυρωμένων εισιτηρίων της πώλησης.
        const tks = db.prepare(
          `SELECT t.id, t.serial, si.id AS si_id, si.unit_price, si.vat_rate, s.payment_method
             FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id JOIN sales s ON s.id = si.sale_id
            WHERE si.sale_id = ? AND t.cancelled_at IS NULL`
        ).all(saleId) as any[];
        tx(() => {
          for (const t of tks) {
            const unit = +Number(t.unit_price || 0).toFixed(2);
            const vat = +((unit * (t.vat_rate || 0)) / (100 + (t.vat_rate || 0))).toFixed(2);
            db.prepare("UPDATE tickets SET cancelled_at = datetime('now','localtime'), cancelled_by = ?, cancel_reason = ? WHERE id = ?").run(user.id, why, t.id);
            db.prepare('UPDATE sale_items SET qty = MAX(0, qty - 1), line_total = ROUND(MAX(0, line_total - ?), 2) WHERE id = ?').run(unit, t.si_id);
            db.prepare('UPDATE sales SET total = ROUND(MAX(0, total - ?), 2), vat_total = ROUND(MAX(0, vat_total - ?), 2) WHERE id = ?').run(unit, vat, saleId);
            db.prepare("INSERT INTO till_movements (datetime, user_id, sale_id, credit, method, reason) VALUES (datetime('now','localtime'), ?, ?, ?, ?, ?)").run(user.id, saleId, -unit, t.payment_method, `Πιστωτικό/επιστροφή ${t.serial}`);
          }
        });
        results.push({ saleId, ok: true, mark: credit.mark });
      } catch (e) { results.push({ saleId, ok: false, error: (e as Error).message }); }
    }
    return { results, issued: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  });

  // Ακύρωση εισιτηρίου (ΜΟΝΟ Διαχειριστής). Το εισιτήριο ΔΕΝ διαγράφεται:
  // διατηρείται ο αριθμός + σήμανση/αιτία/χρόνος/χρήστης (audit). Γίνεται αντιλογισμός
  // (επιστροφή) στο ταμείο και αφαιρείται η αξία από έσοδα/ΦΠΑ.
  app.post('/api/tickets/:id/cancel', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const user = req.user as JwtUser;
    const body = (req.body ?? {}) as { reason?: string; approver?: string };
    const reason = String(body.reason ?? '').trim();
    const approver = String(body.approver ?? '').trim();
    if (!reason) return reply.code(400).send({ error: 'Απαιτείται αιτία ακύρωσης' });
    const t = db.prepare(
      `SELECT t.id, t.serial, t.cancelled_at, t.show_date, si.id AS si_id, si.unit_price, si.vat_rate,
              s.id AS sale_id, s.payment_method, date(s.datetime) AS sale_date
       FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id JOIN sales s ON s.id = si.sale_id
       WHERE t.id = ?`
    ).get(id) as any;
    if (!t) return reply.code(404).send({ error: 'Δεν βρέθηκε εισιτήριο' });
    if (t.cancelled_at) return reply.code(409).send({ error: 'Το εισιτήριο είναι ήδη ακυρωμένο' });
    // Ημ. που «αφορά» το εισιτήριο = ημ. εκδήλωσης (αλλιώς ημ. πώλησης για λιανική POS).
    const eventDate: string = (t.show_date || t.sale_date || '').slice(0, 10);
    const isPast = !!eventDate && eventDate < localDate();
    // ΦΟΡΟΛΟΓΙΚΗ ΔΙΚΛΕΙΔΑ: εισιτήρια εκδηλώσεων που έχουν ΗΔΗ γίνει δεν ακυρώνονται
    // κανονικά — επιτρέπεται μόνο ως ΔΙΟΡΘΩΣΗ με Ονοματεπώνυμο Εγκρίνοντος.
    if (isPast && !approver) {
      return reply.code(422).send({
        error: 'Η εκδήλωση έχει ήδη γίνει. Απαιτείται το Ονοματεπώνυμο Εγκρίνοντος για φορολογική διόρθωση.',
        requiresApprover: true, eventDate,
      });
    }
    const unit = +Number(t.unit_price || 0).toFixed(2);
    const vat = +((unit * (t.vat_rate || 0)) / (100 + (t.vat_rate || 0))).toFixed(2);
    tx(() => {
      db.prepare("UPDATE tickets SET cancelled_at = datetime('now','localtime'), cancelled_by = ?, cancel_reason = ?, cancel_approver = ? WHERE id = ?")
        .run(user.id, reason, approver || null, id);
      // Καθαρή εικόνα εσόδων: μειώνεται το παραστατικό κατά την αξία του εισιτηρίου.
      db.prepare('UPDATE sale_items SET qty = MAX(0, qty - 1), line_total = ROUND(MAX(0, line_total - ?), 2) WHERE id = ?')
        .run(unit, t.si_id);
      db.prepare('UPDATE sales SET total = ROUND(MAX(0, total - ?), 2), vat_total = ROUND(MAX(0, vat_total - ?), 2) WHERE id = ?')
        .run(unit, vat, t.sale_id);
      // Αντιλογισμός (επιστροφή) στο ταμείο — αρνητική κίνηση.
      db.prepare(
        `INSERT INTO till_movements (datetime, user_id, sale_id, credit, method, reason)
         VALUES (datetime('now','localtime'), ?, ?, ?, ?, ?)`
      ).run(user.id, t.sale_id, -unit, t.payment_method,
        isPast ? `ΔΙΟΡΘΩΣΗ ακύρωσης ${t.serial} (εκδ. ${eventDate}) — Εγκρ.: ${approver}` : `Ακύρωση εισιτηρίου ${t.serial}`);
    });
    // Λειτουργία παρόχου: έκδοση Πιστωτικού (αντιλογιστικό) για την αξία του εισιτηρίου.
    let credit: { ok: boolean; mark?: string; error?: string } | null = null;
    try { credit = await creditForSale(t.sale_id, reason, { net: +(unit - vat).toFixed(2), vat, total: unit }); }
    catch (e) { credit = { ok: false, error: (e as Error).message }; }
    return { ok: true, serial: t.serial, refund: unit, isPast, eventDate, credit };
  });
}

function labelPayment(m: string): string {
  return m === 'cash' ? 'ΜΕΤΡΗΤΑ' : m === 'card' ? 'ΚΑΡΤΑ' : 'ΤΡΑΠΕΖΑ';
}

/** Μορφοποίηση ημ/νίας θεάματος YYYY-MM-DD → DD/MM/YYYY για εκτύπωση. */
function dmyShow(s?: string): string {
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : (s ?? '');
}

/** Είναι η πώληση εμπορικών προϊόντων (κάποιο είδος με kind=1); */
function saleIsProduct(saleId: number): boolean {
  return !!db.prepare('SELECT 1 FROM sale_items si JOIN ticket_types tt ON tt.id = si.ticket_type_id WHERE si.sale_id = ? AND tt.kind = 1 LIMIT 1').get(saleId);
}

/** Επεξεργάσιμη φόρμα Απόδειξης Λιανικής (header/footer/showVat + code page) από print_templates. */
function retailForm(): { header?: string; footer?: string; showVat: boolean } {
  const r = db.prepare("SELECT header, footer, params FROM print_templates WHERE doc_type = 'retail' ORDER BY id LIMIT 1").get() as any;
  let p: any = {}; try { p = JSON.parse(r?.params ?? '{}'); } catch { /* default */ }
  return { header: r?.header || undefined, footer: r?.footer || undefined, showVat: p.showVat !== false };
}

/** Δομή ΑΠΟΔΕΙΞΗΣ ΛΙΑΝΙΚΗΣ από αποθηκευμένη πώληση (για επανεκτύπωση/εκτύπωση όλων των ειδών μαζί). */
function buildRetailReceipt(saleId: number): any {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as any;
  const items = db.prepare('SELECT title, qty, unit_price, line_total, vat_rate FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
  const customer = sale?.customer_id ? (db.prepare('SELECT full_name, vat_number FROM customers WHERE id = ?').get(sale.customer_id) as any) : null;
  const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
  const fd = db.prepare("SELECT series, aa, mark, qr_url FROM fiscal_documents WHERE sale_id = ? AND role = 'sale' AND status = 'transmitted' ORDER BY id DESC LIMIT 1").get(saleId) as any;
  const tk = db.prepare("SELECT fiscal_doc_type FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id WHERE si.sale_id = ? AND t.fiscal_doc_type IS NOT NULL LIMIT 1").get(saleId) as any;
  // Code page / ESC ελληνικών κληρονομείται από τις υφιστάμενες ρυθμίσεις φόρμας εισιτηρίου (id=1).
  const tplRow = db.prepare('SELECT params FROM print_templates WHERE id = 1').get() as any;
  let tp: any = {}; try { tp = JSON.parse(tplRow?.params ?? '{}'); } catch { /* default */ }
  return {
    venueName: venue?.name ?? '', vatNumber: venue?.vat_number, address: venue?.address,
    cityLine: [venue?.postal_code, venue?.city].filter(Boolean).join(' '), phone: venue?.phone, taxOffice: venue?.tax_office,
    docType: tk?.fiscal_doc_type || 'ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ', series: fd?.series, aa: fd?.aa,
    datetime: String(sale?.datetime ?? '').replace('T', ' ').slice(0, 16),
    customerName: customer?.full_name, customerVat: customer?.vat_number,
    items: items.map((it) => ({ name: it.title, qty: Number(it.qty) || 1, unitPrice: Number(it.unit_price) || 0, lineTotal: Number(it.line_total) || 0, vatRate: Number(it.vat_rate) || 0 })),
    total: Number(sale?.total) || 0, paymentMethod: labelPayment(sale?.payment_method),
    mark: fd?.mark, markQr: fd?.qr_url, legalNote: '',
    codePage: tp.codePage, escposPageId: tp.escposPageId,
  };
}

/** 'YYYY-MM-DD HH:MM:SS' → 'DD/MM/YYYY HH:MM' (για επανεκτύπωση με αρχική ώρα). */
function formatGr(dt?: string): string {
  if (!dt) return '';
  const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : dt;
}
