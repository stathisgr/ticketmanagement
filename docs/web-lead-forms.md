# Οδηγός: Φόρμες επικοινωνίας / Leads (στατικό site → Supabase)

Γενικός οδηγός για φόρμα leads σε στατικό site, που στέλνει σε **Supabase Edge Function**,
αποθηκεύει σε πίνακα και ειδοποιεί με email — χωρίς backend server. Αναφορά:
`ticketmanager.gr/site/assets/js/site.js`, `online/supabase/functions/lead/`.

---

## 1. Ροή

1. Ο χρήστης συμπληρώνει τη φόρμα.
2. JS (`site.js`) κάνει `POST` στο `SUPABASE_URL/functions/v1/lead` με το anon key.
3. Η function: anti-spam → `insert` σε `leads` (service role) → (προαιρετικά) email ειδοποίηση.
4. Επιτυχία → ο JS **αντικαθιστά τη φόρμα** με panel «Ευχαριστούμε» (από `data-ok` / `data-okmsg`).

## 2. Anti-spam (honeypot) — ΚΡΙΣΙΜΗ παγίδα

Κρυφό πεδίο που οι bots συμπληρώνουν· αν έχει τιμή → αγνόησε σιωπηλά.

**ΜΗΝ** ονομάζεις το honeypot `website`, `email2`, `name` κ.λπ. — οι **browsers το
autofill-άρουν** → η function νομίζει spam → η φόρμα «δεν αποθηκεύει» (ιδίως σε μία γλώσσα/σελίδα).
Χρησιμοποίησε ουδέτερο όνομα, π.χ. `hp_token`:

```html
<div style="position:absolute;left:-9999px" aria-hidden="true">
  <label>Μην συμπληρώνετε<input name="hp_token" tabindex="-1" autocomplete="off" /></label>
</div>
```

```ts
if (clean(body.hp_token)) return json({ ok: true }); // σιωπηλά «ΟΚ», δεν αποθηκεύει
```

## 3. Thank-you panel (UX)

Μην αφήνεις τη φόρμα να κάνει **native submit** (θα φύγει/ξαναφορτώσει η σελίδα). Στο
`submit`: `preventDefault()`, fetch, και σε επιτυχία αντικατάστησε το innerHTML της φόρμας
με μήνυμα επιβεβαίωσης. Πρόσεξε ότι **πρέπει** να φορτώνεται το `site.js` (δες παρακάτω).

## 4. Edge Function `lead` (περίληψη)

- `verify_jwt:false`, CORS, δέχεται anon.
- Καθαρισμός/validation πεδίων· honeypot check.
- `insert` με **service role** (όχι anon) ώστε να γράφει ανεξάρτητα από RLS.
- Email ειδοποίηση σε `sales@…` (δες [email-resend-graph.md](./email-resend-graph.md)) — fail-soft.
- GDPR σημείωση κάτω από το κουμπί, με **link** στην πολιτική προστασίας δεδομένων.

## Παγίδες (που φάγαμε)

- Honeypot με όνομα `website` → browser autofill → «η φόρμα δεν αποθηκεύει» μόνο σε κάποιες σελίδες. Μετονομασία σε `hp_token`.
- **Truncated σελίδα** (από bulk write) χωρίς το `<script src="/assets/js/site.js">` → η φόρμα έκανε native submit → λευκή σελίδα, χωρίς «Ευχαριστούμε». Έλεγχος: κάθε σελίδα με φόρμα να φορτώνει το `site.js` και να κλείνει σωστά (`</body></html>`).
- Email ως μοναδική ένδειξη επιτυχίας → αν δεν φτάσει, ο χρήστης νομίζει ότι απέτυχε. Αποθήκευσε **πάντα** το lead στη βάση ανεξάρτητα από το email.
