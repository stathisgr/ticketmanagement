// Συγχρονισμός τοπικής βάσης ↔ Supabase (cloud) για online κρατήσεις.
// Χρησιμοποιεί το service_role key (μόνο server-side) μέσω PostgREST upsert.
import { db } from '../db.js';
import { issueForSale, type FiscalOutcome } from '../fiscal/issue.js';
import { sendEmail, emailCfg, receiptEmailHtml } from './email.js';

/** Έκδοση ΑΠΥ για μια πώληση + (αν νέα & υπάρχει email) αποστολή 2ου email με σύνδεσμο PDF παρόχου. */
export async function issueAndEmailSale(saleId: number): Promise<FiscalOutcome | null> {
  const fr = await issueForSale(saleId);
  if (!fr || !fr.ok) return fr;
  if (fr.isNew && emailCfg()) {
    const sale = db.prepare('SELECT s.total, c.email, c.full_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?').get(saleId) as any;
    if (sale?.email) {
      const head = db.prepare('SELECT sh.title AS show_title, si.show_date FROM sale_items si LEFT JOIN shows sh ON sh.id = si.show_id WHERE si.sale_id = ? LIMIT 1').get(saleId) as any;
      const seatRows = db.prepare(
        `SELECT COALESCE(se.display_name, se.row_label || se.col_label) AS lbl
           FROM sale_items si LEFT JOIN seats se ON se.id = si.seat_id WHERE si.sale_id = ? AND si.seat_id IS NOT NULL`
      ).all(saleId) as any[];
      const venue = db.prepare('SELECT name FROM venue WHERE id = 1').get() as any;
      try {
        await sendEmail(
          sale.email,
          `Απόδειξη Παροχής Υπηρεσιών — ${head?.show_title ?? 'Κράτηση'}`,
          receiptEmailHtml({
            name: sale.full_name, showTitle: head?.show_title, showDate: head?.show_date,
            seats: seatRows.map((r) => r.lbl).filter(Boolean).join(', '),
            total: Number(sale.total) || 0, mark: fr.mark, link: fr.providerUrl ?? fr.qrUrl, venueName: venue?.name,
          }),
        );
      } catch { /* η αποτυχία email δεν επηρεάζει την έκδοση */ }
    }
  }
  return fr;
}

/** Έκδοση ΑΠΥ για όλες τις online πωλήσεις που ΔΕΝ έχουν διαβιβασμένο παραστατικό (επανέκδοση εκκρεμών). */
export async function issuePendingOnline(): Promise<{ pending: number; issued: number; failed: number }> {
  const rows = db.prepare(
    `SELECT s.id FROM sales s
      WHERE s.source = 'online'
        AND NOT EXISTS (SELECT 1 FROM fiscal_documents fd WHERE fd.sale_id = s.id AND fd.role = 'sale' AND fd.status = 'transmitted')
      ORDER BY s.id`
  ).all() as any[];
  let issued = 0; let failed = 0;
  for (const r of rows) {
    try { const fr = await issueAndEmailSale(r.id); if (fr?.ok) issued++; else failed++; }
    catch { failed++; }
  }
  return { pending: rows.length, issued, failed };
}

interface OnlineCfg { supabase_url: string; service_key: string; enabled: number; sync_minutes_before: number; }

function cfg(): OnlineCfg {
  const c = db.prepare('SELECT * FROM online_config WHERE id = 1').get() as any;
  if (!c?.supabase_url || !c?.service_key) throw new Error('Δεν έχει ρυθμιστεί η σύνδεση Supabase (URL + service key).');
  return c;
}

function headers(c: OnlineCfg, extra: Record<string, string> = {}) {
  return {
    apikey: c.service_key,
    Authorization: `Bearer ${c.service_key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(c: OnlineCfg, path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${c.supabase_url}/rest/v1/${path}`, init);
  const txt = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

/** Upsert (merge) με επιστροφή εγγραφών. */
async function upsert(c: OnlineCfg, table: string, onConflict: string, rows: any[]): Promise<any[]> {
  if (!rows.length) return [];
  return rest(c, `${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: headers(c, { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(rows),
  });
}

const euroToCents = (v: number) => Math.round(Number(v) * 100);

/** Λίστα ημερομηνιών 'YYYY-MM-DD' από from έως to (συμπεριλαμβανομένων). */
function dateRange(from: string, to: string, maxDays = 92): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end && out.length < maxDays) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Δημοσίευση θεάματος για ΕΥΡΟΣ ημερομηνιών (από–έως). Ένα cloud θέαμα ανά ημέρα,
 * με ημερήσια ώρα κλεισίματος online (closeTime 'HH:MM') για κάθε ημερομηνία.
 * Το εύρος κλιμακώνεται μέσα στο valid_from..valid_to του τοπικού θεάματος.
 */
export async function pushRange(
  showId: number, fromDate: string, toDate: string, closeTime: string,
): Promise<{ published: string[]; cloudIds: number[] }> {
  const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(showId) as any;
  if (!show) throw new Error('Δεν βρέθηκε θέαμα');
  // Περιορισμός μέσα στο εύρος ισχύος του θεάματος, αν υπάρχει.
  const vf = (show.valid_from ?? '').slice(0, 10);
  const vt = (show.valid_to ?? '').slice(0, 10);
  const from = vf && fromDate < vf ? vf : fromDate;
  const to = vt && toDate > vt ? vt : toDate;
  if (from > to) throw new Error('Το εύρος ημερομηνιών είναι εκτός ισχύος του θεάματος');

  const dates = dateRange(from, to);
  const published: string[] = []; const cloudIds: number[] = [];
  for (const d of dates) {
    const ct = closeTime && /^\d{2}:\d{2}$/.test(closeTime) ? closeTime : '17:00';
    const salesCloseAt = new Date(`${d}T${ct}:00`).toISOString(); // local→UTC
    const cloudId = await pushPublication(showId, d, salesCloseAt);
    published.push(d); cloudIds.push(cloudId);
  }
  return { published, cloudIds };
}

/**
 * Δημοσίευση ενός θεάματος (συγκεκριμένη ημερομηνία) στο cloud:
 * μεταφέρει το θέαμα, τους τύπους εισιτηρίων και ΟΛΕΣ τις θέσεις της αίθουσας (ως έχει).
 */
export async function pushPublication(showId: number, showDate: string, salesCloseAt: string | null): Promise<number> {
  const c = cfg();
  const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(showId) as any;
  if (!show) throw new Error('Δεν βρέθηκε θέαμα');
  const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;

  const isGeneral = show.seating_mode === 'general';
  // 1) Show (upsert ανά local_id + ημερομηνία)
  const [cloudShow] = await upsert(c, 'shows', 'local_id,show_date', [{
    local_id: show.id,
    title: show.title,
    subtitle: '',
    venue_name: venue?.name ?? '',
    show_date: showDate,
    start_time: show.start_time ?? '21:00',
    end_time: show.end_time ?? null,
    seating_mode: isGeneral ? 'general' : 'seated',
    online_capacity: isGeneral ? (show.capacity ?? 0) : 0,
    sales_close_at: salesCloseAt,
    image_url: show.poster_url ?? null,
    description: show.description ?? null,
    enabled: true,
  }]);
  const cloudShowId = cloudShow.id as number;

  // 2) Τύποι εισιτηρίων (local_id = show_ticket_types.id)
  const stts = db.prepare('SELECT * FROM show_ticket_types WHERE show_id = ? ORDER BY sort_order, id').all(showId) as any[];
  await upsert(c, 'ticket_types', 'show_id,local_id', stts.map((t) => ({
    local_id: t.id, show_id: cloudShowId, title: t.title,
    price_cents: euroToCents(t.price), vat_rate: t.vat_rate ?? 6, sort: t.sort_order ?? 0, enabled: true,
  })));

  // Για general events ΔΕΝ υπάρχουν θέσεις — τέλος εδώ.
  if (isGeneral) {
    db.prepare(
      `INSERT INTO online_publications (show_id, show_date, cloud_show_id, sales_close_at, enabled, pushed_at)
       VALUES (?, ?, ?, ?, 1, datetime('now','localtime'))
       ON CONFLICT(show_id, show_date) DO UPDATE SET
         cloud_show_id = excluded.cloud_show_id, sales_close_at = excluded.sales_close_at,
         enabled = 1, pushed_at = datetime('now','localtime')`
    ).run(showId, showDate, cloudShowId, salesCloseAt);
    return cloudShowId;
  }

  // 3) ΟΛΟΣ ο χάρτης της αίθουσας (θέσεις + διάδρομοι + κενά) με συντεταγμένες,
  //    ώστε το online seat-map να είναι ίδιο με του ταμείου.
  const cells = db.prepare(
    "SELECT * FROM seats WHERE hall_id = ? AND enabled = 1 ORDER BY y, x"
  ).all(show.hall_id) as any[];
  const label = (s: any) =>
    s.kind === 'seat' ? (s.display_name ?? `${s.row_label ?? ''}${s.col_label ?? ''}`) : `${s.kind}_${s.y}_${s.x}`;
  // Upsert ΧΩΡΙΣ status (ώστε να μη χαλάμε τυχόν online-πουλημένες σε επανα-push).
  await upsert(c, 'seats', 'show_id,local_seat_id', cells.map((s) => ({
    show_id: cloudShowId, local_seat_id: s.id, x: s.x, y: s.y, kind: s.kind,
    row_label: s.row_label ?? '', seat_label: label(s), channel: 'online',
  })));

  // 3b) Θέσεις ήδη πουλημένες ΑΠΟ ΤΟ ΤΑΜΕΙΟ για αυτή την ημερομηνία → sold online.
  const soldLocal = db.prepare(
    'SELECT DISTINCT seat_id FROM tickets WHERE show_id = ? AND show_date = ? AND seat_id IS NOT NULL'
  ).all(showId, showDate) as any[];
  const soldIds = soldLocal.map((r) => r.seat_id);
  if (soldIds.length) {
    await rest(c, `seats?show_id=eq.${cloudShowId}&local_seat_id=in.(${soldIds.join(',')})`, {
      method: 'PATCH', headers: headers(c, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ status: 'sold', sold_channel: 'box_office' }),
    });
  }

  // 4) Καταγραφή publication τοπικά
  db.prepare(
    `INSERT INTO online_publications (show_id, show_date, cloud_show_id, sales_close_at, enabled, pushed_at)
     VALUES (?, ?, ?, ?, 1, datetime('now','localtime'))
     ON CONFLICT(show_id, show_date) DO UPDATE SET
       cloud_show_id = excluded.cloud_show_id, sales_close_at = excluded.sales_close_at,
       enabled = 1, pushed_at = datetime('now','localtime')`
  ).run(showId, showDate, cloudShowId, salesCloseAt);

  return cloudShowId;
}

/**
 * Απόσυρση από online: ΠΡΩΤΑ κατεβάζει τυχόν online πωλήσεις τοπικά (να μη χαθούν),
 * ΜΕΤΑ ΔΙΑΓΡΑΦΕΙ το θέαμα + όλες τις εξαρτημένες εγγραφές από το cloud (καθαρή βάση).
 */
export async function unpublish(pubId: number): Promise<{ importedSales: number }> {
  const c = cfg();
  const pub = db.prepare('SELECT * FROM online_publications WHERE id = ?').get(pubId) as any;
  if (!pub) throw new Error('Δεν βρέθηκε δημοσίευση');
  let importedSales = 0;
  if (pub.cloud_show_id) {
    const webId = (db.prepare("SELECT id FROM users WHERE username = 'web'").get() as any)?.id ?? null;
    // 1) ασφάλεια: φέρε τυχόν online πωλήσεις τοπικά πριν σβήσουμε.
    importedSales = await importShowOrders(c, pub, webId);
    // 2) διαγραφή cloud: πρώτα orders (cascade order_items+tickets), μετά το show (cascade seats/types/holds).
    await rest(c, `orders?show_id=eq.${pub.cloud_show_id}`, { method: 'DELETE', headers: headers(c, { Prefer: 'return=minimal' }) });
    await rest(c, `shows?id=eq.${pub.cloud_show_id}`, { method: 'DELETE', headers: headers(c, { Prefer: 'return=minimal' }) });
  }
  // Σβήνουμε και την τοπική εγγραφή δημοσίευσης (δεν υπάρχει πια στο cloud).
  db.prepare('DELETE FROM online_publications WHERE id = ?').run(pubId);
  return { importedSales };
}

/** Εισαγωγή πληρωμένων online παραγγελιών ενός θεάματος → τοπικές πωλήσεις + εισιτήρια (idempotent). */
async function importShowOrders(c: OnlineCfg, pub: any, webId: number | null): Promise<number> {
  const cs = await rest(c, `seats?show_id=eq.${pub.cloud_show_id}&select=id,local_seat_id`, { method: 'GET', headers: headers(c) }) as any[];
  const seatMap = new Map<number, number>(); for (const s of cs) if (s.local_seat_id != null) seatMap.set(s.id, s.local_seat_id);
  const ct = await rest(c, `ticket_types?show_id=eq.${pub.cloud_show_id}&select=id,local_id`, { method: 'GET', headers: headers(c) }) as any[];
  const typeMap = new Map<number, number>(); for (const t of ct) if (t.local_id != null) typeMap.set(t.id, t.local_id);
  const tks = await rest(c,
    `tickets?show_id=eq.${pub.cloud_show_id}&select=serial,serial_uid,price_cents,seat_id,ticket_type_id,order_id,orders!inner(id,customer_name,customer_email,customer_phone,status)&orders.status=eq.paid`,
    { method: 'GET', headers: headers(c) }) as any[];
  const byOrder = new Map<number, any[]>();
  for (const r of tks) { if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, []); byOrder.get(r.order_id)!.push(r); }
  let imported = 0;
  const created: { saleId: number; email?: string; name?: string }[] = [];
  for (const [, items] of byOrder) {
    if (db.prepare('SELECT 1 FROM tickets WHERE serial = ?').get(items[0].serial)) continue; // idempotent
    const ord = items[0].orders ?? {};
    let custId: number | null = null;
    if (ord.customer_email) {
      const ex = db.prepare('SELECT id FROM customers WHERE email = ?').get(ord.customer_email) as any;
      custId = ex ? ex.id : Number(db.prepare('INSERT INTO customers (full_name, email, phone1) VALUES (?, ?, ?)')
        .run(ord.customer_name ?? ord.customer_email, ord.customer_email, ord.customer_phone ?? null).lastInsertRowid);
    }
    const total = items.reduce((s, i) => s + i.price_cents / 100, 0);
    const saleId = Number(db.prepare(
      "INSERT INTO sales (datetime, user_id, customer_id, payment_method, total, vat_total, source) VALUES (datetime('now','localtime'), ?, ?, 'card', ?, 0, 'online')"
    ).run(webId, custId, +total.toFixed(2)).lastInsertRowid);
    let vatTotal = 0;
    for (const it of items) {
      const localSeat = seatMap.get(it.seat_id) ?? null;
      const sttId = typeMap.get(it.ticket_type_id);
      const stt = sttId ? db.prepare('SELECT * FROM show_ticket_types WHERE id = ?').get(sttId) as any : null;
      const unit = it.price_cents / 100;
      const vatRate = stt?.vat_rate ?? 6;
      vatTotal += +((unit * vatRate) / (100 + vatRate)).toFixed(2);
      const siId = Number(db.prepare(
        `INSERT INTO sale_items (sale_id, ticket_type_id, show_id, show_date, seat_id, title, qty, unit_price, vat_rate, line_total)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).run(saleId, stt?.ticket_type_id ?? null, pub.show_id, pub.show_date, localSeat, stt?.title ?? 'Εισιτήριο online', unit, vatRate, unit).lastInsertRowid);
      try {
        db.prepare(
          `INSERT INTO tickets (sale_item_id, serial, qr_payload, show_id, show_date, seat_id, printed_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
        ).run(siId, it.serial, it.serial_uid, pub.show_id, pub.show_date, localSeat);
      } catch { /* θέση ήδη πουλημένη τοπικά ή διπλό serial — αγνόησε */ }
    }
    db.prepare('UPDATE sales SET vat_total = ? WHERE id = ?').run(+vatTotal.toFixed(2), saleId);
    created.push({ saleId, email: ord.customer_email ?? undefined, name: ord.customer_name ?? undefined });
    imported++;
  }

  // ── Έκδοση ΑΠΥ στον πάροχο για τις ΝΕΕΣ online πωλήσεις + 2ο email με σύνδεσμο PDF ──
  // (κάρτα → 2-step → ΜΑΡΚ). Αν δεν είναι ενεργή λειτουργία παρόχου → issueForSale=null (παράλειψη).
  for (const s of created) {
    try { await issueAndEmailSale(s.saleId); }
    catch { /* η αποτυχία έκδοσης/email δεν μπλοκάρει τον συγχρονισμό */ }
  }
  return imported;
}

/**
 * Κατέβασμα online-πουλημένων θέσεων → τοπικός πίνακας online_sold_seats,
 * ώστε ο ταμίας να τις βλέπει πιασμένες. Επιστρέφει πλήθος νέων.
 */
export async function pull(): Promise<{ pulled: number; importedSales: number; perShow: Record<number, number> }> {
  const c = cfg();
  const pubs = db.prepare('SELECT * FROM online_publications WHERE enabled = 1 AND cloud_show_id IS NOT NULL').all() as any[];
  let pulled = 0; let importedSales = 0; const perShow: Record<number, number> = {};
  const webId = (db.prepare("SELECT id FROM users WHERE username = 'web'").get() as any)?.id ?? null;

  for (const pub of pubs) {
    // (α) ΑΝΕΒΑΣΜΑ: θέσεις που πούλησε το ταμείο για αυτή την ημ/νία → sold(box_office) στο cloud.
    const soldLocal = db.prepare(
      'SELECT DISTINCT seat_id FROM tickets WHERE show_id = ? AND show_date = ? AND seat_id IS NOT NULL'
    ).all(pub.show_id, pub.show_date) as any[];
    const soldIds = soldLocal.map((r) => r.seat_id);
    if (soldIds.length) {
      await rest(c, `seats?show_id=eq.${pub.cloud_show_id}&local_seat_id=in.(${soldIds.join(',')})&sold_channel=is.null`, {
        method: 'PATCH', headers: headers(c, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ status: 'sold', sold_channel: 'box_office' }),
      });
    }
    // (β) ΚΑΤΕΒΑΣΜΑ: online πουλημένες θέσεις (sold_channel=online) με το local_seat_id τους.
    const rows = await rest(c,
      `seats?show_id=eq.${pub.cloud_show_id}&sold_channel=eq.online&select=local_seat_id`,
      { method: 'GET', headers: headers(c) });
    let n = 0;
    for (const r of rows as any[]) {
      if (r.local_seat_id == null) continue;
      const info = db.prepare(
        `INSERT INTO online_sold_seats (show_id, show_date, seat_id)
         VALUES (?, ?, ?) ON CONFLICT(show_id, show_date, seat_id) DO NOTHING`
      ).run(pub.show_id, pub.show_date, r.local_seat_id);
      if ((info as any).changes) n++;
    }
    perShow[pub.show_id] = n; pulled += n;

    // (γ) ΕΙΣΑΓΩΓΗ πληρωμένων online παραγγελιών → τοπικές πωλήσεις + εισιτήρια (πωλητής «web»).
    importedSales += await importShowOrders(c, pub, webId);

    db.prepare("UPDATE online_publications SET last_pull_at = datetime('now','localtime') WHERE id = ?").run(pub.id);
  }
  return { pulled, importedSales, perShow };
}
