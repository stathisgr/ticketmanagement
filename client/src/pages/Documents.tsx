import { useEffect, useState } from 'react';
import { api, dmy, getStation } from '../api';
import DateField from '../components/DateField';
import { printTickets } from '../components/printTicket';

interface DocRow {
  id: number; sale_id: number; role: string; invoice_type_id: number; series: string; aa: string;
  mark: string | null; status: string; net: number; vat: number; total: number; created_at: string;
  raw: string | null; guid: string | null; customer_name: string | null; customer_vat: string | null;
  show_date: string | null; show_time: string | null; ticket_count: number; ticket_ids: string | null;
  has_credit: number; qr_url: string | null; qr_provider: string | null; correlated_mark: string | null;
}

const eur = (n: any) => (Number(n) || 0).toFixed(2);
const dt = (s?: string | null) => (s ? `${dmy(s.slice(0, 10))} ${s.slice(11, 16)}` : '—');

export default function Documents() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [raw, setRaw] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setMsg('');
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (q.trim()) params.set('q', q.trim());
      const data = await api.get<DocRow[]>(`/api/fiscal/documents/list?${params.toString()}`);
      setRows(data); setSel(new Set());
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); /* αρχική φόρτωση */ }, []); // eslint-disable-line

  const creditable = (d: DocRow) => d.status === 'transmitted' && !d.has_credit && !!d.mark;

  function toggle(id: number) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function issueCredit() {
    const ids = [...sel];
    if (!ids.length) return;
    const reason = window.prompt(`Έκδοση Πιστωτικού για ${ids.length} παραστατικό(ά). Αιτιολογία:`, 'Ακύρωση / επιστροφή');
    if (reason == null) return;
    setBusy(true); setMsg('Έκδοση πιστωτικών…');
    try {
      const r = await api.post<{ issued: number; failed: number }>('/api/fiscal/documents/credit', { saleIds: ids, reason });
      setMsg(`✓ Πιστωτικά: ${r.issued}${r.failed ? ` · Απέτυχαν: ${r.failed}` : ''}`);
      load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function issuePending() {
    setBusy(true); setMsg('Έκδοση εκκρεμών online ΑΠΥ…');
    try {
      const r = await api.post<{ pending: number; issued: number; failed: number }>('/api/fiscal/issue-pending-online', {});
      setMsg(`✓ Εκκρεμείς: ${r.pending} · Εκδόθηκαν: ${r.issued}${r.failed ? ` · Απέτυχαν: ${r.failed}` : ''}`);
      load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function reprint(d: DocRow) {
    setBusy(true); setMsg('');
    try {
      if (d.role === 'credit') {
        // Πιστωτικό: εκτύπωση του ίδιου του πιστωτικού (τύπος/σειρά/ΑΑ/ΜΑΡΚ), όχι του εισιτηρίου.
        const res = await api.post<{ previews: string[] }>('/api/fiscal/documents/credit-print', { docId: d.id });
        if (res.previews?.length) printTickets(res.previews);
        else setMsg('Δεν βρέθηκαν στοιχεία πιστωτικού.');
        return;
      }
      const ids = (d.ticket_ids ?? '').split(',').map((x) => Number(x)).filter(Boolean);
      if (!ids.length) { setMsg('Δεν βρέθηκαν εισιτήρια για επανεκτύπωση.'); return; }
      const previews: string[] = [];
      for (const id of ids) {
        const res = await api.post<{ preview: string; printTicket?: boolean; dispatched?: boolean }>(`/api/tickets/${id}/reprint`, { station: getStation() });
        if (!res.dispatched && res.printTicket !== false && res.preview) previews.push(res.preview);
      }
      if (previews.length) printTickets(previews);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  const statusCell = (d: DocRow) => {
    if (d.status === 'transmitted') return <span className="text-green-700 font-semibold">✓</span>;
    if (d.status === 'cancelled') return <span className="text-gray-500" title="Έχει εκδοθεί πιστωτικό">πιστωτικό</span>;
    return <span className="text-red-600 font-semibold" title="Σφάλμα διαβίβασης">✗ ΜΑΡΚ</span>;
  };

  const selectableIds = rows.filter(creditable).map((d) => d.sale_id);
  const allSel = selectableIds.length > 0 && selectableIds.every((id) => sel.has(id));

  return (
    <div className="p-4">
      <div className="flex items-center mb-3 gap-2 flex-wrap">
        <h2 className="text-xl font-bold">Παραστατικά</h2>
        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">myDATA · Πάροχος</span>
        <button onClick={issuePending} disabled={busy} className="ml-auto text-sm bg-sky-600 text-white px-3 py-1.5 rounded disabled:opacity-50">Έκδοση εκκρεμών online ΑΠΥ</button>
      </div>

      {/* Φίλτρα */}
      <div className="flex items-end gap-3 flex-wrap bg-white border rounded-lg p-3 mb-3">
        <label className="text-sm">Από<DateField value={from} onChange={setFrom} /></label>
        <label className="text-sm">Έως<DateField value={to} onChange={setTo} /></label>
        <label className="text-sm flex-1 min-w-[12rem]">Αναζήτηση (Πελάτης / Αρ. παραστατικού / ΜΑΡΚ / #Πώληση)
          <input className="inp w-full" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="π.χ. Παπαδόπουλος, 5, 400000…" />
        </label>
        <button onClick={load} disabled={busy} className="bg-slate-700 text-white px-4 py-2 rounded text-sm">Αναζήτηση</button>
        {(from || to || q) && <button onClick={() => { setFrom(''); setTo(''); setQ(''); setTimeout(load, 0); }} className="text-sm text-gray-500 underline">Καθαρισμός</button>}
      </div>

      {msg && <div className="bg-slate-100 text-slate-700 p-2 rounded mb-2 text-sm">{msg}</div>}

      {/* Ενέργειες επιλεγμένων */}
      <div className="flex items-center gap-2 mb-2">
        <button onClick={issueCredit} disabled={busy || sel.size === 0}
          className="bg-red-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-40">
          Έκδοση Πιστωτικού ({sel.size})
        </button>
        <span className="text-xs text-gray-500">Επίλεξε παραστατικά με ✓ για έκδοση πιστωτικού (αντιλογισμός myDATA).</span>
      </div>

      <div className="overflow-x-auto border rounded-lg bg-white">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2"><input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set(selectableIds) : new Set())} /></th>
              <th className="p-2">PDF</th>
              <th className="p-2">#Πώλ.</th>
              <th className="p-2">Τύπος</th>
              <th className="p-2">Κατ.</th>
              <th className="p-2">ΜΑΡΚ</th>
              <th className="p-2">Έκδοση</th>
              <th className="p-2">Θέαμα</th>
              <th className="p-2 text-right">Εισ.</th>
              <th className="p-2 text-right">Σύνολο</th>
              <th className="p-2 text-right">Καθαρή</th>
              <th className="p-2 text-right">ΦΠΑ</th>
              <th className="p-2">Πελάτης</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t hover:bg-slate-50">
                <td className="p-2">
                  {creditable(d)
                    ? <input type="checkbox" checked={sel.has(d.sale_id)} onChange={() => toggle(d.sale_id)} />
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="p-2 text-center">
                  {(d.qr_provider || d.qr_url)
                    ? <button title="Άνοιγμα PDF παρόχου" onClick={() => window.open((d.qr_provider || d.qr_url)!, '_blank', 'noopener')}
                        className="text-slate-600 hover:text-blue-600 align-middle">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
                      </button>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="p-2">#{d.sale_id}</td>
                <td className="p-2"><span className={d.role === 'credit' ? 'text-red-700' : ''}>{d.series} {d.aa}</span></td>
                <td className="p-2">{statusCell(d)}</td>
                <td className="p-2 font-mono text-xs">{d.mark || '—'}</td>
                <td className="p-2">{dt(d.created_at)}</td>
                <td className="p-2">{d.show_date ? `${dmy(d.show_date)}${d.show_time ? ' ' + d.show_time : ''}` : '—'}</td>
                <td className="p-2 text-right">{d.ticket_count}</td>
                <td className="p-2 text-right font-semibold">{eur(d.total)}</td>
                <td className="p-2 text-right">{eur(d.net)}</td>
                <td className="p-2 text-right">{eur(d.vat)}</td>
                <td className="p-2">{d.customer_name || <span className="text-gray-400">Λιανική</span>}</td>
                <td className="p-2 text-right">
                  <button onClick={() => reprint(d)} className="text-blue-600 mr-2">Επανεκτύπωση</button>
                  <button onClick={() => setRaw(d.raw ?? '(κενό)')} className="text-slate-500">απάντηση</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !busy && <tr><td colSpan={14} className="p-4 text-gray-400 text-center">Κανένα παραστατικό.</td></tr>}
          </tbody>
        </table>
      </div>

      {raw != null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setRaw(null)}>
          <div className="bg-white rounded-xl p-5 w-[44rem] max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-2">Απάντηση παρόχου</h3>
            <pre className="bg-gray-50 border rounded p-2 text-[11px] whitespace-pre-wrap break-all">{raw}</pre>
            <div className="text-right mt-3"><button onClick={() => setRaw(null)} className="px-4 py-2 rounded bg-slate-800 text-white">Κλείσιμο</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
