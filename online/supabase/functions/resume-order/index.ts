// POST /functions/v1/resume-order
// Body: { orderId, token }  (token = hold_token capability guard)
// → Επανενεργοποιεί ημιτελή (pending) παραγγελία: ξαναελέγχει διαθεσιμότητα, ξανακρατά θέσεις,
//   φτιάχνει ΝΕΟ Viva order και επιστρέφει { orderId, checkoutUrl, statusToken }.
//   Χρησιμοποιείται από το email υπενθύμισης («ολοκληρώστε την πληρωμή»).
import { createClient } from "npm:@supabase/supabase-js@2";
import { Viva } from "../_shared/viva.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const HOLD_MINUTES = 15; // λίγο μεγαλύτερο από το αρχικό (10') ώστε να προλάβει την πληρωμή

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { orderId, token } = await req.json();
    if (!orderId || !token) return json({ error: "orderId & token required" }, 400);

    // Παραγγελία + έλεγχος capability token
    const { data: order } = await db.from("orders")
      .select("id, show_id, hold_token, customer_name, customer_email, customer_phone, amount_cents, status")
      .eq("id", orderId).single();
    if (!order || order.hold_token !== token) return json({ error: "not found" }, 404);
    if (order.status === "paid") return json({ alreadyPaid: true });
    if (order.status !== "pending") return json({ error: "Η παραγγελία δεν είναι ενεργή." }, 409);

    // Θέαμα ανοιχτό;
    const { data: show } = await db.from("shows")
      .select("id, title, enabled, sales_close_at, seating_mode").eq("id", order.show_id).single();
    if (!show) return json({ error: "Το θέαμα δεν βρέθηκε" }, 404);
    if (!show.enabled) return json({ error: "Το θέαμα δεν είναι πλέον διαθέσιμο" }, 409);
    if (show.sales_close_at && new Date(show.sales_close_at) < new Date())
      return json({ error: "Οι online πωλήσεις έκλεισαν" }, 409);

    // Γραμμές παραγγελίας
    const { data: oitems } = await db.from("order_items")
      .select("seat_id, ticket_type_id, price_cents").eq("order_id", order.id);
    if (!oitems || !oitems.length) return json({ error: "Η παραγγελία δεν έχει είδη" }, 409);

    // Καθάρισε τυχόν δικά μας παλιά holds (ίδιο token) πριν τον επανέλεγχο
    await db.from("seat_holds").delete().eq("hold_token", token);

    const seatIds = oitems.map((i: any) => i.seat_id).filter(Boolean);
    if (show.seating_mode === "seated") {
      if (seatIds.length !== oitems.length) return json({ error: "Λείπει θέση σε seated θέαμα" }, 400);
      const { data: seats } = await db.from("seats")
        .select("id, status, channel, seat_label").in("id", seatIds).eq("show_id", order.show_id);
      if (!seats || seats.length !== seatIds.length) return json({ error: "Άκυρες θέσεις" }, 409);
      for (const s of seats) {
        if (s.channel !== "online") return json({ seatsGone: true, error: `Η θέση ${s.seat_label} δεν διατίθεται online` }, 409);
        if (s.status !== "free") return json({ seatsGone: true, error: `Η θέση ${s.seat_label} δεν είναι πλέον διαθέσιμη` }, 409);
      }
      // Κρατημένες από ΑΛΛΟΝ (όχι το δικό μας token, που μόλις καθαρίσαμε)
      const { data: held } = await db.from("seat_holds")
        .select("seat_id").in("seat_id", seatIds).gt("expires_at", new Date().toISOString());
      if (held && held.length) return json({ seatsGone: true, error: "Κάποια θέση δεσμεύεται ήδη — δοκιμάστε άλλη" }, 409);

      const expires = new Date(Date.now() + HOLD_MINUTES * 60000).toISOString();
      const { error: he } = await db.from("seat_holds").insert(
        seatIds.map((id: number) => ({ show_id: order.show_id, seat_id: id, hold_token: token, expires_at: expires })),
      );
      if (he) return json({ seatsGone: true, error: "Κάποια θέση μόλις δεσμεύτηκε — δοκιμάστε ξανά" }, 409);
    }

    // Νέο Viva order
    try {
      const viva = new Viva();
      const { orderCode, checkoutUrl } = await viva.createOrder(order.amount_cents, {
        customerTrns: `${show.title}`, merchantTrns: `Order ${order.id}`,
        email: order.customer_email, fullName: order.customer_name, phone: order.customer_phone,
      });
      await db.from("orders").update({ viva_order_code: orderCode }).eq("id", order.id);
      return json({ orderId: order.id, orderCode, checkoutUrl, statusToken: token, title: show.title });
    } catch (ve) {
      await db.from("seat_holds").delete().eq("hold_token", token);
      return json({ error: "Πρόβλημα με την πληρωμή (Viva): " + String((ve as Error).message) }, 502);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
