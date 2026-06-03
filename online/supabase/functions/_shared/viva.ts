// Viva Smart Checkout helper για Supabase Edge Functions (Deno).
// Endpoints επιβεβαιωμένα από το Viva Documentation (demo + prod hosts).

export type VivaEnv = "demo" | "prod";

export interface VivaConfig {
  env: VivaEnv;
  smartClientId: string;     // Smart Checkout OAuth client (apps.vivapayments.com)
  smartClientSecret: string;
  merchantId: string;        // για Basic auth στο orders API
  apiKey: string;
  sourceCode?: string;       // Payment source (4-digit), προαιρετικό
}

export const VIVA_PAID_STATE = 3; // StateId = 3 → Paid

function hosts(env: VivaEnv) {
  return env === "prod"
    ? { accounts: "https://accounts.vivapayments.com", api: "https://api.vivapayments.com" }
    : { accounts: "https://demo-accounts.vivapayments.com", api: "https://demo-api.vivapayments.com" };
}

function fromEnv(): VivaConfig {
  return {
    env: (Deno.env.get("VIVA_ENV") as VivaEnv) === "prod" ? "prod" : "demo",
    smartClientId: Deno.env.get("VIVA_SMART_CLIENT_ID") ?? "",
    smartClientSecret: Deno.env.get("VIVA_SMART_CLIENT_SECRET") ?? "",
    merchantId: Deno.env.get("VIVA_MERCHANT_ID") ?? "",
    apiKey: Deno.env.get("VIVA_API_KEY") ?? "",
    sourceCode: Deno.env.get("VIVA_SOURCE_CODE") ?? undefined,
  };
}

export class Viva {
  cfg: VivaConfig;
  constructor(cfg?: VivaConfig) { this.cfg = cfg ?? fromEnv(); }

  // OAuth2 client_credentials → access token (Smart Checkout)
  async token(): Promise<string> {
    const { accounts } = hosts(this.cfg.env);
    const basic = btoa(`${this.cfg.smartClientId}:${this.cfg.smartClientSecret}`);
    const res = await fetch(`${accounts}/connect/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`Viva token ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return j.access_token as string;
  }

  // Δημιουργία order πληρωμής → { orderCode, checkoutUrl }
  async createOrder(amountCents: number, opts: {
    customerTrns?: string; merchantTrns?: string;
    email?: string; fullName?: string; phone?: string;
  } = {}): Promise<{ orderCode: string; checkoutUrl: string }> {
    const { api } = hosts(this.cfg.env);
    const tok = await this.token();
    const body: Record<string, unknown> = {
      amount: amountCents,
      customerTrns: opts.customerTrns ?? "Εισιτήρια",
      merchantTrns: opts.merchantTrns ?? "Online booking",
      paymentTimeout: 600,
      preauth: false,
      allowRecurring: false,
      currencyCode: 978, // EUR
      customer: {
        email: opts.email, fullName: opts.fullName,
        phone: opts.phone, countryCode: "GR", requestLang: "el-GR",
      },
    };
    if (this.cfg.sourceCode) body.sourceCode = this.cfg.sourceCode;
    const res = await fetch(`${api}/checkout/v2/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Viva createOrder ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const orderCode = String(j.orderCode);
    const checkoutHost = this.cfg.env === "prod"
      ? "https://www.vivapayments.com" : "https://demo.vivapayments.com";
    return { orderCode, checkoutUrl: `${checkoutHost}/web/checkout?ref=${orderCode}` };
  }

  // Κατάσταση order — legacy endpoint /api/orders/{code}, Basic merchantId:apiKey.
  // Επιστρέφει "StateId" (κεφαλαίο)· 3 = Paid.
  async orderState(orderCode: string): Promise<{ stateId: number | null; paid: boolean }> {
    const host = this.cfg.env === "prod"
      ? "https://www.vivapayments.com" : "https://demo.vivapayments.com";
    const basic = btoa(`${this.cfg.merchantId}:${this.cfg.apiKey}`);
    const res = await fetch(`${host}/api/orders/${orderCode}`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new Error(`Viva orderState ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const stateId = (typeof j.StateId === "number" ? j.StateId
      : typeof j.stateId === "number" ? j.stateId : null);
    return { stateId, paid: stateId === VIVA_PAID_STATE };
  }

  // Webhook verification key (Viva GET challenge)
  async webhookKey(): Promise<string> {
    const { api } = hosts(this.cfg.env);
    const tok = await this.token();
    const res = await fetch(`${api}/messages/config/token`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!res.ok) throw new Error(`Viva webhookKey ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return j.Key as string;
  }
}
