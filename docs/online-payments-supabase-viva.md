# Οδηγός: Online πωλήσεις — Supabase + Viva Smart Checkout

Γενικός οδηγός για online κρατήσεις/πωλήσεις με **Supabase** (Postgres + Edge Functions)
ως cloud backend και **Viva Smart Checkout** ως πάροχο πληρωμών, με συγχρονισμό προς το
τοπικό σύστημα. Αναφορά: `online/supabase/functions/`, `online/web/` (SPA),
`server/src/online/` (sync/scheduler).

---

## 1. Αρχιτεκτονική

- **Cloud (Supabase):** Postgres (shows, ticket_types, seats, orders, order_items, tickets, seat_holds), Edge Functions (Deno), RLS policies. Ο client (SPA) μιλά με anon key· τα Edge Functions με **service role**.
- **SPA (Vite/React):** δημόσια σελίδα κρατήσεων, σερβίρεται στατικά (π.χ. σε subpath `/demo/` με `base:'/demo/'`).
- **Τοπικός server:** «κατεβάζει» πληρωμένες παραγγελίες → τοπικές πωλήσεις, ανεβάζει διαθεσιμότητα θέσεων, εκδίδει παραστατικά.

## 2. Ροή κράτησης (happy path)

1. `create-order`: validate show/θέσεις/τιμές → **seat_holds** (TTL, π.χ. 10') → `orders(status='pending')` → Viva order → επιστρέφει `checkoutUrl` + `statusToken (=hold_token)`.
2. SPA → redirect στο Viva checkout. Κρατά `pending` σε localStorage για polling.
3. Πληρωμή → **viva-webhook** (StateId=3 = paid): οριστικοποιεί θέσεις (sold), εκδίδει e-ticket, στέλνει email.
4. SPA polling (`order-status`) δείχνει «paid» + εισιτήρια.

**Κρίσιμα όρια:** seat hold TTL και Viva `paymentTimeout` πρέπει να είναι κοντά (π.χ. 10'). Μετά: θέσεις ελεύθερες + Viva link νεκρό.

## 3. Πληρωμή απέτυχε / εγκαταλείφθηκε → abandoned-cart recovery

Pending παραγγελίες (ξεκίνησαν αλλά δεν πληρώθηκαν) είναι ευκαιρία ανάκτησης:

- **Μήνυμα πριν την πληρωμή** (πάνω από τους όρους, τονισμένο): «Αν αποτύχει η πληρωμή, δεν χρειάζεται επανάληψη — θα λάβετε email με σύνδεσμο ολοκλήρωσης».
- **`resume-order` function:** `{orderId, token}` → ξαναελέγχει διαθεσιμότητα, ξανακρατά θέσεις, φτιάχνει **νέο** Viva order, επιστρέφει νέο `checkoutUrl`. Διαχειρίζεται `alreadyPaid` και `seatsGone`.
- **Email link** = `…/?resume=<orderId>&token=<hold_token>` → η SPA το ανοίγει, καλεί `resume-order`, redirect σε νέο checkout.
- **Χρονισμός:** υπενθύμιση #1 ~30' μετά, #2 ~24h μετά (μία ανά στάδιο, με flags `reminder1_sent_at` / `reminder2_sent_at`).
- **Πού τρέχει:** είτε από τον τοπικό scheduler (απλό, αλλά μόνο όσο είναι ανοιχτό το PC) είτε από Supabase scheduled function (24/7).

**Γιατί link-επιστροφής αντί για raw Viva link:** το παλιό Viva link λήγει σε λίγα λεπτά και οι θέσεις ελευθερώνονται· ο σύνδεσμος επιστροφής ξαναελέγχει διαθεσιμότητα τη στιγμή του κλικ.

## 4. Δημοσίευση & προστασία από διπλή δημοσίευση

- Upsert cloud show με κλειδί `(local_id, show_date)` → επαναδημοσίευση **ίδιου** show = idempotent.
- **Παγίδα:** νέα/διαφορετική τοπική εγγραφή ίδιου slot (ίδια ημέρα+ώρα+αίθουσα) → διπλή αγγελία. Βάλε φύλακα που μπλοκάρει διαφορετικό `show_id` στο ίδιο slot.

## 5. Συγχρονισμός (sync)

- Ανεβάζει θέσεις πουλημένες από ταμείο (sold/box_office), ελευθερώνει ακυρωμένες, κατεβάζει online-πουλημένες, **εισάγει πληρωμένες παραγγελίες** (idempotent: skip αν υπάρχει ήδη το serial).
- **Ορατότητα:** μη μένεις στο «κατέβηκε 1 πώληση» — επέστρεψε **ανά πώληση** λεπτομέρειες (τίτλος, ημ/νία, πελάτης, τεμάχια, σύνολο) και δείξ' τες, για έλεγχο.
- Auto-sync server-side ανά X' (χωρίς login)· κράτα/εμφάνισε «τελευταίος συγχρονισμός + αποτέλεσμα».

## 6. Deploy Edge Functions

- Ζουν στο repo → deployable (CLI `supabase functions deploy <name>` ή MCP).
- Δημόσια functions (create-order/resume-order/webhook) → `verify_jwt:false` + δικός τους έλεγχος (capability token / webhook key).
- Shared κώδικας (`_shared/viva.ts`) μπαίνει ως relative dependency στο deploy.

## 7. Viva — σημεία προσοχής

- Smart Checkout: OAuth client_credentials → `POST /checkout/v2/orders` → `orderCode` → `https://[demo.]vivapayments.com/web/checkout?ref=<orderCode>`.
- Webhook: GET επιστρέφει verification key· POST επαληθεύει `StateId=3`. Το legacy lookup αργεί μετά την πληρωμή → **retry** σε 404.
- Success/Failure URLs να δείχνουν σε σελίδες που υπάρχουν (SPA query params, όχι 404).

## Παγίδες

- Success URL σε route χωρίς SPA fallback → λευκή/404 σελίδα μετά την πληρωμή.
- `_redirects` με 200-rewrite που κάνει loop → απέτυχε το deploy.
- Seat map σε mobile: flex `align-items:center` + overflow κόβει αριστερές στήλες → χρησιμοποίησε inner `width:max-content; margin:0 auto`.
- Λογότυπα σε flex footer που «εξαφανίζονται» σε mobile → `flex:0 0 auto` + στοίβαξη σε στενή οθόνη.
