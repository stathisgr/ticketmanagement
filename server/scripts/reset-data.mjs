// Καθαρισμός δοκιμαστικών δεδομένων — ΚΡΑΤΑΕΙ ρυθμίσεις, χρήστες/κωδικούς, αίθουσες,
// τύπους εισιτηρίων, πελάτες και τη σύνδεση Online (Supabase URL + service key).
// Σβήνει: πωλήσεις, εισιτήρια, θεάματα (+τύπους θεάματος) και τα online tracking.
//
// Χρήση (με τον server ΣΤΑΜΑΤΗΜΕΝΟ):  node server/scripts/reset-data.mjs
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.TM_DB_PATH ?? join(__dirname, '..', '..', 'data', 'ticket.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF');

const before = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return '—'; } };
const tables = ['tickets', 'sale_items', 'sales', 'show_ticket_types', 'shows', 'online_sold_seats', 'online_publications'];

console.log('Πριν:', Object.fromEntries(tables.map((t) => [t, before(t)])));

db.exec('BEGIN');
try {
  db.exec('DELETE FROM tickets');
  db.exec('DELETE FROM sale_items');
  db.exec('DELETE FROM sales');
  db.exec('DELETE FROM show_ticket_types');
  db.exec('DELETE FROM online_sold_seats');
  db.exec('DELETE FROM online_publications');
  db.exec('DELETE FROM shows');
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Σφάλμα — έγινε rollback:', e.message);
  process.exit(1);
}

console.log('Μετά :', Object.fromEntries(tables.map((t) => [t, before(t)])));
console.log('✓ Διαγράφηκαν πωλήσεις/εισιτήρια/θεάματα. Κρατήθηκαν: αίθουσες, τύποι εισιτηρίων, πελάτες, ρυθμίσεις, χρήστες, σύνδεση Online.');
db.close();
