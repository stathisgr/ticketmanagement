# Οδηγίες έργου — Alpha Ticket Manager

Lightweight ticketing / box-office εφαρμογή (Node.js) για θέατρα/κινηματογράφους/μουσεία/εκδηλώσεις,
που αντικαθιστά μια παλιά εφαρμογή PowerBuilder + Sybase. Monorepo στο `C:\ticket`:
`server/` (Fastify + JWT + `node:sqlite`) + `client/` (React + Vite + Tailwind),
`online/` (Supabase + Viva booking site), `docs/` (επαναχρησιμοποιήσιμοι οδηγοί).

---

## ⚠️ Διάβασε ΠΡΩΤΑ τους οδηγούς στο `docs/`

Πριν δουλέψεις σε οποιοδήποτε υποσύστημα, συμβουλέψου τον σχετικό οδηγό στον φάκελο
[`docs/`](./docs/README.md). Κάθε οδηγός περιγράφει το μοτίβο, τα βήματα ρύθμισης και
**τις παγίδες που έχουμε ήδη φάει** — μην τις ξαναπατήσεις.

| Υποσύστημα | Οδηγός |
|---|---|
| Πάροχος ηλεκτρονικής τιμολόγησης / myDATA (RapidSign/RBS) | [`docs/mydata-provider.md`](./docs/mydata-provider.md) |
| Μοντέλο παραστατικών & ειδών, αρίθμηση ΑΑ, υπηρεσίες vs προϊόντα | [`docs/fiscal-documents.md`](./docs/fiscal-documents.md) |
| Θερμικοί εκτυπωτές ESC/POS, ZPL, QR | [`docs/thermal-printing.md`](./docs/thermal-printing.md) |
| Online πωλήσεις: Supabase + Viva, holds, webhook, sync | [`docs/online-payments-supabase-viva.md`](./docs/online-payments-supabase-viva.md) |
| Αποστολή email: Resend & Microsoft 365 Graph | [`docs/email-resend-graph.md`](./docs/email-resend-graph.md) |
| Αντίγραφα ασφαλείας & ανάκτηση | [`docs/backups-restore.md`](./docs/backups-restore.md) |
| Στατικό marketing site (ticketmanager.gr) | [`docs/web-static-site.md`](./docs/web-static-site.md) |
| SEO & πολυγλωσσικότητα (hreflang, slugs, JSON-LD) | [`docs/web-seo-i18n.md`](./docs/web-seo-i18n.md) |
| Προσβασιμότητα & επιδόσεις (WCAG/WAVE, εικόνες) | [`docs/web-accessibility-performance.md`](./docs/web-accessibility-performance.md) |
| Φόρμες leads → Supabase Edge Function | [`docs/web-lead-forms.md`](./docs/web-lead-forms.md) |

Ο πλήρης index + checklist νέας εφαρμογής είναι στο [`docs/README.md`](./docs/README.md).
Σχετικά: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`FISCAL.md`](./FISCAL.md),
[`RAPIDSIGN_SETUP.md`](./RAPIDSIGN_SETUP.md), [`ΝΟΜΙΚΟ-ΠΛΑΙΣΙΟ-ΕΙΣΙΤΗΡΙΩΝ.md`](./ΝΟΜΙΚΟ-ΠΛΑΙΣΙΟ-ΕΙΣΙΤΗΡΙΩΝ.md).

---

## Χρυσοί κανόνες (ισχύουν παντού)

- **Secrets μόνο τοπικά / από τον χρήστη.** Κλειδιά, passwords, connection strings τα
  καταχωρεί ο χρήστης και μένουν στη βάση του server — ποτέ στον browser, ποτέ στο git.
- **Idempotency.** Κάθε συγχρονισμός/έκδοση/εισαγωγή να ξανατρέχει χωρίς διπλά
  (έλεγχος «υπάρχει ήδη» πριν από insert).
- **Μη χάνεις αριθμούς/χρήματα.** Αποτυχημένες προσπάθειες δεν «καίνε» αριθμούς ΑΑ·
  auto-retry σε γνωστά σφάλματα διπλασιασμού.
- **Fail-soft στα δευτερεύοντα.** Αποτυχία email/εκτύπωσης/cloud δεν ρίχνει την κύρια συναλλαγή.
- **Backup από μέρα 1.** Το δωρεάν cloud συνήθως δεν έχει αυτόματα backups.

---

## Τεχνικές συμβάσεις του έργου

- **DB engine: `node:sqlite`** (όχι better-sqlite3) — απαιτεί **Node ≥ 22.5 (ιδανικά 24)**,
  μηδέν native deps. `db.ts` εκθέτει `db` (DatabaseSync) + helper `tx()` για BEGIN/COMMIT/ROLLBACK.
  Named params με `@key`.
- **Ώρα/ημερομηνία πάντα localtime.** Χρησιμοποίησε `datetime('now','localtime')` ρητά στα
  INSERTs (όχι column DEFAULT) και `db.localDate()` για το «σήμερα» — αλλιώς οι πωλήσεις
  κολλάνε στην προηγούμενη μέρα (UTC bug).
- **Πληρωμές: μόνο μετρητά/κάρτα.** Online μόνο μέσω Viva.
- **Git τρέχει στο Windows του χρήστη**, όχι μέσα από το mount — το OneDrive/FUSE mount
  χαλάει τα lock/rename/unlink του git.
- **Παγίδα sandbox με ελληνικά:** το FUSE mount μπορεί να επιστρέφει **truncated** ή
  αλλοιωμένα (multibyte) περιεχόμενα σε bash/node/esbuild/tsc → δίνουν **ψεύτικα** syntax
  errors σε αρχεία με ελληνικά. Επαλήθευσε με το Read tool / `node --check`, όχι με
  esbuild/tsc πάνω στο mount.

---

## Ροή για νέο υποσύστημα

1. Διάβασε τον αντίστοιχο οδηγό στο `docs/`.
2. Εφάρμοσε το μοτίβο· τήρησε τους χρυσούς κανόνες.
3. Όταν φας μια **νέα** παγίδα, πρόσθεσέ την στην ενότητα «Παγίδες που φάγαμε» του σχετικού οδηγού.
