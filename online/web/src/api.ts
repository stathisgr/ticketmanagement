import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

const restHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

export interface Show {
  id: number; title: string; subtitle: string; venue_name: string;
  show_date: string; start_time: string; end_time?: string | null; seating_mode: string;
  brand_color: string; sales_close_at: string | null;
  image_url?: string | null; description?: string | null;
  online_capacity?: number | null; online_sold?: number | null;
}
export interface TicketType { id: number; title: string; price_cents: number; sort: number; }
export interface SeatAvail { seat_id: number; x: number; y: number; kind: string; zone: string; row_label: string; seat_label: string; available: boolean; }

// --- PostgREST ---
export async function listShows(): Promise<Show[]> {
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/shows?select=*&enabled=eq.true&show_date=gte.${today}&order=show_date,start_time`,
    { headers: restHeaders },
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listTicketTypes(showId: number): Promise<TicketType[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ticket_types?select=*&enabled=eq.true&show_id=eq.${showId}&order=sort`,
    { headers: restHeaders },
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function seatAvailability(showId: number): Promise<SeatAvail[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_seat_availability`, {
    method: "POST", headers: restHeaders, body: JSON.stringify({ p_show_id: showId }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// --- Edge Functions ---
export interface CreateOrderResult { orderId: number; orderCode: string; checkoutUrl: string; statusToken: string; }
export async function createOrder(payload: {
  showId: number;
  items: { seatId?: number | null; ticketTypeId: number }[];
  customer: { name: string; email: string; phone: string };
}): Promise<CreateOrderResult> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-order`, {
    method: "POST", headers: restHeaders, body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Σφάλμα δημιουργίας παραγγελίας");
  return j;
}

export interface ResumeResult { orderId?: number; checkoutUrl?: string; statusToken?: string; title?: string; alreadyPaid?: boolean; seatsGone?: boolean; error?: string; }
/** Επανενεργοποίηση ημιτελούς παραγγελίας από το email υπενθύμισης (νέο Viva order). */
export async function resumeOrder(orderId: number, token: string): Promise<ResumeResult> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/resume-order`, {
    method: "POST", headers: restHeaders, body: JSON.stringify({ orderId, token }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.alreadyPaid && !j.seatsGone) throw new Error(j.error || "Σφάλμα ανάκτησης παραγγελίας");
  return j;
}

export interface OrderStatus { status: string; tickets: { serial: string; url: string }[]; }
export async function orderStatus(orderId: number, token: string): Promise<OrderStatus> {
  const r = await fetch(
    `${SUPABASE_URL}/functions/v1/order-status?orderId=${orderId}&token=${encodeURIComponent(token)}`,
    { headers: restHeaders },
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export interface TicketView {
  venueName: string; showTitle: string; showSubtitle: string; date: string; time: string;
  seat: string; ticketType: string; holder: string; price: string; serial: string;
  brandColor: string; legal: string; qr: string;
}
export async function getTicket(uid: string): Promise<TicketView> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ticket-data?uid=${encodeURIComponent(uid)}`, { headers: restHeaders });
  if (!r.ok) throw new Error("Το εισιτήριο δεν βρέθηκε");
  return r.json();
}

export const eur = (cents: number) => (cents / 100).toFixed(2).replace(".", ",") + " €";

export function dateGr(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    const wd = new Intl.DateTimeFormat("el-GR", { weekday: "long" }).format(d);
    return `${wd} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch { return iso; }
}
