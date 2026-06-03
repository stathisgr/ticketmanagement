import { useEffect, useMemo, useState } from 'react';
import { api, getStation, type PaymentMethod, type Seat, type Show, type ShowTicketType, type Customer } from '../api';
import CustomerPicker from '../components/CustomerPicker';
import { printTickets } from '../components/printTicket';
import VivaPay from '../components/VivaPay';

const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

/** π.χ. "Δευτέρα 1/7/2026" */
function formatGreekDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  const wd = new Intl.DateTimeFormat('el-GR', { weekday: 'long' }).format(d);
  return `${wd} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

const PAYMENTS: { id: PaymentMethod; label: string; color: string }[] = [
  { id: 'cash', label: 'Μετρητά', color: 'bg-green-600' },
  { id: 'card', label: 'Κάρτα', color: 'bg-yellow-500' },
];

export default function SeatPOS() {
  const [date, setDate] = useState(today());
  const [shows, setShows] = useState<Show[]>([]);
  const [show, setShow] = useState<Show | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [types, setTypes] = useState<ShowTicketType[]>([]);
  const [activeType, setActiveType] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<number, number>>({}); // seatId -> show_ticket_type_id
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [viva, setViva] = useState<{ provider: string; hasTerminal: boolean }>({ provider: 'none', hasTerminal: false });
  const [pendingPay, setPendingPay] = useState<{ amount: number; run: () => void } | null>(null);

  async function loadShows(d: string) {
    setShow(null); setSeats([]); setSelected({});
    try { setShows(await api.get<Show[]>(`/api/shows?date=${d}`)); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    loadShows(date);
    api.get<{ provider: string; hasTerminal: boolean }>('/api/pos/enabled').then(setViva).catch(() => {});
    /* eslint-disable-next-line */
  }, []);

  async function openShow(s: Show) {
    setError(''); setMsg(''); setSelected({});
    const res = await api.get<{ seats: Seat[]; ticketTypes: ShowTicketType[] }>(`/api/shows/${s.id}/availability?date=${date}`);
    setShow(s); setSeats(res.seats); setTypes(res.ticketTypes);
    setActiveType(res.ticketTypes[0]?.id ?? null);
  }

  function toggleSeat(seat: Seat) {
    if (seat.kind !== 'seat' || seat.sold || activeType == null) return;
    setSelected((prev) => {
      const next = { ...prev };
      if (next[seat.id]) delete next[seat.id];
      else next[seat.id] = activeType;
      return next;
    });
  }

  const total = useMemo(() => {
    return Object.values(selected).reduce((sum, sttId) => {
      const t = types.find((x) => x.id === sttId);
      return sum + (t?.price ?? 0);
    }, 0);
  }, [selected, types]);

  function issue() {
    const items = Object.entries(selected).map(([seatId, sttId]) => ({ seat_id: Number(seatId), show_ticket_type_id: sttId }));
    if (!items.length) return;
    // Κάρτα + Viva → πρώτα χρέωση, μετά έκδοση.
    if (payment === 'card' && viva.provider === 'viva') { setPendingPay({ amount: total, run: () => doIssue(items) }); return; }
    doIssue(items);
  }

  async function doIssue(items: { seat_id: number; show_ticket_type_id: number }[]) {
    setBusy(true); setError(''); setMsg('');
    try {
      const res = await api.post<{ saleId: number; total: number; tickets: { preview: string }[]; printTicket?: boolean }>('/api/sales', {
        items, payment_method: payment, show_date: date, customer_id: customer?.id ?? null, station: getStation(),
      });
      if (res.printTicket !== false) printTickets((res.tickets ?? []).map((t) => t.preview));
      setMsg(`✓ Πώληση #${res.saleId} — ${res.total.toFixed(2)} € (${items.length} θέσεις)`);
      if (show) await openShow(show); // ανανέωση διαθεσιμότητας
    } catch (e) {
      setError((e as Error).message);
      if (show) await openShow(show);
    } finally { setBusy(false); }
  }

  const rows = Math.max(0, ...seats.map((s) => s.y + 1));
  const cols = Math.max(0, ...seats.map((s) => s.x + 1));
  const grid: (Seat | null)[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => seats.find((s) => s.y === y && s.x === x) ?? null)
  );

  return (
    <div className="h-full flex">
      {/* Αριστερά: ημερομηνία + λίστα θεαμάτων */}
      <div className="w-72 bg-white border-r p-3 shrink-0 overflow-auto">
        <label className="text-sm block mb-1">Ημερομηνία
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); loadShows(e.target.value); }}
            className="block border rounded px-2 py-1 w-full" /></label>
        <div className="text-base font-semibold capitalize mb-3 text-slate-700">{formatGreekDate(date)}</div>
        <h3 className="font-semibold text-gray-700 mb-1">Θεάματα</h3>
        {shows.length === 0 && <div className="text-gray-400 text-sm">Κανένα θέαμα αυτή τη μέρα.</div>}
        <ul className="space-y-1">
          {shows.map((s) => (
            <li key={s.id}>
              <button onClick={() => openShow(s)}
                className={`w-full text-left px-3 py-2 rounded ${show?.id === s.id ? 'bg-slate-200' : 'hover:bg-gray-100'}`}>
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-gray-500">{(s.start_time ?? '').slice(0, 5)}{s.end_time ? '–' + s.end_time.slice(0, 5) : ''} · {s.hall_name}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Κέντρο: χάρτης θέσεων */}
      <div className="flex-1 p-4 overflow-auto">
        {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-2">{error}</div>}
        {msg && <div className="bg-green-100 text-green-700 p-2 rounded mb-2">{msg}</div>}
        {!show && <div className="text-gray-400">Διάλεξε θέαμα από αριστερά.</div>}
        {show && (
          <>
            <div className="text-center text-sm text-gray-500 mb-2 border-b pb-1">ΟΘΟΝΗ / ΣΚΗΝΗ</div>
            <div className="inline-block">
              {grid.map((row, y) => (
                <div key={y} className="flex gap-1 mb-1 items-center">
                  <span className="w-6 text-xs text-gray-400 text-right mr-1">{row.find((c) => c)?.row_label ?? ''}</span>
                  {row.map((cell, x) => {
                    if (!cell || cell.kind !== 'seat') return <span key={x} className="w-8 h-8" />;
                    const isSel = !!selected[cell.id];
                    const cls = cell.sold ? 'bg-gray-300 text-gray-400 cursor-not-allowed'
                      : isSel ? 'bg-slate-800 text-white' : 'bg-emerald-500 text-white hover:bg-emerald-600';
                    return (
                      <button key={x} disabled={!!cell.sold} onClick={() => toggleSeat(cell)} title={cell.display_name ?? ''}
                        className={`w-8 h-8 rounded text-[10px] ${cls}`}>{cell.col_label}</button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-3 text-xs text-gray-600">
              <span className="flex items-center gap-1"><i className="w-3 h-3 bg-emerald-500 inline-block rounded" /> Διαθέσιμη</span>
              <span className="flex items-center gap-1"><i className="w-3 h-3 bg-slate-800 inline-block rounded" /> Επιλεγμένη</span>
              <span className="flex items-center gap-1"><i className="w-3 h-3 bg-gray-300 inline-block rounded" /> Πουλημένη</span>
            </div>
          </>
        )}
      </div>

      {/* Δεξιά: είδος / πληρωμή / έκδοση */}
      {show && (
        <div className="w-80 bg-white border-l p-3 shrink-0 flex flex-col">
          <CustomerPicker value={customer} onChange={setCustomer} />
          <h3 className="font-semibold text-gray-700 mb-1">Είδος εισιτηρίου</h3>
          <div className="space-y-1 mb-3">
            {types.map((t) => (
              <button key={t.id} onClick={() => setActiveType(t.id)}
                className={`w-full flex justify-between px-3 py-2 rounded border ${activeType === t.id ? 'ring-2 ring-slate-700 bg-slate-50' : ''}`}>
                <span>{t.title}</span><span className="font-semibold">{t.price.toFixed(2)} €</span>
              </button>
            ))}
            {types.length === 0 && <div className="text-gray-400 text-sm">Το θέαμα δεν έχει είδη εισιτηρίων.</div>}
          </div>
          <p className="text-xs text-gray-500 mb-2">Διάλεξε είδος και μετά πάτα θέσεις. Οι νέες επιλογές παίρνουν το ενεργό είδος.</p>

          <div className="mt-auto">
            <div className="flex justify-between text-sm mb-1"><span>Επιλεγμένες θέσεις:</span><span>{Object.keys(selected).length}</span></div>
            <div className="text-right text-2xl font-bold mb-2">{total.toFixed(2)} €</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {PAYMENTS.map((p) => (
                <button key={p.id} onClick={() => setPayment(p.id)}
                  className={`py-2 rounded text-white text-sm font-medium ${p.color} ${payment === p.id ? 'ring-4 ring-slate-700' : 'opacity-70'}`}>{p.label}</button>
              ))}
            </div>
            <button onClick={issue} disabled={busy || Object.keys(selected).length === 0}
              className="w-full bg-slate-800 text-white py-4 rounded-lg text-xl font-bold hover:bg-slate-700 disabled:opacity-40">
              {busy ? 'Έκδοση…' : 'ΕΚΔΟΣΗ'}
            </button>
          </div>
        </div>
      )}

      {pendingPay && (
        <VivaPay amount={pendingPay.amount} hasTerminal={viva.hasTerminal}
          onPaid={() => { const run = pendingPay.run; setPendingPay(null); run(); }}
          onCancel={() => setPendingPay(null)} />
      )}
    </div>
  );
}
