// POST /functions/v1/lead — αποθήκευση lead (service role) + email ειδοποίηση (Microsoft 365 / Graph).
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function graphToken(): Promise<string> {
  const r = await fetch(`https://login.microsoftonline.com/${Deno.env.get("MS_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("MS_CLIENT_ID")!, client_secret: Deno.env.get("MS_CLIENT_SECRET")!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token as string;
}
async function sendMailGraph(to: string, subject: string, html: string, replyTo?: string) {
  const from = Deno.env.get("MAIL_FROM") ?? "noreply@ticketmanager.gr";
  const token = await graphToken();
  const message: Record<string, unknown> = { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] };
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }];
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!r.ok) throw new Error(`sendMail ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const b = await req.json();
    if (clean(b.website)) return json({ ok: true }); // honeypot
    const name = clean(b.name, 200), email = clean(b.email, 200);
    if (!name && !email) return json({ error: "Συμπληρώστε όνομα ή email" }, 400);
    const row = { name, company: clean(b.company, 200), email, phone: clean(b.phone, 60), venue_type: clean(b.venue_type, 80), venues: clean(b.venues, 60), numbered_seats: clean(b.numbered_seats, 20), online_needed: clean(b.online_needed, 20), existing_system: clean(b.existing_system, 200), volume: clean(b.volume, 60), message: clean(b.message, 4000), lang: clean(b.lang, 5), source: clean(b.source, 120) || "ticketmanager.gr", user_agent: clean(req.headers.get("user-agent") ?? "", 300) };
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await db.from("leads").insert(row);
    if (error) return json({ error: error.message }, 500);
    const to = Deno.env.get("LEAD_NOTIFY_EMAIL") ?? "sales@ticketmanager.gr";
    if (Deno.env.get("MS_CLIENT_ID")) {
      const html = `<h3>Νέο αίτημα παρουσίασης — ticketmanager.gr</h3>` + Object.entries(row).map(([k, v]) => v ? `<p><b>${k}:</b> ${String(v).replace(/</g, "&lt;")}</p>` : "").join("");
      try { await sendMailGraph(to, `Νέο lead — ${row.company || row.name || row.email}`, html, email || undefined); } catch (e) { console.error("lead email failed:", String((e as Error).message)); }
    }
    return json({ ok: true });
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
