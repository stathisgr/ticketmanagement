/**
 * Adapter πληρωμών καρτών: Viva (Viva.com / Vivapayments).
 *
 * OAuth2 (client_credentials):
 *   Demo:  https://demo-accounts.vivapayments.com/connect/token
 *   Prod:  https://accounts.vivapayments.com/connect/token
 *   Header: Authorization: Basic base64(clientId:clientSecret), Content-Type: x-www-form-urlencoded, body grant_type=client_credentials
 *
 * Smart Checkout (online/QR): POST {api}/checkout/v2/orders {amount(cents),...} → {orderCode}
 *   Checkout URL: https://demo.vivapayments.com/web/checkout?ref={orderCode}  (prod: www.vivapayments.com)
 *
 * Cloud Terminal (φυσικό POS): scaffold — απαιτεί terminalId & επιβεβαίωση endpoint από docs/συσκευή.
 *
 * ⚠️ Demo περιβάλλον. Δεν εκτελείται πραγματική χρέωση από τον κώδικα εδώ· μόνο
 * δημιουργία order / έλεγχος token. Η χρέωση γίνεται από τον πελάτη στο checkout/terminal.
 */
export type VivaEnv = 'demo' | 'prod';

export interface VivaConfig {
  env: VivaEnv;
  // Smart Checkout OAuth client (client_credentials)
  smartClientId?: string;
  smartClientSecret?: string;
  // POS / Cloud Terminal OAuth client
  posClientId?: string;
  posClientSecret?: string;
  // Basic auth (για κατάσταση/ακύρωση order): Merchant ID + API Key
  merchantId?: string;
  apiKey?: string;
  terminalId?: string;          // φυσικό τερματικό (cash register / terminal id)
  sourceCode?: string;          // Smart Checkout "source/payment source" code (προαιρετικό)
}

/** Viva order StateId: 3 = Paid (επιβεβαιωμένο από demo). Άλλες τιμές = εκκρεμεί/άκυρο. */
export const VIVA_PAID_STATE = 3;

function hosts(env: VivaEnv) {
  return env === 'prod'
    ? { accounts: 'https://accounts.vivapayments.com', api: 'https://api.vivapayments.com', checkout: 'https://www.vivapayments.com' }
    : { accounts: 'https://demo-accounts.vivapayments.com', api: 'https://demo-api.vivapayments.com', checkout: 'https://demo.vivapayments.com' };
}

export class VivaProvider {
  constructor(private cfg: VivaConfig) {}

  /** OAuth2 token (client_credentials). which='smart' | 'pos'. */
  async token(which: 'smart' | 'pos' = 'smart'): Promise<string> {
    const id = which === 'pos' ? this.cfg.posClientId : this.cfg.smartClientId;
    const secret = which === 'pos' ? this.cfg.posClientSecret : this.cfg.smartClientSecret;
    if (!id || !secret) throw new Error('Λείπουν credentials Viva (' + which + ')');
    const h = hosts(this.cfg.env);
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetch(`${h.accounts}/connect/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok || !data.access_token) throw new Error(`Viva token HTTP ${res.status}: ${data.error_description ?? data.error ?? text.slice(0, 200)}`);
    return data.access_token as string;
  }

  /** Έλεγχος credentials (παίρνει token). */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try { await this.token('smart'); return { ok: true }; }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  }

  /** Smart Checkout: δημιουργία order → επιστρέφει orderCode + checkout URL. */
  async createCheckoutOrder(amountCents: number, opts: { customerTrns?: string; merchantTrns?: string; email?: string; fullName?: string; phone?: string } = {}): Promise<{ orderCode: string; checkoutUrl: string }> {
    const h = hosts(this.cfg.env);
    const token = await this.token('smart');
    const body: any = {
      amount: amountCents,
      customerTrns: opts.customerTrns ?? 'Εισιτήρια',
      merchantTrns: opts.merchantTrns,
      paymentTimeout: 300,
      preauth: false,
      allowRecurring: false,
      ...(opts.email || opts.fullName || opts.phone
        ? { customer: { email: opts.email, fullName: opts.fullName, phone: opts.phone, countryCode: 'GR', requestLang: 'el-GR' } }
        : {}),
    };
    if (this.cfg.sourceCode) body.sourceCode = this.cfg.sourceCode;
    const res = await fetch(`${h.api}/checkout/v2/orders`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok || !data.orderCode) throw new Error(`Viva order HTTP ${res.status}: ${data.message ?? text.slice(0, 200)}`);
    return { orderCode: String(data.orderCode), checkoutUrl: `${h.checkout}/web/checkout?ref=${data.orderCode}` };
  }

  /** Προωθεί υπάρχον order σε συνδεδεμένο φυσικό τερματικό (payment session). */
  async pushToTerminal(orderCode: string): Promise<{ ok: boolean; error?: string }> {
    const h = hosts(this.cfg.env);
    const token = await this.token('smart');
    const res = await fetch(`${h.api}/web2/checkout/v2/paymentsessions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderCode: Number(orderCode) }),
    });
    if (!res.ok) { const t = await res.text(); return { ok: false, error: `Viva paymentsession HTTP ${res.status}: ${t.slice(0, 200)}` }; }
    return { ok: true };
  }

  /** Κατάσταση order (Basic auth Merchant ID:API Key). Επιστρέφει StateId (3 = Paid). */
  async getOrderState(orderCode: string): Promise<{ stateId: number | null; paid: boolean; transactionId?: string; raw?: any; error?: string }> {
    if (!this.cfg.merchantId || !this.cfg.apiKey) return { stateId: null, paid: false, error: 'Λείπουν Merchant ID / API Key (Basic auth).' };
    const h = hosts(this.cfg.env);
    const basic = Buffer.from(`${this.cfg.merchantId}:${this.cfg.apiKey}`).toString('base64');
    const res = await fetch(`${h.checkout}/api/orders/${orderCode}`, { headers: { Authorization: `Basic ${basic}` } });
    const text = await res.text();
    let d: any; try { d = JSON.parse(text); } catch { d = { raw: text }; }
    if (!res.ok) return { stateId: null, paid: false, error: `Viva order status HTTP ${res.status}` };
    const stateId = typeof d.StateId === 'number' ? d.StateId : null;
    // Αναγνωριστικό συναλλαγής Viva (για δήλωση στον πάροχο ως TidNsp). Διάφορα πεδία ανά απάντηση.
    const transactionId = d.TransactionId ?? d.transactionId
      ?? (Array.isArray(d.Transactions) && d.Transactions.length ? (d.Transactions[0].TransactionId ?? d.Transactions[0].Id) : undefined)
      ?? undefined;
    return { stateId, paid: stateId === VIVA_PAID_STATE, transactionId: transactionId ? String(transactionId) : undefined, raw: d };
  }
}
