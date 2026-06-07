# Οδηγός: Θερμικοί εκτυπωτές & Εκτύπωση

Γενικός οδηγός για εκτύπωση αποδείξεων/εισιτηρίων/ετικετών από εφαρμογή POS/booking.
Αναφορά: `server/src/print/` (`dispatch.ts`, `escpos.ts`, `zpl.ts`, `template.ts`,
`markup.ts`, `index.ts`), client `printTicket.ts`.

---

## 1. Τύποι εκτυπωτών & σύνδεσης

| Τύπος | Χρήση | Σύνδεση |
|---|---|---|
| `escpos58` / `escpos80` | Θερμικές αποδείξεις 58/80mm | network (IP:9100) ή USB/system |
| `zpl` | Ετικέτες (label printers) | network ή system |

- **Δικτυακός (IP:9100):** ο server στέλνει raw bytes με TCP socket — άμεσο, χωρίς διάλογο.
- **USB / system:** δεν στέλνει ο server· πέφτει σε **browser print** (μέσω OS driver).

## 2. Αρχιτεκτονική εκτύπωσης (μοτίβο)

1. **Render** → παράγει ταυτόχρονα: (α) `preview` (κείμενο για οθόνη/browser) και (β) `payload` (ESC/POS bytes ή ZPL).
2. **Dispatch** → αν δικτυακός: στείλε payload (TCP). Αλλιώς επέστρεψε `printTicket:true` στον client.
3. **Browser fallback** → ο client ανοίγει αόρατο iframe με HTML και καλεί `print()`.

ESC/POS builder: init → codepage → γραμμές (alignment/size/bold) → QR → cut → drawer kick.
Αντίγραφα/κοπή/συρτάρι μπαίνουν στο τελικό payload (`buildEscposJob`).

## 3. Παραμετρικές φόρμες (templates + markup)

Header/Details/Footer με placeholders `{{field}}` και **inline tags** στην αρχή γραμμής:

```
[s1..s4] μέγεθος · [c]/[l]/[r] στοίχιση · [b] έντονα
[qr]     QR εισιτηρίου (check-in)    → payload = serial/qrPayload
[qrmark] QR myDATA (ΑΑΔΕ)            → payload = το AADE QR URL
```

Στο preview τα QR γίνονται markers `[QR]` / `[QR ΜΑΡΚ]` (δεν μπαίνει εικόνα στο κείμενο).

## 4. QR στο browser fallback — ΚΡΙΣΙΜΟ

Στους θερμικούς το QR το ζωγραφίζει **ο εκτυπωτής** (ESC/POS command). Στο **browser**
το κείμενο `[QR]` δεν είναι σκαναρίσιμο. Λύση:

1. Ο server παράγει το QR ως **data-URI εικόνα** (lib `qrcode`) — **όχι** μέσα στο preview (θα φαινόταν τεράστιο base64 στην οθόνη), αλλά ως ξεχωριστά πεδία `qrImg` / `qrMarkImg`.
2. Ο client, στο print HTML, αντικαθιστά τις γραμμές-markers `[QR]`/`[QR ΜΑΡΚ]` με `<img src=dataURI>`.
3. Το preview στην οθόνη μένει καθαρό κείμενο.

Η θέση/συνθήκη του QR στο preview πρέπει να **καθρεφτίζει** ακριβώς τον θερμικό
(π.χ. «default QR αν δεν τοποθετήθηκε ρητό [qr] και υπάρχει serial»).

## 5. Browser print (πρακτικά)

- Αόρατο `<iframe>` → `doc.write(html)` → `focus()` → `print()`.
- `@page { size: 80mm auto; margin: 2mm }`, font monospace, `white-space: pre-wrap`.
- QR: `<img>` ~36mm, `image-rendering: pixelated`.
- Για POS χωρίς διάλογο: Chrome **Kiosk printing**.

## 6. Επανεκτύπωση & αποδείξεις λιανικής

- Επανεκτύπωση: ξαναφτιάχνει το preview από τα αποθηκευμένα στοιχεία (ΜΑΡΚ/σειρά/ΑΑ/QR στο εισιτήριο).
- Λιανική προϊόντων → **μία** ενοποιημένη απόδειξη (όλα τα είδη + ανάλυση ΦΠΑ ανά συντελεστή), όχι ξεχωριστά «εισιτήρια».

## Παγίδες

- **Το QR έλειπε στο browser** γιατί το preview είχε literal `[QR]`. Λύση: data-URI εικόνα από server + αντικατάσταση στο print HTML.
- Μεγάλο base64 μέσα στο preview = άσχημο στην οθόνη. Κράτα την εικόνα **εκτός** preview.
- USB/θερμικοί χωρίς δικτυακή IP → πάντα browser fallback· βεβαιώσου ότι ο browser έχει σωστό @page.
- ZPL ≠ ESC/POS — οι ετικέτες θέλουν δικό τους renderer.
