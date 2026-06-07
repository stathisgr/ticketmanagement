// factory-seed.mjs — γεμίζει τα στοιχεία επιχείρησης σε μια ΗΔΗ seeded (άδεια) βάση.
// Χρήση: node factory-seed.mjs <dbPath> <paramsJsonPath>
// Προϋπόθεση: έχει ήδη τρέξει `npm run seed` (σχήμα + βασικά είδη + admin), χωρίς κινήσεις.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const [, , dbPath, paramsPath] = process.argv;
if (!dbPath || !paramsPath) { console.error('usage: node factory-seed.mjs <db> <params.json>'); process.exit(1); }
const p = JSON.parse(readFileSync(paramsPath, 'utf8'));
const db = new DatabaseSync(dbPath);
db.prepare(
  `UPDATE venue SET name=@name, vat_number=@vat, tax_office=@tax, address=@addr,
     postal_code=@pc, city=@city, phone=@phone, email=@email WHERE id = 1`
).run({
  name: p.name ?? '', vat: p.vat ?? '000000000', tax: p.tax ?? '', addr: p.address ?? '',
  pc: p.postal ?? '', city: p.city ?? '', phone: p.phone ?? '', email: p.email ?? '',
});
console.log('[factory] venue set ->', p.name || '(empty)');
