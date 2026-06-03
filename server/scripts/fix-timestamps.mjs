/**
 * ΕΦΑΠΑΞ διόρθωση: μετατρέπει ΥΠΑΡΧΟΥΣΕΣ ημερομηνίες από UTC σε τοπική ώρα.
 * Αφορά εγγραφές που γράφτηκαν πριν τη διόρθωση timezone (sales, till_movements, tickets).
 *
 * ΧΡΗΣΗ:
 *   1) Σταμάτησε τον server (Ctrl+C στο npm run dev).
 *   2) node server/scripts/fix-timestamps.mjs
 *   3) Ξεκίνα ξανά: npm run dev
 *
 * ⚠️ Τρέξε το ΜΟΝΟ ΜΙΑ ΦΟΡΑ. Δεύτερη εκτέλεση θα μετατοπίσει ξανά (διπλή προσθήκη offset).
 *    Δημιουργείται αυτόματα backup (.bak) πριν την αλλαγή.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = process.env.TM_DB_PATH ?? join(__dirname, '..', '..', 'data', 'ticket.db');
if (!existsSync(DB)) { console.error('Δεν βρέθηκε η βάση:', DB); process.exit(1); }

copyFileSync(DB, DB + '.bak');
console.log('✓ Backup:', DB + '.bak');

const db = new DatabaseSync(DB);
// Offset (ώρες) τοπικής ώρας από UTC, στο ΤΡΕΧΟΝ μηχάνημα.
const { off } = db.prepare(
  "SELECT (julianday(datetime('now','localtime')) - julianday(datetime('now'))) * 24 AS off"
).get();
const hours = Math.round(off);
console.log('Τοπικό offset:', hours, 'ώρες');
if (hours === 0) { console.log('Καμία αλλαγή (UTC == τοπική).'); process.exit(0); }

const shift = `'${hours >= 0 ? '+' : ''}${hours} hours'`;
const run = (sql) => { const r = db.prepare(sql).run(); return r.changes; };
let total = 0;
total += run(`UPDATE sales SET datetime = datetime(datetime, ${shift}) WHERE datetime IS NOT NULL`);
total += run(`UPDATE till_movements SET datetime = datetime(datetime, ${shift}) WHERE datetime IS NOT NULL`);
total += run(`UPDATE tickets SET printed_at = datetime(printed_at, ${shift}) WHERE printed_at IS NOT NULL`);
console.log(`✓ Διορθώθηκαν ${total} εγγραφές (+${hours}h). Έτοιμο.`);
