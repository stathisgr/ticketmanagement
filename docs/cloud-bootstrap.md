# Οδηγός: Στήσιμο Cloud σε 3 βήματα (Supabase)

Πώς στήνεται το **online cloud** μιας εγκατάστασης. Γίνεται **ΜΙΑ φορά**, από τον integrator
(εσένα), από οποιοδήποτε PC με internet — **όχι** πάνω στο άδειο PC του πελάτη.
Συμπληρώνει τα `cheat-sheet-cloud-setup.md`, `cloud-migration.md`, `deployment.md`.

---

## Ποιος κάνει τι (κρίσιμος διαχωρισμός)

| | Άδειο PC πελάτη (server) | Cloud (Supabase) |
|---|---|---|
| **Ποιος** | ο τεχνικός στον χώρο | εσύ, μία φορά |
| **Τι** | μόνο `Server.zip` → `install-service.bat` | τα 3 βήματα παρακάτω |
| **Εργαλεία** | κανένα (το Node το βάζει το bat· τοπική βάση SQLite auto-seed) | browser + Supabase CLI |
| **pg_dump / psql** | **ΠΟΤΕ** εκεί | ούτε εδώ (το SQL μπαίνει από web SQL Editor) |

Το `schema.sql` το **παράγεις μία φορά** σε δικό σου μηχάνημα (`pg_dump --schema-only`, δες κάτω) και μένει **στατικό αρχείο** που το ξαναχρησιμοποιείς σε κάθε πελάτη.

---

## Προαπαιτούμενα (στο δικό σου PC, μία φορά)

- **Node.js 22** (για το Supabase CLI). `npm i -g supabase` → `supabase login`.
- Το αρχείο **`online/supabase/schema.sql`** (δες «Πώς παράγεται» στο τέλος).

---

## Τα 3 βήματα (σε άδειο Supabase project)

### 1) Βάση — από το **SQL Editor** (browser, χωρίς psql)
1. Νέο project στο supabase.com (περιοχή π.χ. eu-central-1, όρισε DB password).
2. Dashboard → **SQL Editor** → **New query** → επικόλλησε όλο το περιεχόμενο του `schema.sql` → **Run**.
   - Φτιάχνει όλους τους πίνακες, indexes, RLS policies, database functions/triggers.
   - (Εναλλακτικά, με psql: `psql "<conn>" -f online/supabase/schema.sql`.)

### 2) Edge Functions — με το CLI (μία εντολή)
Από τον φάκελο `online/`:
```
supabase link --project-ref <NEW-REF>
deploy-functions.bat        (ή: supabase functions deploy)
```
Ανεβάζει και τις 7 functions + το κοινό `_shared/`. Το `config.toml` ορίζει `verify_jwt=false` στις δημόσιες.

### 3) Κλειδιά (secrets) + webhook
```
supabase secrets set VIVA_ENV=demo VIVA_SMART_CLIENT_ID=... VIVA_SMART_CLIENT_SECRET=... ^
  VIVA_MERCHANT_ID=... VIVA_API_KEY=... VIVA_SOURCE_CODE=... ^
  MS_TENANT_ID=... MS_CLIENT_ID=... MS_CLIENT_SECRET=... ^
  MAIL_FROM=noreply@domain.gr LEAD_NOTIFY_EMAIL=sales@domain.gr ^
  PUBLIC_SITE_URL=https://ticketmanager.gr/demo
```
- Στο **Viva** δήλωσε webhook `https://<ref>.supabase.co/functions/v1/viva-webhook` + Success/Failure URLs.
- Πλήρης λίστα/επεξήγηση κλειδιών: `cheat-sheet-cloud-setup.md`.

**Σύνδεση τοπικού app με το cloud:** στο PC του πελάτη → Ρυθμίσεις → Online → βάλε `URL` + `service key` (+ connection string για backup) → «Ενεργό». SPA: `VITE_SUPABASE_URL` + `anon key`.

---

## Πώς παράγεται το `schema.sql` (μία φορά, σε δικό σου PC)

Από το **υπάρχον** project σου (έχεις pg_dump + connection string):
```
pg_dump --schema-only --schema=public --no-owner --no-privileges "<conn>" -f online\supabase\schema.sql
```
- `--schema=public`: μόνο οι δικοί μας πίνακες/policies (όχι τα εσωτερικά `auth`/`storage` της Supabase → δεν συγκρούεται σε φρέσκο project).
- Μετά το έχεις **έτοιμο αρχείο** — δεν ξανατρέχεις pg_dump για νέους πελάτες.

> Γιατί όχι «ένα SQL για όλα»: το SQL στήνει μόνο τη **βάση**. Τα Edge Functions είναι κώδικας της πλατφόρμας → ανεβαίνουν με το CLI (βήμα 2). Δεν γίνεται με SQL.
