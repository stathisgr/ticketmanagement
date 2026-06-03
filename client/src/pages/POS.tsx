import { useMemo, useEffect, useState } from 'react';
import { api, getStation, type PaymentMethod, type TicketType, type Customer } from '../api';
import CustomerPicker from '../components/CustomerPicker';
import { printTickets } from '../components/printTicket';
import VivaPay from '../components/VivaPay';

interface CartLine { type: TicketType; qty: number; }
interface SaleResult { saleId: number; total: number; tickets: { preview: string }[]; receiptFile?: string | null; printTicket?: boolean; }

const PAYMENTS: { id: PaymentMethod; label: string; color: string }[] = [
  { id: 'cash', label: 'Μετρητά', color: 'bg-green-600' },
  { id: 'card', label: 'Κάρτα', color: 'bg-yellow-500' },
];
const payLabel = (p: string) => (p === 'cash' ? 'Μετρητά' : p === 'card' ? 'Κάρτα' : '');
const isPreset = (t: TicketType) => t.default_payment === 'cash' || t.default_payment === 'card';

export default function POS() {
  const [types, setTypes] = useState<TicketType[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [qty, setQty] = useState(1);
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viva, setViva] = useState<{ provider: string; hasTerminal: boolean }>({ provider: 'none', hasTerminal: false });
  const [pendingPay, setPendingPay] = useState<{ amount: number; run: () => void } | null>(null);

  useEffect(() => {
    api.get<TicketType[]>('/api/ticket-types?enabledOnly=1').then(setTypes).catch((e) => setError(e.message));
    api.get<{ provider: string; hasTerminal: boolean }>('/api/pos/enabled').then(setViva).catch(() => {});
  }, []);

  const total = useMemo(() => cart.reduce((s, l) => s + l.type.price * l.qty, 0), [cart]);

  function keypad(d: string) {
    if (d === 'C') return setQty(1);
    if (d === '⌫') return setQty((q) => Math.max(1, Math.floor(q / 10)) || 1);
    setQty((q) => { const n = Number(String(q === 1 ? '' : q) + d); return Math.min(999, Math.max(1, n)); });
  }

  async function issueSale(items: { ticket_type_id: number; qty: number }[], method: PaymentMethod) {
    setBusy(true); setError('');
    try {
      const res = await api.post<SaleResult>('/api/sales', { items, payment_method: method, customer_id: customer?.id ?? null, station: getStation() });
      setResult(res);
      if (res.printTicket !== false) printTickets(res.tickets.map((t) => t.preview));
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }

  // Πάτημα κουμπιού: αν έχει προεπιλεγμένο τρόπο → άμεση έκδοση· αλλιώς → προσθήκη στο καλάθι.
  // Αν πληρωμή με κάρτα & ενεργό Viva → πρώτα χρέωση, μετά έκδοση.
  function withCard(method: PaymentMethod, amount: number, run: () => void) {
    if (method === 'card' && viva.provider === 'viva') setPendingPay({ amount, run });
    else run();
  }

  async function tapTicket(t: TicketType) {
    if (busy) return;
    if (isPreset(t)) {
      const method = t.default_payment as PaymentMethod;
      withCard(method, t.price * qty, async () => { const ok = await issueSale([{ ticket_type_id: t.id, qty }], method); if (ok) setQty(1); });
    } else {
      setResult(null);
      setCart((prev) => {
        const ex = prev.find((l) => l.type.id === t.id);
        if (ex) return prev.map((l) => (l.type.id === t.id ? { ...l, qty: l.qty + qty } : l));
        return [...prev, { type: t, qty }];
      });
      setQty(1);
    }
  }

  async function issueCart() {
    if (!cart.length) return;
    withCard(payment, total, async () => {
      const ok = await issueSale(cart.map((l) => ({ ticket_type_id: l.type.id, qty: l.qty })), payment);
      if (ok) setCart([]);
    });
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 p-3 overflow-auto">
        {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-2">{error}</div>}
        <div className="grid grid-cols-3 gap-3">
          {types.map((t) => (
            <button key={t.id} onClick={() => tapTicket(t)} disabled={busy}
              className="rounded-lg border shadow-sm p-3 text-left h-28 flex flex-col hover:ring-2 hover:ring-slate-400 transition disabled:opacity-50 relative"
              style={{ background: t.color ?? '#f3f4f6' }}>
              <div className="font-bold text-lg leading-tight">{t.title}</div>
              <div className="text-sm text-gray-600">{t.subtitle}</div>
              {isPreset(t)
                ? <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-white/70 border">⚡ {payLabel(t.default_payment)}</span>
                : <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-white/50 border text-gray-500">➕ καλάθι</span>}
              <div className="mt-auto text-right font-bold text-xl">{t.price.toFixed(2)} €</div>
            </button>
          ))}
          {types.length === 0 && !error && <div className="text-gray-500 col-span-3">Δεν υπάρχουν ενεργά εισιτήρια. Πρόσθεσε από τις Ρυθμίσεις.</div>}
        </div>
      </div>

      <div className="w-96 bg-white border-l p-3 flex flex-col shrink-0">
        <CustomerPicker value={customer} onChange={setCustomer} />
        {/* Ποσότητα */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-gray-600">Ποσότητα:</span>
          <span className="text-3xl font-bold bg-green-100 px-3 py-1 rounded">{String(qty).padStart(2, '0')}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((d) => (
            <button key={d} onClick={() => keypad(d)} className="bg-gray-100 hover:bg-gray-200 rounded py-3 text-xl font-semibold">{d}</button>
          ))}
        </div>

        {/* Καλάθι (εισιτήρια χωρίς προεπιλογή πληρωμής) */}
        <div className="flex-1 overflow-auto mb-2 border-t pt-2">
          <h3 className="font-semibold text-gray-700 mb-1 text-sm">Προς έκδοση</h3>
          {cart.length === 0 && <div className="text-gray-400 text-xs">Τα εισιτήρια χωρίς προεπιλεγμένο τρόπο πληρωμής μπαίνουν εδώ. Διάλεξε ποσότητα, πάτησε εισιτήριο, μετά ΕΚΔΟΣΗ.</div>}
          {cart.map((l, i) => (
            <div key={i} className="flex items-center justify-between border-b py-1 text-sm">
              <span>{l.qty} × {l.type.title}</span>
              <span className="flex items-center gap-2">{(l.type.price * l.qty).toFixed(2)} €
                <button onClick={() => setCart((c) => c.filter((_, j) => j !== i))} className="text-red-500">✕</button>
              </span>
            </div>
          ))}
        </div>

        <div className="text-right text-2xl font-bold mb-2">Σύνολο: {total.toFixed(2)} €</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {PAYMENTS.map((p) => (
            <button key={p.id} onClick={() => setPayment(p.id)}
              className={`py-3 rounded text-white font-medium ${p.color} ${payment === p.id ? 'ring-4 ring-slate-700' : 'opacity-70'}`}>{p.label}</button>
          ))}
        </div>
        <button onClick={issueCart} disabled={busy || cart.length === 0}
          className="bg-slate-800 text-white py-4 rounded-lg text-xl font-bold hover:bg-slate-700 disabled:opacity-40">
          {busy ? 'Έκδοση…' : 'ΕΚΔΟΣΗ'}
        </button>

        {result && (
          <div className="mt-3 border-t pt-2 overflow-auto max-h-44">
            <div className="text-green-700 font-medium text-sm">✓ Πώληση #{result.saleId} — {result.total.toFixed(2)} €{result.receiptFile ? ' (απόδειξη στάλθηκε)' : ''}</div>
            {result.tickets.map((t, i) => (<pre key={i} className="bg-gray-50 border rounded p-2 mt-1 text-[10px] whitespace-pre-wrap">{t.preview}</pre>))}
          </div>
        )}
      </div>

      {pendingPay && (
        <VivaPay amount={pendingPay.amount} hasTerminal={viva.hasTerminal}
          onPaid={() => { const run = pendingPay.run; setPendingPay(null); run(); }}
          onCancel={() => setPendingPay(null)} />
      )}
    </div>
  );
}
