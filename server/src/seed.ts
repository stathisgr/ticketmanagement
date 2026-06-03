import bcrypt from 'bcryptjs';
import { db, migrate, tx } from './db.js';

/** Αρχικοποίηση σχήματος + βασικά δεδομένα (idempotent). */
export function seed(): void {
  migrate();

  // Venue (singleton)
  const venueExists = db.prepare('SELECT 1 FROM venue WHERE id = 1').get();
  if (!venueExists) {
    db.prepare(
      `INSERT INTO venue (id, name, vat_number, tax_office, address, postal_code, city, phone, email, default_vat)
       VALUES (1, @name, @vat, @tax, @addr, @pc, @city, @phone, @email, 24)`
    ).run({
      name: 'Η Επιχείρησή μου',
      vat: '000000000',
      tax: '',
      addr: '',
      pc: '',
      city: '',
      phone: '',
      email: '',
    });
  }

  // Fiscal config (singleton, default: none)
  if (!db.prepare('SELECT 1 FROM fiscal_config WHERE id = 1').get()) {
    db.prepare(`INSERT INTO fiscal_config (id, mode) VALUES (1, 'none')`).run();
  }

  // Default admin (manager)
  if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get('admin')) {
    db.prepare(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'manager')`
    ).run('admin', bcrypt.hashSync('admin', 10), 'Διαχειριστής');
  }

  // Ταμίας χωρίς κωδικό (για δοκιμή του ρόλου cashier) — password_hash = hash κενού string
  if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get('user')) {
    db.prepare(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'cashier')`
    ).run('user', bcrypt.hashSync('', 10), 'Ταμίας');
  }

  // Δείγμα τύπων εισιτηρίων (μόνο αν είναι άδειο)
  const count = db.prepare('SELECT COUNT(*) AS n FROM ticket_types').get() as { n: number };
  if (count.n === 0) {
    const ins = db.prepare(
      `INSERT INTO ticket_types (title, subtitle, price, default_qty, vat_rate, default_payment, enabled, sort_order, color)
       VALUES (@title, @sub, @price, @qty, @vat, @pay, 1, @ord, @color)`
    );
    const samples = [
      { title: 'ΚΑΝΟΝΙΚΟ', sub: 'Γενική Είσοδος', price: 5, qty: 1, vat: 24, pay: 'prompt', ord: 10, color: '#e8e4d8' },
      { title: 'ΜΕΙΩΜΕΝΟ', sub: 'Φοιτητικό', price: 3, qty: 1, vat: 24, pay: 'prompt', ord: 20, color: '#d8e4e8' },
      { title: 'ΔΩΡΕΑΝ', sub: '', price: 0, qty: 1, vat: 0, pay: 'cash', ord: 30, color: '#e0f0e0' },
      { title: 'ΟΜΑΔΙΚΟ 5', sub: 'Πακέτο 5 ατόμων', price: 20, qty: 5, vat: 24, pay: 'prompt', ord: 40, color: '#f0e8d0' },
    ];
    tx(() => samples.forEach((s) => ins.run(s)));
  }

  console.log('✓ Seed complete. Login: admin / admin (manager) ή user / (κενό) (ταμίας)');
}

// Άμεση εκτέλεση: `npm run seed`
seed();
