import type { FastifyInstance } from 'fastify';
import { db, localDate, kindClause } from '../db.js';
import { authenticate, requireManager, type JwtUser } from '../auth.js';

export default async function tillRoutes(app: FastifyInstance) {
  // Ημερήσιο ταμείο (σύνολα ανά τρόπο πληρωμής)
  app.get('/api/till/summary', { preHandler: authenticate }, async (req) => {
    const { from, to, kind } = req.query as { from?: string; to?: string; kind?: string };
    const user = req.user as JwtUser;
    const todayStr = localDate();
    // Ο ταμίας κλειδώνεται στη σημερινή ημερομηνία (server-side).
    const fromDate = user.role === 'manager' ? (from ?? todayStr) : todayStr;
    const toDate = user.role === 'manager' ? (to ?? fromDate) : todayStr;

    // cashier: μόνο δικό του ταμείο. manager: όλα.
    const params: (string | number)[] = [fromDate, toDate];
    let sql =
      `SELECT s.payment_method AS method, COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total
       FROM sales s WHERE date(s.datetime) BETWEEN ? AND ?` + kindClause(kind, 's');
    if (user.role !== 'manager') {
      sql += ' AND s.user_id = ?';
      params.push(user.id);
    }
    sql += ' GROUP BY s.payment_method';

    const rows = db.prepare(sql).all(...params) as any[];

    const byMethod: Record<string, { count: number; total: number }> = {
      cash: { count: 0, total: 0 },
      card: { count: 0, total: 0 },
    };
    let grandTotal = 0;
    let grandCount = 0;
    for (const r of rows) {
      const total = Number(r.total) || 0;
      const count = Number(r.count) || 0;
      if (byMethod[r.method]) byMethod[r.method] = { count, total: +total.toFixed(2) };
      grandTotal += total;
      grandCount += count;
    }
    return { from: fromDate, to: toDate, byMethod, grandTotal: +grandTotal.toFixed(2), grandCount };
  });

  // Ανάλυση ανά τύπο εισιτηρίου (manager — στατιστικά)
  app.get('/api/till/by-type', { preHandler: requireManager }, async (req) => {
    const { from, to, kind } = req.query as { from?: string; to?: string; kind?: string };
    const fromDate = from ?? localDate();
    const toDate = to ?? fromDate;
    return db
      .prepare(
        `SELECT si.title, SUM(si.qty) AS qty, SUM(si.line_total) AS total
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE date(s.datetime) BETWEEN ? AND ?` + kindClause(kind, 's') + `
         GROUP BY si.title ORDER BY total DESC`
      )
      .all(fromDate, toDate);
  });
}
