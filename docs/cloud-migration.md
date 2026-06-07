# Οδηγός: Μεταφορά Cloud (νέο Supabase project ή άλλος Postgres host)

Πλήρης «κιτ» μετάφερσης του online backend σε άλλο project/υπηρεσία. Συνοδεύει το
[backups-restore.md](./backups-restore.md). Αναφορά: `online/supabase/`.

---

## 1. Τι περιέχει το πλήρες backup (`cloud-full-*.sql`)

`pg_dump --no-owner --no-privileges` → **schema + δεδομένα + database functions + triggers +
RLS policies** όλων των πινάκων στα οποία έχει πρόσβαση ο χρήστης (πρακτικά: το schema `public`
της εφαρμογής). **ΔΕΝ** περιέχει: Edge Functions, secrets/env, webhooks, auth users, storage,
ούτε τα εσωτερικά schemas της Supabase (`auth`, `storage`, realtime) — αυτά τα παρέχει η πλατφόρμα.

Μαζί με το `cloud-*.json` (μόνο δεδομένα) έχεις δύο μορφές: SQL για πλήρη restore, JSON για ασφαλές αντίγραφο γραμμών.

## 2. Πλήρες κιτ μετάφερσης — τι χρειάζεσαι

| Συστατικό | Από πού | Σημείωση |
|---|---|---|
| **Δομή + δεδομένα** | `cloud-full-*.sql` | restore με `psql` |
| **Edge Functions** | repo: `online/supabase/functions/` | re-deploy (λίστα §4) |
| **Secrets / env** | δικά σου αρχεία | μόνο **ονόματα** εδώ (§3) — οι τιμές μένουν δικές σου |
| **Webhooks** | Viva dashboard | νέο URL webhook (§5) |
| **Στατικό site / SPA** | repo + Cloudflare | δεν εξαρτάται από το project, μόνο τα κλειδιά αλλάζουν |
| **Τοπικό app** | Ρυθμίσεις → Online | νέο URL + service key + connection string |

## 3. Απαιτούμενα secrets (ΟΝΟΜΑΤΑ — όχι τιμές)

Αυτά ορίζονται ως **Function Secrets** στο Supabase project (Dashboard → Edge Functions → Secrets)
ή στο τοπικό app. Οι **τιμές** φυλάσσονται από εσένα, ποτέ στο repo/backup.

| Secret | Χρήση | Από πού παίρνεται η τιμή |
|---|---|---|
| `SUPABASE_URL` | (auto) | Δίνεται αυτόματα από το Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | (auto) | Project Settings → API |
| `VIVA_ENV` | demo/prod | εσύ |
| `VIVA_SMART_CLIENT_ID` / `VIVA_SMART_CLIENT_SECRET` | Smart Checkout | Viva → apps.vivapayments.com |
| `VIVA_MERCHANT_ID` / `VIVA_API_KEY` | order state (legacy) | Viva account |
| `VIVA_SOURCE_CODE` | payment source (προαιρ.) | Viva |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | email (Microsoft 365 Graph) | Entra app registration |
| `MAIL_FROM` | αποστολέας email | π.χ. noreply@domain |
| `LEAD_NOTIFY_EMAIL` | παραλήπτης leads / replyTo | π.χ. sales@domain |
| `PUBLIC_SITE_URL` | base για συνδέσμους email | π.χ. https://ticketmanager.gr/demo |
| `GOOGLE_WALLET_ISSUER_ID` / `GOOGLE_WALLET_SA_EMAIL` / `GOOGLE_WALLET_SA_KEY` | Google Wallet pass (προαιρ.) | Google Cloud |

(Τοπικό app — δικά του, στη βάση του server: RapidSign username/password/activationCode, Viva, email provider, Supabase URL/service key, connection string.)

## 4. Edge Functions προς deploy (από repo)

`create-order`, `resume-order`, `order-status`, `viva-webhook`, `lead`, `ticket`, `wallet-google`
(+ κοινός κώδικας `_shared/`). Deploy: `supabase functions deploy <name>` (ή MCP). Οι δημόσιες
(create-order/resume-order/viva-webhook/lead/ticket) με `verify_jwt=false`.

## 5. Βήματα — μεταφορά σε ΝΕΟ Supabase project

1. Δημιούργησε νέο project (ίδιο ή νεότερο PostgreSQL).
2. **Restore δομής+δεδομένων:** `psql "<new-conn>" -f cloud-full-YYYYMMDD.sql`
   *(αν υπάρχουν συγκρούσεις με προϋπάρχοντα objects: restore σε καθαρό project, ή κράτα μόνο το schema `public`)*.
3. **Deploy** τα Edge Functions (§4).
4. **Set secrets** (§3) στο νέο project.
5. **Webhook Viva:** όρισε το νέο URL `.../functions/v1/viva-webhook` στο Viva dashboard· πάρε το verification key.
6. **Τοπικό app → Ρυθμίσεις → Online:** βάλε νέο `Supabase URL`, `service key`, `connection string`.
7. **SPA/site:** ενημέρωσε `SUPABASE_URL`/anon key στο `config` του SPA + redeploy· έλεγξε Success/Failure URLs Viva.
8. Δοκιμή: μια online κράτηση demo → πληρωμή → webhook → e-ticket → συγχρονισμός.

## 6. Μεταφορά σε ΑΛΛΗ υπηρεσία (όχι Supabase) — π.χ. Neon, RDS, self-host

- **Τα δεδομένα + το schema `public` είναι 100% φορητά** (τυπική PostgreSQL): `psql -f cloud-full-*.sql` σε οποιονδήποτε Postgres ≥ της έκδοσης.
- **ΔΕΝ** μεταφέρονται τα «platform» κομμάτια της Supabase:
  - Ρόλοι `anon` / `authenticated` / `service_role` και schemas `auth` / `storage` — οι RLS policies που τα αναφέρουν θα αποτύχουν· σε καθαρό Postgres είτε δημιουργείς αυτούς τους ρόλους, είτε **αφαιρείς τα RLS** (η ασφάλεια γίνεται στο API σου).
  - **Edge Functions, auto REST API (PostgREST), Auth (GoTrue), Realtime, Storage** — αυτά είναι υπηρεσίες της Supabase. Σε άλλον host θα χρειαστεί να στήσεις δικό σου API layer (ή να τρέξεις self-hosted Supabase μέσω Docker, που τα περιλαμβάνει όλα).
- **Πρακτικά:** για «καθαρό» Postgres host κράτα τη βάση ως αποθήκη δεδομένων και μίλα της από δικό σου backend. Για πλήρη ισοδυναμία με ένα κλικ → **self-hosted Supabase (Docker)**.

## Παγίδες

- Restore πλήρους dump πάνω σε project που ήδη έχει `auth`/`storage` → συγκρούσεις. Προτίμησε καθαρό project ή scope σε `public`.
- Ειδικοί χαρακτήρες στον κωδικό του connection string → URL-encoding ή reset σε alphanumeric.
- Pooler host → χρήστης `postgres.<project-ref>` (όχι σκέτο `postgres`).
- Μην ξεχάσεις webhook URL + Success/Failure URLs Viva + anon key στο SPA μετά τη μεταφορά.
