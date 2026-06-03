// Συγχρονισμός τοπικής βάσης ↔ Supabase (cloud) για online κρατήσεις.
// Χρησιμοποιεί το service_role key (μόνο server-side) μέσω PostgREST upsert.
import { db } from '../db.js';

interface OnlineCfg { supabase_url: string; service_key: string; enabled: number; sync_minutes_before: number; }

function cfg(): OnlineCfg {
  const c = db.prepare('SELECT * FROM online_config WHERE id = 1').get() as any;
  if (!c?.supabase_url || !c?.service_key) throw new Error('Δεν έχει ρυθμιστεί η σύνδεση Supabase (URL + service key).');
  return c;
}

function headers(c: OnlineCfg, extra: Record<string, string> = {}) {
  return {
    apikey: c.service_key,
    Authorization: `Bearer ${c.service_key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(c: OnlineCfg, path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${c.supabase_url}/rest/v1/${path}`, init);
  const txt = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

/** Upsert (merge) με επιστροφή εγγραφών. */
async function upsert(c: OnlineCfg, table: string, onConflict: string, rows: any[]): Promise<any[]> {
  if (!rows.length) return [];
  return rest(c, `${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: headers(c, { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(rows),
  });
}

const euroToCents = (v: number) => Math.round(Number(v) * 100);

/** Λίστα ημερομηνιών 'YYYY-MM-DD' από from έως to (συμπεριλαμβανομένων). */
function dateRange(from: string, to: string, maxDays = 92): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end && out.length < maxDays) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Δημοσίευση θεάματος για ΕΥΡΟΣ ημερομηνιών (από–έως). Ένα cloud θέαμα ανά ημέρα,
 * με ημερήσια ώρα κλεισίματος online (closeTime 'HH:MM') για κάθε ημερομηνία.
 * Το εύρος κλιμακώνεται μέσα στο valid_from..valid_to του τοπικού θεάματος.
 */
export async function pushRange(
  showId: number, fromDate: string, toDate: string, closeTime: string,
): Promise<{ published: string[]; cloudIds: number[] }> {
  const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(showId) as any;
  if (!show) throw new Error('Δεν βρέθηκε θέαμα');
  // Περιορισμός μέσα στο εύρος ισχύος του θεάματος, αν υπάρχει.
  const vf = (show.valid_from ?? '').slice(0, 10);
  const vt = (show.valid_to ?? '').slice(0, 10);
  const from = vf && fromDate < vf ? vf : fromDate;
  const to = vt && toDate > vt ? vt : toDate;
  if (from > to) throw new Error('Το εύρος ημερομηνιών είναι εκτός ισχύος του θεάματος');

  const dates = dateRange(from, to);
  const published: string[] = []; const cloudIds: number[] = [];
  for (const d of dates) {
    const ct = closeTime && /^\d{2}:\d{2}$/.test(closeTime) ? closeTime : '17:00';
    const salesCloseAt = new Date(`${d}T${ct}:00`).toISOString(); // local→UTC
    const cloudId = await pushPublication(showId, d, salesCloseAt);
    published.push(d); cloudIds.push(cloudId);
  }
  return { published, cloudIds };
}

/**
 * Δημοσίευση ενός θεάματος (συγκεκριμένη ημερομηνία) στο cloud:
 * μεταφέρει το θέαμα, τους τύπους εισιτηρίων και ΟΛΕΣ τις θέσεις της αίθουσας (ως έχει).
 */
export async function pushPublication(showId: number, showDate: string, salesCloseAt: string | null): Promise<number> {
  const c = cfg();
  const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(showId) as any;
  if (!show) throw new Error('Δεν βρέθηκε θέαμα');
  const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;

  // 1) Show (upsert ανά local_id + ημερομηνία)
  const [cloudShow] = await upsert(c, 'shows', 'local_id,show_date', [{
    local_id: show.id,
    title: show.title,
    subtitle: '',
    venue_name: venue?.name ?? '',
    show_date: showDate,
    start_time: show.start_time ?? '21:00',
    end_time: show.end_time ?? null,
    seating_mode: 'seated',
    sales_close_at: salesCloseAt,
    enabled: true,
  }]);
  const cloudShowId = cloudShow.id as number;

  // 2) Τύποι εισιτηρίων (local_id = show_ticket_types.id)
  const stts = db.prepare('SELECT * FROM show_ticket_types WHERE show_id = ? ORDER BY sort_order, id').all(showId) as any[];
  await upsert(c, 'ticket_types', 'local_id', stts.map((t) => ({
    local_id: t.id, show_id: cloudShowId, title: t.title,
    price_cents: euroToCents(t.price), vat_rate: t.vat_rate ?? 6, sort: t.sort_order ?? 0, enabled: true,
  })));

  // 3) ΟΛΟΣ ο χάρτης της αίθουσας (θέσεις + διάδρομοι + κενά) με συντεταγμένες,
  //    ώστε το online seat-map να είναι ίδιο με του ταμείου.
  const cells = db.prepare(
    "SELECT * FROM seats WHERE hall_id = ? AND enabled = 1 ORDER BY y, x"
  ).all(show.hall_id) as any[];
  const label = (s: any) =>
    s.kind === 'seat' ? (s.display_name ?? `${s.row_label ?? ''}${s.col_label ?? ''}`) : `${s.kind}_${s.y}_${s.x}`;
  // Upsert ΧΩΡΙΣ status (ώστε να μη χαλάμε τυχόν online-πουλημένες σε επανα-push).
  await upsert(c, 'seats', 'show_id,local_seat_id', cells.map((s) => ({
    show_id: cloudShowId, local_seat_id: s.id, x: s.x, y: s.y, kind: s.kind,
    row_label: s.row_label ?? '', seat_label: label(s), channel: 'online',
  })));

  // 3b) Θέσεις ήδη πουλημένες ΑΠΟ ΤΟ ΤΑΜΕΙΟ για αυτή την ημερομηνία → sold online.
  const soldLocal = db.prepare(
    'SELECT DISTINCT seat_id FROM tickets WHERE show_id = ? AND show_date = ? AND seat_id IS NOT NULL'
  ).all(showId, showDate) as any[];
  const soldIds = soldLocal.map((r) => r.seat_id);
  if (soldIds.length) {
    await rest(c, `seats?show_id=eq.${cloudShowId}&local_seat_id=in.(${soldIds.join(',')})`, {
      method: 'PATCH', headers: headers(c, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ status: 'sold', sold_channel: 'box_office' }),
    });
  }

  // 4) Καταγραφή publication τοπικά
  db.prepare(
    `INSERT INTO online_publications (show_id, show_date, cloud_show_id, sales_close_at, enabled, pushed_at)
     VALUES (?, ?, ?, ?, 1, datetime('now','localtime'))
     ON CONFLICT(show_id, show_date) DO UPDATE SET
       cloud_show_id = excluded.cloud_show_id, sales_close_at = excluded.sales_close_at,
       enabled = 1, pushed_at = datetime('now','localtime')`
  ).run(showId, showDate, cloudShowId, salesCloseAt);

  return cloudShowId;
}

/** Απόσυρση από online: απενεργοποιεί το cloud show. */
export async function unpublish(pubId: number): Promise<void> {
  const c = cfg();
  const pub = db.prepare('SELECT * FROM online_publications WHERE id = ?').get(pubId) as any;
  if (!pub) throw new Error('Δεν βρέθηκε δημοσίευση');
  if (pub.cloud_show_id) {
    await rest(c, `shows?id=eq.${pub.cloud_show_id}`, {
      method: 'PATCH', headers: headers(c), body: JSON.stringify({ enabled: false }),
    });
  }
  db.prepare('UPDATE online_publications SET enabled = 0 WHERE id = ?').run(pubId);
}

/**
 * Κατέβασμα online-πουλημένων θέσεων → τοπικός πίνακας online_sold_seats,
 * ώστε ο ταμίας να τις βλέπει πιασμένες. Επιστρέφει πλήθος νέων.
 */
export async function pull(): Promise<{ pulled: number; perShow: Record<number, number> }> {
  const c = cfg();
  const pubs = db.prepare('SELECT * FROM online_publications WHERE enabled = 1 AND cloud_show_id IS NOT NULL').all() as any[];
  let pulled = 0; const perShow: Record<number, number> = {};

  for (const pub of pubs) {
    // (α) ΑΝΕΒΑΣΜΑ: θέσεις που πούλησε το ταμείο για αυτή την ημ/νία → sold(box_office) στο cloud.
    const soldLocal = db.prepare(
      'SELECT DISTINCT seat_id FROM tickets WHERE show_id = ? AND show_date = ? AND seat_id IS NOT NULL'
    ).all(pub.show_id, pub.show_date) as any[];
    const soldIds = soldLocal.map((r) => r.seat_id);
    if (soldIds.length) {
      await rest(c, `seats?show_id=eq.${pub.cloud_show_id}&local_seat_id=in.(${soldIds.join(',')})&sold_channel=is.null`, {
        method: 'PATCH', headers: headers(c, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ status: 'sold', sold_channel: 'box_office' }),
      });
    }
    // (β) ΚΑΤΕΒΑΣΜΑ: online πουλημένες θέσεις (sold_channel=online) με το local_seat_id τους.
    const rows = await rest(c,
      `seats?show_id=eq.${pub.cloud_show_id}&sold_channel=eq.online&select=local_seat_id`,
      { method: 'GET', headers: headers(c) });
    let n = 0;
    for (const r of rows as any[]) {
      if (r.local_seat_id == null) continue;
      const info = db.prepare(
        `INSERT INTO online_sold_seats (show_id, show_date, seat_id)
         VALUES (?, ?, ?) ON CONFLICT(show_id, show_date, seat_id) DO NOTHING`
      ).run(pub.show_id, pub.show_date, r.local_seat_id);
      if ((info as any).changes) n++;
    }
    perShow[pub.show_id] = n; pulled += n;
    db.prepare("UPDATE online_publications SET last_pull_at = datetime('now','localtime') WHERE id = ?").run(pub.id);
  }
  return { pulled, perShow };
}
