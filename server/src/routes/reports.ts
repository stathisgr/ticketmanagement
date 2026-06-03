import type { FastifyInstance } from 'fastify';
import { db, localDate } from '../db.js';
import { requireManager } from '../auth.js';

/** Όλες οι αναφορές είναι μόνο για Manager και φιλτράρουν βάσει ημερομηνίας πώλησης. */
export default async function reportRoutes(app: FastifyInstance) {
  function range(req: any): [string, string] {
    const { from, to } = req.query as { from?: string; to?: string };
    const f = from ?? localDate();
    return [f, to ?? f];
  }

  // Σύνοψη: τζίρος, ΦΠΑ, πωλήσεις, τεμάχια, ανά τρόπο πληρωμής, POS vs Αίθουσες
  app.get('/api/reports/summary', { preHandler: requireManager }, async (req) => {
    const [from, to] = range(req);
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS sales, COALESCE(SUM(total),0) AS gross, COALESCE(SUM(vat_total),0) AS vat
         FROM sales WHERE date(datetime) BETWEEN ? AND ?`
      )
      .get(from, to) as any;
    const tickets = db
      .prepare(
        `SELECT COALESCE(SUM(si.qty),0) AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE date(s.datetime) BETWEEN ? AND ?`
      )
      .get(from, to) as any;
    const byMethodRows = db
      .prepare(
        `SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
         FROM sales WHERE date(datetime) BETWEEN ? AND ? GROUP BY payment_method`
      )
      .all(from, to) as any[];
    const byMethod: Record<string, { count: number; total: number }> = { cash: { count: 0, total: 0 }, card: { count: 0, total: 0 } };
    for (const r of byMethodRows) if (byMethod[r.method]) byMethod[r.method] = { count: Number(r.count), total: +Number(r.total).toFixed(2) };

    // POS (χωρίς θέση) vs Αίθουσες (με θέση)
    const src = db
      .prepare(
        `SELECT CASE WHEN si.seat_id IS NULL THEN 'pos' ELSE 'hall' END AS src,
                COALESCE(SUM(si.line_total),0) AS gross, COALESCE(SUM(si.qty),0) AS qty
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE date(s.datetime) BETWEEN ? AND ? GROUP BY src`
      )
      .all(from, to) as any[];
    const bySource: Record<string, { gross: number; qty: number }> = { pos: { gross: 0, qty: 0 }, hall: { gross: 0, qty: 0 } };
    for (const r of src) bySource[r.src] = { gross: +Number(r.gross).toFixed(2), qty: Number(r.qty) };

    return {
      from, to,
      gross: +Number(totals.gross).toFixed(2),
      vat: +Number(totals.vat).toFixed(2),
      net: +(Number(totals.gross) - Number(totals.vat)).toFixed(2),
      sales: Number(totals.sales),
      tickets: Number(tickets.qty),
      avgPerSale: totals.sales ? +(Number(totals.gross) / Number(totals.sales)).toFixed(2) : 0,
      byMethod, bySource,
    };
  });

  // Ημερήσιος τζίρος (για γράφημα)
  app.get('/api/reports/by-day', { preHandler: requireManager }, async (req) => {
    const [from, to] = range(req);
    return db
      .prepare(
        `SELECT date(datetime) AS day, COUNT(*) AS sales, COALESCE(SUM(total),0) AS gross
         FROM sales WHERE date(datetime) BETWEEN ? AND ? GROUP BY day ORDER BY day`
      )
      .all(from, to);
  });

  // Ανά θέαμα
  app.get('/api/reports/by-show', { preHandler: requireManager }, async (req) => {
    const [from, to] = range(req);
    return db
      .prepare(
        `SELECT sh.id, sh.title, sh.start_time, h.name AS hall_name,
                COALESCE(SUM(si.qty),0) AS qty, COALESCE(SUM(si.line_total),0) AS gross
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN shows sh ON sh.id = si.show_id
         JOIN halls h ON h.id = sh.hall_id
         WHERE si.show_id IS NOT NULL AND date(s.datetime) BETWEEN ? AND ?
         GROUP BY si.show_id ORDER BY gross DESC`
      )
      .all(from, to);
  });

  // Ανά αίθουσα (πωλήσεις θέσεων)
  app.get('/api/reports/by-hall', { preHandler: requireManager }, async (req) => {
    const [from, to] = range(req);
    return db
      .prepare(
        `SELECT h.name AS hall_name, COALESCE(SUM(si.qty),0) AS qty, COALESCE(SUM(si.line_total),0) AS gross
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN seats se ON se.id = si.seat_id
         JOIN halls h ON h.id = se.hall_id
         WHERE si.seat_id IS NOT NULL AND date(s.datetime) BETWEEN ? AND ?
         GROUP BY h.id ORDER BY gross DESC`
      )
      .all(from, to);
  });

  // Ανά τύπο εισιτηρίου
  app.get('/api/reports/by-type', { preHandler: requireManager }, async (req) => {
    const [from, to] = range(req);
    return db
      .prepare(
        `SELECT si.title, COALESCE(SUM(si.qty),0) AS qty, COALESCE(SUM(si.line_total),0) AS gross
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE date(s.datetime) BETWEEN ? AND ?
         GROUP BY si.title ORDER BY gross DESC`
      )
      .all(from, to);
  });
}
