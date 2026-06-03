import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { authenticate, requireManager } from '../auth.js';
import { RapidSignProvider, type FiscalEnv } from '../fiscal/rapidsign.js';
import { VivaProvider, type VivaEnv } from '../fiscal/viva.js';

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
