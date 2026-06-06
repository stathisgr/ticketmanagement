/**
 * Ενιαίο μοντέλο παραστατικών (docs.list[]).
 *
 * Κάθε παραστατικό:
 *   { id, label, enabled, role:'sale'|'credit', for:'service'|'product',
 *     counterpart:'retail'|'invoice', creditDocId,
 *     invoiceTypeId, series, aaStart, incomeCatId, incomeValId, vatExemptionId,
 *     paymentCashId, paymentCardId, acquirerId, paymentStatus }
 *
 * Η fiscalDocs(cfg) επιστρέφει τη λίστα — κάνει migration από το παλιό μοντέλο
 * (docs.apy / docs.credit / docs.extra[] / productDocId / productCreditDocId)
 * αν δεν υπάρχει ακόμη docs.list. Έτσι παλιές ρυθμίσεις δουλεύουν χωρίς αλλαγή.
 */

import { db } from '../db.js';

export interface FiscalDoc {
  id: number;
  label: string;
  enabled: boolean;
  role: 'sale' | 'credit';
  for: 'service' | 'product';
  counterpart: 'retail' | 'invoice';
  creditDocId: number | null;
  invoiceTypeId: number;
  series: string;
  aaStart?: number | '' | null;
  incomeCatId?: number;
  incomeValId?: number;
  vatExemptionId?: number;
  paymentCashId?: number;
  paymentCardId?: number;
  acquirerId?: number;
  paymentStatus?: number;
}

let _seq = 0;
const genId = () => Date.now() + (++_seq);

/** Τύποι myDATA που είναι πιστωτικά (για αυτόματη ταξινόμηση παλιών extra). */
const CREDIT_TYPES = new Set([5, 16, 22, 23, 24]); // π.χ. 22 = Πιστωτικό Λιανικής, 5 = Πιστωτικό Τιμολόγιο

const looksCredit = (e: any) =>
  CREDIT_TYPES.has(Number(e?.invoiceTypeId)) || /πιστωτ/i.test(String(e?.label || ''));

export interface SeriesHints { saleService?: string | null; creditService?: string | null }

/**
 * Επιστρέφει την ενιαία λίστα παραστατικών (με migration από το παλιό μοντέλο αν χρειάζεται).
 * `hints`: πραγματικές σειρές που ήδη χρησιμοποιούνται (ώστε η αρίθμηση να ΣΥΝΕΧΙΖΕΤΑΙ, να μη μηδενίζει).
 */
export function buildDocList(docs: any, hints: SeriesHints = {}): FiscalDoc[] {
  if (docs && Array.isArray(docs.list) && docs.list.length) {
    return docs.list.map((d: any) => normalizeDoc(d));
  }
  const out: FiscalDoc[] = [];
  const apy = (docs && docs.apy) || {};
  const credit = (docs && docs.credit) || {};
  const extra: any[] = (docs && docs.extra) || [];

  // Πιστωτικό υπηρεσιών (ΠΑΠΥ) — δημιουργείται ΠΑΝΤΑ (διατηρεί την προηγούμενη συμπεριφορά ακύρωσης
  // που εξέδιδε πιστωτικό τύπου 22 ακόμη κι αν δεν ήταν ρητά ρυθμισμένο). Σειρά: η ήδη σε χρήση.
  const svcCreditId: number = Number(credit.id) || genId();
  out.push(normalizeDoc({
    id: svcCreditId, label: 'Πιστωτικό Υπηρεσιών (ΠΑΠΥ)', role: 'credit', for: 'service', counterpart: 'retail',
    invoiceTypeId: credit.invoiceTypeId ?? 22, series: credit.series ?? hints.creditService ?? 'ΠΑΠΥ', aaStart: credit.aaStart,
    incomeCatId: credit.incomeCatId ?? 2, incomeValId: credit.incomeValId ?? 8, vatExemptionId: credit.vatExemptionId,
    acquirerId: credit.acquirerId ?? 0, paymentCashId: 3, paymentCardId: 7, paymentStatus: 2,
  }));
  // ΑΠΥ υπηρεσιών (πάντα — το βασικό παραστατικό). Σειρά: αυτή που ήδη χρησιμοποιείται (συνέχεια αρίθμησης).
  out.push(normalizeDoc({
    id: Number(apy.id) || genId(), label: 'Απόδειξη Παροχής Υπηρεσιών (ΑΠΥ)', role: 'sale', for: 'service', counterpart: 'retail',
    creditDocId: svcCreditId, invoiceTypeId: apy.invoiceTypeId ?? 20, series: apy.series ?? hints.saleService ?? 'ΑΠΥ', aaStart: apy.aaStart,
    incomeCatId: apy.incomeCatId ?? 2, incomeValId: apy.incomeValId ?? 8, vatExemptionId: apy.vatExemptionId,
    paymentCashId: apy.paymentCashId ?? 3, paymentCardId: apy.paymentCardId ?? 7, acquirerId: apy.acquirerId ?? 0,
    paymentStatus: apy.paymentStatus ?? 2,
  }));
  // Πρόσθετα → ταξινόμηση sale/credit. Παλιά extra αφορούσαν εμπορικά προϊόντα (λιανική).
  for (const e of extra) {
    const isCr = looksCredit(e);
    out.push(normalizeDoc({
      id: Number(e.id) || genId(), label: e.label, role: isCr ? 'credit' : 'sale', for: 'product', counterpart: 'retail',
      creditDocId: isCr ? null : (String(e.id) === String(docs?.productDocId) ? (docs?.productCreditDocId ?? null) : null),
      invoiceTypeId: e.invoiceTypeId, series: e.series, aaStart: e.aaStart, incomeCatId: e.incomeCatId, incomeValId: e.incomeValId,
      vatExemptionId: e.vatExemptionId, paymentCashId: e.paymentCashId ?? 3, paymentCardId: e.paymentCardId ?? 7,
      acquirerId: e.acquirerId ?? 0, paymentStatus: e.paymentStatus ?? 2,
    }));
  }
  // Post-pass: κάθε παραστατικό πώλησης χωρίς ορισμένο πιστωτικό → σύνδεσέ το με πιστωτικό ίδιας χρήσης (for).
  for (const d of out) {
    if (d.role === 'sale' && d.creditDocId == null) {
      const c = out.find((x) => x.role === 'credit' && x.for === d.for);
      if (c) d.creditDocId = c.id;
    }
  }
  return out;
}

function normalizeDoc(d: any): FiscalDoc {
  return {
    id: Number(d.id) || genId(),
    label: String(d.label || 'Παραστατικό'),
    enabled: d.enabled !== false,
    role: d.role === 'credit' ? 'credit' : 'sale',
    for: d.for === 'product' ? 'product' : 'service',
    counterpart: d.counterpart === 'invoice' ? 'invoice' : 'retail',
    creditDocId: d.creditDocId == null || d.creditDocId === '' ? null : Number(d.creditDocId),
    invoiceTypeId: Number(d.invoiceTypeId) || 0,
    series: String(d.series || ''),
    aaStart: d.aaStart === '' || d.aaStart == null ? undefined : Number(d.aaStart),
    incomeCatId: d.incomeCatId == null ? undefined : Number(d.incomeCatId),
    incomeValId: d.incomeValId == null ? undefined : Number(d.incomeValId),
    vatExemptionId: d.vatExemptionId == null ? undefined : Number(d.vatExemptionId),
    paymentCashId: d.paymentCashId == null ? 3 : Number(d.paymentCashId),
    paymentCardId: d.paymentCardId == null ? 7 : Number(d.paymentCardId),
    acquirerId: d.acquirerId == null ? 0 : Number(d.acquirerId),
    paymentStatus: d.paymentStatus == null ? 2 : Number(d.paymentStatus),
  };
}

/** Διαλέγει παραστατικό ΠΩΛΗΣΗΣ βάσει είδους (υπηρεσία/προϊόν) και τύπου (λιανική/τιμολόγιο). */
export function pickSaleDoc(list: FiscalDoc[], isProduct: boolean, mode: 'retail' | 'invoice' = 'retail'): FiscalDoc | null {
  const f = isProduct ? 'product' : 'service';
  return (
    list.find((d) => d.role === 'sale' && d.enabled && d.for === f && d.counterpart === mode) ||
    list.find((d) => d.role === 'sale' && d.enabled && d.for === f) ||
    null
  );
}

/** Διαλέγει το ΠΙΣΤΩΤΙΚΟ που αντιστοιχεί στο παραστατικό πώλησης. */
export function pickCreditDoc(list: FiscalDoc[], saleDoc: FiscalDoc | null): FiscalDoc | null {
  if (!saleDoc) return null;
  if (saleDoc.creditDocId != null) {
    const c = list.find((d) => String(d.id) === String(saleDoc.creditDocId) && d.role === 'credit');
    if (c) return c;
  }
  return list.find((d) => d.role === 'credit' && d.for === saleDoc.for && d.enabled) || null;
}

/** Σειρά υπηρεσιών (ΑΠΥ) με τα περισσότερα ήδη-εκδοθέντα παραστατικά, εξαιρώντας τις σειρές προϊόντων. */
function serviceSaleSeries(exclude: Set<string>): string | null {
  try {
    const rows = db.prepare(
      "SELECT series, COUNT(*) AS n FROM fiscal_documents WHERE role = 'sale' AND series IS NOT NULL AND series <> '' GROUP BY series ORDER BY n DESC"
    ).all() as any[];
    for (const r of rows) if (!exclude.has(String(r.series))) return r.series;
    return null;
  } catch { return null; }
}

// Λατινικά ομόγλυφα → ΕΛΛΗΝΙΚΑ. Η σειρά είναι ΠΑΝΤΑ με ελληνικούς χαρακτήρες (π.χ. «ΑΠΥ» με ελληνικό Υ),
// ΠΟΤΕ λατινικό Y/A/P κ.λπ. Έτσι υπάρχει ΜΙΑ μόνο γραφή ανά σειρά και ο αύξων (MAX αα ανά σειρά)
// δεν μηδενίζει ούτε διπλασιάζεται λόγω οπτικά ίδιων αλλά διαφορετικών χαρακτήρων.
const LAT2GR: Record<string, string> = {
  A: 'Α', B: 'Β', E: 'Ε', Z: 'Ζ', H: 'Η', I: 'Ι', K: 'Κ', M: 'Μ', N: 'Ν', O: 'Ο', P: 'Ρ', T: 'Τ', Y: 'Υ', X: 'Χ',
};
const toGreekSeries = (s: string): string => [...String(s || '')].map((c) => LAT2GR[c.toUpperCase()] || c).join('');

/** Κανονικοποιεί κάθε σειρά σε ελληνικούς χαρακτήρες (μία ενιαία γραφή ανά σειρά). */
function repairSeries(list: FiscalDoc[]): FiscalDoc[] {
  for (const d of list) if (d.series) d.series = toGreekSeries(d.series);
  return list;
}

/**
 * Φορτώνει την ενιαία λίστα από το config, με migration που ΣΕΒΕΤΑΙ τη σειρά ΑΠΥ που ήδη
 * χρησιμοποιείται στη βάση (ώστε να μη μηδενίζει η αρίθμηση). Αυτό χρησιμοποιεί η μηχανή έκδοσης.
 */
export function loadDocList(docs: any): FiscalDoc[] {
  let list: FiscalDoc[];
  if (docs && Array.isArray(docs.list) && docs.list.length) {
    list = docs.list.map((d: any) => normalizeDoc(d));
  } else {
    const productSeries = new Set<string>(((docs && docs.extra) || []).map((e: any) => String(e.series || '')).filter(Boolean));
    list = buildDocList(docs, { saleService: serviceSaleSeries(productSeries) });
  }
  return repairSeries(list);
}
