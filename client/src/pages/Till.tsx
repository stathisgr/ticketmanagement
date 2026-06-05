import { useEffect, useState } from 'react';
import { api, getStation, dmy, type TillSummary } from '../api';
import { printTickets } from '../components/printTicket';
import DateField from '../components/DateField';

const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

interface TicketRow {
  id: number; serial: string; datetime: string; payment_method: string;
  title: string; unit_price: number; seat?: string; show_title?: string; username?: string; show_date?: string; checked_in_at?: string | null;
  cancelled_at?: string | null; cancel_reason?: string | null; cancel_approver?: string | null;
}

export default function Till({ role }: { role: 'manager' | 'cashier' | 'checker' }) {
  const isManager = role === 'manager';
  const [tab, setTab] = useState<'summary' | 'tickets'>('summary');
  const [kind, setKind] = useState<'all' | 'service' | 'product'>('service');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [summary, setSummary] = useState<TillSummary | null>(null);
  const [byType, setByType] = useState<{ title: string; qty: number; total: number }[]>([]);
  const [byTypeProd, setByTypeProd] = useState<{ title: string; qty: number; total: number }[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TicketRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelApprover, setCancelApprover] = useState('');
  const [error, setError] = useState('');

  const qFrom = isManager ? from : today();
  const qTo = isManager ? to : today();

  async function loadSummary() {
    setError('');
    try {
      const s = await api.get<TillSummary>(`/api/till/summary?from=${qFrom}&to=${qTo}&kind=${kind}`);
      setSummary(s);
      if (isManager) {
        setByType(await api.get<typeof byType>(`/api/till/by-type?from=${qFrom}&to=${qTo}&kind=service`));
        setByTypeProd(await api.get<typeof byType>(`/api/till/by-type?from=${qFrom}&to=${qTo}&kind=product`));
      }
    } catch (e) { setError((e as Error).message); }
  }
  async function loadTickets() {
    setError('');
    try { setTickets(await api.get<TicketRow[]>(`/api/tickets?from=${qFrom}&to=${qTo}&kind=${kind}`)); }
    catch (e) { setError((e as Error).message); }
  }
  function refresh() { tab === 'summary' ? loadSummary() : loadTickets(); }

  useEffect(() => { tab === 'summary' ? loadSummary() : loadTickets(); /* eslint-disable-next-line */ }, [kind, tab]);

  // Ημ. που αφορά το εισιτήριο: ημ. εκδήλωσης, αλλιώς ημ. πώλησης (λιανική POS).
  function ticketEventDate(t: TicketRow): string {
    return (t.show_date || (t.datetime ?? '').slice(0, 10) || '').slice(0, 10);
  }
  const isPastTicket = (t: TicketRow) => { const d = ticketEventDate(t); return !!d && d < today(); };

  async function doCancel() {
    const t = cancelTarget; if (!t) return;
    const reason = cancelReason.trim();
    if (!reason) { setError('Απαιτείται αιτία ακύρωσης'); return; }
    const past = isPastTicket(t);
    if (past && !cancelApprover.trim()) { setError('Απαιτείται Ονοματεπώνυμο Εγκρίνοντος'); return; }
    try {
      const r = await api.post<{ refund: number }>(`/api/tickets/${t.id}/cancel`,
        { reason, approver: past ? cancelApprover.trim() : undefined });
      setError(`✓ Ακυρώθηκε το ${t.serial} — επιστροφή ${Number(r.refund).toFixed(2)} €`);
      setCancelTarget(null); setCancelReason(''); setCancelApprover('');
      loadTickets(); loadSummary();
    } catch (e) { setError((e as Error).message); }
  }

  async function reprint(id: number) {
    try {
      const res = await api.post<{ preview: string; printTicket?: boolean; dispatched?: boolean }>(`/api/tickets/${id}/reprint`, { station: getStation() });
      if (res.dispatched) setError('✓ Επανεκτύπωση στάλθηκε στον εκτυπωτή');
      else if (res.printTicket !== false) printTickets([res.preview]);
      else setPreview(res.preview);
      loadTickets();
    } catch (e) { setError((e as Error).message); }
  }

  const m = summary?.byMethod;

  function exportCsv() {
    if (!summary) return;
    const rows = [
      `Ταμείο;${qFrom};${qTo}`, '',
      'Τρόπος πληρωμής;Πωλήσεις;Τζίρος',
      `Μετρητά;${m!.cash.count};${m!.cash.total.toFixed(2)}`,
      `Κάρτα;${m!.card.count};${m!.card.total.toFixed(2)}`,
      `ΣΥΝΟΛΟ;${summary.grandCount};${summary.grandTotal.toFixed(2)}`, '',
      'ΥΠΗΡΕΣΙΕΣ / ΕΙΣΙΤΗΡΙΑ', 'Εισιτήριο;Τεμάχια;Τζίρος',
      ...byType.map((r) => `${r.title};${r.qty};${r.total.toFixed(2)}`), '',
      'ΠΡΟΪΟΝΤΑ', 'Προϊόν;Τεμάχια;Τζίρος',
      ...byTypeProd.map((r) => `${r.title};${r.qty};${r.total.toFixed(2)}`),
    ];
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `tameio_${qFrom}_${qTo}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex gap-1 border-b mb-4">
        <button onClick={() => setTab('summary')} className={`px-4 py-2 -mb-px border-b-2 ${tab === 'summary' ? 'border-slate-800 font-semibold' : 'border-transparent text-gray-500'}`}>Σύνοψη</button>
        <button onClick={() => setTab('tickets')} className={`px-4 py-2 -mb-px border-b-2 ${tab === 'tickets' ? 'border-slate-800 font-semibold' : 'border-transparent text-gray-500'}`}>Εκδοθέντα εισιτήρια</button>
      </div>

      <div className="flex items-center gap-2 mb-3 text-sm">
        <span className="text-gray-500">Είδος:</span>
        {([['service', 'Υπηρεσίες'], ['product', 'Προϊόντα'], ['all', 'Όλα']] as const).map(([v, lbl]) => (
          <button key={v} onClick={() => setKind(v)}
            className={`px-3 py-1 rounded border ${kind === v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600'}`}>{lbl}</button>
        ))}
      </div>

      {isManager ? (
        <div className="flex items-end gap-2 mb-4 flex-wrap">
          <label className="text-sm">Από<span className="block"><DateField value={from} onChange={setFrom} /></span></label>
          <label className="text-sm">Έως<span className="block"><DateField value={to} onChange={setTo} /></span></label>
          <button onClick={refresh} className="bg-slate-800 text-white px-4 py-1.5 rounded">Εμφάνιση</button>
          {tab === 'summary' && <button onClick={exportCsv} disabled={!summary} className="bg-emerald-600 text-white px-4 py-1.5 rounded disabled:opacity-40">Εξαγωγή CSV</button>}
        </div>
      ) : (
        <div className="mb-4 text-sm text-gray-600">Ημερήσιο ταμείο — {dmy(today())}</div>
      )}

      {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-2">{error}</div>}

      {tab === 'summary' && summary && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Card label="Μετρητά" value={m!.cash.total} count={m!.cash.count} color="bg-green-100" />
            <Card label="Κάρτα" value={m!.card.total} count={m!.card.count} color="bg-yellow-100" />
            <Card label="ΣΥΝΟΛΟ" value={summary.grandTotal} count={summary.grandCount} color="bg-slate-200" />
          </div>
          {isManager && (
            <div className="mb-4">
              <h3 className="font-semibold mb-2">Υπηρεσίες / Εισιτήρια — ανά τύπο</h3>
              <table className="w-full border text-sm">
                <thead className="bg-gray-100"><tr><th className="text-left p-2">Εισιτήριο</th><th className="text-right p-2">Τεμάχια</th><th className="text-right p-2">Τζίρος</th></tr></thead>
                <tbody>
                  {byType.map((r, i) => (<tr key={i} className="border-t"><td className="p-2">{r.title}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2 text-right">{r.total.toFixed(2)} €</td></tr>))}
                  {byType.length === 0 && <tr><td colSpan={3} className="p-2 text-gray-400">Καμία υπηρεσία.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {isManager && (
            <div>
              <h3 className="font-semibold mb-2">Προϊόντα — ανά είδος</h3>
              <table className="w-full border text-sm">
                <thead className="bg-gray-100"><tr><th className="text-left p-2">Προϊόν</th><th className="text-right p-2">Τεμάχια</th><th className="text-right p-2">Τζίρος</th></tr></thead>
                <tbody>
                  {byTypeProd.map((r, i) => (<tr key={i} className="border-t"><td className="p-2">{r.title}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2 text-right">{r.total.toFixed(2)} €</td></tr>))}
                  {byTypeProd.length === 0 && <tr><td colSpan={3} className="p-2 text-gray-400">Κανένα προϊόν.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'tickets' && (
        <table className="w-full border text-sm bg-white">
          <thead className="bg-gray-100"><tr>
            <th className="text-left p-2">Ώρα</th><th className="text-left p-2">Σειρά</th>
            <th className="text-left p-2">Εισιτήριο</th><th className="text-left p-2">Θέση/Θέαμα</th>
            <th className="text-right p-2">Τιμή</th><th className="text-center p-2">Τρόπος</th>
            <th className="text-center p-2">Είσοδος</th>
            {isManager && <th className="text-left p-2">Χρήστης</th>}<th></th>
          </tr></thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className={`border-t ${t.cancelled_at ? 'bg-red-50 text-gray-400 line-through' : ''}`}>
                <td className="p-2">{(t.datetime ?? '').slice(11, 16)}</td>
                <td className="p-2 font-mono">{t.serial}
                  {t.cancelled_at && <span className="ml-1 no-underline inline-block px-1.5 py-0.5 rounded bg-red-200 text-red-800 text-[10px] align-middle" title={t.cancel_reason ?? ''}>ΑΚΥΡΩΘΕΝ</span>}
                </td>
                <td className="p-2">{t.title}</td>
                <td className="p-2 text-gray-600">{t.seat ? `${t.seat}` : ''}{t.show_title ? ` · ${t.show_title}` : ''}{t.show_date ? ` (${dmy(t.show_date)})` : ''}</td>
                <td className="p-2 text-right">{t.unit_price.toFixed(2)} €</td>
                <td className="p-2 text-center">{t.payment_method === 'cash' ? 'Μετρητά' : t.payment_method === 'card' ? 'Κάρτα' : t.payment_method}</td>
                <td className="p-2 text-center">
                  {t.checked_in_at
                    ? <span className="px-2 py-0.5 rounded bg-green-100 text-green-700" title={`Μπήκε: ${t.checked_in_at}`}>✓</span>
                    : <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">—</span>}
                </td>
                {isManager && <td className="p-2">{t.username}</td>}
                <td className="p-2 text-right whitespace-nowrap no-underline">
                  {!t.cancelled_at && <button onClick={() => reprint(t.id)} className="text-blue-600 mr-2">Επανεκτύπωση</button>}
                  {isManager && !t.cancelled_at && <button onClick={() => { setCancelTarget(t); setCancelReason(''); setCancelApprover(''); setError(''); }} className="text-red-600">Ακύρωση</button>}
                  {t.cancelled_at && <span className="text-gray-400 text-xs">ακυρωμένο</span>}
                </td>
              </tr>
            ))}
            {tickets.length === 0 && <tr><td colSpan={isManager ? 9 : 8} className="p-3 text-gray-400">Κανένα εισιτήριο.</td></tr>}
          </tbody>
        </table>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-xl p-5 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-2">Επανεκτύπωση</h3>
            <pre className="bg-gray-50 border rounded p-2 text-[10px] whitespace-pre-wrap">{preview}</pre>
            <div className="text-right mt-3"><button onClick={() => setPreview(null)} className="px-4 py-2 rounded bg-slate-800 text-white">Κλείσιμο</button></div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setCancelTarget(null)}>
          <div className="bg-white rounded-xl p-5 w-[26rem]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-2">Ακύρωση εισιτηρίου {cancelTarget.serial}</h3>
            {isPastTicket(cancelTarget) && (
              <div className="bg-red-600 text-white rounded-lg p-3 mb-3">
                <div className="font-bold">⚠ ΦΟΡΟΛΟΓΙΚΗ ΔΙΟΡΘΩΣΗ</div>
                <div className="text-sm mt-1">Η εκδήλωση ({dmy(ticketEventDate(cancelTarget))}) έχει <b>ΗΔΗ γίνει</b>. Η ακύρωση μεταβάλλει περασμένη περίοδο — απαιτείται έγκριση. Συνεννοηθείτε με τον λογιστή σας.</div>
              </div>
            )}
            <p className="text-sm text-gray-600 mb-3">Η αξία επιστρέφεται (αντιλογισμός) και αφαιρείται από έσοδα/ΦΠΑ. Το εισιτήριο διατηρείται με σήμανση «ΑΚΥΡΩΘΕΝ».</p>
            <label className="text-sm block mb-2"><span className="block text-gray-600 mb-1">Αιτία ακύρωσης *</span>
              <input className="w-full border rounded px-3 py-2" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus /></label>
            {isPastTicket(cancelTarget) && (
              <label className="text-sm block mb-2"><span className="block text-red-700 font-semibold mb-1">Ονοματεπώνυμο Εγκρίνοντος *</span>
                <input className="w-full border-2 border-red-400 rounded px-3 py-2" value={cancelApprover} onChange={(e) => setCancelApprover(e.target.value)} placeholder="π.χ. Όνομα Επώνυμο" /></label>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setCancelTarget(null)} className="px-4 py-2 rounded border">Άκυρο</button>
              <button onClick={doCancel} className="px-4 py-2 rounded bg-red-600 text-white">Ακύρωση εισιτηρίου</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, count, color }: { label: string; value: number; count: number; color: string }) {
  return (
    <div className={`${color} rounded-lg p-3`}>
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-2xl font-bold">{value.toFixed(2)} €</div>
      <div className="text-xs text-gray-500">{count} πωλήσεις</div>
    </div>
  );
}
