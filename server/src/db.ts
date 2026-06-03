import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Η βάση ζει στο <project>/data/ticket.db
export const DATA_DIR = join(__dirname, '..', '..', 'data');
export const DB_PATH = process.env.TM_DB_PATH ?? join(DATA_DIR, 'ticket.db');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/** Δημιουργεί/ενημερώνει το σχήμα (idempotent). */
export function migrate(): void {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

  // Pre-migrations για ΥΠΑΡΧΟΥΣΕΣ βάσεις (σε νέα βάση αποτυγχάνουν αθόρυβα — δεν υπάρχουν ακόμη οι πίνακες).
  const preMigrations = [
    "ALTER TABLE venue ADD COLUMN pos_mode TEXT NOT NULL DEFAULT 'both'",
    "ALTER TABLE venue ADD COLUMN default_printer_type TEXT NOT NULL DEFAULT 'escpos80'",
    'ALTER TABLE sale_items ADD COLUMN show_date TEXT',
    'ALTER TABLE tickets ADD COLUMN show_date TEXT',
    'ALTER TABLE halls ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE shows ADD COLUMN start_time TEXT',
    'ALTER TABLE shows ADD COLUMN end_time TEXT',
    'ALTER TABLE shows ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE printers ADD COLUMN copies INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE printers ADD COLUMN auto_cut INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE printers ADD COLUMN drawer_kick INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE venue ADD COLUMN numbering_mode TEXT NOT NULL DEFAULT 'unified'",
    'ALTER TABLE venue ADD COLUMN serial_next INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE venue ADD COLUMN serial_width INTEGER NOT NULL DEFAULT 6',
    'ALTER TABLE ticket_types ADD COLUMN series_prefix TEXT',
    'ALTER TABLE ticket_types ADD COLUMN series_next INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE customers ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE fiscal_config ADD COLUMN print_policy TEXT NOT NULL DEFAULT 'ticket'",
    'ALTER TABLE fiscal_config ADD COLUMN issue_mode TEXT',
    "ALTER TABLE fiscal_config ADD COLUMN legal_note TEXT NOT NULL DEFAULT 'Δεν αποτελεί φορολογικό παραστατικό'",
    'ALTER TABLE tickets ADD COLUMN checked_in_at TEXT',
    'ALTER TABLE tickets ADD COLUMN checked_in_by INTEGER',
    "ALTER TABLE fiscal_config ADD COLUMN pos_provider TEXT NOT NULL DEFAULT 'none'",
    'ALTER TABLE fiscal_config ADD COLUMN pos_config TEXT',
    // Παράθυρο check-in: λεπτά ΠΡΙΝ την έναρξη που ανοίγει η είσοδος (0 = χωρίς περιορισμό).
    'ALTER TABLE venue ADD COLUMN checkin_window_min INTEGER NOT NULL DEFAULT 30',
    // Το παλιό unique index ήταν (show_id, seat_id) — το ανακατασκευάζουμε με show_date.
    'DROP INDEX IF EXISTS idx_tickets_seat_show',
  ];
  for (const stmt of preMigrations) {
    try { db.exec(stmt); } catch { /* ήδη εφαρμοσμένο ή ο πίνακας δεν υπάρχει */ }
  }

  db.exec(schema);

  // Αναβάθμιση πίνακα users: αφαίρεση παλιού CHECK(role) ώστε να επιτρέπεται ο ρόλος 'checker'.
  try {
    const u = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any;
    if (u?.sql && /CHECK\s*\(\s*role/i.test(u.sql)) {
      db.exec('PRAGMA foreign_keys=OFF');
      db.exec('BEGIN');
      db.exec(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        full_name TEXT, role TEXT NOT NULL DEFAULT 'cashier', enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
      db.exec('INSERT INTO users_new (id,username,password_hash,full_name,role,enabled,created_at) SELECT id,username,password_hash,full_name,role,enabled,created_at FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      db.exec('COMMIT');
      db.exec('PRAGMA foreign_keys=ON');
    }
  } catch { try { db.exec('ROLLBACK'); db.exec('PRAGMA foreign_keys=ON'); } catch { /* ignore */ } }

  // Backfill issue_mode από το παλιό mode (μία φορά, για υπάρχουσες βάσεις).
  try {
    db.exec(`UPDATE fiscal_config SET issue_mode = CASE mode
               WHEN 'cash_register_file' THEN 'cash_register'
               WHEN 'e_invoicing' THEN 'provider'
               ELSE 'ticket_only' END
             WHERE issue_mode IS NULL`);
  } catch { /* ignore */ }
  ensureDefaultUsers();
}

/** Εξασφαλίζει ότι υπάρχουν πάντα ο admin (manager) και ο user (ταμίας, χωρίς κωδικό). */
function ensureDefaultUsers(): void {
  if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get('admin')) {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'manager')`)
      .run('admin', bcrypt.hashSync('admin', 10), 'Διαχειριστής');
  }
  if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get('user')) {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'cashier')`)
      .run('user', bcrypt.hashSync('', 10), 'Ταμίας');
  }
  // Ελεγκτής εισόδου (χωρίς κωδικό) — βλέπει μόνο την οθόνη «Είσοδος».
  if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get('checker')) {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'checker')`)
      .run('checker', bcrypt.hashSync('', 10), 'Ελεγκτής');
  }
  // Προεπιλεγμένος πελάτης λιανικής (ανώνυμη ΑΠΥ).
  if (!db.prepare('SELECT 1 FROM customers WHERE is_default = 1').get()) {
    db.prepare(`INSERT INTO customers (full_name, is_default) VALUES ('ΠΕΛΑΤΗΣ ΛΙΑΝΙΚΗΣ', 1)`).run();
  }
}

/** Τοπική ημερομηνία 'YYYY-MM-DD' (της ώρας του server PC, ΟΧΙ UTC). */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Wrapper συναλλαγής: BEGIN/COMMIT/ROLLBACK. Επιστρέφει το αποτέλεσμα της fn. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
