// GET /functions/v1/order-status?orderId=..&token=<hold_token>
// → { status, tickets:[{serial, url}] }   (token = capability guard)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);
  const orderId = u.searchParams.get("orderId");
  const token = u.searchParams.get("token");
  if (!orderId || !token) return json({ error: "orderId & token required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: order } = await db.from("orders")
    .select("id, status, hold_token").eq("id", orderId).single();
  if (!order || order.hold_token !== token) return json({ error: "not found" }, 404);

  let tickets: { serial: string; url: string }[] = [];
  if (order.status === "paid") {
    const base = Deno.env.get("SUPABASE_URL")!;
    const { data: ts } = await db.from("tickets").select("serial, serial_uid").eq("order_id", order.id);
    tickets = (ts ?? []).map((t: any) => ({ serial: t.serial, url: `${base}/functions/v1/ticket?uid=${t.serial_uid}` }));
  }
  return json({ status: order.status, tickets });
});
