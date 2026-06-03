import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { authenticate, requireManager } from '../auth.js';
import { pushPublication, pushRange, unpublish, pull } from '../online/sync.js';

export default async function onlineRoutes(app: FastifyInstance) {
  // --- Ρυθμίσεις σύνδεσης ---
  app.get('/api/online/config', { preHandler: requireManager }, async () => {
    const c = db.prepare('SELECT * FROM online_config WHERE id = 1').get() as any;
    return {
      supabase_url: c?.supabase_url ?? '',
      sync_minutes_before: c?.sync_minutes_before ?? 60,
      enabled: !!c?.enabled,
      has_key: !!c?.service_key, // δεν επιστρέφουμε ποτέ το ίδιο το κλειδί
    };
  });

  app.put('/api/online/config', { preHandler: requireManager }, async (req) => {
    const b = req.body as any;
    // Ενημέρωση service_key ΜΟΝΟ αν δόθηκε νέο (αλλιώς κρατάμε το υπάρχον).
    if (typeof b.service_key === 'string' && b.service_key.length > 0) {
      db.prepare('UPDATE online_config SET service_key = ? WHERE id = 1').run(b.service_key);
    }
    db.prepare(
      'UPDATE online_config SET supabase_url = ?, sync_minutes_before = ?, enabled = ? WHERE id = 1'
    ).run(
      b.supabase_url ?? '',
      Math.max(0, Number(b.sync_minutes_before) || 60),
      b.enabled ? 1 : 0,
    );
    const c = db.prepare('SELECT * FROM online_config WHERE id = 1').get() as any;
    return { supabase_url: c.supabase_url, sync_minutes_before: c.sync_minutes_before, enabled: !!c.enabled, has_key: !!c.service_key };
  });

  // --- Δημοσιεύσεις ---
  app.get('/api/online/publications', { preHandler: requireManager }, async () => {
    return db.prepare(
      `SELECT p.*, s.title,
        (SELECT COUNT(*) FROM online_sold_seats o WHERE o.show_id = p.show_id AND o.show_date = p.show_date) AS sold_online
       FROM online_publications p JOIN shows s ON s.id = p.show_id
       ORDER BY p.show_date DESC, p.id DESC`
    ).all();
  });

  app.post('/api/online/publish', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as { show_id?: number; show_date?: string; sales_close_at?: string | null };
    if (!b.show_id || !b.show_date) return reply.code(400).send({ error: 'show_id και show_date απαιτούνται' });
    try {
      const cloudShowId = await pushPublication(b.show_id, b.show_date, b.sales_close_at ?? null);
      return { ok: true, cloud_show_id: cloudShowId };
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  app.post('/api/online/publish-range', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as { show_id?: number; from?: string; to?: string; close_time?: string };
    if (!b.show_id || !b.from || !b.to) return reply.code(400).send({ error: 'show_id, from, to απαιτούνται' });
    try {
      const r = await pushRange(b.show_id, b.from, b.to, b.close_time ?? '17:00');
      return { ok: true, published: r.published, count: r.published.length };
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  app.post('/api/online/unpublish', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as { id?: number };
    if (!b.id) return reply.code(400).send({ error: 'id απαιτείται' });
    try { await unpublish(b.id); return { ok: true }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  // --- Συγχρονισμός (pull online-πουλημένων θέσεων) ---
  app.post('/api/online/pull', { preHandler: requireManager }, async (_req, reply) => {
    try { return await pull(); }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  // Online-πουλημένες θέσεις για συγκεκριμένο θέαμα/ημερομηνία (για χρωματισμό στον ταμία).
  app.get('/api/online/sold', { preHandler: authenticate }, async (req) => {
    const { show_id, date } = req.query as { show_id?: string; date?: string };
    if (!show_id || !date) return [];
    return db.prepare('SELECT seat_id, serial FROM online_sold_seats WHERE show_id = ? AND show_date = ?')
      .all(Number(show_id), date);
  });
}
