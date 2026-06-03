import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { authenticate, requireManager } from '../auth.js';
import { renderTicket } from '../print/index.js';
import type { TicketContext } from '../print/template.js';
import { renderEscpos } from '../print/escpos.js';
import { renderZpl } from '../print/zpl.js';
import { dispatch, type PrinterRow } from '../print/dispatch.js';

export default async function printerRoutes(app: FastifyInstance) {
  // ---- Εκτυπωτές ----
  app.get('/api/printers', { preHandler: authenticate }, async () =>
    db.prepare('SELECT * FROM printers ORDER BY is_default DESC, name').all()
  );

  app.post('/api/printers', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as any;
    if (!b?.name) return reply.code(400).send({ error: 'Λείπει το όνομα' });
    if (b.is_default) db.prepare('UPDATE printers SET is_default = 0').run();
    const info = db
      .prepare(
        `INSERT INTO printers (name, type, connection, address, copies, auto_cut, drawer_kick, is_default)
         VALUES (@name, @type, @connection, @address, @copies, @auto_cut, @drawer_kick, @is_default)`
      )
      .run(norm(b));
    return db.prepare('SELECT * FROM printers WHERE id = ?').get(Number(info.lastInsertRowid));
  });

  app.put('/api/printers/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    if (!db.prepare('SELECT 1 FROM printers WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    if (b.is_default) db.prepare('UPDATE printers SET is_default = 0').run();
    db.prepare(
      `UPDATE printers SET name=@name, type=@type, connection=@connection, address=@address,
        copies=@copies, auto_cut=@auto_cut, drawer_kick=@drawer_kick, is_default=@is_default WHERE id=@id`
    ).run({ ...norm(b), id });
    return db.prepare('SELECT * FROM printers WHERE id = ?').get(id);
  });

  app.delete('/api/printers/:id', { preHandler: requireManager }, async (req) => {
    db.prepare('DELETE FROM printers WHERE id = ?').run(Number((req.params as any).id));
    return { ok: true };
  });

  // Δοκιμαστική εκτύπωση — render + (αν δικτυακός) πραγματική αποστολή.
  app.post('/api/printers/:id/test', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const p = db.prepare('SELECT * FROM printers WHERE id = ?').get(id) as PrinterRow | undefined;
    if (!p) return reply.code(404).send({ error: 'Δεν βρέθηκε εκτυπωτής' });
    const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
    const ctx: TicketContext = {
      venueName: venue?.name ?? 'TEST', vatNumber: venue?.vat_number,
      address: venue?.address, cityLine: [venue?.postal_code, venue?.city].filter(Boolean).join(' '),
      phone: venue?.phone, email: venue?.email,
      title: 'ΔΟΚΙΜΑΣΤΙΚΗ ΕΚΤΥΠΩΣΗ', subtitle: p.name, qty: 1, unitPrice: 0, lineTotal: 0, vatRate: 0,
      serial: 'TEST-0001', datetime: new Date().toLocaleString('el-GR'), paymentMethod: '—', qrPayload: 'TEST',
    };
    const tplRow = db.prepare('SELECT * FROM print_templates WHERE id = 1').get() as any;
    let tpl: any = {};
    if (tplRow) {
      let pp: any = {};
      try { pp = JSON.parse(tplRow.params ?? '{}'); } catch { /* default */ }
      tpl = { header: tplRow.header, details: tplRow.details, footer: tplRow.footer, withQr: pp.withQr !== false, codePage: pp.codePage, escposPageId: pp.escposPageId, sizes: pp.sizes };
    }
    const rendered = renderTicket(ctx, p.type, tpl);
    const escposBytes = p.type === 'zpl' ? undefined : renderEscpos(ctx, tpl);
    const zpl = p.type === 'zpl' ? renderZpl(ctx) : undefined;
    const res = await dispatch(p, { escposBytes, zpl });
    return { preview: rendered.preview, dispatch: res };
  });

  // ---- Σταθμοί (ταμεία) → εκτυπωτής ----
  app.get('/api/stations', { preHandler: authenticate }, async () =>
    db.prepare(`SELECT st.*, p.name AS printer_name FROM stations st LEFT JOIN printers p ON p.id = st.printer_id ORDER BY st.name`).all()
  );

  app.post('/api/stations', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as any;
    if (!b?.name) return reply.code(400).send({ error: 'Λείπει το όνομα σταθμού' });
    try {
      const info = db.prepare('INSERT INTO stations (name, printer_id) VALUES (?, ?)').run(b.name, b.printer_id ?? null);
      return db.prepare('SELECT * FROM stations WHERE id = ?').get(Number(info.lastInsertRowid));
    } catch (e) {
      return reply.code(409).send({ error: 'Υπάρχει ήδη σταθμός με αυτό το όνομα' });
    }
  });

  app.put('/api/stations/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    if (!db.prepare('SELECT 1 FROM stations WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    db.prepare('UPDATE stations SET name = ?, printer_id = ? WHERE id = ?').run(b.name, b.printer_id ?? null, id);
    return db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
  });

  app.delete('/api/stations/:id', { preHandler: requireManager }, async (req) => {
    db.prepare('DELETE FROM stations WHERE id = ?').run(Number((req.params as any).id));
    return { ok: true };
  });
}

function norm(b: any) {
  return {
    name: b.name,
    type: ['escpos58', 'escpos80', 'zpl'].includes(b.type) ? b.type : 'escpos80',
    connection: ['usb', 'network', 'system', 'file'].includes(b.connection) ? b.connection : 'system',
    address: b.address ?? null,
    copies: Math.max(1, Number(b.copies) || 1),
    auto_cut: b.auto_cut ? 1 : 0,
    drawer_kick: b.drawer_kick ? 1 : 0,
    is_default: b.is_default ? 1 : 0,
  };
}
