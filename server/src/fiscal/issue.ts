/**
 * Σύνδεση έκδοσης παραστατικών παρόχου (myDATA) με τη ροή πώλησης/ακύρωσης.
 * Όταν fiscal_config.issue_mode='provider': κάθε πώληση εκδίδει ΑΠΥ, κάθε ακύρωση εκδίδει Πιστωτικό.
 * Τα στοιχεία (ΜΑΡΚ/UID/QR/auth) αποθηκεύονται στον πίνακα fiscal_documents.
 */
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { RapidSignProvider, vatCatIdFromRate, type FiscalEnv, type IssueParty } from './rapidsign.js';

export interface FiscalOutcome { ok: boolean; mark?: string; qrUrl?: string; providerUrl?: string; isNew?: boolean; series?: string; aa?: string; docType?: string; error?: string; }

const _dmy = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : (d ?? ''));
/** Περιγραφή γραμμής παραστατικού: «Τύπος - Θέαμα [Θέση] - ημ/νία ώρα». Χρησιμοποιείται σε ΑΠΥ & Πιστωτικό. */
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
  const head = [ttype, [showTitle, seatLbl].filter(Boolean).join(' ')].filter(Boolean).join(' - ');
  return [head, when].filter(Boolean).join(' - ').slice(0, 200) || ttype;
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
  const apy = (cfg.docs && cfg.docs.apy) || {};
  const docType = apy.docLabel || 'ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ';
  const already = db.prepare("SELECT mark, qr_provider, qr_url, series, aa FROM fiscal_documents WHERE sale_id = ? AND role = 'sale' AND status = 'transmitted'").get(saleId) as any;
  if (already) return { ok: true, mark: already.mark ?? undefined, providerUrl: already.qr_provider ?? undefined, qrUrl: already.qr_url ?? undefined, series: already.series ?? undefined, aa: already.aa ?? undefined, docType, isNew: false };
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as any;
  if (!sale) return { ok: false, error: 'Δεν βρέθηκε πώληση' };
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
  const cust = sale.customer_id ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id) as any) : null;

  const lines = items.map((it: any, i: number) => {
    const gross = +Number(it.line_total).toFixed(2);
    const vr = Number(it.vat_rate) || 0;
    const net = +(vr ? gross / (1 + vr / 100) : gross).toFixed(2);
    return {
      code: String(it.ticket_type_id ?? `L${i + 1}`), name: lineDescription(it),
      qty: Number(it.qty) || 1, unitPriceInclVat: +Number(it.unit_price).toFixed(2),
      netValue: net, vatAmount: +(gross - net).toFixed(2), vatCatId: vatCatIdFromRate(vr),
      incomeCatId: Number.isFinite(Number(apy.incomeCatId)) ? Number(apy.incomeCatId) : 2,
      incomeValId: Number.isFinite(Number(apy.incomeValId)) ? Number(apy.incomeValId) : 8,
    };
  });
  const totalGross = +lines.reduce((s, l) => s + l.unitPriceInclVat * l.qty, 0).toFixed(2);
  const totalNet = +lines.reduce((s, l) => s + l.netValue, 0).toFixed(2);
  const totalVat = +lines.reduce((s, l) => s + l.vatAmount, 0).toFixed(2);
  const isCard = sale.payment_method === 'card';
  const payId = isCard ? (Number(apy.paymentCardId) || 7) : (Number(apy.paymentCashId) || 3);

  // Αα = ΜΕΓΙΣΤΟ αα που έχει σταλεί ποτέ + 1 (ώστε να ΜΗΝ ξαναχρησιμοποιείται — ακόμη κι αν ένα
  // βήμα-1 κάρτας καταχώρησε εκκρεμές παραστατικό στον πάροχο που δεν ολοκληρώθηκε).
  // Αν έχει οριστεί «Αρχικός Αα» στις ρυθμίσεις, ξεκινάμε από εκεί (το μέγιστο των δύο).
  const maxNext = ((db.prepare("SELECT MAX(CAST(aa AS INTEGER)) AS m FROM fiscal_documents WHERE role = 'sale'").get() as any).m || 0) + 1;
  const aaStart = Number(apy.aaStart);
  const aaNum = Number.isFinite(aaStart) && aaStart > maxNext ? aaStart : maxNext;
  // Στοιχείο πληρωμής:
  //  • Μετρητά → PaymentStatus 2 + acquirer + tid (δουλεύει).
  //  • Κάρτα ΜΕ πραγματικό Viva transactionId → δήλωση POS (PaymentStatus 2 + acquirer + tid).
  //  • Κάρτα ΧΩΡΙΣ transactionId → PaymentStatus 1 (δηλωμένη, χωρίς αποδοχή POS· το 2→1192, το 0→1006).
  const pay: any = { payGuid: randomUUID(), paymentId: payId, net: totalNet, vat: totalVat, amount: totalGross };
  if (!isCard) {
    pay.paymentStatus = Number(apy.paymentStatus) || 2;
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
  const res = await provider.postInvoice({
    invoiceTypeId: Number(apy.invoiceTypeId) || 20, series: apy.series || cfg.series || 'ΑΠY',
    aa: String(aaNum), counter: 1, issueDate: new Date().toISOString(), currencyId: 47,
    issuer: issuerOf(cfg, venue, Number(apy.branch) || 0),
    // Όταν υπάρχει πελάτης (π.χ. online ή επιλεγμένος στο ταμείο), στέλνουμε τα στοιχεία του
    // (όνομα/τηλ/email) στον πάροχο — ακόμη κι αν είναι λιανική (ΑΦΜ 000000000), όχι ανώνυμος.
    counterpart: cust
      ? {
          vatNumber: cust.vat_number || '000000000', countryId: 87, branch: 0,
          name: cust.full_name || 'Πελάτης λιανικής',
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

  const ins = db.prepare(`INSERT INTO fiscal_documents
    (sale_id, role, provider, invoice_type_id, series, aa, mark, uid, auth_code, qr_url, qr_provider, guid, status, net, vat, total, raw)
    VALUES (?, 'sale', 'rapidsign', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  if (res.ok && res.mark) {
    ins.run(saleId, Number(apy.invoiceTypeId) || 20, apy.series || 'ΑΠY', String(aaNum),
      res.mark, res.uid ?? null, res.authenticationCode ?? null, res.qrCodeMyData ?? null, res.qrCode ?? null, res.guid ?? null,
      'transmitted', totalNet, totalVat, totalGross, JSON.stringify(res.raw ?? '').slice(0, 4000));
    // Αποτύπωση παραστατικού πάνω στα εισιτήρια της πώλησης (για επανεκτύπωση/ιχνηλασιμότητα).
    const seriesVal = apy.series || cfg.series || 'ΑΠY';
    try {
      db.prepare(
        `UPDATE tickets SET fiscal_mark = ?, fiscal_series = ?, fiscal_aa = ?, fiscal_qr = ?, fiscal_doc_type = ?
          WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ?)`
      ).run(res.mark ?? null, seriesVal, String(aaNum), res.qrCodeMyData ?? null, docType, saleId);
    } catch { /* οι στήλες ίσως δεν υπάρχουν σε πολύ παλιά βάση */ }
    return { ok: true, mark: res.mark, qrUrl: res.qrCodeMyData, providerUrl: res.qrCode, series: seriesVal, aa: String(aaNum), docType, isNew: true };
  }
  // Αποτυχία ή κενό ΜΑΡΚ → αποθήκευση ΟΛΟΥ του raw (request + response) για διάγνωση.
  const rawDump = JSON.stringify(res.raw ?? res.error ?? '').slice(0, 4000);
  ins.run(saleId, Number(apy.invoiceTypeId) || 20, apy.series || 'ΑΠY', String(aaNum),
    null, null, null, null, null, null, 'error', totalNet, totalVat, totalGross, rawDump);
  return { ok: false, error: res.error };
}

/** Εκδίδει Πιστωτικό (αντιλογιστικό) για την πώληση, αναφερόμενο στο ΜΑΡΚ του αρχικού ΑΠΥ. */
export async function creditForSale(saleId: number, _reason: string, amount?: { net: number; vat: number; total: number }): Promise<FiscalOutcome | null> {
  const pc = providerCfg(); if (!pc) return null;
  const { provider, cfg, venue } = pc;
  const cr = (cfg.docs && cfg.docs.credit) || {};
  const orig = db.prepare("SELECT * FROM fiscal_documents WHERE sale_id = ? AND role = 'sale' AND status = 'transmitted' ORDER BY id DESC LIMIT 1").get(saleId) as any;
  if (!orig || !orig.mark) return { ok: false, error: 'Δεν βρέθηκε διαβιβασμένο ΑΠΥ για ακύρωση' };
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as any;
  const cust = sale?.customer_id ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id) as any) : null;
  // Ποσό πιστωτικού: του συγκεκριμένου εισιτηρίου (αν δόθηκε) αλλιώς όλο το αρχικό ΑΠΥ.
  const net = +Number(amount ? amount.net : orig.net).toFixed(2);
  const vat = +Number(amount ? amount.vat : orig.vat).toFixed(2);
  const total = +Number(amount ? amount.total : orig.total).toFixed(2);
  const rate = net > 0 ? Math.round((vat / net) * 100) : 0;
  // ΑΑ πιστωτικού: μέγιστο της σειράς πιστωτικού + 1· αν έχει οριστεί «Αρχικός ΑΑ» στις ρυθμίσεις, από εκεί.
  const crMaxNext = ((db.prepare("SELECT MAX(CAST(aa AS INTEGER)) AS m FROM fiscal_documents WHERE role = 'credit'").get() as any).m || 0) + 1;
  const crStart = Number(cr.aaStart);
  const crAa = Number.isFinite(crStart) && crStart > crMaxNext ? crStart : crMaxNext;
  const crSeries = cr.series || 'ΠΑΠΥ';
  const crIncCat = Number.isFinite(Number(cr.incomeCatId)) ? Number(cr.incomeCatId) : 2;
  const crIncVal = Number.isFinite(Number(cr.incomeValId)) ? Number(cr.incomeValId) : 8;

  // Γραμμές πιστωτικού: πλήρης αντιλογισμός → μία γραμμή ανά είδος της πώλησης, με την ίδια περιγραφή
  // (Τύπος - Θέαμα [Θέση] - ημ/ώρα). Μερικός (όταν δόθηκε amount) → μία γραμμή με περιγραφή του θεάματος.
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
  let lines;
  if (!amount && items.length) {
    lines = items.map((it: any, i: number) => {
      const gross = +Number(it.line_total).toFixed(2);
      const vr = Number(it.vat_rate) || 0;
      const n = +(vr ? gross / (1 + vr / 100) : gross).toFixed(2);
      return { code: String(it.ticket_type_id ?? `L${i + 1}`), name: lineDescription(it), qty: Number(it.qty) || 1, unitPriceInclVat: +Number(it.unit_price).toFixed(2),
        netValue: n, vatAmount: +(gross - n).toFixed(2), vatCatId: vatCatIdFromRate(vr), incomeCatId: crIncCat, incomeValId: crIncVal };
    });
  } else {
    const code0 = items.length ? String(items[0].ticket_type_id ?? 'L1') : 'L1';
    const desc = items.length ? lineDescription(items[0]) : 'Πιστωτικό / Επιστροφή';
    lines = [{ code: code0, name: desc, qty: 1, unitPriceInclVat: total, netValue: net, vatAmount: vat, vatCatId: vatCatIdFromRate(rate), incomeCatId: crIncCat, incomeValId: crIncVal }];
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
          name: cust.full_name || 'Πελάτης λιανικής', code: cust.vat_number ? String(cust.id) : 'ΛΙΑΝΙΚΗ',
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
