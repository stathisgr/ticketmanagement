import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { authenticate, requireManager } from '../auth.js';
import { RapidSignProvider, vatCatIdFromRate, type FiscalEnv } from '../fiscal/rapidsign.js';
import { VivaProvider, type VivaEnv } from '../fiscal/viva.js';
import { sendEmail, receiptEmailHtml } from '../online/email.js';
import { issuePendingOnline } from '../online/sync.js';

export default async function venueRoutes(app: FastifyInstance) {
  app.get('/api/venue', { preHandler: authenticate }, async () => {
    return db.prepare('SELECT * FROM venue WHERE id = 1').get();
  });

  app.put('/api/venue', { preHandler: requireManager }, async (req) => {
    const b = req.body as any;
    const pos_mode = ['serial', 'halls', 'both'].includes(b.pos_mode) ? b.pos_mode : 'both';
    const numbering_mode = b.numbering_mode === 'per_type' ? 'per_type' : 'unified';
    db.prepare(
      `UPDATE venue SET name=@name, vat_number=@vat_number, tax_office=@tax_office, address=@address,
        postal_code=@postal_code, city=@city, phone=@phone, email=@email, default_vat=@default_vat,
        pos_mode=@pos_mode, default_printer_type=@dpt,
        numbering_mode=@numbering_mode, serial_next=@serial_next, serial_width=@serial_width,
        checkin_window_min=@checkin_window_min WHERE id = 1`
    ).run({
      name: b.name ?? '',
      vat_number: b.vat_number ?? null,
      tax_office: b.tax_office ?? null,
      address: b.address ?? null,
      postal_code: b.postal_code ?? null,
      city: b.city ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      default_vat: b.default_vat ?? 24,
      pos_mode,
      dpt: ['escpos58', 'escpos80', 'zpl'].includes(b.default_printer_type) ? b.default_printer_type : 'escpos80',
      numbering_mode,
      serial_next: Math.max(1, Number(b.serial_next) || 1),
      serial_width: Math.min(12, Math.max(1, Number(b.serial_width) || 6)),
      checkin_window_min: Math.max(0, Number(b.checkin_window_min ?? 30)),
    });
    return db.prepare('SELECT * FROM venue WHERE id = 1').get();
  });

  // Πρότυπο εκτύπωσης εισιτηρίου (singleton id=1)
  app.get('/api/print-template', { preHandler: authenticate }, async () => {
    let row = db.prepare('SELECT * FROM print_templates WHERE id = 1').get();
    if (!row) {
      db.prepare(
        `INSERT INTO print_templates (id, name, printer_type, header, details, footer, params, is_default)
         VALUES (1, 'Προεπιλογή', 'escpos80', @h, @d, @f, '{"withQr":true,"codePage":"cp737","escposPageId":14,"sizes":{"header":2,"details":1,"footer":1}}', 1)`
      ).run({
        h: '{{venueName}}\nΑΦΜ: {{vatNumber}}\n{{address}}\n{{cityLine}}\nΤΗΛ: {{phone}}',
        d: '{{title}}\n{{subtitle}}\n{{qty}} x {{unitPrice}} = {{lineTotal}} EUR\nΦΠΑ {{vatRate}}%  |  {{paymentMethod}}',
        f: 'No: {{serial}}\n{{datetime}}\n{{legalNote}}\nΕυχαριστούμε!',
      });
      row = db.prepare('SELECT * FROM print_templates WHERE id = 1').get();
    }
    return row;
  });

  app.put('/api/print-template', { preHandler: requireManager }, async (req) => {
    const b = req.body as any;
    const pt = ['escpos58', 'escpos80', 'zpl'].includes(b.printer_type) ? b.printer_type : 'escpos80';
    const clampSize = (n: any) => Math.max(1, Math.min(4, Number(n) || 1));
    const params = JSON.stringify({
      withQr: b.withQr !== false,
      qrContent: b.qrContent === 'serial' ? 'serial' : 'serial_uid',
      codePage: b.codePage || 'cp737',
      escposPageId: Number.isFinite(Number(b.escposPageId)) ? Number(b.escposPageId) : 14,
      sizes: {
        header: clampSize(b.sizes?.header ?? 2),
        details: clampSize(b.sizes?.details ?? 1),
        footer: clampSize(b.sizes?.footer ?? 1),
      },
    });
    const exists = db.prepare('SELECT 1 FROM print_templates WHERE id = 1').get();
    if (exists) {
      db.prepare(
        `UPDATE print_templates SET name=@name, printer_type=@pt, header=@h, details=@d, footer=@f, params=@params WHERE id = 1`
      ).run({ name: b.name ?? 'Προεπιλογή', pt, h: b.header ?? '', d: b.details ?? '', f: b.footer ?? '', params });
    } else {
      db.prepare(
        `INSERT INTO print_templates (id, name, printer_type, header, details, footer, params, is_default)
         VALUES (1, @name, @pt, @h, @d, @f, @params, 1)`
      ).run({ name: b.name ?? 'Προεπιλογή', pt, h: b.header ?? '', d: b.details ?? '', f: b.footer ?? '', params });
    }
    return db.prepare('SELECT * FROM print_templates WHERE id = 1').get();
  });

  // Fiscal config
  app.get('/api/fiscal', { preHandler: requireManager }, async () => {
    return db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get();
  });

  app.put('/api/fiscal', { preHandler: requireManager }, async (req) => {
    const b = req.body as any;
    const cur = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    // MERGE: ενημερώνουμε ΜΟΝΟ τα πεδία που στάλθηκαν (ώστε POS & Πάροχος να αποθηκεύονται ανεξάρτητα).
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const issue_mode = has('issue_mode')
      ? (['disabled', 'ticket_only', 'cash_register', 'provider'].includes(b.issue_mode) ? b.issue_mode : 'ticket_only')
      : cur.issue_mode;
    const mode = issue_mode === 'cash_register' ? 'cash_register_file' : issue_mode === 'provider' ? 'e_invoicing' : 'none';
    const pos_provider = has('pos_provider')
      ? (['none', 'viva'].includes(b.pos_provider) ? b.pos_provider : 'none')
      : cur.pos_provider;
    db.prepare(
      `UPDATE fiscal_config SET mode=@mode, issue_mode=@issue_mode, legal_note=@legal_note, export_folder=@export_folder,
        provider=@provider, config=@config, pos_provider=@pos_provider, pos_config=@pos_config WHERE id = 1`
    ).run({
      mode,
      issue_mode,
      legal_note: has('legal_note') ? (b.legal_note ?? 'Δεν αποτελεί φορολογικό παραστατικό') : cur.legal_note,
      export_folder: has('export_folder') ? (b.export_folder ?? null) : cur.export_folder,
      provider: has('provider') ? (b.provider ?? null) : cur.provider,
      config: has('config') ? (b.config ? JSON.stringify(b.config) : null) : cur.config,
      pos_provider,
      pos_config: has('pos_config') ? (b.pos_config ? JSON.stringify(b.pos_config) : null) : cur.pos_config,
    });
    return db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get();
  });

  // Δοκιμή σύνδεσης με τον πάροχο (RapidSign) — επαληθεύει credentials & επιστρέφει lookups.
  app.post('/api/fiscal/provider/test', { preHandler: requireManager }, async (_req, reply) => {
    const row = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    let cfg: any = {};
    try { cfg = JSON.parse(row?.config ?? '{}'); } catch { /* ignore */ }
    if (!cfg.username || !cfg.password || !cfg.activationCode)
      return reply.code(400).send({ error: 'Συμπλήρωσε & αποθήκευσε username / password / activationCode πρώτα.' });
    const provider = new RapidSignProvider({
      env: (cfg.env as FiscalEnv) === 'prod' ? 'prod' : 'dev',
      username: cfg.username, password: cfg.password, activationCode: cfg.activationCode,
    });
    const res = await provider.testConnection();
    return res;
  });

  // Δοκιμαστική ΕΚΔΟΣΗ παραστατικού (ΑΠΥ) — επιβεβαιώνει όλη την αλυσίδα (auth→refresh→PostInvoice1155).
  // Επιστρέφει MARK / QR. ΠΡΟΣΟΧΗ: χρησιμοποιεί το ΑΦΜ εκδότη που έχει ρυθμιστεί (demo: 619333103).
  app.post('/api/fiscal/provider/test-invoice', { preHandler: requireManager }, async (_req, reply) => {
    const row = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    let cfg: any = {};
    try { cfg = JSON.parse(row?.config ?? '{}'); } catch { /* ignore */ }
    if (!cfg.username || !cfg.password || !cfg.activationCode)
      return reply.code(400).send({ error: 'Συμπλήρωσε & αποθήκευσε username / password / activationCode πρώτα.' });
    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const apy = (cfg.docs && cfg.docs.apy) || {};
    const provider = new RapidSignProvider({
      env: (cfg.env as FiscalEnv) === 'prod' ? 'prod' : 'dev',
      username: cfg.username, password: cfg.password, activationCode: cfg.activationCode,
    });
    const res = await provider.postInvoice({
      invoiceTypeId: Number(apy.invoiceTypeId) || 20,
      series: apy.series || cfg.series || 'ΑΠY', aa: String(Date.now() % 1000000), counter: 1,
      issueDate: new Date().toISOString(), currencyId: 47,
      issuer: {
        vatNumber: cfg.issuerVat || venue?.vat_number || '619333103', countryId: 87, branch: Number(apy.branch) || 0,
        name: venue?.name || 'MAT S.A.', activity: '', taxOffice: venue?.tax_office || '',
        phone: venue?.phone || '', email: venue?.email || '',
        address: { City: venue?.city || '', PostalCode: venue?.postal_code || '', Street: venue?.address || '', Number: '' },
      },
      lines: [{
        code: 'TEST', name: 'Δοκιμαστικό εισιτήριο', qty: 1, unitPriceInclVat: 12.4,
        netValue: 10.0, vatAmount: 2.4, vatCatId: vatCatIdFromRate(24),
        incomeCatId: Number.isFinite(Number(apy.incomeCatId)) ? Number(apy.incomeCatId) : 2,
        incomeValId: Number.isFinite(Number(apy.incomeValId)) ? Number(apy.incomeValId) : 8,
      }],
      payments: [{ payGuid: randomUUID(), paymentId: Number(apy.paymentCashId) || 3, net: 10.0, vat: 2.4, amount: 12.4,
        paymentStatus: Number(apy.paymentStatus) || 2, acquirerId: Number(apy.acquirerId) || 122 }],
    });
    return res;
  });

  // Διάγνωση: τα τελευταία παραστατικά που διαβιβάστηκαν (ή απέτυχαν) στον πάροχο.
  app.get('/api/fiscal/documents', { preHandler: requireManager }, async () => {
    return db.prepare(
      `SELECT id, sale_id, role, status, invoice_type_id, series, mark, qr_url, total, created_at, raw
       FROM fiscal_documents ORDER BY id DESC LIMIT 20`
    ).all();
  });

  // Αναλυτική λίστα παραστατικών (σελίδα «Παραστατικά») με φίλτρα ημ/νιών + αναζήτηση.
  app.get('/api/fiscal/documents/list', { preHandler: requireManager }, async (req) => {
    const { from, to, q } = (req.query ?? {}) as { from?: string; to?: string; q?: string };
    const where: string[] = ['1=1'];   // όλα τα παραστατικά (ΑΠΥ + Πιστωτικά)
    const params: any[] = [];
    if (from) { where.push('date(fd.created_at) >= date(?)'); params.push(from); }
    if (to) { where.push('date(fd.created_at) <= date(?)'); params.push(to); }
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      where.push('(c.full_name LIKE ? OR fd.aa LIKE ? OR fd.mark LIKE ? OR CAST(fd.sale_id AS TEXT) LIKE ?)');
      params.push(like, like, like, like);
    }
    return db.prepare(
      `SELECT fd.id, fd.sale_id, fd.role, fd.invoice_type_id, fd.series, fd.aa, fd.mark, fd.status,
              fd.net, fd.vat, fd.total, fd.created_at, fd.raw, fd.guid, fd.qr_url, fd.qr_provider, fd.correlated_mark,
              c.full_name AS customer_name, c.vat_number AS customer_vat,
              (SELECT si.show_date FROM sale_items si WHERE si.sale_id = fd.sale_id LIMIT 1) AS show_date,
              (SELECT sh.start_time FROM sale_items si JOIN shows sh ON sh.id = si.show_id WHERE si.sale_id = fd.sale_id LIMIT 1) AS show_time,
              (SELECT COUNT(*) FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id WHERE si.sale_id = fd.sale_id) AS ticket_count,
              (SELECT GROUP_CONCAT(t.id) FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id WHERE si.sale_id = fd.sale_id) AS ticket_ids,
              EXISTS(SELECT 1 FROM fiscal_documents cr WHERE cr.sale_id = fd.sale_id AND cr.role = 'credit' AND cr.status = 'transmitted') AS has_credit
         FROM fiscal_documents fd
         JOIN sales s ON s.id = fd.sale_id
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE ${where.join(' AND ')}
        ORDER BY fd.id DESC LIMIT 500`
    ).all(...params);
  });

  // (Η έκδοση Πιστωτικού «/api/fiscal/documents/credit» έχει μεταφερθεί στο routes/sales.ts,
  //  ώστε εκτός από το παραστατικό να γίνεται και ΠΛΗΡΗΣ τοπικός αντιλογισμός: ακύρωση εισιτηρίων,
  //  μείωση τζίρου/ΦΠΑ και αρνητική κίνηση ταμείου — να μη μετράει ως έσοδο.)

  // Ανάκτηση όλων των λιστών (lookups) του παρόχου — για τη ρύθμιση παραστατικών.
  app.get('/api/fiscal/provider/lookups', { preHandler: requireManager }, async (_req, reply) => {
    const row = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    let cfg: any = {}; try { cfg = JSON.parse(row?.config ?? '{}'); } catch { /* ignore */ }
    if (!cfg.username || !cfg.password || !cfg.activationCode)
      return reply.code(400).send({ error: 'Συμπλήρωσε & αποθήκευσε τα credentials του παρόχου πρώτα.' });
    try {
      const provider = new RapidSignProvider({
        env: (cfg.env as FiscalEnv) === 'prod' ? 'prod' : 'dev',
        username: cfg.username, password: cfg.password, activationCode: cfg.activationCode,
      });
      return await provider.allLookups();
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  // Δοκιμαστική ΑΚΥΡΩΣΗ (void) παραστατικού με το guid που επέστρεψε η έκδοση.
  app.post('/api/fiscal/provider/void-test', { preHandler: requireManager }, async (req, reply) => {
    const { guid, reason } = (req.body ?? {}) as { guid?: string; reason?: string };
    if (!guid) return reply.code(400).send({ error: 'Δώσε το guid του παραστατικού (από τη δοκιμή έκδοσης).' });
    const row = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    let cfg: any = {}; try { cfg = JSON.parse(row?.config ?? '{}'); } catch { /* ignore */ }
    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const provider = new RapidSignProvider({
      env: (cfg.env as FiscalEnv) === 'prod' ? 'prod' : 'dev',
      username: cfg.username, password: cfg.password, activationCode: cfg.activationCode,
    });
    return provider.voidInvoice(cfg.issuerVat || venue?.vat_number || '619333103', guid, reason || 'Δοκιμή ακύρωσης');
  });

  // Δοκιμαστική αποστολή email απόδειξης (Resend) — επιβεβαιώνει τη ρύθμιση email.
  app.post('/api/fiscal/provider/test-email', { preHandler: requireManager }, async (req, reply) => {
    const { to } = (req.body ?? {}) as { to?: string };
    if (!to) return reply.code(400).send({ error: 'Δώσε διεύθυνση παραλήπτη.' });
    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const html = receiptEmailHtml({
      name: 'Δοκιμή', showTitle: 'Δοκιμαστικό θέαμα', showDate: new Date().toISOString().slice(0, 10),
      seats: 'Α1, Α2', total: 14, mark: '400000000000000', link: 'https://example.com/receipt.pdf',
      venueName: venue?.name,
    });
    return sendEmail(to, 'Δοκιμαστικό email απόδειξης', html);
  });

  // Έκδοση ΑΠΥ για online πωλήσεις που έχουν κατέβει αλλά δεν κόπηκε παραστατικό (επανέκδοση εκκρεμών).
  app.post('/api/fiscal/issue-pending-online', { preHandler: requireManager }, async () => {
    return issuePendingOnline();
  });

  // Δοκιμαστική έκδοση ΠΙΣΤΩΤΙΚΟΥ (αντιλογιστικό) που αναφέρεται στο ΜΑΡΚ ενός ΑΠΥ.
  app.post('/api/fiscal/provider/test-credit', { preHandler: requireManager }, async (req, reply) => {
    const { mark } = (req.body ?? {}) as { mark?: string };
    if (!mark) return reply.code(400).send({ error: 'Δώσε το ΜΑΡΚ του αρχικού ΑΠΥ (από τη δοκιμή έκδοσης).' });
    const row = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    let cfg: any = {}; try { cfg = JSON.parse(row?.config ?? '{}'); } catch { /* ignore */ }
    if (!cfg.username || !cfg.password || !cfg.activationCode)
      return reply.code(400).send({ error: 'Συμπλήρωσε & αποθήκευσε τα credentials του παρόχου πρώτα.' });
    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const cr = (cfg.docs && cfg.docs.credit) || {};
    const provider = new RapidSignProvider({
      env: (cfg.env as FiscalEnv) === 'prod' ? 'prod' : 'dev',
      username: cfg.username, password: cfg.password, activationCode: cfg.activationCode,
    });
    // ΛΙΑΝΙΚΗ (type 22): ΧΩΡΙΣ correlatedMarks, ΧΩΡΙΣ αρνητικά — απλό νέο παραστατικό (οδηγία RBS).
    return provider.postInvoice({
      invoiceTypeId: Number(cr.invoiceTypeId) || 22, // 11.4 Πιστωτικό Στοιχ. Λιανικής
      series: cr.series || 'ΠΑΠΥ', aa: String(Date.now() % 1000000), counter: 1,
      issueDate: new Date().toISOString(), currencyId: 47,
      issuer: {
        vatNumber: cfg.issuerVat || venue?.vat_number || '619333103', countryId: 87, branch: 0,
        name: venue?.name || 'MAT S.A.', activity: '', taxOffice: venue?.tax_office || '',
        phone: venue?.phone || '', email: venue?.email || '',
        address: { City: venue?.city || '', PostalCode: venue?.postal_code || '', Street: venue?.address || '', Number: '' },
      },
      lines: [{
        code: 'TEST', name: 'Δοκιμαστικό πιστωτικό', qty: 1, unitPriceInclVat: 12.4,
        netValue: 10.0, vatAmount: 2.4, vatCatId: vatCatIdFromRate(24),
        incomeCatId: Number.isFinite(Number(cr.incomeCatId)) ? Number(cr.incomeCatId) : 2,
        incomeValId: Number.isFinite(Number(cr.incomeValId)) ? Number(cr.incomeValId) : 8,
      }],
      payments: [{ payGuid: randomUUID(), paymentId: 3, net: 10.0, vat: 2.4, amount: 12.4, paymentStatus: 2, acquirerId: Number(cr.acquirerId) || 122, tidNsp: String(Date.now()).slice(-8) }],
    });
  });

  // ---- POS / Κάρτες (Viva) ----
  function vivaFromConfig(): VivaProvider | null {
    const row = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
    if (row?.pos_provider !== 'viva') return null;
    let c: any = {}; try { c = JSON.parse(row.pos_config ?? '{}'); } catch { /* ignore */ }
    return new VivaProvider({
      env: (c.env as VivaEnv) === 'prod' ? 'prod' : 'demo',
      smartClientId: c.smartClientId, smartClientSecret: c.smartClientSecret,
      posClientId: c.posClientId, posClientSecret: c.posClientSecret,
      merchantId: c.merchantId, apiKey: c.apiKey,
      terminalId: c.terminalId, sourceCode: c.sourceCode,
    });
  }

  // Ελαφρύ endpoint για το POS (όλοι οι ρόλοι): είναι ενεργό το Viva; έχει φυσικό τερματικό;
  app.get('/api/pos/enabled', { preHandler: authenticate }, async () => {
    const row = db.prepare('SELECT pos_provider, pos_config FROM fiscal_config WHERE id = 1').get() as any;
    let hasTerminal = false;
    try { hasTerminal = !!JSON.parse(row?.pos_config ?? '{}').terminalId; } catch { /* ignore */ }
    return { provider: row?.pos_provider ?? 'none', hasTerminal };
  });

  app.post('/api/pos/test', { preHandler: requireManager }, async (_req, reply) => {
    const v = vivaFromConfig();
    if (!v) return reply.code(400).send({ error: 'Επίλεξε & αποθήκευσε πάροχο POS (Viva) με credentials πρώτα.' });
    return v.testConnection();
  });

  // Δημιουργία πληρωμής Smart Checkout (επιστρέφει link/QR). Δεν χρεώνει — ο πελάτης πληρώνει στο link.
  app.post('/api/pos/checkout', { preHandler: authenticate }, async (req, reply) => {
    const v = vivaFromConfig();
    if (!v) return reply.code(400).send({ error: 'Δεν έχει ρυθμιστεί POS Viva.' });
    const b = req.body as { amount?: number; merchantTrns?: string; customerTrns?: string; email?: string; fullName?: string; phone?: string };
    const cents = Math.round(Number(b.amount) * 100);
    if (!cents || cents <= 0) return reply.code(400).send({ error: 'Άκυρο ποσό' });
    try {
      const r = await v.createCheckoutOrder(cents, { merchantTrns: b.merchantTrns, customerTrns: b.customerTrns, email: b.email, fullName: b.fullName, phone: b.phone });
      let pushed: any = undefined;
      if ((b as any).toTerminal) pushed = await v.pushToTerminal(r.orderCode); // αποστολή σε φυσικό τερματικό
      return { ...r, pushed };
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  // Κατάσταση πληρωμής order (polling): paid όταν StateId = 3.
  app.get('/api/pos/order-status', { preHandler: authenticate }, async (req, reply) => {
    const v = vivaFromConfig();
    if (!v) return reply.code(400).send({ error: 'Δεν έχει ρυθμιστεί POS Viva.' });
    const { orderCode } = req.query as { orderCode?: string };
    if (!orderCode) return reply.code(400).send({ error: 'Λείπει orderCode' });
    return v.getOrderState(orderCode);
  });
}
