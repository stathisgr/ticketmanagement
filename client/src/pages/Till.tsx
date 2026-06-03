import { useEffect, useState } from 'react';
import { api, getStation, type TillSummary } from '../api';
import { printTickets } from '../components/printTicket';

const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

interface TicketRow {
  id: number; serial: string; datetime: string; payment_method: string;
  title: string; unit_price: number; seat?: string; show_title?: string; username?: string; show_date?: string; checked_in_at?: string | null;
}

export default function Till({ role }: { role: 'manager' | 'cashier' | 'checker' }) {
  const isManager = role === 'manager';
  const [tab, setTab] = useState<'summary' | 'tickets'>('summary');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [summary, setSummary] = useState<TillSummary | null>(null);
  const [byType, setByType] = useState<{ title: string; qty: number; total: number }[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');

  const qFrom = isManager ? from : today();
  const qTo = isManager ? to : today();

  async function loadSummary() {
    setError('');
    try {
      const s = await api.get<TillSummary>(`/api/till/summary?from=${qFrom}&to=${qTo}`);
      setSummary(s);
      if (isManager) setByType(await api.get<typeof byType>(`/api/till/by-type?from=${qFrom}&to=${qTo}`));
    } catch (e) { setError((e as Error).message); }
  }
  async function loadTickets() {
    setError('');
    try { setTickets(await api.get<TicketRow[]>(`/api/tickets?from=${qFrom}&to=${qTo}`)); }
    catch (e) { setError((e as Error).message); }
  }
  function refresh() { tab === 'summary' ? loadSummary() : loadTickets(); }

  useEffect(() => { loadSummary(); loadTickets(); /* eslint-disable-next-line */ }, []);

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
      'Εισιτήριο;Τεμάχια;Τζίρος',
      ...byType.map((r) => `${r.title};${r.qty};${r.total.toFixed(2)}`),
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

      {isManager ? (
        <div className="flex items-end gap-2 mb-4 flex-wrap">
          <label className="text-sm">Από<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block border rounded px-2 py-1" /></label>
          <label className="text-sm">Έως<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block border rounded px-2 py-1" /></label>
          <button onClick={refresh} className="bg-slate-800 text-white px-4 py-1.5 rounded">Εμφάνιση</button>
          {tab === 'summary' && <button onClick={exportCsv} disabled={!summary} className="bg-emerald-600 text-white px-4 py-1.5 rounded disabled:opacity-40">Εξαγωγή CSV</button>}
        </div>
      ) : (
        <div className="mb-4 text-sm text-gray-600">Ημερήσιο ταμείο — {today()}</div>
      )}

      {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-2">{error}</div>}

      {tab === 'summary' && summary && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Card label="Μετρητά" value={m!.cash.total} count={m!.cash.count} color="bg-green-100" />
            <Card label="Κάρτα" value={m!.card.total} count={m!.card.count} color="bg-yellow-100" />
            <Card label="ΣΥΝΟΛΟ" value={summary.grandTotal} count={summary.grandCount} color="bg-slate-200" />
          </div>
          {isManager && byType.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Ανάλυση ανά τύπο εισιτηρίου</h3>
              <table className="w-full border text-sm">
                <thead className="bg-gray-100"><tr><th className="text-left p-2">Εισιτήριο</th><th className="text-right p-2">Τεμάχια</th><th className="text-right p-2">Τζίρος</th></tr></thead>
                <tbody>{byType.map((r, i) => (<tr key={i} className="border-t"><td className="p-2">{r.title}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2 text-right">{r.total.toFixed(2)} €</td></tr>))}</tbody>
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
              <tr key={t.id} className="border-t">
                <td className="p-2">{(t.datetime ?? '').slice(11, 16)}</td>
                <td className="p-2 font-mono">{t.serial}</td>
                <td className="p-2">{t.title}</td>
                <td className="p-2 text-gray-600">{t.seat ? `${t.seat}` : ''}{t.show_title ? ` · ${t.show_title}` : ''}{t.show_date ? ` (${t.show_date})` : ''}</td>
                <td className="p-2 text-right">{t.unit_price.toFixed(2)} €</td>
                <td className="p-2 text-center">{t.payment_method === 'cash' ? 'Μετρητά' : t.payment_method === 'card' ? 'Κάρτα' : t.payment_method}</td>
                <td className="p-2 text-center">
                  {t.checked_in_at
                    ? <span className="px-2 py-0.5 rounded bg-green-100 text-green-700" title={`Μπήκε: ${t.checked_in_at}`}>✓</span>
                    : <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">—</span>}
                </td>
                {isManager && <td className="p-2">{t.username}</td>}
                <td className="p-2 text-right"><button onClick={() => reprint(t.id)} className="text-blue-600">Επανεκτύπωση</button></td>
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
