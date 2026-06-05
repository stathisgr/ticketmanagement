/**
 * Σύνδεση έκδοσης παραστατικών παρόχου (myDATA) με τη ροή πώλησης/ακύρωσης.
 * Όταν fiscal_config.issue_mode='provider': κάθε πώληση εκδίδει ΑΠΥ, κάθε ακύρωση εκδίδει Πιστωτικό.
 * Τα στοιχεία (ΜΑΡΚ/UID/QR/auth) αποθηκεύονται στον πίνακα fiscal_documents.
 */
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { RapidSignProvider, vatCatIdFromRate, type FiscalEnv, type IssueParty } from './rapidsign.js';
import { loadDocList, pickSaleDoc, pickCreditDoc } from './docs.js';

export interface FiscalOutcome { ok: boolean; mark?: string; qrUrl?: string; providerUrl?: string; isNew?: boolean; series?: string; aa?: string; docType?: string; error?: string; }

const _dmy = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : (d ?? ''));
/** Περιγραφή γραμμής παραστατικού: «ΕΙΔΟΣ - ΘΕΑΜΑ - ΩΡΑ - ΘΕΣΗ». Χρησιμοποιείται σε ΑΠΥ & Πιστωτικό. */
export function lineDescription(it: any): string {
  const ttype = (it.title || 'Εισιτήριο').trim();
  const show = it.show_id ? (db.prepare('SELECT title, start_time FROM shows WHERE id = ?').get(it.show_id) as any) : null;
  const showTitle = (show?.title || '').trim();
  let seatLbl = '';
  if (it.seat_id) {
    const se = db.prepare('SELECT display_name, row_label, col_label FROM seats WHERE id = ?').get(it.seat_id) as any;
    seatLbl = (se?.display_name || `${se?.row_label ?? ''}${se?.col_label ?? ''}`).trim();
  }
  const when = [_dmy(it.show_date), show?.start_time].filter(Boolean).join(' ');
  // Σειρά: ΕΙΔΟΣ - ΘΕΑΜΑ - ΩΡΑ - ΘΕΣΗ (κάθε πεδίο χωριστά, με «-»).
  return [ttype, showTitle, when, seatLbl].filter(Boolean).join(' - ').slice(0, 200) || ttype;
}

/** Φτιάχνει provider + config μόνο αν είναι ενεργή η λειτουργία 'provider' με credentials. */
function providerCfg(): { provider: RapidSignProvider; cfg: any; venue: any } | null {
  const row = db.prepare('SELECT * FROM fiscal_config WHERE id = 1').get() as any;
  if (row?.issue_mode !== 'provider') return null;
  let cfg: any = {}; try { cfg = JSON.parse(row.config ?? '{}'); } catch { /* ignore */ }
  if (!cfg.username || !cfg.password || !cfg.activationCode) return null;
  const venue = db.prepare('SELECT * FROM venue WHERE id = 1').get() as any;
  const provider = new RapidSignProvider({
    env: (cfg.env as FiscalEnv) === 'prod' ? 'prod' : 'dev',
    username: cfg.username, password: cfg.password, activationCode: cfg.activationCode,
  });
  return { provider, cfg, venue };
}

function issuerOf(cfg: any, venue: any, branch = 0): IssueParty {
  return {
    vatNumber: cfg.issuerVat || venue?.vat_number || '', countryId: 87, branch,
    name: venue?.name, activity: '', taxOffice: venue?.tax_office,
    phone: venue?.phone, email: venue?.email,
    address: { City: venue?.city, PostalCode: venue?.postal_code, Street: venue?.address, Number: '' },
  };
}

/** Εκδίδει ΑΠΥ για την πώληση (idempotent). Επιστρέφει null αν δεν είναι σε λειτουργία παρόχου. */
export async function issueForSale(saleId: number, opts?: { vivaTxId?: string }): Promise<FiscalOutcome | null> {
  const pc = providerCfg(); if (!pc) return null;
  const { provider, cfg, venue } = pc;
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as any;
  if (!sale) return { ok: false, error: 'Δεν βρέθηκε πώληση' };
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
  const cust = sale.customer_id ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id) as any) : null;

  // Είδος πώλησης: αν περιέχει εμπορικό προϊόν (ticket_types.kind=1) → προϊόν (Απόδειξη Λιανικής)·
  // αλλιώς υπηρεσία (ΑΠΥ). Επιλογή παραστατικού από την ενιαία λίστα (docs.list) βάσει χρήσης. Λιανική μόνο.
  const isProductSale = items.some((it: any) => it.ticket_type_id
    && ((db.prepare('SELECT kind FROM ticket_types WHERE id = ?').get(it.ticket_type_id) as any)?.kind === 1));
  const docList = loadDocList(cfg.docs);
  const apy: any = pickSaleDoc(docList, isProductSale, 'retail') || {};
  const docType: string = apy.label || (isProductSale ? 'ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ' : 'ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ');
  const series: string = apy.series || (isProductSale ? 'ΑΛΠ' : 'ΑΠΥ');
  const already = db.prepare("SELECT mark, qr_provider, qr_url, series, aa FROM fiscal_documents WHERE sale_id = ? AND role = 'sale' AND status = 'transmitted'").get(saleId) as any;
  if (already) return { ok: true, mark: already.mark ?? undefined, providerUrl: already.qr_provider ?? undefined, qrUrl: already.qr_url ?? undefined, series: already.series ?? undefined, aa: already.aa ?? undefined, docType, isNew: false };
  // Ασφάλεια: αν δεν βρέθηκε/ενεργοποιήθηκε κατάλληλο παραστατικό πώλησης → ΜΗΝ εκδώσεις λάθος.
  if (!Number(apy.invoiceTypeId)) {
    return { ok: false, error: isProductSale
      ? 'Δεν έχει οριστεί/ενεργοποιηθεί παραστατικό πώλησης προϊόντων (Απόδειξη Λιανικής) στις Ρυθμίσεις → Παραστατικά.'
      : 'Δεν έχει οριστεί/ενεργοποιηθεί παραστατικό πώλησης υπηρεσιών (ΑΠΥ) στις Ρυθμίσεις → Παραστατικά.' };
  }

  const lines = items.map((it: any, i: number) => {
    const gross = +Number(it.line_total).toFixed(2);
    const vr = Number(it.vat_rate) || 0;
    const net = +(vr ? gross / (1 + vr / 100) : gross).toFixed(2);
    const vcat = vatCatIdFromRate(vr);
    return {
      code: String(it.ticket_type_id ?? `L${i + 1}`), name: lineDescription(it),
      qty: Number(it.qty) || 1, unitPriceInclVat: +Number(it.unit_price).toFixed(2),
      netValue: net, vatAmount: +(gross - net).toFixed(2), vatCatId: vcat,
      // ΦΠΑ 0% (κατηγορία 7) → απαιτείται Κατηγορία Απαλλαγής (άρθρο/απόφαση) από τον πάροχο.
      vatExcCatId: vcat === 7 && Number.isFinite(Number(apy.vatExemptionId)) ? Number(apy.vatExemptionId) : null,
      incomeCatId: Number.isFinite(Number(apy.incomeCatId)) ? Number(apy.incomeCatId) : 2,
      incomeValId: Number.isFinite(Number(apy.incomeValId)) ? Number(apy.incomeValId) : 8,
    };
  });
  const totalGross = +lines.reduce((s, l) => s + l.unitPriceInclVat * l.qty, 0).toFixed(2);
  const totalNet = +lines.reduce((s, l) => s + l.netValue, 0).toFixed(2);
  const totalVat = +lines.reduce((s, l) => s + l.vatAmount, 0).toFixed(2);
  // Φραγή: πώληση χωρίς γραμμές ή μηδενικό ποσό → ΔΕΝ εκδίδουμε (ούτε καταχωρούμε «error», ούτε καταναλώνουμε αα).
  if (!lines.length || totalGross <= 0) return { ok: false, error: 'Μηδενικό/κενό ποσό — δεν εκδίδεται παραστατικό' };
  const isCard = sale.payment_method === 'card';
  const payId = isCard ? (Number(apy.paymentCardId) || 7) : (Number(apy.paymentCashId) || 3);

  // Αα = ΜΕΓΙΣΤΟ αα που έχει σταλεί ποτέ + 1 (ώστε να ΜΗΝ ξαναχρησιμοποιείται — ακόμη κι αν ένα
  // βήμα-1 κάρτας καταχώρησε εκκρεμές παραστατικό στον πάροχο που δεν ολοκληρώθηκε).
  // Αν έχει οριστεί «Αρχικός Αα» στις ρυθμίσεις, ξεκινάμε από εκεί (το μέγιστο των δύο).
  const maxNext = ((db.prepare("SELECT MAX(CAST(aa AS INTEGER)) AS m FROM fiscal_documents WHERE role = 'sale' AND series = ? AND status = 'transmitted'").get(series) as any).m || 0) + 1;
  const aaStart = Number(apy.aaStart);
  let aaNum = Number.isFinite(aaStart) && aaStart > maxNext ? aaStart : maxNext;
  // Στοιχείο πληρωμής. ΚΑΝΟΝΑΣ ΠΑΡΟΧΟΥ (επιβεβαιωμένος από επιτυχημένες εκδόσεις):
  // όταν υπάρχει PaymentStatus, ΠΡΕΠΕΙ να συνοδεύεται από AcquirerId + TidNsp· αλλιώς → 1174 «token μόνο POS»·
  // αν λείπει εντελώς → 1006 «εκτός ορίων». Άρα ΟΛΑ (μετρητά & κάρτα) πάνε με PaymentStatus + Acquirer + Tid.
  //  • Μετρητά → PaymentStatus από το doc (default 2 «Με Διασύνδεση») + acquirer + tid.
  //  • Κάρτα ΜΕ πραγματικό Viva transactionId → PaymentStatus 2 + acquirer + το πραγματικό tid.
  //  • Κάρτα ΧΩΡΙΣ transactionId → PaymentStatus από το doc + acquirer + tid.
  const pay: any = { payGuid: randomUUID(), paymentId: payId, net: totalNet, vat: totalVat, amount: totalGross };
  if (!isCard) {
    // ΜΕΤΡΗΤΑ: ο πάροχος δέχεται ΜΟΝΟ PaymentStatus 2 (ολοκληρωμένη). Το 1 («εκκρεμεί αντιστοίχιση POS») → 1174.
    pay.paymentStatus = 2;
    pay.acquirerId = Number(apy.acquirerId) || 122;
    pay.tidNsp = String(Date.now()).slice(-8);
  } else if (opts?.vivaTxId) {
    // Κάρτα με πραγματικό Viva transactionId → αποδοχή POS.
    pay.paymentStatus = 2;
    pay.acquirerId = Number(apy.acquirerId) || 122;
    pay.tidNsp = opts.vivaTxId;
  } else {
    // Κάρτα χωρίς πραγματικό tid: PaymentStatus 1, αλλά ο τύπος 7 ΑΠΑΙΤΕΙ AcquirerId + TidNsp.
    pay.paymentStatus = Number(apy.cardPaymentStatus) || 1;
    pay.acquirerId = Number(apy.acquirerId) || 122;
    pay.tidNsp = String(Date.now()).slice(-8);
  }
  // Έκδοση με auto-retry: αν ο πάροχος έχει ΗΔΗ ΜΑΡΚ για αυτό το αα (σφάλμα 1114, π.χ. ο πάροχος είναι
  // μπροστά από την τοπική αρίθμηση), αυξάνουμε το αα και ξαναδοκιμάζουμε (μέχρι 25 φορές).
  let res: any;
  for (let _attempt = 0; _attempt < 25; _attempt++) {
  res = await provider.postInvoice({
    invoiceTypeId: Number(apy.invoiceTypeId) || 20, series,
    aa: String(aaNum), counter: 1, issueDate: new Date().toISOString(), currencyId: 47,
    issuer: issuerOf(cfg, venue, Number(apy.branch) || 0),
    // Όταν υπάρχει πελάτης (π.χ. online ή επιλεγμένος στο ταμείο), στέλνουμε τα στοιχεία του
    // (όνομα/τηλ/email) στον πάροχο — ακόμη κι αν είναι λιανική (ΑΦΜ 000000000), όχι ανώνυμος.
    counterpart: cust
      ? {
          vatNumber: cust.vat_number || '000000000', countryId: 87, branch: 0,
          name: cust.full_name || 'ΠΕΛΑΤΗΣ ΛΙΑΝΙΚΗΣ',
          code: cust.vat_number ? String(cust.id) : 'ΛΙΑΝΙΚΗ',
          phone: cust.phone1 || cust.phone || undefined,
          email: cust.email || undefined,
          address: { City: cust.city, PostalCode: cust.postal_code, Street: cust.address, Number: '' },
        }
      : undefined,
    showCounterpart: !!cust,
    lines,
    payments: [pay],
  });
    const dupAa = !res.ok && /\b1114\b|έχει λάβει ήδη|έχει λάβει Μ\.?ΑΡ\.?Κ/i.test(String(res.error ?? '') + JSON.stringify(res.raw ?? ''));
    if (!dupAa) break;
    aaNum += 1; // ο πάροχος έχει ήδη αυτό το αα — δοκίμασε το επόμενο
  }

  const ins = db.prepare(`INSERT INTO fiscal_documents
    (sale_id, role, provider, invoice_type_id, series, aa, mark, uid, auth_code, qr_url, qr_provider, guid, status, net, vat, total, raw)
    VALUES (?, 'sale', 'rapidsign', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  if (res.ok && res.mark) {
    ins.run(saleId, Number(apy.invoiceTypeId) || 20, series, String(aaNum),
      res.mark, res.uid ?? null, res.authenticationCode ?? null, res.qrCodeMyData ?? null, res.qrCode ?? null, res.guid ?? null,
      'transmitted', totalNet, totalVat, totalGross, JSON.stringify(res.raw ?? '').slice(0, 4000));
    // Αποτύπωση παραστατικού πάνω στα εισιτήρια της πώλησης (για επανεκτύπωση/ιχνηλασιμότητα).
    try {
      db.prepare(
        `UPDATE tickets SET fiscal_mark = ?, fiscal_series = ?, fiscal_aa = ?, fiscal_qr = ?, fiscal_doc_type = ?
          WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ?)`
      ).run(res.mark ?? null, series, String(aaNum), res.qrCodeMyData ?? null, docType, saleId);
    } catch { /* οι στήλες ίσως δεν υπάρχουν σε πολύ παλιά βάση */ }
    return { ok: true, mark: res.mark, qrUrl: res.qrCodeMyData, providerUrl: res.qrCode, series, aa: String(aaNum), docType, isNew: true };
  }
  // Αποτυχία ή κενό ΜΑΡΚ → αποθήκευση ΟΛΟΥ του raw (request + response) για διάγνωση.
  const rawDump = JSON.stringify(res.raw ?? res.error ?? '').slice(0, 4000);
  ins.run(saleId, Number(apy.invoiceTypeId) || 20, series, String(aaNum),
    null, null, null, null, null, null, 'error', totalNet, totalVat, totalGross, rawDump);
  return { ok: false, error: res.error };
}

/** Εκδίδει Πιστωτικό (αντιλογιστικό) για την πώληση, αναφερόμενο στο ΜΑΡΚ του αρχικού ΑΠΥ. */
export async function creditForSale(saleId: number, _reason: string, amount?: { net: number; vat: number; total: number }): Promise<FiscalOutcome | null> {
  const pc = providerCfg(); if (!pc) return null;
  const { provider, cfg, venue } = pc;
  // Πιστωτικό: βρες το παραστατικό πώλησης (υπηρεσία/προϊόν) και πάρε το συνδεδεμένο πιστωτικό του.
  const isProdCredit = !!db.prepare('SELECT 1 FROM sale_items si JOIN ticket_types tt ON tt.id = si.ticket_type_id WHERE si.sale_id = ? AND tt.kind = 1 LIMIT 1').get(saleId);
  const docList = loadDocList(cfg.docs);
  const saleDoc = pickSaleDoc(docList, isProdCredit, 'retail');
  const cr: any = pickCreditDoc(docList, saleDoc) || {};
  if (!Number(cr.invoiceTypeId)) {
    return { ok: false, error: isProdCredit
      ? 'Δεν έχει οριστεί πιστωτικό για το παραστατικό πωλήσεων προϊόντων (Πιστωτικό Λιανικής) στις Ρυθμίσεις → Παραστατικά.'
      : 'Δεν έχει οριστεί πιστωτικό για το παραστατικό υπηρεσιών (ΠΑΠΥ) στις Ρυθμίσεις → Παραστατικά.' };
  }
  const orig = db.prepare("SELECT * FROM fiscal_documents WHERE sale_id = ? AND role = 'sale' AND status = 'transmitted' ORDER BY id DESC LIMIT 1").get(saleId) as any;
  if (!orig || !orig.mark) return { ok: false, error: 'Δεν βρέθηκε διαβιβασμένο παραστατικό για ακύρωση' };
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as any;
  const cust = sale?.customer_id ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id) as any) : null;
  // Ποσό πιστωτικού: του συγκεκριμένου εισιτηρίου (αν δόθηκε) αλλιώς όλο το αρχικό ΑΠΥ.
  const net = +Number(amount ? amount.net : orig.net).toFixed(2);
  const vat = +Number(amount ? amount.vat : orig.vat).toFixed(2);
  const total = +Number(amount ? amount.total : orig.total).toFixed(2);
  const rate = net > 0 ? Math.round((vat / net) * 100) : 0;
  // ΑΑ πιστωτικού: ΑΝΑ ΣΕΙΡΑ (μέγιστο της σειράς + 1)· αν έχει οριστεί «Αρχικός ΑΑ», από εκεί (το μεγαλύτερο).
  const crSeries = cr.series || 'ΠΑΠΥ';
  const crMaxNext = ((db.prepare("SELECT MAX(CAST(aa AS INTEGER)) AS m FROM fiscal_documents WHERE role = 'credit' AND series = ? AND status = 'transmitted'").get(crSeries) as any).m || 0) + 1;
  const crStart = Number(cr.aaStart);
  const crAa = Number.isFinite(crStart) && crStart > crMaxNext ? crStart : crMaxNext;
  const crIncCat = Number.isFinite(Number(cr.incomeCatId)) ? Number(cr.incomeCatId) : 2;
  const crIncVal = Number.isFinite(Number(cr.incomeValId)) ? Number(cr.incomeValId) : 8;
  const crVatEx = Number(cr.vatExemptionId ?? saleDoc?.vatExemptionId);
  const excFor = (vcat: number) => (vcat === 7 && Number.isFinite(crVatEx) ? crVatEx : null);

  // Γραμμές πιστωτικού: πλήρης αντιλογισμός → μία γραμμή ανά είδος της πώλησης, με την ίδια περιγραφή
  // (Τύπος - Θέαμα [Θέση] - ημ/ώρα). Μερικός (όταν δόθηκε amount) → μία γραμμή με περιγραφή του θεάματος.
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
  let lines;
  if (!amount && items.length) {
    lines = items.map((it: any, i: number) => {
      const gross = +Number(it.line_total).toFixed(2);
      const vr = Number(it.vat_rate) || 0;
      const n = +(vr ? gross / (1 + vr / 100) : gross).toFixed(2);
      const vc = vatCatIdFromRate(vr);
      return { code: String(it.ticket_type_id ?? `L${i + 1}`), name: lineDescription(it), qty: Number(it.qty) || 1, unitPriceInclVat: +Number(it.unit_price).toFixed(2),
        netValue: n, vatAmount: +(gross - n).toFixed(2), vatCatId: vc, vatExcCatId: excFor(vc), incomeCatId: crIncCat, incomeValId: crIncVal };
    });
  } else {
    const code0 = items.length ? String(items[0].ticket_type_id ?? 'L1') : 'L1';
    const desc = items.length ? lineDescription(items[0]) : 'Πιστωτικό / Επιστροφή';
    const vc = vatCatIdFromRate(rate);
    lines = [{ code: code0, name: desc, qty: 1, unitPriceInclVat: total, netValue: net, vatAmount: vat, vatCatId: vc, vatExcCatId: excFor(vc), incomeCatId: crIncCat, incomeValId: crIncVal }];
  }

  // ΛΙΑΝΙΚΗ (Πιστωτικό Στοιχ. Λιανικής 11.4 / type 22): ΧΩΡΙΣ συσχετιζόμενο παραστατικό, ΧΩΡΙΣ
  // αρνητικά ποσά — απλώς νέο παραστατικό με InvoiceTypeId 22 (οδηγία RBS RapidSign· void δεν επιτρέπεται).
  const res = await provider.postInvoice({
    invoiceTypeId: Number(cr.invoiceTypeId) || 22, series: crSeries,
    aa: String(crAa), counter: 1,
    issueDate: new Date().toISOString(), currencyId: 47,
    issuer: issuerOf(cfg, venue, 0),
    counterpart: cust
      ? {
          vatNumber: cust.vat_number || '000000000', countryId: 87, branch: 0,
          name: cust.full_name || 'ΠΕΛΑΤΗΣ ΛΙΑΝΙΚΗΣ', code: cust.vat_number ? String(cust.id) : 'ΛΙΑΝΙΚΗ',
          phone: cust.phone1 || cust.phone || undefined, email: cust.email || undefined,
          address: { City: cust.city, PostalCode: cust.postal_code, Street: cust.address, Number: '' },
        }
      : undefined,
    showCounterpart: !!cust,
    lines,
    // Τρόπος πληρωμής πιστωτικού = ίδιος με την αρχική πώληση (κάρτα → κάρτα/2-step, αλλιώς μετρητά).
    payments: [
      sale?.payment_method === 'card'
        ? { payGuid: randomUUID(), paymentId: Number(cr.paymentCardId) || 7, net, vat, amount: total, paymentStatus: Number(cr.cardPaymentStatus) || 1, acquirerId: Number(cr.acquirerId) || 122, tidNsp: String(Date.now()).slice(-8) }
        : { payGuid: randomUUID(), paymentId: 3, net, vat, amount: total, paymentStatus: 2, acquirerId: Number(cr.acquirerId) || 122, tidNsp: String(Date.now()).slice(-8) },
    ],
  });

  if (res.ok && res.mark) {
    db.prepare(`INSERT INTO fiscal_documents
      (sale_id, role, provider, invoice_type_id, series, aa, mark, uid, auth_code, qr_url, qr_provider, guid, correlated_mark, status, net, vat, total, raw)
      VALUES (?, 'credit', 'rapidsign', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'transmitted', ?, ?, ?, ?)`)
      .run(saleId, Number(cr.invoiceTypeId) || 22, crSeries, String(crAa),
        res.mark ?? null, res.uid ?? null, res.authenticationCode ?? null, res.qrCodeMyData ?? null, res.qrCode ?? null, res.guid ?? null,
        orig.mark, net, vat, total, JSON.stringify(res.raw ?? '').slice(0, 4000));
    db.prepare("UPDATE fiscal_documents SET status = 'cancelled' WHERE id = ?").run(orig.id);
    return { ok: true, mark: res.mark };
  }
  return { ok: false, error: res.error || 'Δεν επιστράφηκε ΜΑΡΚ για το πιστωτικό' };
}
