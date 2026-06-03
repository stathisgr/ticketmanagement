// GET /functions/v1/ticket?uid=<serial_uid>  → HTML εισιτήριο με QR (δημόσιο).
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderTicketHtml } from "../_shared/ticket-html.ts";

function fmtDateGr(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    const wd = new Intl.DateTimeFormat("el-GR", { weekday: "long" }).format(d);
    return `${wd} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch { return iso; }
}
const eur = (cents: number) => (cents / 100).toFixed(2).replace(".", ",") + " €";

Deno.serve(async (req) => {
  const uid = new URL(req.url).searchParams.get("uid");
  if (!uid) return new Response("Missing uid", { status: 400 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: t } = await db.from("tickets")
    .select("*, shows(*), ticket_types(title), seats(seat_label), orders(customer_name, customer_email)")
    .eq("serial_uid", uid).single();
  if (!t) return new Response("Δεν βρέθηκε εισιτήριο", { status: 404 });

  const s: any = t.shows;
  const html = await renderTicketHtml({
    venueName: s?.venue_name || "", showTitle: s?.title || "", showSubtitle: s?.subtitle || "",
    date: fmtDateGr(s?.show_date || ""), time: s?.start_time || "",
    seat: (t as any).seats?.seat_label || "—", ticketType: (t as any).ticket_types?.title || "",
    holder: (t as any).orders?.customer_name || (t as any).orders?.customer_email || "",
    price: eur(t.price_cents), serial: t.serial, brandColor: s?.brand_color || "#7c2d12",
    legal: s?.legal_note || "", qrData: t.serial_uid,
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
