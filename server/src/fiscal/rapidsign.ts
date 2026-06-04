/**
 * Adapter παρόχου ηλεκτρονικής τιμολόγησης: RapidSign / MyMat (RBS).
 *   Docs: https://api.mymat.com.gr · Dev: https://dev.rapidsign.com.gr · Prod: https://app.rapidsign.com.gr
 *
 * Ροή (από την τεκμηρίωση):
 *   1) POST /api/v1.0/provider/Authorize    { username, password, activationCode }      → parentToken
 *   2) POST /api/v1.0/provider/RefreshToken  (header ParentToken: <parentToken>)         → bearer token
 *   3) Bearer token σε όλα τα υπόλοιπα (InvoiceTypes, VatCategories, PaymentMethods, PostInvoice, …)
 *   4) POST /api/v1.0/provider/PostInvoice  { Guid, InvoiceHeader, Issuer, InvoiceDetails[], PaymentMethods[] }
 *      → απόκριση: fromDB.aadeBookInvoiceType { uid, mark, authenticationCode }
 *
 * Όλες οι αποκρίσεις έχουν φάκελο: { extCode, statusDescription, message, token, jsonData }.
 */

export type FiscalEnv = 'dev' | 'prod';

export interface RapidSignConfig {
  env: FiscalEnv;
  baseUrl?: string;
  username: string;
  password: string;
  activationCode: string;
}

const BASE: Record<FiscalEnv, string> = {
  dev: 'https://dev.rapidsign.com.gr',
  prod: 'https://app.rapidsign.com.gr',
};

interface Envelope<T = any> {
  extCode?: number; statusDescription?: string; message?: string;
  token?: string; jsonData?: T; [k: string]: any;
}

export interface IssueLine { code?: string; name: string; qty: number; unitPriceInclVat: number; netValue: number; vatAmount: number; vatCatId: number; vatExcCatId?: number | null; incomeCatId?: number; incomeValId?: number; }
export interface IssueParty {
  vatNumber: string; countryId: number; branch: number; name?: string; activity?: string;
  taxOffice?: string; phone?: string; email?: string; code?: string;
  address?: { City?: string; PostalCode?: string; Street?: string; Number?: string };
}
export interface IssueRequest {
  invoiceTypeId: number;        // ΑΠΥ = 20 · Πιστωτικό Λιανικής = 22
  series: string; aa: string; counter?: number;
  correlatedMarks?: string[];   // για Πιστωτικό/αντιλογιστικό: ΜΑΡΚ του αρχικού παραστατικού
  issueDate: string;            // ISO
  issuer: IssueParty;
  counterpart?: IssueParty;     // λιανική: VatNumber 000000000
  showCounterpart?: boolean;    // true → εμφάνιση στοιχείων συμβαλλόμενου στο παραστατικό
  lines: IssueLine[];
  payments: { payGuid: string; paymentId: number; net?: number; vat?: number; amount: number; acquirerId?: number; tidNsp?: string; paymentStatus?: number }[];
  incomeCatId?: number; incomeValId?: number;
  currencyId: number;
}
export interface IssueResult { ok: boolean; guid?: string; uid?: string; mark?: string; authenticationCode?: string; authCodeMat?: string; qrCode?: string; qrCodeMyData?: string; raw?: any; error?: string; }
export interface VoidResult { ok: boolean; raw?: any; error?: string; }

/** Χαρτογράφηση συντελεστή ΦΠΑ % → VatCatId (AADE). 24→1,13→2,6→3,17→4,9→5,4→6,0→7. */
export function vatCatIdFromRate(rate: number): number {
  const m: Record<number, number> = { 24: 1, 13: 2, 6: 3, 17: 4, 9: 5, 4: 6, 0: 7 };
  return m[Math.round(rate)] ?? 7;
}

export class RapidSignProvider {
  private bearer: string | null = null;
  constructor(private cfg: RapidSignConfig) {}
  private base() { return (this.cfg.baseUrl || BASE[this.cfg.env] || BASE.dev).replace(/\/$/, ''); }

  private async call<T = any>(path: string, opts: { method?: string; body?: any; headers?: Record<string, string> } = {}): Promise<Envelope<T>> {
    const res = await fetch(this.base() + path, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'Response', ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: Envelope<T>;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text } as any; }
    if (!res.ok) {
      // Πλήρες σώμα (matException.errors / ProblemDetails) για διάγνωση· αλλιώς ένδειξη κενού σώματος.
      const detail = (text && text.trim()) ? text.slice(0, 900) : `(κενό σώμα — ${res.statusText || 'Bad Request'})`;
      throw new Error(`RapidSign ${path} HTTP ${res.status}: ${detail}`);
    }
    return data;
  }

  private pickToken(env: Envelope): string | null {
    // Authorize → { refToken: { token, expires } } · RefreshToken → { token }
    return env.refToken?.token || env.jsonData?.refToken?.token
      || env.refreshToken?.token || env.jsonData?.refreshToken?.token
      || (typeof env.refToken === 'string' ? env.refToken : null)
      || env.token || env.jsonData?.token || env.jsonData?.accessToken || null;
  }

  /** Authorize → RefreshToken → cache bearer. */
  async authenticate(): Promise<string> {
    const auth = await this.call('/api/v1.0/provider/Authorize', {
      method: 'POST',
      body: { username: this.cfg.username, password: this.cfg.password, activationCode: this.cfg.activationCode },
    });
    const parent = this.pickToken(auth);
    if (!parent) throw new Error('RapidSign Authorize: δεν επιστράφηκε token. Απάντηση: ' + JSON.stringify(auth).slice(0, 400));
    const refreshed = await this.call('/api/v1.0/provider/RefreshToken', {
      method: 'POST', headers: { ParentToken: parent },
    });
    const bearer = this.pickToken(refreshed) || parent;
    this.bearer = bearer;
    return bearer;
  }

  private async authed<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<Envelope<T>> {
    if (!this.bearer) await this.authenticate();
    return this.call<T>(path, { ...opts, headers: { Authorization: `Bearer ${this.bearer}` } });
  }

  // Lookups
  invoiceTypes() { return this.authed('/api/v1.0/provider/InvoiceTypes'); }
  vatCategories() { return this.authed('/api/v1.0/provider/VatCategories'); }
  paymentMethods() { return this.authed('/api/v1.0/provider/PaymentMethods'); }
  currencies() { return this.authed('/api/v1.0/provider/Currencies'); }
  incomeCategories() { return this.authed('/api/v1.0/provider/IncomeCategories'); }
  incomeValues() { return this.authed('/api/v1.0/provider/IncomeValues'); }

  /** Έλεγχος διαπιστευτηρίων + ανάκτηση lookups (για ρύθμιση mappings). */
  async testConnection(): Promise<{ ok: boolean; error?: string; lookups?: any }> {
    try {
      await this.authenticate();
      const [it, vat, pay] = await Promise.all([this.invoiceTypes(), this.vatCategories(), this.paymentMethods()]);
      return { ok: true, lookups: { invoiceTypes: it.jsonData, vatCategories: vat.jsonData, paymentMethods: pay.jsonData } };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Έκδοση στοιχείου λιανικής (ΑΠΥ, InvoiceTypeId=20). IncludesVat=true (τιμές με ΦΠΑ).
   * Endpoint (επιβεβαιωμένο): /api/v1.1/provider/PostInvoice1155?debug=true
   * Απόκριση: jsonData.dataLite { mark, invoiceUid, authCode, authCodeMat, qrCode, qrCodeMyData }
   */
  async postInvoice(req: IssueRequest): Promise<IssueResult> {
    try {
      const cp = req.counterpart ?? {
        vatNumber: '000000000', countryId: 87, branch: 0, name: 'Πελάτης λιανικής', code: 'ΛΙΑΝΙΚΗ',
      };
      const body = {
        Guid: cryptoRandomUUID(),
        TransmissionFailure: false,
        TransFailure: 0,
        Template: 3,
        FileType: 2,
        ShowCounterpart: req.showCounterpart ?? false,
        DeferredTransaction: false,
        ReceiptStatus: 0,
        PaymentStatus: 0,
        DiscServer: false,
        InvoiceHeader: {
          InvoiceTypeId: req.invoiceTypeId,
          IncludesVat: true,
          Series: req.series,
          Aa: req.aa,
          Counter: req.counter ?? 1,
          IssueDate: req.issueDate,
          CurrencyId: req.currencyId,
          ...(req.correlatedMarks && req.correlatedMarks.length
            ? { CorrelatedMarks: req.correlatedMarks.map((m) => Number(m)).filter((n) => Number.isFinite(n)) }
            : {}),
          MultipleConnectedMarksGuid: [],
        },
        Issuer: {
          VatNumber: req.issuer.vatNumber,
          CountryIdAade: 'GR',
          CountryId: req.issuer.countryId ?? 87,
          Branch: req.issuer.branch ?? 0,
          Name: req.issuer.name,
          Activity: req.issuer.activity,
          TaxOffice: req.issuer.taxOffice,
          Phone: req.issuer.phone,
          Email: req.issuer.email,
          Address: req.issuer.address,
        },
        Counterpart: {
          VatNumber: cp.vatNumber,
          CountryIdAade: 'GR',
          CountryId: cp.countryId ?? 87,
          Branch: cp.branch ?? 0,
          Code: cp.code ?? '',
          Name: cp.name,
          ...(cp.phone ? { Phone: cp.phone } : {}),
          ...(cp.email ? { Email: cp.email } : {}),
          Address: cp.address,
        },
        InvoiceDetails: req.lines.map((l, i) => {
          const tot = +(l.unitPriceInclVat * l.qty).toFixed(2);
          return {
            Line: i + 1,
            Code: l.code ?? `L${i + 1}`,
            Name: l.name,
            MUnitId: 1,
            Qty: l.qty,
            ItemPrc: l.unitPriceInclVat,
            DiscType: 0,
            TotPrice: tot,
            TotPrcAfterDisc: tot,
            DiscountValue: 0.0,
            NetValue: l.netValue,
            VatAmount: l.vatAmount,
            VatCatId: l.vatCatId,
            VatExcCatId: l.vatExcCatId ?? null,
            IncomeCatId: l.incomeCatId ?? req.incomeCatId ?? null,
            IncomeValId: l.incomeValId ?? req.incomeValId ?? null,
          };
        }),
        // Τα πεδία αποδοχής POS (PaymentStatus 2 + Acquirer + TidNsp) μπαίνουν ΜΟΝΟ όταν δοθεί
        // θετικό paymentStatus (μετρητά: 2 — δουλεύει). Για κάρτα χωρίς πραγματική αποδοχή POS
        // (paymentStatus 0/κενό) στέλνουμε μόνο τα ποσά (αλλιώς 1192 σε PaymentId 7).
        PaymentMethods: req.payments.map((p) => {
          const pm: Record<string, unknown> = {
            PayGuid: p.payGuid,
            PaymentId: p.paymentId,
            Net: p.net ?? null,
            Vat: p.vat ?? null,
            Amount: p.amount,
            TipAmount: 0.0,
            DateAdded: new Date().toISOString(),
          };
          if (p.paymentStatus && p.paymentStatus > 0) {
            pm.PaymentStatus = p.paymentStatus;
            if (p.acquirerId) pm.AcquirerId = p.acquirerId;
            if (p.tidNsp) pm.TidNsp = p.tidNsp;
          }
          return pm;
        }),
      };
      let env = await this.authed('/api/v1.1/provider/PostInvoice1155?debug=true', { method: 'POST', body });
      // ΔΥΟ ΒΗΜΑΤΑ για κάρτα/POS: αν γύρισε paySigs χωρίς ΜΑΡΚ → επιβεβαίωση πληρωμής (SendPaymentMethods).
      const dl0 = env.jsonData?.dataLite;
      if (!deepFind(env, ['mark']) && dl0?.paySigs?.length && dl0?.guid) {
        const pm = dl0.paySigs.map((ps: any) => {
          const orig = (req.payments.find((p) => p.payGuid === ps.payGuid) ?? req.payments[0]) as any;
          return { PayGuid: ps.payGuid, PaymentId: orig.paymentId, Amount: orig.amount, PaymentStatus: 2, transactionId: orig.tidNsp ?? ps.payGuid };
        });
        try {
          const env2 = await this.authed('/api/v1.1/provider/SendPaymentMethods?debug=true', {
            method: 'POST', body: { VatNumber: req.issuer.vatNumber, DiscServer: false, InvoiceGuid: dl0.guid, PaymentMethods: pm },
          });
          if (deepFind(env2, ['mark'])) env = env2;            // πέτυχε → ΜΑΡΚ
          else env = { ...env2, jsonData: { ...env2.jsonData, _step1: env.jsonData } }; // για διάγνωση
        } catch (e) { /* κρατάμε το env του βήματος 1 για διάγνωση */ }
      }
      // Βαθιά αναζήτηση (η θέση των πεδίων διαφέρει ανά endpoint/έκδοση/debug).
      const mark = deepFind(env, ['mark']) ?? deepFind(env, ['markNumber', 'aadeMark']);
      const uid = deepFind(env, ['invoiceUid', 'uid']);
      const guid = deepFind(env, ['guid']);
      const authenticationCode = deepFind(env, ['authCode', 'authenticationCode']);
      const qrCode = deepFind(env, ['qrCode']);
      const qrCodeMyData = deepFind(env, ['qrCodeMyData']);
      if (!mark && !uid) {
        return { ok: false, raw: { request: body, response: env }, error: 'Δεν επιστράφηκε MARK/UID. Απάντηση: ' + JSON.stringify(env).slice(0, 600) };
      }
      return {
        ok: true, guid, mark: String(mark ?? ''), uid: uid ? String(uid) : undefined,
        authenticationCode, authCodeMat: deepFind(env, ['authCodeMat']), qrCode, qrCodeMyData,
        raw: { request: body, response: env },
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Ακύρωση (void) εκδοθέντος παραστατικού — π.χ. ακυρωτικό ΑΠΥ.
   * POST /api/v1.0/provider/invoicevoid?debug=true  body { vatNumber, guid, VoidReason }
   * Το `guid` είναι αυτό που επέστρεψε η έκδοση (dataLite.guid).
   */
  async voidInvoice(vatNumber: string, guid: string, reason: string): Promise<VoidResult> {
    try {
      if (!guid) return { ok: false, error: 'Λείπει το guid του παραστατικού προς ακύρωση' };
      const env = await this.authed('/api/v1.0/provider/invoicevoid?debug=true', {
        method: 'POST', body: { vatNumber, guid, VoidReason: reason || 'Ακύρωση' },
      });
      const code = env.extCode ?? env.jsonData?.invoiceStatus;
      const ok = env.statusDescription === 'SUCCESS' || env.message === 'SUCCESS' || code === 100;
      if (!ok) return { ok: false, raw: env, error: env.message ?? JSON.stringify(env).slice(0, 200) };
      return { ok: true, raw: env };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Συγκεντρωτική ανάκτηση όλων των λιστών (lookups) για τη ρύθμιση παραστατικών. */
  async allLookups(): Promise<any> {
    await this.authenticate();
    const pick = (e: Envelope) => e.jsonData?.idNames ?? e.jsonData ?? [];
    const [it, vat, vatEx, inc, incV, pay, acq] = await Promise.all([
      this.invoiceTypes(), this.vatCategories(), this.call('/api/v1.0/provider/VatExemptions', { headers: { Authorization: `Bearer ${this.bearer}` } }),
      this.incomeCategories(), this.incomeValues(), this.paymentMethods(),
      this.call('/api/v1.0/provider/Acquirers', { headers: { Authorization: `Bearer ${this.bearer}` } }),
    ]);
    return {
      invoiceTypes: pick(it), vatCategories: pick(vat), vatExemptions: pick(vatEx),
      incomeCategories: pick(inc), incomeValues: pick(incV), paymentMethods: pick(pay), acquirers: pick(acq),
    };
  }
}

/** Επιστρέφει την πρώτη μη-κενή τιμή για οποιοδήποτε από τα keys, ψάχνοντας σε όλο το αντικείμενο. */
function deepFind(obj: any, keys: string[]): any {
  const seen = new Set<any>();
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    for (const k of keys) {
      const v = (cur as any)[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    for (const val of Object.values(cur)) {
      if (val && typeof val === 'object') stack.push(val);
      else if (typeof val === 'string') {
        const s = val.trim();
        if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
          try { stack.push(JSON.parse(s)); } catch { /* not json */ }
        }
      }
    }
  }
  return undefined;
}

function cryptoRandomUUID(): string {
  // node:crypto randomUUID χωρίς import σε top-level (αποφυγή κύκλων)
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}
