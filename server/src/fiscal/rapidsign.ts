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

export interface IssueLine { name: string; qty: number; unitPriceInclVat: number; netValue: number; vatAmount: number; vatCatId: number; vatExcCatId?: number | null; }
export interface IssueRequest {
  invoiceTypeId: number;        // π.χ. 11.2 → InvoiceTypeId από InvoiceTypes
  series: string; aa: string;
  issueDate: string;            // ISO
  issuer: { vatNumber: string; countryId: number; branch: number; name?: string; activity?: string; taxOffice?: string; phone?: string; email?: string; address?: any };
  lines: IssueLine[];
  payments: { payGuid: string; paymentId: number; amount: number }[];
  incomeCatId?: number; incomeValId?: number;
  currencyId: number;
}
export interface IssueResult { ok: boolean; uid?: string; mark?: string; authenticationCode?: string; raw?: any; error?: string; }

export class RapidSignProvider {
  private bearer: string | null = null;
  constructor(private cfg: RapidSignConfig) {}
  private base() { return (this.cfg.baseUrl || BASE[this.cfg.env] || BASE.dev).replace(/\/$/, ''); }

  private async call<T = any>(path: string, opts: { method?: string; body?: any; headers?: Record<string, string> } = {}): Promise<Envelope<T>> {
    const res = await fetch(this.base() + path, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: Envelope<T>;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text } as any; }
    if (!res.ok) throw new Error(`RapidSign ${path} HTTP ${res.status}: ${data?.message ?? text?.slice(0, 200)}`);
    return data;
  }

  private pickToken(env: Envelope): string | null {
    return env.token || env.jsonData?.token || env.jsonData?.accessToken || env.jsonData?.refreshToken || null;
  }

  /** Authorize → RefreshToken → cache bearer. */
  async authenticate(): Promise<string> {
    const auth = await this.call('/api/v1.0/provider/Authorize', {
      method: 'POST',
      body: { username: this.cfg.username, password: this.cfg.password, activationCode: this.cfg.activationCode },
    });
    const parent = this.pickToken(auth);
    if (!parent) throw new Error('RapidSign Authorize: δεν επιστράφηκε token. ' + (auth.message ?? ''));
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

  /** Έκδοση στοιχείου λιανικής (π.χ. 11.2 ΑΠΥ παροχής υπηρεσιών). IncludesVat=true (τιμές με ΦΠΑ). */
  async postInvoice(req: IssueRequest): Promise<IssueResult> {
    try {
      const body = {
        Guid: cryptoRandomUUID(),
        TransmissionFailure: false,
        Template: 3,
        FileType: 0,
        ShowCounterpart: false,
        PaymentStatus: 0,
        InvoiceHeader: {
          InvoiceTypeId: req.invoiceTypeId,
          IncludesVat: true,
          Series: req.series,
          Aa: req.aa,
          IssueDate: req.issueDate,
          CurrencyId: req.currencyId,
        },
        Issuer: {
          VatNumber: req.issuer.vatNumber,
          CountryId: req.issuer.countryId,
          Branch: req.issuer.branch ?? 0,
          Name: req.issuer.name,
          Activity: req.issuer.activity,
          TaxOffice: req.issuer.taxOffice,
          Phone: req.issuer.phone,
          Email: req.issuer.email,
          Address: req.issuer.address,
        },
        InvoiceDetails: req.lines.map((l, i) => ({
          Line: i + 1,
          Name: l.name,
          MUnitId: 1,
          Qty: l.qty,
          ItemPrc: l.unitPriceInclVat,
          TotPrcAfterDisc: +(l.unitPriceInclVat * l.qty).toFixed(2),
          NetValue: l.netValue,
          VatAmount: l.vatAmount,
          VatCatId: l.vatCatId,
          VatExcCatId: l.vatExcCatId ?? null,
          IncomeCatId: req.incomeCatId ?? null,
          IncomeValId: req.incomeValId ?? null,
        })),
        PaymentMethods: req.payments.map((p) => ({
          PayGuid: p.payGuid, PaymentId: p.paymentId, Amount: p.amount, TipAmount: 0.0, PaymentStatus: 0,
        })),
      };
      const env = await this.authed('/api/v1.0/provider/PostInvoice', { method: 'POST', body });
      const aade = env.jsonData?.fromDB?.aadeBookInvoiceType ?? env.jsonData?.aadeBookInvoiceType ?? {};
      const mark = aade.mark ?? env.jsonData?.fromDB?.mark;
      const uid = aade.uid ?? env.jsonData?.fromDB?.id;
      const authenticationCode = aade.authenticationCode;
      if (!mark && !uid) return { ok: false, raw: env, error: 'Δεν επιστράφηκε MARK/UID. ' + (env.message ?? '') };
      return { ok: true, mark: String(mark ?? ''), uid: uid ? String(uid) : undefined, authenticationCode, raw: env };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

function cryptoRandomUUID(): string {
  // node:crypto randomUUID χωρίς import σε top-level (αποφυγή κύκλων)
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}
