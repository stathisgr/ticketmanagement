import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Modal χρέωσης κάρτας μέσω Viva. Δημιουργεί order (Smart Checkout) — και προαιρετικά
 * το προωθεί σε φυσικό τερματικό — και κάνει polling την κατάσταση μέχρι να πληρωθεί.
 * onPaid() καλείται μόλις StateId = 3 (ή με χειροκίνητη επιβεβαίωση).
 */
export default function VivaPay({ amount, hasTerminal, onPaid, onCancel }:
  { amount: number; hasTerminal: boolean; onPaid: (transactionId?: string) => void; onCancel: () => void }) {
  const [status, setStatus] = useState('Δημιουργία πληρωμής…');
  const [url, setUrl] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [err, setErr] = useState('');
  const timer = useRef<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.post<{ orderCode: string; checkoutUrl: string }>('/api/pos/checkout', {
          amount, merchantTrns: 'Εισιτήρια', customerTrns: 'Πληρωμή εισιτηρίων', toTerminal: hasTerminal,
        });
        setOrderCode(r.orderCode); setUrl(r.checkoutUrl);
        setStatus(hasTerminal ? 'Στάλθηκε στο τερματικό — αναμονή πληρωμής…' : 'Αναμονή πληρωμής (σάρωσε QR ή άνοιξε τον σύνδεσμο)…');
        timer.current = setInterval(async () => {
          try {
            const s = await api.get<{ paid: boolean; stateId: number | null; transactionId?: string }>(`/api/pos/order-status?orderCode=${r.orderCode}`);
            if (s.paid) { clearInterval(timer.current); setStatus('✓ Πληρώθηκε'); onPaid(s.transactionId); }
          } catch { /* keep polling */ }
        }, 3000);
      } catch (e) { setErr((e as Error).message); }
    })();
    return () => clearInterval(timer.current);
    // eslint-disable-next-line
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-20" onClick={onCancel}>
      <div className="bg-white rounded-xl p-5 w-96 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg mb-1">Πληρωμή με κάρτα (Viva)</h3>
        <div className="text-2xl font-bold mb-2">{amount.toFixed(2)} €</div>
        {err ? <div className="bg-red-100 text-red-700 p-2 rounded text-sm">{err}</div> : <div className="text-sm text-gray-600 mb-3">{status}</div>}
        {/* Με φυσικό τερματικό/SoftPOS η πληρωμή γίνεται στη συσκευή — ΔΕΝ ανοίγουμε web σελίδα (που θα έκανε redirect). */}
        {hasTerminal && !err && (
          <div className="mb-3 text-sm text-gray-700 bg-slate-50 border rounded p-3">
            💳 Η πληρωμή ολοκληρώνεται στο τερματικό/SoftPOS. Μόλις πληρωθεί, εκδίδεται αυτόματα το εισιτήριο.
          </div>
        )}
        {url && !hasTerminal && (
          <div className="mb-3">
            <img alt="QR" className="mx-auto border rounded" width={180} height={180}
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`} />
            <div className="text-xs text-gray-500 mt-1">Ο πελάτης σαρώνει το QR με το κινητό του για να πληρώσει (μην ανοίγετε τον σύνδεσμο στον υπολογιστή του ταμείου).</div>
          </div>
        )}
        <div className="flex gap-2 justify-center">
          <button onClick={onCancel} className="px-4 py-2 rounded border">Άκυρο</button>
          <button onClick={() => onPaid()} className="px-4 py-2 rounded bg-green-600 text-white">Πληρώθηκε → Έκδοση</button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Όταν ολοκληρωθεί η πληρωμή, το εισιτήριο εκδίδεται αυτόματα. Demo περιβάλλον.</p>
      </div>
    </div>
  );
}
