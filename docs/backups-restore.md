# Οδηγός: Αντίγραφα ασφαλείας & Ανάκτηση (Backups & Restore)

Γενικός οδηγός για backup μιας εφαρμογής με **τοπική βάση** (SQLite) + **cloud βάση**
(Supabase/Postgres). Αναφορά: `server/src/routes/backup.ts`, `server/src/online/sync.ts`.

---

## 1. Τι θέλουμε να σώζουμε

| Επίπεδο | Πηγή | Τρόπος |
|---|---|---|
| Τοπική βάση | SQLite | `VACUUM INTO` → καθαρό single-file `.db` (ασφαλές ακόμη & με WAL) |
| Cloud δεδομένα | Supabase (PostgREST) | JSON ανά πίνακα (service key, σελιδοποίηση) |
| Cloud πλήρες | Supabase (Postgres) | `pg_dump` → SQL (schema + data + functions + policies) |
| Edge Functions | repo | version control → re-deploy |
| Secrets/webhooks | — | καταχωρούνται ξανά χειροκίνητα |

## 2. Τοπικό backup (SQLite)

```sql
VACUUM INTO 'backups/app-YYYYMMDD-HHMMSS.db';
```
Κουμπί στις Ρυθμίσεις → γράφει στον φάκελο `backups/` + κατεβάζει το αρχείο. Λίστα/λήψη/διαγραφή με προστασία path-traversal (`basename`, έλεγχος κατάληξης).

## 3. Cloud — αντίγραφο **δεδομένων** (JSON)

Με το service key + PostgREST, τράβα όλους τους πίνακες (σελιδοποίηση 1000/αίτημα) και
γράψε `cloud-<stamp>.json` στον ίδιο φάκελο. Ελαφρύ, δουλεύει **πάντα**, χωρίς extra εργαλεία.

```
GET {url}/rest/v1/{table}?select=*&limit=1000&offset=N   (loop μέχρι <1000)
```

Περιέχει **μόνο γραμμές** — όχι schema/functions/policies.

## 4. Cloud — **πλήρες** backup (pg_dump)

Για restore-σε-νέο-project χρειάζεται schema+functions+policies+data:

```
pg_dump --dbname "postgresql://USER:PASS@HOST:5432/postgres" \
        --no-owner --no-privileges -f cloud-full-<stamp>.sql
```

- Connection string: Supabase → **Connect** (πάνω) ή Project Settings → Database → Connection string. Διάλεξε **Session pooler** ή **Direct** (όχι Transaction pooler/6543).
- Password: αντικαθιστά το `[YOUR-PASSWORD]` (χωρίς αγκύλες· URL-encode ειδικούς χαρακτήρες ή κάνε reset σε alphanumeric).
- Προαπαιτούμενο: εγκατεστημένο **pg_dump** (PostgreSQL client tools, έκδοση ≥ της βάσης). Αν λείπει → fail-soft, κράτα το JSON.
- Καλό μοτίβο: το ίδιο κουμπί backup παράγει **και τα τρία** (τοπικό .db, cloud .json, cloud-full .sql), και η αποτυχία ενός δεν ακυρώνει τα άλλα.

## 5. Restore

**Ίδιο project (επαναφορά):**
```
psql "postgresql://USER:PASS@HOST:5432/postgres" -f cloud-full-<stamp>.sql
```
(σε καθαρή/άδεια βάση· αλλιώς drop πρώτα τα αντικείμενα.)

**Νέο/άλλο project:**
1. `psql "<new-conn>" -f cloud-full-*.sql` (schema+functions+policies+data)
2. Deploy Edge Functions από το repo
3. Ρύθμισε secrets (πάροχος πληρωμών, email, κ.λπ.) + webhooks
4. Ενημέρωσε το τοπικό app: νέο URL + service key + connection string

**Μόνο δεδομένα (από JSON):** insert με σωστή σειρά εξαρτήσεων (parents → children) + reset sequences (`setval`). Χρήσιμο για ανάκτηση γραμμών στο ίδιο schema.

## 6. Όρια δωρεάν πλάνου (Supabase) — γιατί χρειάζεσαι το δικό σου backup

- Free tier: **χωρίς** αυτόματα backups· **pause** μετά από ~1 εβδομάδα αδράνειας· 500 MB βάση.
- Daily backups (7 ημ.) / PITR → μόνο από Pro ($25/μήνα) ή ως add-on.
- Συμπέρασμα: στο δωρεάν, το **τοπικό+cloud backup είναι το δίχτυ σου**. Ο auto-sync κρατά και τη βάση «ξύπνια».

## Παγίδες

- Transaction pooler (6543) δεν κάνει για `pg_dump` → χρησιμοποίησε Session/Direct (5432).
- Ειδικοί χαρακτήρες σε password μέσα σε URI → URL-encoding ή reset.
- Το JSON-only δεν στήνει νέο project (λείπει schema/functions). Κράτα **και** pg_dump για disaster recovery.
- Μην βάζεις secrets/connection strings στο git ή στον browser — μόνο τοπικά.
