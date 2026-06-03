import type { FastifyInstance } from 'fastify';
import { db, tx } from '../db.js';
import { authenticate, requireManager } from '../auth.js';

/** Συνθέτει legacy starts_at από ημερομηνία ισχύος + ώρα έναρξης. */
function composeStartsAt(valid_from?: string, start_time?: string): string | null {
  if (!valid_from) return null;
  return `${valid_from}T${start_time ?? '00:00'}`;
}

export default async function showRoutes(app: FastifyInstance) {
  // Λίστα θεαμάτων — φίλτρο ημερομηνίας: εμφανίζεται αν D εντός [valid_from, valid_to]
  app.get('/api/shows', { preHandler: authenticate }, async (req) => {
    const { date } = req.query as { date?: string };
    if (date) {
      return db
        .prepare(
          `SELECT sh.*, h.name AS hall_name FROM shows sh LEFT JOIN halls h ON h.id = sh.hall_id
           WHERE sh.valid_from IS NOT NULL AND sh.valid_to IS NOT NULL
             AND ? BETWEEN date(sh.valid_from) AND date(sh.valid_to)
             AND (sh.hall_id IS NULL OR h.enabled = 1) AND sh.enabled = 1
           ORDER BY sh.start_time, sh.id`
        )
        .all(date);
    }
    return db
      .prepare(
        `SELECT sh.*, h.name AS hall_name FROM shows sh LEFT JOIN halls h ON h.id = sh.hall_id
         ORDER BY sh.valid_from DESC, sh.start_time LIMIT 300`
      )
      .all();
  });

  app.get('/api/shows/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const show = db
      .prepare(`SELECT sh.*, h.name AS hall_name FROM shows sh LEFT JOIN halls h ON h.id = sh.hall_id WHERE sh.id = ?`)
      .get(id) as any;
    if (!show) return reply.code(404).send({ error: 'Δεν βρέθηκε θέαμα' });
    const ticketTypes = db.prepare('SELECT * FROM show_ticket_types WHERE show_id = ? ORDER BY sort_order, id').all(id);
    return { show, ticketTypes };
  });

  // Διαθεσιμότητα θέσεων για συγκεκριμένη ΗΜΕΡΟΜΗΝΙΑ
  app.get('/api/shows/:id/availability', { preHandler: authenticate }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(id) as any;
    if (!show) return reply.code(404).send({ error: 'Δεν βρέθηκε θέαμα' });
    const { date } = req.query as { date?: string };
    const showDate = date ?? (show.valid_from ?? '').slice(0, 10);
    const ticketTypesAll = db.prepare('SELECT * FROM show_ticket_types WHERE show_id = ? ORDER BY sort_order, id').all(id);
    // Event χωρίς θέσεις: επιστρέφουμε μετρητή πωλήσεων + χωρητικότητα (καμία θέση).
    if (show.seating_mode === 'general') {
      const sold = (db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE show_id = ? AND show_date = ?').get(id, showDate) as any).c;
      const remaining = show.capacity > 0 ? Math.max(0, show.capacity - sold) : null; // null = απεριόριστο
      return { show, seats: [], ticketTypes: ticketTypesAll, show_date: showDate, general: true, sold, capacity: show.capacity, remaining };
    }
    const seats = db
      .prepare(
        `SELECT s.*,
                CASE WHEN t.id IS NULL AND o.id IS NULL THEN 0 ELSE 1 END AS sold,
                CASE WHEN o.id IS NULL THEN 0 ELSE 1 END AS online_sold
         FROM seats s
         LEFT JOIN tickets t ON t.seat_id = s.id AND t.show_id = ? AND t.show_date = ?
         LEFT JOIN online_sold_seats o ON o.seat_id = s.id AND o.show_id = ? AND o.show_date = ?
         WHERE s.hall_id = ? ORDER BY s.y, s.x`
      )
      .all(id, showDate, id, showDate, show.hall_id);
    return { show, seats, ticketTypes: ticketTypesAll, show_date: showDate, general: false };
  });

  // Δημιουργία: υποστηρίζει ΠΟΛΛΑΠΛΑ ωριαία διαστήματα × διαστήματα ημερομηνιών.
  // Κάθε συνδυασμός (ώρα × εύρος ημ/νιών) γίνεται ξεχωριστό θέαμα προς επιλογή.
  app.post('/api/shows', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body as any;
    const slots: { start_time: string; end_time?: string }[] =
      Array.isArray(b.timeSlots) && b.timeSlots.length ? b.timeSlots : [{ start_time: b.start_time, end_time: b.end_time }];
    const ranges: { valid_from: string; valid_to: string }[] =
      Array.isArray(b.dateRanges) && b.dateRanges.length ? b.dateRanges : [{ valid_from: b.valid_from, valid_to: b.valid_to }];

    const general = b.seating_mode === 'general';
    const capacity = Math.max(0, Number(b.capacity) || 0);
    if (!b?.title) return reply.code(400).send({ error: 'Απαιτείται τίτλος' });
    if (!general && !b?.hall_id) return reply.code(400).send({ error: 'Απαιτείται αίθουσα (ή επίλεξε Event χωρίς θέσεις)' });
    if (!ranges.every((r) => r.valid_from && r.valid_to))
      return reply.code(400).send({ error: 'Κάθε διάστημα χρειάζεται ημερομηνία από–έως' });
    if (!slots.every((s) => s.start_time))
      return reply.code(400).send({ error: 'Κάθε ωριαίο διάστημα χρειάζεται ώρα έναρξης' });

    const created: number[] = [];
    tx(() => {
      const ins = db.prepare(
        `INSERT INTO shows (hall_id, title, starts_at, start_time, end_time, valid_from, valid_to, enabled, seating_mode, capacity)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      );
      for (const r of ranges) {
        for (const s of slots) {
          const info = ins.run(
            general ? null : b.hall_id, b.title, composeStartsAt(r.valid_from, s.start_time),
            s.start_time, s.end_time ?? null, r.valid_from, r.valid_to,
            general ? 'general' : 'seated', capacity
          );
          const showId = Number(info.lastInsertRowid);
          assignTicketTypes(showId, b.ticketTypeIds);
          created.push(showId);
        }
      }
    });
    return { created: created.length, ids: created };
  });

  // Ενεργοποίηση/απενεργοποίηση προγράμματος
  app.put('/api/shows/:id/active', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as { enabled?: boolean };
    if (!db.prepare('SELECT 1 FROM shows WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    db.prepare('UPDATE shows SET enabled = ? WHERE id = ?').run(b.enabled ? 1 : 0, id);
    return db.prepare('SELECT * FROM shows WHERE id = ?').get(id);
  });

  app.put('/api/shows/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    if (!db.prepare('SELECT 1 FROM shows WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    tx(() => {
      db.prepare(
        `UPDATE shows SET hall_id=?, title=?, starts_at=?, start_time=?, end_time=?, valid_from=?, valid_to=? WHERE id=?`
      ).run(
        b.hall_id, b.title,
        composeStartsAt(b.valid_from, b.start_time),
        b.start_time ?? null, b.end_time ?? null, b.valid_from ?? null, b.valid_to ?? null, id
      );
      if (Array.isArray(b.ticketTypeIds)) {
        db.prepare('DELETE FROM show_ticket_types WHERE show_id = ?').run(id);
        assignTicketTypes(id, b.ticketTypeIds);
      }
    });
    return loadShow(id);
  });

  app.delete('/api/shows/:id', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE show_id = ?').get(id) as { n: number };
    if (used.n > 0)
      return reply.code(409).send({ error: `Το θέαμα έχει ${used.n} εκδοθέντα εισιτήρια — δεν διαγράφεται. Απενεργοποίησέ το (ON/OFF).` });
    db.prepare('DELETE FROM shows WHERE id = ?').run(id);
    return { ok: true };
  });

  // Αντιγραφή setup σε νέο εύρος ημερομηνιών
  app.post('/api/shows/:id/copy', { preHandler: requireManager }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    const src = db.prepare('SELECT * FROM shows WHERE id = ?').get(id) as any;
    if (!src) return reply.code(404).send({ error: 'Δεν βρέθηκε θέαμα προς αντιγραφή' });

    const newId = tx(() => {
      const valid_from = b.valid_from ?? src.valid_from;
      const valid_to = b.valid_to ?? src.valid_to;
      const start_time = b.start_time ?? src.start_time;
      const info = db
        .prepare(
          `INSERT INTO shows (hall_id, title, starts_at, start_time, end_time, valid_from, valid_to)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          b.hall_id ?? src.hall_id, b.title ?? src.title,
          composeStartsAt(valid_from, start_time), start_time, b.end_time ?? src.end_time, valid_from, valid_to
        );
      const showId = Number(info.lastInsertRowid);
      const tts = db.prepare('SELECT ticket_type_id FROM show_ticket_types WHERE show_id = ?').all(id) as any[];
      assignTicketTypes(showId, tts.map((t) => t.ticket_type_id));
      return showId;
    });
    return loadShow(newId);
  });
}

/** Δημιουργεί show_ticket_types από επιλεγμένους υπάρχοντες τύπους (snapshot τίτλου/τιμής/ΦΠΑ). */
function assignTicketTypes(showId: number, ticketTypeIds: number[] | undefined) {
  if (!Array.isArray(ticketTypeIds)) return;
  const ins = db.prepare(
    `INSERT INTO show_ticket_types (show_id, ticket_type_id, title, price, vat_rate, sort_order)
     VALUES (@show, @ttid, @title, @price, @vat, @ord)`
  );
  ticketTypeIds.forEach((ttid) => {
    const tt = db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(ttid) as any;
    if (!tt) return;
    // Η σειρά εμφάνισης ακολουθεί το sort_order του τύπου εισιτηρίου.
    ins.run({ show: showId, ttid: tt.id, title: tt.title, price: tt.price, vat: tt.vat_rate, ord: tt.sort_order ?? 0 });
  });
}

function loadShow(id: number) {
  const show = db
    .prepare(`SELECT sh.*, h.name AS hall_name FROM shows sh LEFT JOIN halls h ON h.id = sh.hall_id WHERE sh.id = ?`)
    .get(id);
  const ticketTypes = db.prepare('SELECT * FROM show_ticket_types WHERE show_id = ? ORDER BY sort_order, id').all(id);
  return { show, ticketTypes };
}
