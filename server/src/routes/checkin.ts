import type { FastifyInstance } from 'fastify';
import { db, localDate } from '../db.js';
import { authenticate, requireManager, type JwtUser } from '../auth.js';

/**
 * Έλεγχος εισόδου (check-in) στο τοπικό δίκτυο.
 * Ο εισπράκτορας σαρώνει το QR (ή πληκτρολογεί τον αριθμό) → το εισιτήριο σημειώνεται «μπήκε».
 */
export default async function checkinRoutes(app: FastifyInstance) {
  function findTicket(code: string): any {
    const c = (code ?? '').trim();
    if (!c) return null;
    const serial = c.includes('|') ? c.split('|')[0] : c;
    const row = db
      .prepare(
        `SELECT t.*, si.title, seat.display_name AS seat, sh.title AS show_title
         FROM tickets t
         JOIN sale_items si ON si.id = t.sale_item_id
         LEFT JOIN seats seat ON seat.id = t.seat_id
         LEFT JOIN shows sh ON sh.id = t.show_id
         WHERE t.qr_payload = ? OR t.serial = ?`
      )
      .get(c, serial) as any;
    return row ?? null;
  }

  // Σάρωση/πληκτρολόγηση κωδικού → check-in.
  app.post('/api/checkin', { preHandler: authenticate }, async (req, reply) => {
    const user = req.user as JwtUser;
    const { code } = (req.body ?? {}) as { code?: string };
    const t = findTicket(code ?? '');
    if (!t) return reply.send({ status: 'not_found', code });
    const info = { id: t.id, serial: t.serial, title: t.title, seat: t.seat, show: t.show_title, show_date: t.show_date };
    if (t.checked_in_at) return reply.send({ status: 'already', at: t.checked_in_at, ...info });
    db.prepare("UPDATE tickets SET checked_in_at = datetime('now','localtime'), checked_in_by = ? WHERE id = ?").run(user.id, t.id);
    return reply.send({ status: 'ok', at: new Date().toLocaleString('el-GR'), ...info });
  });

  // Στατιστικά εισόδου. Προαιρετικά ανά θέαμα+ημερομηνία· αλλιώς σημερινά.
  app.get('/api/checkin/stats', { preHandler: authenticate }, async (req) => {
    const { show_id, date } = req.query as { show_id?: string; date?: string };
    if (show_id) {
      const d = date ?? localDate();
      const row = db.prepare(
        `SELECT COUNT(*) AS issued, SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS entered
         FROM tickets WHERE show_id = ? AND show_date = ?`
      ).get(Number(show_id), d) as any;
      return { scope: 'show', show_id: Number(show_id), date: d, issued: row.issued ?? 0, entered: row.entered ?? 0 };
    }
    const d = date ?? localDate();
    const row = db.prepare(
      `SELECT COUNT(*) AS issued, SUM(CASE WHEN t.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS entered
       FROM tickets t JOIN sale_items si ON si.id = t.sale_item_id JOIN sales s ON s.id = si.sale_id
       WHERE date(s.datetime) = ?`
    ).get(d) as any;
    return { scope: 'day', date: d, issued: row.issued ?? 0, entered: row.entered ?? 0 };
  });

  // Πρόσφατες είσοδοι (live λίστα).
  app.get('/api/checkin/recent', { preHandler: authenticate }, async () => {
    return db.prepare(
      `SELECT t.id, t.serial, t.checked_in_at, si.title, seat.display_name AS seat, sh.title AS show_title
       FROM tickets t
       JOIN sale_items si ON si.id = t.sale_item_id
       LEFT JOIN seats seat ON seat.id = t.seat_id
       LEFT JOIN shows sh ON sh.id = t.show_id
       WHERE t.checked_in_at IS NOT NULL
       ORDER BY t.checked_in_at DESC LIMIT 30`
    ).all();
  });

  // Αναίρεση εισόδου (manager) — π.χ. λάθος σάρωση.
  app.post('/api/checkin/undo/:id', { preHandler: requireManager }, async (req) => {
    const id = Number((req.params as any).id);
    db.prepare('UPDATE tickets SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?').run(id);
    return { ok: true };
  });
}
