-- Ticket Manager — SQLite schema (Phase 1 core + forward-looking tables)
PRAGMA foreign_keys = ON;

-- Επιχείρηση / στοιχεία εκτύπωσης
CREATE TABLE IF NOT EXISTS venue (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT NOT NULL,
  vat_number    TEXT,            -- ΑΦΜ
  tax_office    TEXT,            -- ΔΟΥ
  address       TEXT,
  postal_code   TEXT,
  city          TEXT,
  phone         TEXT,
  email         TEXT,
  logo_path     TEXT,
  default_vat   REAL NOT NULL DEFAULT 24,
  pos_mode      TEXT NOT NULL DEFAULT 'both' CHECK (pos_mode IN ('serial','halls','both')),
  default_printer_type TEXT NOT NULL DEFAULT 'escpos80',
  numbering_mode TEXT NOT NULL DEFAULT 'unified' CHECK (numbering_mode IN ('unified','per_type')),
  serial_next   INTEGER NOT NULL DEFAULT 1,   -- επόμενος αριθμός για ενιαία αρίθμηση
  serial_width  INTEGER NOT NULL DEFAULT 6,   -- πλήθος ψηφίων (zero-padded)
  checkin_window_min INTEGER NOT NULL DEFAULT 30  -- λεπτά πριν την έναρξη που ανοίγει το check-in (0=χωρίς όριο)
);

-- Χρήστες & ρόλοι
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'cashier',  -- manager | cashier | checker
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Τύποι εισιτηρίων (κουμπιά POS)
CREATE TABLE IF NOT EXISTS ticket_types (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  price           REAL NOT NULL DEFAULT 0,
  default_qty     INTEGER NOT NULL DEFAULT 1,
  vat_rate        REAL NOT NULL DEFAULT 24,
  department      INTEGER NOT NULL DEFAULT 1,
  receipt_limit   REAL,                       -- όριο απόδειξης (αποφυγή λαθών)
  default_payment TEXT NOT NULL DEFAULT 'prompt' CHECK (default_payment IN ('cash','card','bank','prompt')),
  enabled         INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  color           TEXT,
  icon            TEXT,
  series_prefix   TEXT,                        -- πρόθεμα σειράς για αρίθμηση ανά τύπο (π.χ. 'Α')
  series_next     INTEGER NOT NULL DEFAULT 1   -- επόμενος αριθμός σειράς του τύπου
);

-- Εκτυπωτές
CREATE TABLE IF NOT EXISTS printers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('escpos58','escpos80','zpl')),
  connection  TEXT NOT NULL DEFAULT 'system' CHECK (connection IN ('usb','network','system','file')),
  address     TEXT,                          -- network: IP:port · file: φάκελος · system/usb: όνομα
  copies      INTEGER NOT NULL DEFAULT 1,
  auto_cut    INTEGER NOT NULL DEFAULT 1,    -- αυτόματη κοπή χαρτιού (ESC/POS)
  drawer_kick INTEGER NOT NULL DEFAULT 0,    -- άνοιγμα συρταριού μετρητών
  is_default  INTEGER NOT NULL DEFAULT 0
);

-- Σταθμοί εργασίας (ταμεία) → εκτυπωτής. Ο browser κρατά το όνομα σταθμού τοπικά.
CREATE TABLE IF NOT EXISTS stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  printer_id  INTEGER REFERENCES printers(id) ON DELETE SET NULL
);

-- Παραμετρικές φόρμες εκτύπωσης (Header/Details/Footer)
CREATE TABLE IF NOT EXISTS print_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  printer_type TEXT NOT NULL CHECK (printer_type IN ('escpos58','escpos80','zpl')),
  header       TEXT,
  details      TEXT,
  footer       TEXT,
  params       TEXT,            -- JSON (πλάτος, QR on/off, κ.λπ.)
  is_default   INTEGER NOT NULL DEFAULT 0
);

-- Ρύθμιση φορολογικών / απόδειξης
CREATE TABLE IF NOT EXISTS fiscal_config (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  mode          TEXT NOT NULL DEFAULT 'none' CHECK (mode IN ('none','cash_register_file','e_invoicing')),
  export_folder TEXT,           -- για cash_register_file
  provider      TEXT,           -- για e_invoicing
  config        TEXT,           -- JSON credentials/λοιπά
  print_policy  TEXT NOT NULL DEFAULT 'ticket',  -- (legacy)
  issue_mode    TEXT NOT NULL DEFAULT 'ticket_only',  -- disabled | ticket_only | cash_register | provider
  legal_note    TEXT NOT NULL DEFAULT 'Δεν αποτελεί φορολογικό παραστατικό',
  pos_provider  TEXT NOT NULL DEFAULT 'none',   -- none | viva (μελλοντικά κι άλλοι)
  pos_config    TEXT                            -- JSON: env + Viva credentials + terminalId
);

-- Πελάτες (στοιχεία marketing & ηλεκτρονικής τιμολόγησης)
CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  address        TEXT,
  postal_code    TEXT,
  city           TEXT,
  vat_number     TEXT,          -- ΑΦΜ
  email          TEXT,
  phone1         TEXT,
  phone2         TEXT,
  notes          TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  is_default     INTEGER NOT NULL DEFAULT 0,   -- ο «ΠΕΛΑΤΗΣ ΛΙΑΝΙΚΗΣ» (προεπιλογή)
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Πωλήσεις (κεφαλίδα συναλλαγής)
CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  datetime       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id        INTEGER REFERENCES users(id),
  customer_id    INTEGER REFERENCES customers(id),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','bank')),
  total          REAL NOT NULL DEFAULT 0,
  vat_total      REAL NOT NULL DEFAULT 0,
  receipt_no     TEXT,
  fiscal_status  TEXT NOT NULL DEFAULT 'none' CHECK (fiscal_status IN ('none','queued','sent','error')),
  source         TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','online'))
);

-- Γραμμές πώλησης
CREATE TABLE IF NOT EXISTS sale_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  ticket_type_id INTEGER REFERENCES ticket_types(id),
  show_id        INTEGER,        -- Φάση 2
  show_date      TEXT,           -- Φάση 2: ημερομηνία παράστασης (για επαναλαμβανόμενα θεάματα)
  seat_id        INTEGER,        -- Φάση 2
  title          TEXT NOT NULL,  -- snapshot τίτλου
  qty            INTEGER NOT NULL DEFAULT 1,
  unit_price     REAL NOT NULL DEFAULT 0,
  vat_rate       REAL NOT NULL DEFAULT 24,
  line_total     REAL NOT NULL DEFAULT 0
);

-- Εκδοθέντα εισιτήρια
CREATE TABLE IF NOT EXISTS tickets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_item_id    INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  serial          TEXT NOT NULL UNIQUE,
  qr_payload      TEXT,
  show_id         INTEGER,        -- Φάση 2
  show_date       TEXT,           -- Φάση 2: ημερομηνία παράστασης
  seat_id         INTEGER,        -- Φάση 2
  printed_at      TEXT,
  reprinted_count INTEGER NOT NULL DEFAULT 0,
  checked_in_at   TEXT,           -- έλεγχος εισόδου (check-in)
  checked_in_by   INTEGER REFERENCES users(id),
  cancelled_at    TEXT,           -- ακύρωση εισιτηρίου (audit trail)
  cancelled_by    INTEGER REFERENCES users(id),
  cancel_reason   TEXT,
  cancel_approver TEXT             -- Ονοματεπώνυμο Εγκρίνοντος (διορθώσεις περασμένων εκδηλώσεων)
);

-- Παραστατικά παρόχου (myDATA) ανά πώληση: τι διαβιβάστηκε + στοιχεία απόδειξης (ΜΑΡΚ/QR/AADE).
-- role: 'sale' = ΑΠΥ, 'credit' = Πιστωτικό/Αντιλογιστικό. Πολλαπλά ανά πώληση (π.χ. ΑΠΥ + Πιστωτικό).
CREATE TABLE IF NOT EXISTS fiscal_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id         INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'sale',
  provider        TEXT,                       -- π.χ. 'rapidsign'
  invoice_type_id INTEGER,                    -- π.χ. 20 (ΑΠΥ), 22 (Πιστωτικό Λιανικής)
  series          TEXT,
  aa              TEXT,
  mark            TEXT,                        -- ΜΑΡΚ (αποδεικτικό παραλαβής AADE)
  uid             TEXT,                        -- invoiceUid
  auth_code       TEXT,                        -- authentication code
  qr_url          TEXT,                        -- QR myDATA (AADE) URL
  qr_provider     TEXT,                        -- QR προεπισκόπησης παρόχου
  guid            TEXT,                        -- guid παραστατικού (για ακύρωση/void)
  correlated_mark TEXT,                        -- για Πιστωτικό: ΜΑΡΚ του αρχικού ΑΠΥ
  status          TEXT NOT NULL DEFAULT 'transmitted',  -- transmitted | cancelled | error
  net             REAL, vat REAL, total REAL,
  raw             TEXT,                        -- πλήρης απάντηση παρόχου (audit)
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_sale ON fiscal_documents(sale_id);

-- Ταμειακές κινήσεις (ταμείο)
CREATE TABLE IF NOT EXISTS till_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  datetime    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id     INTEGER REFERENCES users(id),
  sale_id     INTEGER REFERENCES sales(id),
  credit      REAL NOT NULL DEFAULT 0,  -- πίστωση (είσπραξη)
  debit       REAL NOT NULL DEFAULT 0,  -- χρέωση
  method      TEXT CHECK (method IN ('cash','card','bank')),
  reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_datetime ON sales(datetime);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_till_datetime ON till_movements(datetime);

-- ============================================================
-- ΦΑΣΗ 2 — Αίθουσες, θέσεις, θεάματα
-- ============================================================

-- Αίθουσες (διαστάσεις πλέγματος)
CREATE TABLE IF NOT EXISTS halls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  rows        INTEGER NOT NULL DEFAULT 0,   -- πλήθος γραμμών πλέγματος
  cols        INTEGER NOT NULL DEFAULT 0,   -- πλήθος στηλών πλέγματος
  enabled     INTEGER NOT NULL DEFAULT 1,   -- ενεργή/ανενεργή
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Θέσεις/κελιά πλέγματος αίθουσας
-- kind: seat = πραγματική θέση, aisle = διάδρομος, gap = κενό (δεν εκδίδεται)
CREATE TABLE IF NOT EXISTS seats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id      INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  y            INTEGER NOT NULL,            -- δείκτης γραμμής (0-based)
  x            INTEGER NOT NULL,            -- δείκτης στήλης (0-based)
  row_label    TEXT,                        -- π.χ. "A"
  col_label    TEXT,                        -- π.χ. "12"
  display_name TEXT,                        -- π.χ. "A12"
  kind         TEXT NOT NULL DEFAULT 'seat' CHECK (kind IN ('seat','aisle','gap')),
  enabled      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (hall_id, y, x)
);
CREATE INDEX IF NOT EXISTS idx_seats_hall ON seats(hall_id);

-- Θεάματα/προβολές (προγραμματισμός ανά αίθουσα & ώρα)
CREATE TABLE IF NOT EXISTS shows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id     INTEGER REFERENCES halls(id) ON DELETE CASCADE,  -- NULL για events χωρίς θέσεις
  title       TEXT NOT NULL,
  starts_at   TEXT,                         -- (legacy/derived: valid_from + start_time)
  ends_at     TEXT,
  start_time  TEXT,                         -- ώρα έναρξης 'HH:MM'
  end_time    TEXT,                         -- ώρα λήξης 'HH:MM'
  valid_from  TEXT,                         -- ημερομηνία ισχύος ΑΠΟ
  valid_to    TEXT,                         -- ημερομηνία ισχύος ΕΩΣ
  enabled     INTEGER NOT NULL DEFAULT 1,   -- ενεργό/ανενεργό πρόγραμμα
  seating_mode TEXT NOT NULL DEFAULT 'seated' CHECK (seating_mode IN ('seated','general')),
  capacity    INTEGER NOT NULL DEFAULT 0,   -- general: μέγιστα εισιτήρια (0 = απεριόριστο)
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_shows_hall ON shows(hall_id);
CREATE INDEX IF NOT EXISTS idx_shows_starts ON shows(starts_at);

-- Είδη εισιτηρίων ανά θέαμα (δική τους τιμή/ΦΠΑ)
CREATE TABLE IF NOT EXISTS show_ticket_types (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id        INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  ticket_type_id INTEGER REFERENCES ticket_types(id),  -- προαιρετική σύνδεση με βασικό τύπο
  title          TEXT NOT NULL,
  price          REAL NOT NULL DEFAULT 0,
  vat_rate       REAL NOT NULL DEFAULT 24,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stt_show ON show_ticket_types(show_id);

-- Προστασία διπλο-κράτησης: μία θέση ανά θέαμα ΑΝΑ ΗΜΕΡΟΜΗΝΙΑ
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_seat_show
  ON tickets(show_id, show_date, seat_id) WHERE seat_id IS NOT NULL AND cancelled_at IS NULL;

-- ===== ONLINE (Supabase) σύνδεση =====
-- Ρυθμίσεις σύνδεσης με το cloud (singleton id=1). service_key = service_role (μυστικό, μόνο τοπικά).
CREATE TABLE IF NOT EXISTS online_config (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  supabase_url        TEXT,
  service_key         TEXT,
  sync_minutes_before INTEGER NOT NULL DEFAULT 60,  -- παράμετρος: λεπτά πριν το θέαμα για auto-pull
  enabled             INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO online_config (id) VALUES (1);

-- Ποια θεάματα (ανά ημερομηνία) έχουν δημοσιευτεί online + το cloud id τους.
CREATE TABLE IF NOT EXISTS online_publications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id        INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  show_date      TEXT NOT NULL,            -- 'YYYY-MM-DD'
  cloud_show_id  INTEGER,                  -- id στο Supabase
  sales_close_at TEXT,                     -- ISO· κλείσιμο online πωλήσεων
  enabled        INTEGER NOT NULL DEFAULT 1,
  pushed_at      TEXT,
  last_pull_at   TEXT,
  UNIQUE (show_id, show_date)
);

-- Online-πουλημένες θέσεις που κατέβηκαν από το cloud (για να τις βλέπει ο ταμίας).
CREATE TABLE IF NOT EXISTS online_sold_seats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id      INTEGER NOT NULL,
  show_date    TEXT NOT NULL,
  seat_id      INTEGER NOT NULL,
  serial       TEXT,
  buyer_email  TEXT,
  synced_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (show_id, show_date, seat_id)
);
