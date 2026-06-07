# Ticket Manager — Σχεδιασμός & Αρχιτεκτονική

> Lightweight εφαρμογή έκδοσης εισιτηρίων για μουσεία, θέατρα, κινηματογράφους & events.
> Τοπική λειτουργία (LAN) με POS-style έκδοση + online κράτηση/πληρωμή (Viva).
> Έκδοση εγγράφου: v0.1 — 2026-06-01

---

## 1. Τεχνολογικές αποφάσεις

| Τομέας | Επιλογή | Αιτιολογία |
|---|---|---|
| Γλώσσα | **Node.js (TypeScript)** | Ζητούμενο· ίδιο stack σε local & online. |
| Αρχιτεκτονική local | **Web app + τοπικός Node server** | Ένας Η/Υ = server/ταμείο· οι ταμίες ανοίγουν την εφαρμογή από browser στο LAN. Ένα σημείο δεδομένων, εύκολος συγχρονισμός με online. |
| Backend framework | **Fastify** | Ελαφρύ, γρήγορο, καλό για API + static serving. |
| Τοπική βάση | **SQLite** (better-sqlite3) | Zero-config, ένα αρχείο, ιδανικό για single-server LAN. Εύκολο backup "με ένα κουμπί". |
| Frontend | **React + Vite + TypeScript** | POS touch UI με κουμπιά/πλέγμα θέσεων. Σερβίρεται ως static από τον ίδιο Node server. |
| UI styling | **Tailwind CSS** | Γρήγορο, touch-friendly, μεγάλα κουμπιά. |
| Εκτύπωση | **ESC/POS (58/80mm) + Zebra ZPL** | Παραμετρικές φόρμες Header/Details/Footer που παράγουν είτε ESC/POS είτε ZPL. |
| Online βάση | **Supabase (PostgreSQL)** | Φάση 3· διαχειριζόμενο Postgres + Auth + REST/Realtime. |
| Πληρωμές online | **Viva (Smart Checkout)** | Φάση 3· webhook → ενημέρωση κρατήσεων. |
| Φορολογικά | **Όχι ΕΑΦΔΣΣ.** (α) Απόδειξη σε ταμειακή μέσω **ASCII text-file** σε οριζόμενο φάκελο· (β) **Πάροχος ηλεκτρονικής τιμολόγησης** (API αργότερα). | Απλό & επεκτάσιμο· ο agent της ταμειακής τραβάει το αρχείο, ή ο πάροχος εκδίδει ηλεκτρονική απόδειξη με στοιχεία πελάτη. |
| Κωδικοποίηση εισιτηρίου | **QR Code αποκλειστικά** | Όχι 1D barcode· εκτύπωση QR + βασικών στοιχείων (π.χ. θέση). |
| Auth/ρόλοι | JWT session, ρόλοι **manager / cashier** | Ο cashier βλέπει μόνο ημερήσιο ταμείο + επανεκτύπωση· ο manager όλα τα στατιστικά. |

### Τοπολογία (Local)
```
┌─────────────────────────────────────────────┐
│  Η/Υ-Server (το «ταμείο»)                     │
│  ┌─────────────┐   ┌──────────────────────┐  │
│  │ Node/Fastify│──▶│ SQLite (ticket.db)   │  │
│  │  API + UI   │   └──────────────────────┘  │
│  │             │──▶ Εκτυπωτής (USB/Network)   │
│  └──────┬──────┘──▶ Ταμειακή (Φάση 2)         │
└─────────┼───────────────────────────────────┘
          │  LAN (http://server-ip:PORT)
   ┌──────┴───────┬───────────────┐
   ▼              ▼               ▼
 Ταμείο 1      Ταμείο 2        Tablet (touch)
 (browser)     (browser)       (browser)
```

---

## 2. Μοντέλο δεδομένων (νέο σχήμα)

Κρατάμε το παραμετρικό πνεύμα του παλιού (τύποι εισιτηρίων, ταμείο, αίθουσες) αλλά το καθαρίζουμε.

### Παραμετρικά / Setup
- **venue** — στοιχεία επιχείρησης: επωνυμία, ΑΦΜ, ΔΟΥ, διεύθυνση, τηλ, email, logo, συντελεστής ΦΠΑ.
- **users** — username, password_hash, ρόλος (`manager`/`cashier`), enabled.
- **ticket_types** — *(αντικαθιστά το `typos_eisitiria`)*: `id, title, subtitle, price, default_qty, vat_rate, department, receipt_limit, default_payment (cash|card|bank|prompt), enabled, sort_order, color, icon`.
- **print_templates** — `id, name, printer_type (escpos58|escpos80|zpl), header, details, footer, params(JSON)` — πλήρως παραμετρικό.
- **printers** — `id, name, type, connection (usb|network|system), address`.
- **customers** — `id, full_name, address, postal_code, city, vat_number (ΑΦΜ), email, phone1, phone2, notes, marketing_opt_in, created_at`. Βασικά στοιχεία πελατών (κυρίως από online πωλήσεις) για marketing/ενημέρωση & για ηλεκτρονική απόδειξη μέσω παρόχου.
- **fiscal_config** — `mode (none|cash_register_file|e_invoicing)`, ρυθμίσεις: για `cash_register_file` → `export_folder`, μορφή ASCII εγγραφής· για `e_invoicing` → provider, API credentials (αργότερα).

### Αίθουσες & Διάταξη (Φάση 2)
- **halls** — `id, name, rows, cols` (διαστάσεις πλέγματος).
- **seats** — `id, hall_id, row_label, col_label, display_name (π.χ. A1), x, y, kind (seat|aisle|gap), enabled`. Η διάταξη ορίζεται οπτικά· διάδρομοι/κενά = `kind != seat`.

### Προγραμματισμός θεαμάτων (Φάση 2)
- **shows** — `id, hall_id, title, starts_at, ends_at, valid_from, valid_to`.
- **show_ticket_types** — σύνδεση `show_id ↔ ticket_type` με δικιά της τιμή (π.χ. Γενική 5€, Φοιτητικό 3€, Δωρεάν 0€). Επιτρέπει διαφορετική τιμολόγηση ανά θέαμα.
- *Copy setup*: αντιγραφή ενός show + ticket types σε νέες ημερομηνίες με ένα κουμπί.

### Πωλήσεις & Ταμείο
- **sales** — *(transaction header)*: `id, datetime, user_id, payment_method (cash|card|bank), total, vat_total, receipt_no, fiscal_status, source (local|online)`.
- **sale_items** — `id, sale_id, ticket_type_id, show_id?, seat_id?, qty, unit_price, line_total`.
- **tickets** — *(εκδοθέν εισιτήριο)*: `id, sale_item_id, serial, qr_payload, show_id?, seat_id?, printed_at, reprinted_count`. QR περιέχει serial/κωδικό για check-in· εκτυπώνονται βασικά στοιχεία (τίτλος, θέση, ημ/ώρα).
- **till_movements** — *(αντικαθιστά το `tameio`)*: ταμειακές κινήσεις (πίστωση/χρέωση), αιτιολογία, για ημερήσιο/περιόδου ταμείο.

### Online (Φάση 3 — Supabase)
- **online_bookings** — κράτηση από website: show, seats, `customer_id`, ποσό, `payment_status`, `viva_order_code`. Τα στοιχεία πελάτη (ονοματεπώνυμο, email, τηλ· προαιρετικά ΑΦΜ/φορολογικά) είναι **υποχρεωτικά** στο online checkout για την ηλεκτρονική απόδειξη.
- **sync_log** — εγγραφές συγχρονισμού local ↔ online (timestamp, direction, counts).

---

## 3. Λειτουργικές ενότητες (modules)

1. **Auth & Ρόλοι** — login, manager/cashier, route guards.
2. **Settings/Admin** *(manager)* — venue, ticket types, εκτυπωτές, print templates, χρήστες, backup με ένα κουμπί.
3. **POS — Σειριακή έκδοση (Φάση 1)** — πλέγμα κουμπιών-εισιτηρίων (τίτλος/υπότιτλος/τιμή/icon), αριθμητικό πληκτρολόγιο ποσότητας, επιλογή Μετρητά/Κάρτα/Τράπεζα, κουμπί έκδοσης, κουμπί ΤΑΜΕΙΑΚΗ (απόδειξη), preview εισιτηρίου.
4. **Εκτύπωση** — render φόρμας → ESC/POS ή ZPL με **QR Code** + βασικά στοιχεία· επανεκτύπωση από ημερήσια λίστα.
4β. **Απόδειξη ταμειακής** — γράψιμο απλής **ASCII εγγραφής σε text-file** σε οριζόμενο φάκελο· ο agent της ταμειακής την τραβάει και εκδίδει απόδειξη.
4γ. **Πελάτες & Ηλεκτρονική τιμολόγηση** — διαχείριση πελατών (στοιχεία/marketing)· αποστολή ηλεκτρονικής απόδειξης μέσω παρόχου (API αργότερα), κυρίως για online πωλήσεις.
5. **Ταμείο** — ημερήσια σύνολα (μετρητά/κάρτα/τράπεζα), έλεγχος ταμείου από–έως, εκτύπωση αναφοράς. Cashier: μόνο δικό του ημερήσιο.
6. **Στατιστικά** *(manager)* — πλήθος & τζίρος ανά τύπο/περίοδο.
7. **Σχεδιαστής αιθουσών (Φάση 2)** — οπτικός ορισμός γραμμών/στηλών/διαδρόμων & αρίθμησης.
8. **Ημερολόγιο θεαμάτων (Φάση 2)** — προγραμματισμός shows ανά αίθουσα/ώρα + ticket types, αντιγραφή setup.
9. **POS με επιλογή θέσεων (Φάση 2)** — επιλογή ημερομηνίας → διαθέσιμα θεάματα → χάρτης θέσεων → επιλογή (μονές/συνεχόμενες) → έκδοση.
10. **Online & Sync (Φάση 3)** — push setup σε Supabase, website κράτησης, Viva πληρωμή, χειροκίνητος συγχρονισμός με κουμπί, κλείσιμο online πωλήσεων X ώρες πριν το θέαμα.

---

## 4. Οδικός χάρτης ανά φάση

### Φάση 1 — Σειριακή έκδοση (Τοπικά) ✦ MVP
- [ ] Scaffold: monorepo (server Fastify + client React/Vite + SQLite migrations).
- [ ] Σχήμα DB & seed (venue, users, ticket_types).
- [ ] Auth + ρόλοι.
- [ ] Settings: διαχείριση ticket types + venue + εκτυπωτές.
- [ ] POS οθόνη έκδοσης (κουμπιά, ποσότητα, τρόπος πληρωμής).
- [ ] Παραμετρική φόρμα εκτύπωσης (Header/Details/Footer) → ESC/POS 58/80mm + ZPL, με **QR Code**.
- [ ] Καταχώρηση πώλησης + έκδοση/εκτύπωση εισιτηρίου.
- [ ] Εξαγωγή απόδειξης σε **ASCII text-file** σε οριζόμενο φάκελο (για agent ταμειακής).
- [ ] Πίνακας & φόρμα **πελατών** (στοιχεία marketing).
- [ ] Ταμείο ημερήσιο + από–έως + επανεκτύπωση.
- [ ] Στατιστικά (manager).
- [ ] Backup με ένα κουμπί.

### Φάση 2 — Αίθουσες & θέσεις
- [ ] Σχεδιαστής αιθουσών (γραμμές/στήλες/διάδρομοι/αρίθμηση).
- [ ] Ημερολόγιο θεαμάτων + ticket types ανά θέαμα + αντιγραφή setup.
- [ ] POS με χάρτη θέσεων (μονές/συνεχόμενες) → έκδοση.
- [ ] (Προαιρετικά) διασύνδεση ταμειακής/φορολογικού μηχανισμού.

### Φάση 3 — Online κράτηση & πληρωμές
- [ ] Supabase schema + push setup θεαμάτων/θέσεων.
- [ ] Website κράτησης (κινητό/desktop) με χάρτη θέσεων.
- [ ] Υποχρεωτική συλλογή στοιχείων πελάτη στο checkout → ηλεκτρονική απόδειξη μέσω παρόχου.
- [ ] Viva Smart Checkout + webhook → ενημέρωση κρατήσεων + email.
- [ ] Χειροκίνητος συγχρονισμός (κουμπί) local ↔ online.
- [ ] Κανόνας κλεισίματος online X ώρες πριν το θέαμα.

---

## 5. Αποφάσεις (κλειδωμένες)
- **Φορολογικά**: ΟΧΙ ΕΑΦΔΣΣ. Δύο τρόποι απόδειξης: (α) ASCII text-file σε φάκελο για agent ταμειακής· (β) πάροχος ηλεκτρονικής τιμολόγησης (API αργότερα).
- **Κωδικοποίηση**: QR Code αποκλειστικά + εκτύπωση βασικών στοιχείων (π.χ. θέση).
- **Πελάτες**: πίνακας με Ονοματεπώνυμο, Διεύθυνση, ΤΚ, Πόλη, ΑΦΜ, email, Τηλ1, Τηλ2 — για marketing & ηλεκτρονική απόδειξη.

## 6. Ανοιχτά σημεία (εκκρεμούν στοιχεία από πελάτη)
1. **Μορφή ASCII εγγραφής** ταμειακής + φάκελος προορισμού (θα δοθεί αργότερα).
2. **Πάροχος ηλεκτρονικής τιμολόγησης** + API (θα δοθεί αργότερα).
3. **Πολλαπλά ταμεία**: ένα ή περισσότερα ταυτόχρονα σημεία έκδοσης στο LAN;
4. **Περιεχόμενο QR**: μόνο serial ή URL check-in (π.χ. για online validation);
