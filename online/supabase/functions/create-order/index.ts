// POST /functions/v1/create-order
// Body: { showId, items:[{seatId, ticketTypeId}], customer:{name,email,phone} }
// → δημιουργεί holds + order (pending) + Viva order → { orderId, orderCode, checkoutUrl }
import { createClient } from "npm:@supabase/supabase-js@2";
import { Viva } from "../_shared/viva.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const HOLD_MINUTES = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { showId, items, customer } = await req.json();
    if (!showId || !Array.isArray(items) || items.length === 0)
      return json({ error: "showId και items απαιτούνται" }, 400);
    if (!customer?.email) return json({ error: "Το email πελάτη είναι υποχρεωτικό" }, 400);

    // Show έγκυρο & ανοιχτό;
    const { data: show, error: se } = await db.from("shows")
      .select("id, title, enabled, sales_close_at, seating_mode").eq("id", showId).single();
    if (se || !show) return json({ error: "Το θέαμα δεν βρέθηκε" }, 404);
    if (!show.enabled) return json({ error: "Το θέαμα δεν είναι διαθέσιμο" }, 409);
    if (show.sales_close_at && new Date(show.sales_close_at) < new Date())
      return json({ error: "Οι online πωλήσεις έκλεισαν" }, 409);

    // Τιμές ανά τύπο
    const ttIds = [...new Set(items.map((i: any) => i.ticketTypeId))];
    const { data: tts } = await db.from("ticket_types")
      .select("id, title, price_cents, enabled").in("id", ttIds).eq("show_id", showId);
    const ttMap = new Map((tts ?? []).map((t: any) => [t.id, t]));
    for (const i of items) {
      const t = ttMap.get(i.ticketTypeId);
      if (!t || !t.enabled) return json({ error: "Άκυρος τύπος εισιτηρίου" }, 400);
    }

    // Επικύρωση θέσεων (seated): online + free + όχι ήδη held
    const seatIds = items.map((i: any) => i.seatId).filter(Boolean);
    if (show.seating_mode === "seated") {
      if (seatIds.length !== items.length) return json({ error: "Λείπει seatId σε seated θέαμα" }, 400);
      const { data: seats } = await db.from("seats")
        .select("id, status, channel, seat_label").in("id", seatIds).eq("show_id", showId);
      if (!seats || seats.length !== seatIds.length) return json({ error: "Άκυρες θέσεις" }, 400);
      for (const s of seats) {
        if (s.channel !== "online") return json({ error: `Η θέση ${s.seat_label} δεν διατίθεται online` }, 409);
        if (s.status !== "free") return json({ error: `Η θέση ${s.seat_label} πουλήθηκε` }, 409);
      }
      const { data: held } = await db.from("seat_holds")
        .select("seat_id").in("seat_id", seatIds).gt("expires_at", new Date().toISOString());
      if (held && held.length) return json({ error: "Κάποια θέση δεσμεύεται ήδη — δοκιμάστε άλλη" }, 409);
    }

    const amountCents = items.reduce((s: number, i: any) => s + (ttMap.get(i.ticketTypeId)!.price_cents), 0);
    const holdToken = crypto.randomUUID();
    const expires = new Date(Date.now() + HOLD_MINUTES * 60000).toISOString();

    // Order (pending)
    const { data: order, error: oe } = await db.from("orders").insert({
      show_id: showId, hold_token: holdToken,
      customer_name: customer.name ?? null, customer_email: customer.email,
      customer_phone: customer.phone ?? null, amount_cents: amountCents, status: "pending",
    }).select("id").single();
    if (oe || !order) return json({ error: "Αποτυχία δημιουργίας παραγγελίας" }, 500);

    // Holds (μοναδικός δείκτης seat_holds(seat_id) πιάνει races → 23505)
    if (seatIds.length) {
      const { error: he } = await db.from("seat_holds").insert(
        seatIds.map((id: number) => ({ show_id: showId, seat_id: id, hold_token: holdToken, expires_at: expires })),
      );
      if (he) {
        await db.from("orders").delete().eq("id", order.id);
        return json({ error: "Κάποια θέση μόλις δεσμεύτηκε — δοκιμάστε ξανά" }, 409);
      }
    }

    // Order items
    await db.from("order_items").insert(items.map((i: any) => ({
      order_id: order.id, ticket_type_id: i.ticketTypeId,
      seat_id: i.seatId ?? null, price_cents: ttMap.get(i.ticketTypeId)!.price_cents,
    })));

    // Viva order
    const viva = new Viva();
    const { orderCode, checkoutUrl } = await viva.createOrder(amountCents, {
      customerTrns: `${show.title}`, merchantTrns: `Order ${order.id}`,
      email: customer.email, fullName: customer.name, phone: customer.phone,
    });
    await db.from("orders").update({ viva_order_code: orderCode }).eq("id", order.id);

    return json({ orderId: order.id, orderCode, checkoutUrl, statusToken: holdToken });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
