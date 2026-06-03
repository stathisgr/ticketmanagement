import type { FastifyInstance } from 'fastify';
import { db, tx } from '../db.js';
import { authenticate, requireManager } from '../auth.js';

/** Ετικέτα γραμμής: 0→A, 1→B, ... 25→Z, 26→AA ... */
function alphaLabel(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** true αν έχει εκδοθεί έστω ένα εισιτήριο για θέση αυτής της αίθουσας (⇒ κλειδωμένη δομή). */
function hallLocked(id: number): boolean {
  const row = db
    .prepare(`SELECT 1 FROM tickets t JOIN seats s ON s.id = t.seat_id WHERE s.hall_id = ? LIMIT 1`)
    .get(id);
  return !!row;
}

export default async function hallRoutes(app: FastifyInstance) {
  app.get('/api/halls', { preHandler: authenticate }, async () => {
    return db
      .prepare(
        `SELECT h.*,
            (SELECT COUNT(*) FROM seats s WHERE s.hall_id = h.id AND s.kind = 'seat') AS seat_count,
            (SELECT CASE WHEN EXISTS (SELECT 1 FROM tickets t JOIN seats s2 ON s2.id = t.seat_id WHERE s2.hall_id = h.id) THEN 1 ELSE 0 END) AS locked
         FROM halls h ORDER BY h.name`
      )
      .all();
  });

  app.get('/api/halls/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const hall = db.prepare('SELECT * FROM halls WHERE id = ?').get(id);
    if (!hall) return reply.code(404).send({ error: 'Δεν βρέθηκε αίθουσα' });
    const seats = db.prepare('SELECT * FROM seats WHERE hall_id = ? ORDER BY y, x').all(id);
    return { hall, seats, locked: hallLocked(id) };
  });

  app.post('/api/halls', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as any;
    if (!b?.name) return reply.code(400).send({ error: 'Λείπει το όνομα' });
    const info = db
      .prepare('INSERT INTO halls (name, rows, cols, enabled) VALUES (?, ?, ?, 1)')
      .run(b.name, b.rows ?? 0, b.cols ?? 0);
    return db.prepare('SELECT * FROM halls WHERE id = ?').get(Number(info.lastInsertRowid));
  });

  app.put('/api/halls/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    if (!db.prepare('SELECT 1 FROM halls WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    // Επιτρέπεται πάντα μετονομασία· οι διαστάσεις αλλάζουν μόνο αν δεν είναι κλειδωμένη.
    if (hallLocked(id)) {
      db.prepare('UPDATE halls SET name = ? WHERE id = ?').run(b.name, id);
    } else {
      db.prepare('UPDATE halls SET name = ?, rows = ?, cols = ? WHERE id = ?').run(b.name, b.rows ?? 0, b.cols ?? 0, id);
    }
    return db.prepare('SELECT * FROM halls WHERE id = ?').get(id);
  });

  // Ενεργοποίηση/απενεργοποίηση αίθουσας (πάντα επιτρεπτό)
  app.put('/api/halls/:id/active', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as { enabled?: boolean };
    if (!db.prepare('SELECT 1 FROM halls WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    db.prepare('UPDATE halls SET enabled = ? WHERE id = ?').run(b.enabled ? 1 : 0, id);
    return db.prepare('SELECT * FROM halls WHERE id = ?').get(id);
  });

  app.delete('/api/halls/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (hallLocked(id))
      return reply.code(409).send({ error: 'Η αίθουσα έχει εκδοθέντα εισιτήρια — δεν διαγράφεται. Απενεργοποίησέ την.' });
    db.prepare('DELETE FROM halls WHERE id = ?').run(id);
    return { ok: true };
  });

  /** Αυτόματη δημιουργία πλέγματος θέσεων. rowMode: alpha (A,B,...) ή numeric. */
  app.post('/api/halls/:id/generate', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    const rows = Math.max(1, Math.min(50, Number(b.rows) || 0));
    const cols = Math.max(1, Math.min(60, Number(b.cols) || 0));
    const rowMode = b.rowMode === 'numeric' ? 'numeric' : 'alpha';
    const colStart = Number(b.colStart) || 1;
    if (!db.prepare('SELECT 1 FROM halls WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    if (hallLocked(id))
      return reply.code(409).send({ error: 'Κλειδωμένη αίθουσα (υπάρχουν εκδοθέντα εισιτήρια) — δεν αλλάζει η δομή.' });

    tx(() => {
      db.prepare('DELETE FROM seats WHERE hall_id = ?').run(id);
      db.prepare('UPDATE halls SET rows = ?, cols = ? WHERE id = ?').run(rows, cols, id);
      const ins = db.prepare(
        `INSERT INTO seats (hall_id, y, x, row_label, col_label, display_name, kind, enabled)
         VALUES (@hall, @y, @x, @rl, @cl, @dn, 'seat', 1)`
      );
      for (let y = 0; y < rows; y++) {
        const rl = rowMode === 'numeric' ? String(y + 1) : alphaLabel(y);
        for (let x = 0; x < cols; x++) {
          const cl = String(colStart + x);
          ins.run({ hall: id, y, x, rl, cl, dn: `${rl}${cl}` });
        }
      }
    });
    const seats = db.prepare('SELECT * FROM seats WHERE hall_id = ? ORDER BY y, x').all(id);
    return { ok: true, seats };
  });

  /** Πλήρης αντικατάσταση διάταξης (ορισμός διαδρόμων/κενών). Η αρίθμηση ΑΓΝΟΕΙ διαδρόμους/κενά. */
  app.put('/api/halls/:id/layout', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as { seats?: any[]; rowMode?: 'alpha' | 'numeric' };
    if (!Array.isArray(b?.seats)) return reply.code(400).send({ error: 'Λείπει η διάταξη seats[]' });
    if (!db.prepare('SELECT 1 FROM halls WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    if (hallLocked(id))
      return reply.code(409).send({ error: 'Κλειδωμένη αίθουσα (υπάρχουν εκδοθέντα εισιτήρια) — δεν αλλάζει η δομή.' });
    const rowMode = b.rowMode === 'numeric' ? 'numeric' : 'alpha';

    // Κανονικοποίηση kind
    const cells = b.seats!.map((s) => ({
      y: Number(s.y), x: Number(s.x),
      kind: ['seat', 'aisle', 'gap'].includes(s.kind) ? (s.kind as 'seat' | 'aisle' | 'gap') : 'seat',
      enabled: s.enabled === 0 ? 0 : 1,
    }));

    // Αρίθμηση: μόνο γραμμές που περιέχουν θέσεις παίρνουν ετικέτα· μόνο θέσεις παίρνουν αριθμό στήλης.
    const ys = [...new Set(cells.map((c) => c.y))].sort((a, c) => a - c);
    let rowCounter = 0;
    const rowLabelByY = new Map<number, string>();
    for (const y of ys) {
      const hasSeat = cells.some((c) => c.y === y && c.kind === 'seat');
      if (hasSeat) {
        rowLabelByY.set(y, rowMode === 'numeric' ? String(rowCounter + 1) : alphaLabel(rowCounter));
        rowCounter++;
      }
    }

    tx(() => {
      db.prepare('DELETE FROM seats WHERE hall_id = ?').run(id);
      const ins = db.prepare(
        `INSERT INTO seats (hall_id, y, x, row_label, col_label, display_name, kind, enabled)
         VALUES (@hall, @y, @x, @rl, @cl, @dn, @kind, @en)`
      );
      for (const y of ys) {
        const rl = rowLabelByY.get(y) ?? null;
        let colCounter = 0;
        const rowCells = cells.filter((c) => c.y === y).sort((a, c) => a.x - c.x);
        for (const c of rowCells) {
          let cl: string | null = null;
          let dn: string | null = null;
          if (c.kind === 'seat') {
            colCounter++;
            cl = String(colCounter);
            dn = `${rl ?? ''}${cl}`;
          }
          ins.run({ hall: id, y: c.y, x: c.x, rl: c.kind === 'seat' ? rl : null, cl, dn, kind: c.kind, en: c.enabled });
        }
      }
    });
    return db.prepare('SELECT * FROM seats WHERE hall_id = ? ORDER BY y, x').all(id);
  });
}
