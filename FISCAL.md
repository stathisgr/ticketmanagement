# Φορολογικά & Νομικά — Οδηγός υλοποίησης (Ελλάδα)

> Αναφορά για τον σχεδιασμό του Ticket Manager. Δεν αποτελεί φορολογική συμβουλή — επιβεβαίωση με λογιστή ανά ΑΦΜ/δραστηριότητα.

## 1. Το εισιτήριο ως φορολογικό στοιχείο
Το εισιτήριο θεάματος θεωρείται **στοιχείο λιανικής παροχής υπηρεσιών** (απόδειξη για δικαίωμα εισόδου). Εκδίδεται **κατά την πώληση/προπώληση** (απόκτηση δικαιώματος), όχι κατά την είσοδο (ΠΟΛ.1003/2014). Άρα: online προπώληση σήμερα για παράσταση σε 10 μέρες → φορολογικό στοιχείο **σήμερα**.

## 2. Κανόνας «ένα φορολογικό γεγονός = ένα παραστατικό»
Δύο καθαρές αρχιτεκτονικές — **ποτέ και τα δύο ως έσοδο**:

| Επιλογή | Φορολογικό στοιχείο | Το εισιτήριο | myDATA |
|---|---|---|---|
| **Α — Ταμειακή/ΦΗΜ** | Απόδειξη από ΦΗΜ | Λειτουργικό voucher εισόδου (QR), **με ένδειξη «Δεν αποτελεί φορολογικό παραστατικό»** | διαβιβάζει ο ΦΗΜ |
| **Β — Εισιτήριο = παραστατικό** | Το ίδιο το εισιτήριο | Φορολογικό (ΑΦΜ, αξία, ΦΠΑ, αρίθμηση, QR) | μέσω παρόχου e-invoicing / ERP |

➡️ Στην εφαρμογή αυτό ελέγχεται από **Ρυθμίσεις → Εκτυπωτές → Τρόπος απόδειξης** (`fiscal_config.mode`):
- `cash_register_file` (Επιλογή Α): το εισιτήριο τυπώνει αυτόματα **«Δεν αποτελεί φορολογικό παραστατικό»** (placeholder `{{legalNote}}`). Παράλληλα γράφεται ASCII αρχείο για τον agent της ταμειακής.
- `e_invoicing` (Επιλογή Β): το εισιτήριο είναι το παραστατικό· χωρίς την ένδειξη· διαβίβαση μέσω παρόχου.
- `none`: χωρίς φορολογική διαχείριση (δοκιμές/εσωτερική χρήση).

## 3. ΦΠΑ ανά είδος
| Είδος | ΦΠΑ |
|---|---|
| Θέατρο | **6%** |
| Συναυλία | **6%** |
| Κινηματογράφος | **6%** |
| Μουσείο δημόσιο / πολιτιστικός φορέας | **Απαλλαγή** (άρθρο 22) — vat_rate 0 |
| Ιδιωτικό/εμπορικό μουσείο | Εξαρτάται (έλεγχος με λογιστή) |
| Δωρεάν είσοδος | Χωρίς έσοδο (vat 0, τιμή 0) |

➡️ Ο ΦΠΑ ορίζεται **ανά τύπο εισιτηρίου** (`ticket_types.vat_rate`) ώστε να καλύπτονται μικτές περιπτώσεις. Για απαλλαγή άρθρου 22 → 0% (η φόρμα μπορεί να τυπώνει ένδειξη απαλλαγής).

## 4. Απαιτούμενα στοιχεία στο (φορολογικό) εισιτήριο
Εκδότης/επιχείρηση, ΑΦΜ, ημερομηνία έκδοσης (και εκδήλωσης όπου απαιτείται), είδος/τίτλος, αξία, ΦΠΑ ή ένδειξη απαλλαγής, **μοναδική αρίθμηση**, **QR** (ιδίως σε ηλεκτρονική έκδοση). Όλα υποστηρίζονται από τον παραμετρικό σχεδιαστή φόρμας + την αρίθμηση (ενιαία ή ανά τύπο).

## 5. Online προπώληση (Φάση 3)
Φορολογικό στοιχείο **κατά την online πώληση** (όχι στην είσοδο). Η έκδοση μπορεί να ανατεθεί σε πιστοποιημένη πλατφόρμα ticketing (ν.4093/2012) με σωστή ανάθεση & διαβίβαση myDATA· αλλιώς το voucher χρειάζεται φορολογικό στοιχείο στο ταμείο.

## 6. myDATA / ΦΗΜ / POS (Φάση φορολογικής διασύνδεσης)
- Έσοδα εισιτηρίων → **myDATA** (μέσω ΦΗΜ, ή ERP+πάροχος, ή πιστοποιημένης πλατφόρμας).
- **POS καρτών**: υποχρέωση διασύνδεσης EFT/POS–ταμειακού/ΑΑΔΕ· κάθε πληρωμή κάρτας πρέπει να συνδέεται με παραστατικό/εισιτήριο.
- Η εφαρμογή ήδη συσχετίζει την πώληση με αριθμό εισιτηρίου· η σύνδεση `receipt_no` ↔ αρ. απόδειξης ΦΗΜ προβλέπεται.

## 7. Πάροχος e-invoicing: RapidSign / MyMat
- **Docs:** https://api.mymat.com.gr · **Dev:** https://dev.rapidsign.com.gr · **Prod:** https://app.rapidsign.com.gr
- Adapter (σκελετός): `server/src/fiscal/rapidsign.ts` — interface `issueRetailReceipt(sale) → {mark, uid, authCode, qrUrl}`.
- **Ροή (mode = e_invoicing):** πώληση → POST στον πάροχο (στοιχείο λιανικής 11.x, γραμμές με net/ΦΠΑ, τρόπος πληρωμής, στοιχεία πελάτη όπου χρειάζεται) → ο πάροχος διαβιβάζει myDATA → επιστρέφει **MARK/UID/QR** → αποθηκεύονται στη `sales` και τυπώνονται στο εισιτήριο (το εισιτήριο γίνεται το φορολογικό στοιχείο → ΧΩΡΙΣ την ένδειξη «δεν αποτελεί φορολογικό παραστατικό»).
### Πραγματικά endpoints (από το PDF «Υπηρεσία Παρόχου RBS» — Postman collection)
Base path: `/api/v1.0/provider/...`
- `POST Authorize` body `{username,password,activationCode}` → parentToken.
- `POST RefreshToken` header `ParentToken: <parentToken>` → **Bearer token** (για όλα τα υπόλοιπα).
- `GET InvoiceTypes` / `InvoiceTypesAade` → IDs τύπων. **11.1**=Απόδειξη Λιανικής Πώλησης, **11.2**=ΑΠΥ παροχής υπηρεσιών (← εισιτήρια), 11.4=Πιστωτικό Λιανικής.
- Lookups: `VatCategories` (id 6% ), `PaymentMethods` (cash/card id), `Currencies` (EUR=47), `Countries` (GR=87), `IncomeCategories`/`IncomeValues`, `Acquirers` (POS).
- `POST PostInvoice` body: `{Guid, Template:3, FileType, ShowCounterpart, InvoiceHeader{InvoiceTypeId,IncludesVat,Series,Aa,IssueDate,CurrencyId}, Issuer{VatNumber,CountryId,Branch,Name,...,Address}, InvoiceDetails[]{Line,Name,Qty,ItemPrc,TotPrcAfterDisc,NetValue,VatAmount,VatCatId,VatExcCatId?,IncomeCatId?,IncomeValId?}, PaymentMethods[]{PayGuid,PaymentId,Amount}}`.
- Απόκριση: `jsonData.fromDB.aadeBookInvoiceType { uid, mark, authenticationCode }` (+ `fromDB.mark3RD`). Όλες οι αποκρίσεις σε φάκελο `{extCode,statusDescription,message,token,jsonData}`.
- QR/εικόνα: `GetBitmap` (ανά ΑΦΜ εκδότη + bitmap Guid). `GetInvoice`/`GetXml` για ανάκτηση παραστατικού.

### Υλοποίηση στην εφαρμογή
- Adapter: `server/src/fiscal/rapidsign.ts` (authenticate → lookups → postInvoice). Test: `POST /api/fiscal/provider/test` (Ρυθμίσεις→Εκτυπωτές→e_invoicing→«Δοκιμή σύνδεσης»). Credentials στο `fiscal_config.config` (JSON: env/username/password/activationCode/issuerVat/series).
- **ΕΚΚΡΕΜΕΙ πριν τη ζωντανή έκδοση:** (1) επιβεβαίωση creds με τη Δοκιμή, (2) ανάγνωση των lookup IDs (InvoiceTypeId για 11.2, VatCatId 6%/24%/απαλλαγή, PaymentId cash/card, IncomeCatId/ValId) → αποθήκευση ως mappings, (3) wiring του `postInvoice()` στο sales flow (mode=e_invoicing) + αποθήκευση mark/uid/qr στη `sales` + εκτύπωση QR/MARK στο εισιτήριο, (4) ακύρωση/πιστωτικό 11.4.
- DB TODO: στήλες sales `mark`, `provider_uid`, `qr_url` (fiscal_status υπάρχει).

## 8. Εκκρεμότητες για επόμενες φάσεις
- Ακυρώσεις / επιστροφές / αλλαγή ημερομηνίας (πιστωτικά).
- Διαβίβαση myDATA (πάροχος e-invoicing — API θα δοθεί).
- Διασύνδεση POS καρτών με ΦΗΜ.
- Ένδειξη απαλλαγής ΦΠΑ (άρθρο 22) στη φόρμα για μουσεία.
- Reports ανά εκδήλωση/ημέρα/ταμείο/τρόπο πληρωμής (✓ υπάρχει) + ΦΠΑ ανά συντελεστή.
