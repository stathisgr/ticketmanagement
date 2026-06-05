// Viva webhook.
//   GET  → επιστρέφει το verification key (challenge κατά την εγγραφή του webhook).
//   POST → event πληρωμής: επαληθεύει StateId=3, οριστικοποιεί θέσεις, εκδίδει
//          εισιτήρια, στέλνει email (Resend) με HTML inline + PDF attachment + link.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Viva } from "../_shared/viva.ts";
import { renderTicketHtml } from "../_shared/ticket-html.ts";
import { buildTicketsPdf, type PdfTicket } from "../_shared/pdf.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const SITE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://ticketmanagement.stathis.workers.dev").replace(/\/$/, "");

function fmtDateGr(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    const wd = new Intl.DateTimeFormat("el-GR", { weekday: "long" }).format(d);
    return `${wd} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch { return iso; }
}
const eur = (cents: number) => (cents / 100).toFixed(2).replace(".", ",") + " €";

Deno.serve(async (req) => {
  const viva = new Viva();
  if (req.method === "GET") {
    try { return json({ Key: await viva.webhookKey() }); }
    catch (e) { return json({ error: String((e as Error).message) }, 500); }
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const evt = await req.json();
    const orderCode = String(evt?.EventData?.OrderCode ?? evt?.OrderCode ?? "");
    if (!orderCode) return json({ ok: true, note: "no orderCode" });

    const { data: order } = await db.from("orders").select("*").eq("viva_order_code", orderCode).single();
    if (!order) return json({ ok: true, note: "order not found" });
    if (order.status === "paid") return json({ ok: true, note: "already paid" }); // idempotent

    // Επαλήθευση με RETRY (καθυστέρηση διάδοσης Smart Checkout → legacy API) και FALLBACK στο
    // StateId του ίδιου του (υπογεγραμμένου) webhook event, ώστε να ΜΗ χάνεται η πληρωμή σε προσωρινό 404.
    const payloadState = Number(evt?.EventData?.StateId ?? evt?.StateId);
    let paid = false;
    try {
      const state = await viva.orderState(orderCode);
      paid = state.paid || payloadState === 3;
    } catch (lookupErr) {
      if (payloadState === 3) paid = true; // προσωρινή αποτυχία lookup → εμπιστεύσου το event
      else throw lookupErr;
    }
    if (!paid) return json({ ok: true, note: `state ${payloadState || "?"}` });

    const { data: show } = await db.from("shows").select("*").eq("id", order.show_id).single();
    const { data: items } = await db.from("order_items")
      .select("*, ticket_types(title), seats(seat_label)").eq("order_id", order.id);

    await db.from("orders").update({
      status: "paid", paid_at: new Date().toISOString(), viva_state_id: 3,
    }).eq("id", order.id);

    const seatIds = (items ?? []).map((i: any) => i.seat_id).filter(Boolean);
    if (seatIds.length) await db.from("seats").update({ status: "sold", sold_channel: "online" }).in("id", seatIds);
    await db.from("seat_holds").delete().eq("hold_token", order.hold_token);

    const year = new Date().getFullYear();
    const ticketRows = (items ?? []).map((i: any, n: number) => ({
      order_id: order.id, show_id: order.show_id, seat_id: i.seat_id ?? null,
      ticket_type_id: i.ticket_type_id, price_cents: i.price_cents,
      serial: `ONL-${year}-${String(order.id).padStart(5, "0")}-${n + 1}`,
    }));
    const { data: tickets } = await db.from("tickets").insert(ticketRows).select("*");
    if (show?.seating_mode === "general") {
      await db.from("shows").update({ online_sold: (show.online_sold ?? 0) + ticketRows.length }).eq("id", order.show_id);
    }

    const pdfTickets: PdfTicket[] = [];
    let htmlInline = "";
    for (let k = 0; k < (tickets ?? []).length; k++) {
      const tk = tickets![k]; const it: any = (items ?? [])[k];
      const view = {
        venueName: show.venue_name || "", showTitle: show.title, showSubtitle: show.subtitle || "",
        date: fmtDateGr(show.show_date), time: show.start_time || "", seat: it?.seats?.seat_label || "—",
        ticketType: it?.ticket_types?.title || "", holder: order.customer_name || order.customer_email,
        price: eur(tk.price_cents), serial: tk.serial, brandColor: show.brand_color || "#7c2d12",
        legal: show.legal_note || "", qrData: tk.serial_uid,
      };
      await db.from("tickets").update({ ticket_url: `${SITE}/?tk=${tk.serial_uid}` }).eq("id", tk.id);
      if (k === 0) htmlInline = await renderTicketHtml(view);
      pdfTickets.push(view);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("MAIL_FROM") ?? "Εισιτήρια <onboarding@resend.dev>";
    if (resendKey) {
      let attachments: any[] = [];
      try {
        const pdf = await buildTicketsPdf(pdfTickets);
        const b64 = btoa(String.fromCharCode(...pdf));
        attachments = [{ filename: `eisitiria-${order.id}.pdf`, content: b64 }];
      } catch (_e) { /* αν αποτύχει το PDF, μόνο HTML+link */ }
      const links = (tickets ?? [])
        .map((t: any) => `<li><a href="${SITE}/?tk=${t.serial_uid}">${t.serial}</a></li>`).join("");
      const body = `<div style="font-family:sans-serif"><h2>Η κράτησή σας επιβεβαιώθηκε</h2><p>${show.title} — ${fmtDateGr(show.show_date)} ${show.start_time}</p><p>Τα εισιτήριά σας:</p><ul>${links}</ul><p>Το εισιτήριο είναι και συνημμένο σε PDF.</p><hr>${htmlInline}</div>`;
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [order.customer_email], subject: `Εισιτήρια — ${show.title}`, html: body, attachments }),
        });
      } catch (_e) { /* log only */ }
    }

    return json({ ok: true, ticketsIssued: (tickets ?? []).length });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
