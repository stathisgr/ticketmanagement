// Λεπτός API client με JWT token (in-memory + sessionStorage fallback).
let token: string | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function getToken(): string | null {
  return token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  // Content-Type μόνο όταν υπάρχει body (αλλιώς το Fastify απορρίπτει κενό JSON body, π.χ. σε DELETE).
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // Ληγμένο/άκυρο token (π.χ. session > 12h): καθάρισε & γύρνα στη σύνδεση αντί να «κολλάει» σε 401.
  if (res.status === 401 && path !== '/api/login') {
    token = null;
    try { sessionStorage.removeItem('tm_session'); } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.location.reload();
    throw new Error('Η σύνδεση έληξε — συνδέσου ξανά.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Σφάλμα διακομιστή');
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

// ---- Τύποι ----
export interface User { id: number; username: string; role: 'manager' | 'cashier' | 'checker'; full_name?: string; }
export interface TicketType {
  id: number; title: string; subtitle?: string; price: number; default_qty: number;
  vat_rate: number; default_payment: 'cash' | 'card' | 'bank' | 'prompt'; enabled: number;
  sort_order: number; color?: string; icon?: string; receipt_limit?: number;
  series_prefix?: string; series_next?: number;
  kind?: number; // 0 = Υπηρεσία (εισιτήριο), 1 = Εμπορικό προϊόν
}
export type PaymentMethod = 'cash' | 'card';
export interface TillSummary {
  from: string; to: string; grandTotal: number; grandCount: number;
  byMethod: Record<PaymentMethod, { count: number; total: number }>;
}

export interface Venue {
  id: number; name: string; vat_number?: string; tax_office?: string; address?: string;
  postal_code?: string; city?: string; phone?: string; email?: string; default_vat: number;
  pos_mode: 'serial' | 'halls' | 'both'; default_printer_type: 'escpos58' | 'escpos80' | 'zpl';
  numbering_mode: 'unified' | 'per_type'; serial_next: number; serial_width: number;
  checkin_window_min?: number;
}
export interface FiscalConfig {
  id: number; mode: 'none' | 'cash_register_file' | 'e_invoicing';
  issue_mode?: 'disabled' | 'ticket_only' | 'cash_register' | 'provider';
  legal_note?: string; export_folder?: string; provider?: string; config?: string;
  pos_provider?: 'none' | 'viva'; pos_config?: string;
}

/** Μορφή ημερομηνίας ΗΗ/ΜΜ/ΕΕΕΕ από ISO 'YYYY-MM-DD' (ή ISO datetime). */
export function dmy(iso?: string | null): string {
  if (!iso) return '';
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
/** ISO 'YYYY-MM-DD' → 'ΗΗ/ΜΜ/ΕΕΕΕ' (alias) · και αντίστροφα. */
export function isoToDmy(iso?: string | null): string { return dmy(iso); }
export function dmyToIso(s: string): string | null {
  const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Όνομα σταθμού (ταμείου) — αποθηκεύεται τοπικά στον browser. */
export function getStation(): string { try { return localStorage.getItem('tm_station') || ''; } catch { return ''; } }
export function setStation(name: string) { try { localStorage.setItem('tm_station', name); } catch { /* ignore */ } }
export interface Printer {
  id: number; name: string; type: 'escpos58' | 'escpos80' | 'zpl';
  connection: 'usb' | 'network' | 'system' | 'file'; address?: string;
  copies: number; auto_cut: number; drawer_kick: number; is_default: number;
}
export interface Station { id: number; name: string; printer_id?: number | null; printer_name?: string; }
export interface Customer {
  id: number; full_name: string; address?: string; postal_code?: string; city?: string;
  vat_number?: string; email?: string; phone1?: string; phone2?: string; notes?: string;
  marketing_opt_in: number; is_default?: number; created_at?: string; purchases?: number;
}
export interface PrintTemplate {
  id: number; name: string; printer_type: 'escpos58' | 'escpos80' | 'zpl';
  header?: string; details?: string; footer?: string; params?: string;
}

// ---- Φάση 2 ----
export interface Hall { id: number; name: string; rows: number; cols: number; enabled: number; seat_count?: number; locked?: number; }
export interface Seat {
  id: number; hall_id: number; y: number; x: number;
  row_label?: string; col_label?: string; display_name?: string;
  kind: 'seat' | 'aisle' | 'gap'; enabled: number; sold?: number;
}
export interface Show {
  id: number; hall_id: number; hall_name?: string; title: string;
  starts_at?: string; ends_at?: string; start_time?: string; end_time?: string;
  valid_from?: string; valid_to?: string;
}
export interface ShowTicketType {
  id: number; show_id: number; ticket_type_id?: number; title: string;
  price: number; vat_rate: number; sort_order: number;
}
