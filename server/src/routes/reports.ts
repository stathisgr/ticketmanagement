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

    // Κανάλι: Τοπικά (ταμείο) vs Online
    const chanRows = db
      .prepare(
        `SELECT s.source AS source, COUNT(DISTINCT s.id) AS sales,
                COALESCE(SUM(si.line_total),0) AS gross, COALESCE(SUM(si.qty),0) AS qty
         FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
         WHERE date(s.datetime) BETWEEN ? AND ? GROUP BY s.source`
      )
      .all(from, to) as any[];
    const byChannel: Record<string, { sales: number; gross: number; qty: number }> = {
      local: { sales: 0, gross: 0, qty: 0 }, online: { sales: 0, gross: 0, qty: 0 },
    };
    for (const r of chanRows) if (byChannel[r.source]) byChannel[r.source] = { sales: Number(r.sales), gross: +Number(r.gross).toFixed(2), qty: Number(r.qty) };

    return {
      from, to,
      gross: +Number(totals.gross).toFixed(2),
      vat: +Number(totals.vat).toFixed(2),
      net: +(Number(totals.gross) - Number(totals.vat)).toFixed(2),
      sales: Number(totals.sales),
      tickets: Number(tickets.qty),
      avgPerSale: totals.sales ? +(Number(totals.gross) / Number(totals.sales)).toFixed(2) : 0,
      byMethod, bySource, byChannel,
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

  // ΦΟΡΟΛΟΓΙΚΗ ΑΝΑΦΟΡΑ — βάσει ΗΜΕΡΟΜΗΝΙΑΣ ΕΚΔΗΛΩΣΗΣ (όχι έκδοσης/πώλησης).
  // Το έσοδο/ΦΠΑ αναγνωρίζεται στον χρόνο τέλεσης. Για εισιτήρια χωρίς θέαμα (λιανική POS)
  // ως ημ. αναφοράς λαμβάνεται η ημ. πώλησης. Τα ΑΚΥΡΩΘΕΝΤΑ ΕΞΑΙΡΟΥΝΤΑΙ από έσοδα/ΦΠΑ
  // αλλά εμφανίζονται ως πλήθος. Ανάλυση ΦΠΑ ανά συντελεστή + ανά εκδήλωση + αδιάθετα.
  app.get('/api/reports/fiscal', { preHandler: requireManager }, async (req) => {
    const [from, to] = range(req);
    const refDate = "COALESCE(t.show_date, date(s.datetime))";
    const valNet = "si.unit_price"; // αξία ανά εισιτήριο (συμπ. ΦΠΑ)
    const vatExpr = "si.unit_price * si.vat_rate / (100 + si.vat_rate)";
    const base =
      `FROM tickets t
       JOIN sale_items si ON si.id = t.sale_item_id
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN shows sh ON sh.id = t.show_id
       WHERE ${refDate} BETWEEN ? AND ?`;

    const totals = db.prepare(
      `SELECT SUM(CASE WHEN t.cancelled_at IS NULL THEN 1 ELSE 0 END) AS issued,
              SUM(CASE WHEN t.cancelled_at IS NOT NULL THEN 1 ELSE 0 END) AS cancelled,
              ROUND(COALESCE(SUM(CASE WHEN t.cancelled_at IS NULL THEN ${valNet} ELSE 0 END),0),2) AS gross,
              ROUND(COALESCE(SUM(CASE WHEN t.cancelled_at IS NULL THEN ${vatExpr} ELSE 0 END),0),2) AS vat
       ${base}`
    ).get(from, to) as any;

    const vatByRate = (db.prepare(
      `SELECT si.vat_rate AS rate,
              SUM(CASE WHEN t.cancelled_at IS NULL THEN 1 ELSE 0 END) AS qty,
              ROUND(COALESCE(SUM(CASE WHEN t.cancelled_at IS NULL THEN ${valNet} ELSE 0 END),0),2) AS gross,
              ROUND(COALESCE(SUM(CASE WHEN t.cancelled_at IS NULL THEN ${vatExpr} ELSE 0 END),0),2) AS vat
       ${base} GROUP BY si.vat_rate ORDER BY si.vat_rate`
    ).all(from, to) as any[]).map((r) => ({
      rate: Number(r.rate), qty: Number(r.qty),
      gross: +Number(r.gross).toFixed(2), vat: +Number(r.vat).toFixed(2),
      net: +(Number(r.gross) - Number(r.vat)).toFixed(2),
    }));

    const rows = db.prepare(
      `SELECT ${refDate} AS event_date, t.show_id AS show_id,
              COALESCE(sh.title, '— Λιανική / POS —') AS show_title,
              sh.seating_mode AS seating_mode, sh.capacity AS gen_cap, sh.hall_id AS hall_id,
              SUM(CASE WHEN t.cancelled_at IS NULL THEN 1 ELSE 0 END) AS issued,
              SUM(CASE WHEN t.cancelled_at IS NOT NULL THEN 1 ELSE 0 END) AS cancelled,
              ROUND(COALESCE(SUM(CASE WHEN t.cancelled_at IS NULL THEN ${valNet} ELSE 0 END),0),2) AS gross,
              ROUND(COALESCE(SUM(CASE WHEN t.cancelled_at IS NULL THEN ${vatExpr} ELSE 0 END),0),2) AS vat
       ${base}
       GROUP BY event_date, t.show_id ORDER BY event_date, show_title`
    ).all(from, to) as any[];

    const seatCountCache = new Map<number, number>();
    const seatCount = (hallId: number): number => {
      if (!seatCountCache.has(hallId)) {
        const c = (db.prepare("SELECT COUNT(*) AS c FROM seats WHERE hall_id = ? AND kind = 'seat'").get(hallId) as any).c;
        seatCountCache.set(hallId, Number(c) || 0);
      }
      return seatCountCache.get(hallId)!;
    };
    const byEvent = rows.map((r) => {
      let capacity: number | null = null;
      if (r.seating_mode === 'seated' && r.hall_id) capacity = seatCount(r.hall_id);
      else if (r.seating_mode === 'general') capacity = r.gen_cap > 0 ? Number(r.gen_cap) : null;
      const unsold = capacity != null ? Math.max(0, capacity - Number(r.issued)) : null;
      return {
        event_date: r.event_date, show_title: r.show_title,
        issued: Number(r.issued), cancelled: Number(r.cancelled),
        gross: +Number(r.gross).toFixed(2), vat: +Number(r.vat).toFixed(2),
        net: +(Number(r.gross) - Number(r.vat)).toFixed(2),
        capacity, unsold,
      };
    });

    return {
      from, to,
      issued: Number(totals.issued || 0),
      cancelled: Number(totals.cancelled || 0),
      gross: +Number(totals.gross || 0).toFixed(2),
      vat: +Number(totals.vat || 0).toFixed(2),
      net: +(Number(totals.gross || 0) - Number(totals.vat || 0)).toFixed(2),
      vatByRate, byEvent,
    };
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
