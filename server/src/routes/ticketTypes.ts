import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { authenticate, requireManager } from '../auth.js';

export default async function ticketTypeRoutes(app: FastifyInstance) {
  // Λίστα (όλοι οι συνδεδεμένοι). enabledOnly=1 για το POS.
  app.get('/api/ticket-types', { preHandler: authenticate }, async (req) => {
    const { enabledOnly } = req.query as { enabledOnly?: string };
    const sql =
      'SELECT * FROM ticket_types' +
      (enabledOnly === '1' ? ' WHERE enabled = 1' : '') +
      ' ORDER BY sort_order, id';
    return db.prepare(sql).all();
  });

  // Δημιουργία (manager)
  app.post('/api/ticket-types', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as any;
    if (!b?.title) return reply.code(400).send({ error: 'Λείπει ο τίτλος' });
    const info = db
      .prepare(
        `INSERT INTO ticket_types (title, subtitle, price, default_qty, vat_rate, department, receipt_limit, default_payment, enabled, sort_order, color, icon, series_prefix, series_next, kind)
         VALUES (@title, @subtitle, @price, @default_qty, @vat_rate, @department, @receipt_limit, @default_payment, @enabled, @sort_order, @color, @icon, @series_prefix, @series_next, @kind)`
      )
      .run({
        title: b.title,
        subtitle: b.subtitle ?? null,
        price: b.price ?? 0,
        default_qty: b.default_qty ?? 1,
        vat_rate: b.vat_rate ?? 24,
        department: b.department ?? 1,
        receipt_limit: b.receipt_limit ?? null,
        default_payment: b.default_payment ?? 'prompt',
        enabled: b.enabled ? 1 : 0,
        sort_order: b.sort_order ?? 0,
        color: b.color ?? null,
        icon: b.icon ?? null,
        series_prefix: b.series_prefix ?? null,
        series_next: Math.max(1, Number(b.series_next) || 1),
        kind: b.kind === 1 ? 1 : 0,
      });
    return db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(info.lastInsertRowid);
  });

  // Ενημέρωση (manager)
  app.put('/api/ticket-types/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    const existing = db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    db.prepare(
      `UPDATE ticket_types SET title=@title, subtitle=@subtitle, price=@price, default_qty=@default_qty,
        vat_rate=@vat_rate, department=@department, receipt_limit=@receipt_limit, default_payment=@default_payment,
        enabled=@enabled, sort_order=@sort_order, color=@color, icon=@icon,
        series_prefix=@series_prefix, series_next=@series_next, kind=@kind WHERE id=@id`
    ).run({
      id,
      title: b.title,
      subtitle: b.subtitle ?? null,
      price: b.price ?? 0,
      default_qty: b.default_qty ?? 1,
      vat_rate: b.vat_rate ?? 24,
      department: b.department ?? 1,
      receipt_limit: b.receipt_limit ?? null,
      default_payment: b.default_payment ?? 'prompt',
      enabled: b.enabled ? 1 : 0,
      sort_order: b.sort_order ?? 0,
      color: b.color ?? null,
      icon: b.icon ?? null,
      series_prefix: b.series_prefix ?? null,
      series_next: Math.max(1, Number(b.series_next) || 1),
      kind: b.kind === 1 ? 1 : 0,
    });
    return db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(id);
  });

  // Διαγραφή (manager)
  app.delete('/api/ticket-types/:id', { preHandler: requireManager }, async (req) => {
    const id = Number((req.params as any).id);
    db.prepare('DELETE FROM ticket_types WHERE id = ?').run(id);
    return { ok: true };
  });
}
