# Cheat Sheet — Στήσιμο Cloud & Παρόχων (τεχνικό)

Για τεχνικό που στήνει νέα εγκατάσταση. Εξηγεί **κάθε πεδίο**: τι είναι, πού το βρίσκεις, πού το βάζεις.
Το **τοπικό σύστημα** (εγκατάσταση/service/εκτυπωτές) είναι στο εγχειρίδιο χρήστη & `deployment.md`.
Εδώ: ό,τι χρειάζεται **εκτός** του τοπικού — Supabase, email, Viva, πάροχος myDATA.

> Όλα τα κλειδιά/secrets τα καταχωρεί ο τεχνικός· **δεν** μπαίνουν στο git/zip.

---

## 0. Πού «κάθεται» η κάθε ρύθμιση (3 σημεία)

| Σημείο | Τι ρυθμίζεις εκεί |
|---|---|
| **Εφαρμογή → Ρυθμίσεις** (τοπικά, στη βάση του server) | Viva ταμείου, Email τοπικού, Σύνδεση Cloud, Πάροχος myDATA |
| **Supabase → Edge Functions → Secrets** (dashboard) | Online πύλη: Viva online, Email online (MS/Resend), λοιπά |
| **SPA config / Cloudflare env** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` της πύλης |

Σημείωση: Viva & Email υπάρχουν **δύο φορές** — μία για το **τοπικό ταμείο** (στην εφαρμογή) και μία για την **online πύλη** (Supabase secrets). Είναι ανεξάρτητα.

---

## 1. Supabase (cloud βάση + online πύλη)

1. **Create project** στο supabase.com → διάλεξε περιοχή (π.χ. eu-central-1) + όρισε **Database password** (κράτησέ το).
2. **API keys:** Project Settings → API → `Project URL`, `anon key` (δημόσιο), `service_role key` (μυστικό).
3. **Connection string:** κουμπί **Connect** → URI → **Session pooler** (χρήστης `postgres.<ref>`).
4. **Edge Functions (Supabase CLI):**
   - `npm i -g supabase` → `supabase login` (access token).
   - Από τον φάκελο `online/` (εκεί ζει το `supabase/`): `supabase link --project-ref <ref>`.
   - `supabase functions deploy` → ανεβάζει **ΟΛΕΣ** (create-order, resume-order, order-status, viva-webhook, lead, ticket, wallet-google) + το κοινό `_shared/`. Το `online/supabase/config.toml` ορίζει `verify_jwt=false` στις δημόσιες (παλιό CLI → ανά function).
5. **Function Secrets:** `supabase secrets set VIVA_... MS_... MAIL_FROM=... LEAD_NOTIFY_EMAIL=... PUBLIC_SITE_URL=...` (πλήρης λίστα §5).
6. **Viva webhook:** δήλωσε στο Viva το URL `https://<ref>.supabase.co/functions/v1/viva-webhook` (το GET επιστρέφει verification key).

| Τιμή | Τι είναι | Πού το βρίσκω | Πού το βάζω |
|---|---|---|---|
| Project URL | Διεύθυνση του cloud project | Settings → API | Εφαρμογή → Online → «Διεύθυνση Cloud (URL)» + SPA `VITE_SUPABASE_URL` |
| anon key | Δημόσιο κλειδί για τον browser | Settings → API | SPA `VITE_SUPABASE_ANON_KEY` (Cloudflare env) |
| service_role key | Μυστικό κλειδί (server-side) | Settings → API | Εφαρμογή → Online → «Κλειδί υπηρεσίας» |
| Connection string | Σύνδεση Postgres (για backup pg_dump) | Connect → Session pooler | Εφαρμογή → Online → «Connection string βάσης» |
| DB password | Κωδικός βάσης | ορίζεται/Reset στο Settings → Database | μέσα στο connection string (alphanumeric → χωρίς encoding) |

---

## 2. Email — διάλεξε **Resend** Ή **Microsoft 365 (Graph)**

Χρησιμοποιείται για αποδείξεις/e-tickets/υπενθυμίσεις/leads. Ρυθμίζεται **και** τοπικά (Ρυθμίσεις → Online → Email) **και** online (Supabase secrets).

### Α) Resend (πιο απλό)
| Πεδίο | Τι είναι | Πού το βρίσκω |
|---|---|---|
| Domain verify | Επαλήθευση domain (SPF/DKIM) | resend.com → Domains |
| API key | Κλειδί αποστολής | resend.com → API Keys |
| From | Αποστολέας (επαληθευμένο domain) | εσύ (π.χ. `noreply@domain.gr`) |

Εφαρμογή → Online → Email: Πάροχος=Resend, From, «Resend API key».

### Β) Microsoft 365 (Graph, client-credentials)
| Πεδίο | Τι είναι | Πού το βρίσκω / κάνω |
|---|---|---|
| App registration | Εφαρμογή στο Entra | entra.microsoft.com → App registrations → New |
| Application permission **Mail.Send** | Δικαίωμα αποστολής | API permissions → Microsoft Graph → Application → Mail.Send → **Grant admin consent** |
| Tenant ID | Directory (tenant) ID | Overview της εφαρμογής |
| Client ID | Application (client) ID | Overview της εφαρμογής |
| Client Secret | Μυστικό | Certificates & secrets → New client secret (κράτα το value) |
| From mailbox | Αποστολέας (shared mailbox) | π.χ. `noreply@domain.gr` (shared) |

Εφαρμογή → Online → Email: Πάροχος=Microsoft 365, From=mailbox, Tenant/Client/Secret.
Supabase secrets: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_FROM`, `LEAD_NOTIFY_EMAIL`.

---

## 3. Viva — πληρωμές με κάρτα

**Δύο σημεία:** (α) τοπικό ταμείο (Ρυθμίσεις → POS/Κάρτες), (β) online πύλη (Supabase secrets).

| Πεδίο (εφαρμογή POS/Κάρτες) | Τι είναι | Πού το βρίσκω (Viva) |
|---|---|---|
| Περιβάλλον | demo / prod | — |
| Merchant ID | Αναγνωριστικό εμπόρου | Viva → Settings → API Access |
| API Key | Για κατάσταση πληρωμής (legacy) | Viva → Settings → API Access |
| Smart Checkout — Client ID/Secret | OAuth για δημιουργία order | Viva → apps.vivapayments.com (Smart Checkout app) |
| POS (Cloud Terminal) — Client ID/Secret | Για φυσικό/Soft POS | Viva → Cloud Terminal app |
| Terminal ID | Το τερματικό (φυσικό/SoftPOS) | Viva → Terminals |
| Source code ΤΑΜΕΙΟΥ | Πηγή πληρωμών ταμείου (Physical) | Viva → Sales → Sources (κενό = default) |

**Online (Supabase secrets):** `VIVA_ENV` (demo/prod), `VIVA_SMART_CLIENT_ID`, `VIVA_SMART_CLIENT_SECRET`, `VIVA_MERCHANT_ID`, `VIVA_API_KEY`, `VIVA_SOURCE_CODE` (πηγή του online — διαφορετική από του ταμείου).
**Webhook:** δήλωσε το `…/functions/v1/viva-webhook` + Success/Failure URLs (`…/demo/` και `…/demo/?failed=1`).

---

## 4. Πάροχος myDATA (RapidSign / RBS) — ηλεκτρονική τιμολόγηση

Ρυθμίζεται **τοπικά**: Ρυθμίσεις → **Εκτυπωτές** → «Λειτουργία έκδοσης» → «Εισιτήριο μέσω Παρόχου».

| Πεδίο | Τι είναι | Πού το βρίσκω |
|---|---|---|
| Περιβάλλον | dev (δοκιμές) / prod | — |
| Username / Password | Λογαριασμός API | ο πάροχος (RBS/RapidSign) |
| Activation code | Κωδικός ενεργοποίησης | ο πάροχος |
| ΑΦΜ εκδότη | ΑΦΜ επιχείρησης | πελάτης |
| Σειρά | π.χ. ΑΠΥ (ελληνικά, μία γραφή) | συμφωνία/πάροχος |

Μετά: «Φόρτωση λιστών παρόχου» (τύποι/κατηγορίες) και ρύθμιση παραστατικών (δες `mydata-provider.md`, `fiscal-documents.md`).

---

## 5. Πίνακας Supabase Function Secrets (online πύλη)

Dashboard → Edge Functions → **Secrets** (ή `supabase secrets set`). Οι τιμές από τα §2–§3.

| Secret | Από | Σημείωση |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | — | Δίνονται **αυτόματα** από το project |
| `VIVA_ENV` | εσύ | demo / prod |
| `VIVA_SMART_CLIENT_ID` / `_SECRET` | Viva | Smart Checkout |
| `VIVA_MERCHANT_ID` / `VIVA_API_KEY` | Viva | order state |
| `VIVA_SOURCE_CODE` | Viva | πηγή online |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Entra | email (Graph) |
| `MAIL_FROM` | εσύ | π.χ. noreply@domain.gr |
| `LEAD_NOTIFY_EMAIL` | εσύ | παραλήπτης leads / replyTo |
| `PUBLIC_SITE_URL` | εσύ | π.χ. https://ticketmanager.gr/demo |
| `GOOGLE_WALLET_*` | Google Cloud | προαιρετικό (Wallet pass) |

---

## 6. Σειρά ενεργειών (checklist) + δοκιμές

1. **Τοπικό:** install service (deployment.md) → login admin → Ρυθμίσεις → Επιχείρηση.
2. **Πάροχος myDATA** (αν χρειάζεται): credentials → «Δοκιμή σύνδεσης» → δοκιμή έκδοσης ΑΠΥ.
3. **Viva ταμείου:** POS/Κάρτες → credentials → «Δοκιμή σύνδεσης» (token) → «Δοκιμή πληρωμής» 1,00€ (demo).
4. **Email τοπικό:** Online → Email → provider+κλειδιά → «Δοκιμαστικό email».
5. **Supabase:** project → deploy functions → secrets → webhook Viva.
6. **SPA:** `VITE_SUPABASE_URL`+`ANON_KEY` (Cloudflare) → redeploy.
7. **Online σύνδεση στο app:** Online → URL + service key + (connection string για backup) → «Ενεργό» → Αποθήκευση.
8. **Δοκιμή end-to-end:** δημοσίευσε demo θέαμα → online κράτηση → πληρωμή → webhook → e-ticket → «Συγχρονισμός τώρα» → εμφανίζεται η πώληση.

> Ασφάλεια: όλα τα secrets μένουν στον server/Supabase. Άλλαξε `admin/admin`. Πάρε backup (τοπικό + cloud) από μέρα 1.
