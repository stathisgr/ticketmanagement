import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { authenticate, requireManager } from '../auth.js';

export default async function customerRoutes(app: FastifyInstance) {
  app.get('/api/customers', { preHandler: authenticate }, async (req) => {
    const { q } = req.query as { q?: string };
    // Πλήθος αγορών ανά πελάτη (για το πελατολόγιο)
    const sel = `SELECT c.*, (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS purchases FROM customers c`;
    if (q) {
      const like = `%${q}%`;
      return db
        .prepare(`${sel} WHERE c.full_name LIKE ? OR c.phone1 LIKE ? OR c.phone2 LIKE ? OR c.email LIKE ? OR c.vat_number LIKE ?
                  ORDER BY c.full_name LIMIT 200`)
        .all(like, like, like, like, like);
    }
    return db.prepare(`${sel} ORDER BY c.created_at DESC LIMIT 500`).all();
  });

  app.post('/api/customers', { preHandler: authenticate }, async (req, reply) => {
    const b = req.body as any;
    if (!b?.full_name) return reply.code(400).send({ error: 'Λείπει το ονοματεπώνυμο' });
    const info = db
      .prepare(
        `INSERT INTO customers (full_name, address, postal_code, city, vat_number, email, phone1, phone2, notes, marketing_opt_in)
         VALUES (@full_name, @address, @postal_code, @city, @vat_number, @email, @phone1, @phone2, @notes, @opt)`
      )
      .run({
        full_name: b.full_name,
        address: b.address ?? null,
        postal_code: b.postal_code ?? null,
        city: b.city ?? null,
        vat_number: b.vat_number ?? null,
        email: b.email ?? null,
        phone1: b.phone1 ?? null,
        phone2: b.phone2 ?? null,
        notes: b.notes ?? null,
        opt: b.marketing_opt_in ? 1 : 0,
      });
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  });

  app.put('/api/customers/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    const b = req.body as any;
    db.prepare(
      `UPDATE customers SET full_name=@full_name, address=@address, postal_code=@postal_code, city=@city,
        vat_number=@vat_number, email=@email, phone1=@phone1, phone2=@phone2, notes=@notes, marketing_opt_in=@opt WHERE id=@id`
    ).run({
      id,
      full_name: b.full_name,
      address: b.address ?? null,
      postal_code: b.postal_code ?? null,
      city: b.city ?? null,
      vat_number: b.vat_number ?? null,
      email: b.email ?? null,
      phone1: b.phone1 ?? null,
      phone2: b.phone2 ?? null,
      notes: b.notes ?? null,
      opt: b.marketing_opt_in ? 1 : 0,
    });
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  });

  // Εισιτήρια/αγορές ενός πελάτη (ημερομηνία, τι, check-in).
  app.get('/api/customers/:id/tickets', { preHandler: authenticate }, async (req) => {
    const id = Number((req.params as any).id);
    return db
      .prepare(
        `SELECT t.id, t.serial, t.checked_in_at, s.datetime, s.payment_method,
                si.title, si.line_total, seat.display_name AS seat, sh.title AS show_title, t.show_date
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id
         JOIN tickets t ON t.sale_item_id = si.id
         LEFT JOIN seats seat ON seat.id = t.seat_id
         LEFT JOIN shows sh ON sh.id = t.show_id
         WHERE s.customer_id = ?
         ORDER BY s.datetime DESC, t.id DESC LIMIT 500`
      )
      .all(id);
  });

  app.delete('/api/customers/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const c = db.prepare('SELECT is_default FROM customers WHERE id = ?').get(id) as { is_default: number } | undefined;
    if (c?.is_default) return reply.code(409).send({ error: 'Ο προεπιλεγμένος «ΠΕΛΑΤΗΣ ΛΙΑΝΙΚΗΣ» δεν διαγράφεται.' });
    const used = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?').get(id) as { n: number };
    if (used.n > 0)
      return reply.code(409).send({ error: `Ο πελάτης έχει ${used.n} πωλήσεις — δεν διαγράφεται (ιστορικό).` });
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    return { ok: true };
  });
}
