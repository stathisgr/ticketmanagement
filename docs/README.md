# Playbooks — Επαναχρησιμοποιήσιμοι οδηγοί υλοποίησης

Modular οδηγοί για να **μην ξεκινάμε από την αρχή** κάθε φορά που στήνουμε μια νέα
εφαρμογή. Κάθε αρχείο είναι αυτόνομο και γενικό — περιγράφει το **μοτίβο** (pattern),
τα βήματα ρύθμισης και τα **γνωστά λάθη/παγίδες** (gotchas) που έχουμε ήδη λύσει.

Το Alpha Ticket Manager χρησιμοποιείται ως **αναφορά υλοποίησης** (πού βρίσκεται ο κώδικας),
αλλά τα μοτίβα ισχύουν για οποιαδήποτε εφαρμογή (POS, κρατήσεις, e-shop, booking, κ.λπ.).

---

## Περιεχόμενα

| Οδηγός | Τι καλύπτει |
|---|---|
| [mydata-provider.md](./mydata-provider.md) | Σύνδεση με πάροχο ηλεκτρονικής τιμολόγησης / myDATA (RapidSign/RBS): auth, έκδοση, πληρωμές, σφάλματα. |
| [fiscal-documents.md](./fiscal-documents.md) | Μοντέλο παραστατικών & ειδών: σειρές, αρίθμηση ΑΑ, υπηρεσίες vs προϊόντα, πιστωτικά, retries. |
| [thermal-printing.md](./thermal-printing.md) | Θερμικοί εκτυπωτές (ESC/POS 58/80), ετικέτες ZPL, δικτυακός/USB, browser fallback, QR. |
| [online-payments-supabase-viva.md](./online-payments-supabase-viva.md) | Online πωλήσεις: Supabase (Postgres + Edge Functions) + Viva Smart Checkout, holds, webhook, abandoned-cart recovery, sync. |
| [email-resend-graph.md](./email-resend-graph.md) | Αποστολή email: Resend & Microsoft 365 (Graph, client-credentials, shared mailbox). |
| [backups-restore.md](./backups-restore.md) | Αντίγραφα ασφαλείας & ανάκτηση: τοπική βάση, cloud JSON, πλήρες pg_dump, restore σε ίδιο/νέο project. |

### Marketing / στατικό site (όπως το ticketmanager.gr)

| Οδηγός | Τι καλύπτει |
|---|---|
| [web-static-site.md](./web-static-site.md) | Αρχιτεκτονική multipage static site + deployment σε Cloudflare + παγίδα truncation. |
| [web-seo-i18n.md](./web-seo-i18n.md) | SEO & πολυγλωσσικότητα: hreflang, slugs ανά γλώσσα, sitemap alternates, JSON-LD. |
| [web-accessibility-performance.md](./web-accessibility-performance.md) | WCAG/WAVE (contrast, heading order, alt) + εικόνες/responsive/mobile. |
| [web-lead-forms.md](./web-lead-forms.md) | Φόρμες leads → Supabase Edge Function, honeypot, thank-you panel. |

---

## Checklist νέας εφαρμογής

Σειρά που συνήθως ακολουθούμε για να στήσουμε κάτι παρόμοιο:

1. **Τοπικός πυρήνας** — βάση (SQLite/Postgres), API (Node/Fastify), client (React/Vite). Σέρβιρε τον built client στατικά από τον server.
2. **Παραστατικά** — όρισε το μοντέλο ειδών/παραστατικών ([fiscal-documents.md](./fiscal-documents.md)) **πριν** συνδέσεις πάροχο.
3. **Πάροχος myDATA** — [mydata-provider.md](./mydata-provider.md): dev credentials → δοκιμή → φόρτωση λιστών → δοκιμή έκδοσης.
4. **Εκτύπωση** — [thermal-printing.md](./thermal-printing.md): δικτυακός εκτυπωτής ή browser fallback· QR ως εικόνα στο browser.
5. **Online** (αν χρειάζεται) — [online-payments-supabase-viva.md](./online-payments-supabase-viva.md): Supabase project, Edge Functions, Viva, webhook, sync.
6. **Email** — [email-resend-graph.md](./email-resend-graph.md): shared mailbox + provider.
7. **Backups** — [backups-restore.md](./backups-restore.md): ενεργοποίησε τοπικό + cloud backup από μέρα 1.
8. **Site/marketing** (αν χρειάζεται) — [web-static-site.md](./web-static-site.md) → [web-seo-i18n.md](./web-seo-i18n.md) → [web-accessibility-performance.md](./web-accessibility-performance.md) → [web-lead-forms.md](./web-lead-forms.md).

---

## Γενικές αρχές (ισχύουν παντού)

- **Secrets μόνο τοπικά / από τον χρήστη.** Κλειδιά, passwords, connection strings τα καταχωρεί ο χρήστης και μένουν στη βάση του server — ποτέ στον browser, ποτέ στο git.
- **Idempotency.** Κάθε συγχρονισμός/έκδοση/εισαγωγή να μπορεί να ξανατρέξει χωρίς διπλά (έλεγχος «υπάρχει ήδη» πριν από insert).
- **Μη χάνεις αριθμούς/χρήματα.** Αποτυχημένες προσπάθειες δεν «καίνε» αριθμούς· auto-retry σε γνωστά σφάλματα διπλασιασμού.
- **Fail-soft στα δευτερεύοντα.** Αποτυχία email/εκτύπωσης/cloud δεν πρέπει να ρίχνει την κύρια συναλλαγή.
- **Backup από μέρα 1.** Το δωρεάν cloud συνήθως δεν έχει αυτόματα backups.
