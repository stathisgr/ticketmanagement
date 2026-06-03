/**
 * Standalone backup της βάσης — για χειροκίνητη ή προγραμματισμένη εκτέλεση.
 * Δουλεύει με ασφάλεια ακόμη κι ενώ τρέχει ο server (VACUUM INTO + WAL).
 *
 * ΧΡΗΣΗ:    node server/scripts/backup.mjs
 * Προαιρετικά: TM_BACKUP_DIR=D:\Backups node server/scripts/backup.mjs
 *
 * Αυτόματα (Windows Task Scheduler) — καθημερινό backup π.χ. στις 03:00:
 *   Program:  node
 *   Arguments: "C:\ticket\server\scripts\backup.mjs"
 *   Start in:  C:\ticket
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = process.env.TM_DB_PATH ?? join(__dirname, '..', '..', 'data', 'ticket.db');
const DIR = process.env.TM_BACKUP_DIR ?? join(__dirname, '..', '..', 'backups');
const KEEP = Number(process.env.TM_BACKUP_KEEP) || 30; // πόσα να κρατά

const p = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

mkdirSync(DIR, { recursive: true });
const full = join(DIR, `ticket-${stamp}.db`);
const db = new DatabaseSync(DB);
db.exec(`VACUUM INTO '${full.replace(/'/g, "''")}'`);
console.log('✓ Backup:', full, `(${(statSync(full).size / 1024).toFixed(0)} KB)`);

// Καθάρισμα παλιών (κρατά τα πιο πρόσφατα KEEP)
const files = readdirSync(DIR).filter((f) => /^ticket-.*\.db$/.test(f)).sort();
const extra = files.slice(0, Math.max(0, files.length - KEEP));
for (const f of extra) { rmSync(join(DIR, f), { force: true }); }
if (extra.length) console.log(`✓ Διαγράφηκαν ${extra.length} παλιά αντίγραφα (κρατάμε ${KEEP}).`);
