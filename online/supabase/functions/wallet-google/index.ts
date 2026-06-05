// GET /functions/v1/wallet-google?uid=<serial_uid>
// → φτιάχνει EventTicket class+object, υπογράφει «Save to Google Wallet» JWT και κάνει
//   redirect στο https://pay.google.com/gp/v/save/<JWT> (δουλεύει ως link, χωρίς domain binding).
//
// Απαιτούμενα secrets (Supabase → Edge Functions → Secrets):
//   GOOGLE_WALLET_ISSUER_ID   (από Google Pay & Wallet Console)
//   GOOGLE_WALLET_SA_EMAIL    (service account email)
//   GOOGLE_WALLET_SA_KEY      (service account private key, PKCS8 PEM — με πραγματικά newlines ή \n)
//   PUBLIC_SITE_URL           (προαιρετικό — origin για το pass)
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5";

function fmtDateGr(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    const wd = new Intl.DateTimeFormat("el-GR", { weekday: "long" }).format(d);
    return `${wd} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch { return iso; }
}
const sanitize = (s: string) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");

Deno.serve(async (req) => {
  const uid = new URL(req.url).searchParams.get("uid");
  if (!uid) return new Response("Missing uid", { status: 400 });

  const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID") ?? "";
  const saEmail = Deno.env.get("GOOGLE_WALLET_SA_EMAIL") ?? "";
  const saKey = (Deno.env.get("GOOGLE_WALLET_SA_KEY") ?? "").replace(/\\n/g, "\n");
  if (!issuerId || !saEmail || !saKey)
    return new Response("Google Wallet δεν έχει ρυθμιστεί (secrets).", { status: 500 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: t } = await db.from("tickets")
    .select("*, shows(*), ticket_types(title), seats(seat_label), orders(customer_name, customer_email)")
    .eq("serial_uid", uid).single();
  if (!t) return new Response("Δεν βρέθηκε εισιτήριο", { status: 404 });

  const s: any = (t as any).shows ?? {};
  const holder = (t as any).orders?.customer_name || (t as any).orders?.customer_email || "";
  const seat = (t as any).seats?.seat_label || "";
  const ticketType = (t as any).ticket_types?.title || "";
  const brand = s.brand_color || "#7c2d12";

  const classId = `${issuerId}.event_${sanitize(String(s.id ?? "x"))}`;
  const objectId = `${issuerId}.t_${sanitize(uid)}`;

  const eventClass: Record<string, unknown> = {
    id: classId,
    issuerName: s.venue_name || "Εισιτήρια",
    reviewStatus: "UNDER_REVIEW",
    eventName: { defaultValue: { language: "el", value: s.title || "Εκδήλωση" } },
    ...(s.venue_name ? { venue: { name: { defaultValue: { language: "el", value: s.venue_name } }, address: { defaultValue: { language: "el", value: s.venue_name } } } } : {}),
    ...(s.show_date ? { dateTime: { start: `${s.show_date}T${(s.start_time || "00:00")}:00` } } : {}),
  };

  const eventObject: Record<string, unknown> = {
    id: objectId,
    classId,
    state: "ACTIVE",
    hexBackgroundColor: brand,
    ticketHolderName: holder,
    ticketNumber: (t as any).serial,
    ...(ticketType ? { ticketType: { defaultValue: { language: "el", value: ticketType } } } : {}),
    ...(seat ? { seatInfo: { seat: { defaultValue: { language: "el", value: seat } } } } : {}),
    barcode: { type: "QR_CODE", value: uid, alternateText: (t as any).serial },
    textModulesData: [
      ...(s.show_date ? [{ id: "date", header: "Ημερομηνία", body: fmtDateGr(s.show_date) + (s.start_time ? " " + s.start_time : "") }] : []),
    ],
  };

  const origins = [Deno.env.get("PUBLIC_SITE_URL") ?? "https://ticketmanagement.stathis.workers.dev"];
  const claims = {
    iss: saEmail,
    aud: "google",
    typ: "savetowallet",
    origins,
    payload: { eventTicketClasses: [eventClass], eventTicketObjects: [eventObject] },
  };

  try {
    const pk = await jose.importPKCS8(saKey, "RS256");
    const jwt = await new jose.SignJWT(claims as unknown as jose.JWTPayload)
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt()
      .sign(pk);
    return Response.redirect(`https://pay.google.com/gp/v/save/${jwt}`, 302);
  } catch (e) {
    return new Response("Σφάλμα Google Wallet: " + String((e as Error).message), { status: 500 });
  }
});
