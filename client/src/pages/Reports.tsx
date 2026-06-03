import { useEffect, useState } from 'react';
import { api, dmy } from '../api';
import DateField from '../components/DateField';

const p2 = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-01`; };

interface Summary {
  from: string; to: string; gross: number; vat: number; net: number; sales: number; tickets: number; avgPerSale: number;
  byMethod: Record<'cash' | 'card', { count: number; total: number }>;
  bySource: Record<'pos' | 'hall', { gross: number; qty: number }>;
  byChannel?: Record<'local' | 'online', { sales: number; gross: number; qty: number }>;
}
interface VatRateRow { rate: number; qty: number; gross: number; vat: number; net: number; }
interface FiscalEventRow { event_date: string; show_title: string; issued: number; cancelled: number; gross: number; vat: number; net: number; capacity: number | null; unsold: number | null; }
interface Fiscal {
  from: string; to: string; issued: number; cancelled: number; gross: number; vat: number; net: number;
  vatByRate: VatRateRow[]; byEvent: FiscalEventRow[];
}
interface DayRow { day: string; sales: number; gross: number; }
interface ShowRow { id: number; title: string; start_time?: string; hall_name: string; qty: number; gross: number; }
interface HallRow { hall_name: string; qty: number; gross: number; }
interface TypeRow { title: string; qty: number; gross: number; }

export default function Reports() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [sum, setSum] = useState<Summary | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [byShow, setByShow] = useState<ShowRow[]>([]);
  const [byHall, setByHall] = useState<HallRow[]>([]);
  const [byType, setByType] = useState<TypeRow[]>([]);
  const [fiscal, setFiscal] = useState<Fiscal | null>(null);
  const [tab, setTab] = useState<'general' | 'fiscal'>('general');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const qs = `from=${from}&to=${to}`;
    try {
      if (tab === 'fiscal') {
        setFiscal(await api.get<Fiscal>(`/api/reports/fiscal?${qs}`));
        return;
      }
      const [s, d, sh, h, t] = await Promise.all([
        api.get<Summary>(`/api/reports/summary?${qs}`),
        api.get<DayRow[]>(`/api/reports/by-day?${qs}`),
        api.get<ShowRow[]>(`/api/reports/by-show?${qs}`),
        api.get<HallRow[]>(`/api/reports/by-hall?${qs}`),
        api.get<TypeRow[]>(`/api/reports/by-type?${qs}`),
      ]);
      setSum(s); setDays(d); setByShow(sh); setByHall(h); setByType(t);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  function csv(name: string, header: string[], rows: (string | number)[][]) {
    const lines = [header.join(';'), ...rows.map((r) => r.join(';'))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name}_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const maxGross = Math.max(1, ...days.map((d) => d.gross));

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <h2 className="text-xl font-bold mr-2">Αναφορές</h2>
        <label className="text-sm">Από<span className="block"><DateField value={from} onChange={setFrom} /></span></label>
        <label className="text-sm">Έως<span className="block"><DateField value={to} onChange={setTo} /></span></label>
        <button onClick={load} className="bg-slate-800 text-white px-4 py-1.5 rounded">Εμφάνιση</button>
      </div>

      <div className="flex gap-1 border-b mb-4">
        {([['general', 'Γενικά (ανά ημ. πώλησης)'], ['fiscal', 'Φορολογική (ανά ημ. εκδήλωσης)']] as const).map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 -mb-px border-b-2 ${tab === id ? 'border-slate-800 font-semibold' : 'border-transparent text-gray-500'}`}>{lbl}</button>
        ))}
      </div>

      {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-2">{error}</div>}

      {tab === 'general' && sum && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Card label="Τζίρος" value={`${sum.gross.toFixed(2)} €`} sub={`${sum.sales} πωλήσεις`} color="bg-slate-800 text-white" />
            <Card label="ΦΠΑ" value={`${sum.vat.toFixed(2)} €`} sub={`Καθαρό ${sum.net.toFixed(2)} €`} color="bg-gray-100" />
            <Card label="Εισιτήρια" value={String(sum.tickets)} sub={`Μ.Ο. ${sum.avgPerSale.toFixed(2)} €/πώληση`} color="bg-gray-100" />
            <Card label="Μετρητά / Κάρτα" value={`${sum.byMethod.cash.total.toFixed(0)} / ${sum.byMethod.card.total.toFixed(0)} €`} sub={`POS ${sum.bySource.pos.gross.toFixed(0)}€ · Αίθ. ${sum.bySource.hall.gross.toFixed(0)}€`} color="bg-gray-100" />
            {sum.byChannel && (
              <Card label="Online" value={`${sum.byChannel.online.gross.toFixed(2)} €`}
                sub={`${sum.byChannel.online.qty} εισιτήρια · ${sum.byChannel.online.sales} πωλήσεις`}
                color="bg-emerald-700 text-white" />
            )}
            {sum.byChannel && (
              <Card label="Τοπικά (ταμείο)" value={`${sum.byChannel.local.gross.toFixed(2)} €`}
                sub={`${sum.byChannel.local.qty} εισιτήρια · ${sum.byChannel.local.sales} πωλήσεις`}
                color="bg-gray-100" />
            )}
          </div>

          {/* Ημερήσιο γράφημα τζίρου */}
          <div className="bg-white border rounded p-3 mb-5">
            <div className="font-semibold mb-2 text-sm">Ημερήσιος τζίρος</div>
            {days.length === 0 && <div className="text-gray-400 text-sm">Καμία πώληση στο διάστημα.</div>}
            {days.length > 0 && (
              <div className="flex items-end gap-2 overflow-x-auto" style={{ height: 170 }}>
                {days.map((d) => {
                  const h = d.gross > 0 ? Math.max(4, Math.round((d.gross / maxGross) * 130)) : 0;
                  return (
                    <div key={d.day} className="flex flex-col items-center justify-end shrink-0" style={{ width: 44 }} title={`${d.day}: ${d.gross.toFixed(2)} €`}>
                      <div className="text-[9px] text-gray-600 mb-0.5">{d.gross > 0 ? d.gross.toFixed(0) : ''}</div>
                      <div className="bg-slate-600 rounded-t hover:bg-slate-800" style={{ height: h, width: 28 }} />
                      <div className="text-[9px] text-gray-500 mt-1">{dmy(d.day).slice(0, 5)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <ReportTable
            title="Ανά θέαμα" onCsv={() => csv('ana_theama', ['Θέαμα', 'Ώρα', 'Αίθουσα', 'Τεμάχια', 'Τζίρος'], byShow.map((r) => [r.title, (r.start_time ?? '').slice(0, 5), r.hall_name, r.qty, r.gross.toFixed(2)]))}
            head={['Θέαμα', 'Ώρα', 'Αίθουσα', 'Τεμάχια', 'Τζίρος']}
            rows={byShow.map((r) => [r.title, (r.start_time ?? '').slice(0, 5), r.hall_name, String(r.qty), `${r.gross.toFixed(2)} €`])}
          />
          <ReportTable
            title="Ανά αίθουσα" onCsv={() => csv('ana_aithousa', ['Αίθουσα', 'Τεμάχια', 'Τζίρος'], byHall.map((r) => [r.hall_name, r.qty, r.gross.toFixed(2)]))}
            head={['Αίθουσα', 'Τεμάχια', 'Τζίρος']}
            rows={byHall.map((r) => [r.hall_name, String(r.qty), `${r.gross.toFixed(2)} €`])}
          />
          <ReportTable
            title="Ανά τύπο εισιτηρίου" onCsv={() => csv('ana_typo', ['Εισιτήριο', 'Τεμάχια', 'Τζίρος'], byType.map((r) => [r.title, r.qty, r.gross.toFixed(2)]))}
            head={['Εισιτήριο', 'Τεμάχια', 'Τζίρος']}
            rows={byType.map((r) => [r.title, String(r.qty), `${r.gross.toFixed(2)} €`])}
          />
        </>
      )}

      {tab === 'fiscal' && fiscal && (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Τα ποσά αναγνωρίζονται στη <b>ημερομηνία εκδήλωσης</b> (όχι έκδοσης/πώλησης). Τα <b>ακυρωθέντα</b> δεν προσμετρώνται σε έσοδα/ΦΠΑ. Εισιτήρια χωρίς θέαμα (λιανική) λαμβάνονται στην ημ. πώλησης.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <Card label="Καθαρός τζίρος" value={`${fiscal.gross.toFixed(2)} €`} sub={`${fiscal.issued} εισιτήρια`} color="bg-slate-800 text-white" />
            <Card label="ΦΠΑ" value={`${fiscal.vat.toFixed(2)} €`} color="bg-gray-100" />
            <Card label="Καθαρή αξία" value={`${fiscal.net.toFixed(2)} €`} color="bg-gray-100" />
            <Card label="Εκδοθέντα" value={String(fiscal.issued)} color="bg-emerald-700 text-white" />
            <Card label="Ακυρωθέντα" value={String(fiscal.cancelled)} color="bg-red-100" />
          </div>

          <ReportTable
            title="ΦΠΑ ανά συντελεστή"
            onCsv={() => csv('fpa_ana_syntelesti', ['Συντελεστής %', 'Τεμάχια', 'Καθαρή αξία', 'ΦΠΑ', 'Σύνολο'],
              fiscal.vatByRate.map((r) => [r.rate, r.qty, r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2)]))}
            head={['Συντελεστής', 'Τεμάχια', 'Καθαρή αξία', 'ΦΠΑ', 'Σύνολο']}
            rows={fiscal.vatByRate.map((r) => [`${r.rate}%`, String(r.qty), `${r.net.toFixed(2)} €`, `${r.vat.toFixed(2)} €`, `${r.gross.toFixed(2)} €`])}
          />

          <ReportTable
            title="Ανά εκδήλωση / ημερομηνία"
            onCsv={() => csv('ana_ekdilosi', ['Ημ. εκδήλωσης', 'Εκδήλωση', 'Εκδοθέντα', 'Ακυρωθέντα', 'Χωρητικότητα', 'Αδιάθετα', 'Καθαρή αξία', 'ΦΠΑ', 'Σύνολο'],
              fiscal.byEvent.map((r) => [r.event_date, r.show_title, r.issued, r.cancelled, r.capacity ?? '', r.unsold ?? '', r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2)]))}
            head={['Ημ. εκδήλωσης', 'Εκδήλωση', 'Εκδοθ.', 'Ακυρ.', 'Χωρητ.', 'Αδιάθ.', 'ΦΠΑ', 'Σύνολο']}
            rows={fiscal.byEvent.map((r) => [dmy(r.event_date), r.show_title, String(r.issued), String(r.cancelled),
              r.capacity != null ? String(r.capacity) : '—', r.unsold != null ? String(r.unsold) : '—',
              `${r.vat.toFixed(2)} €`, `${r.gross.toFixed(2)} €`])}
          />
          {fiscal.byEvent.length === 0 && <div className="text-gray-400 text-sm">Καμία εγγραφή στο διάστημα.</div>}
        </>
      )}
    </div>
  );
}

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={`${color} rounded-lg p-3`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function ReportTable({ title, head, rows, onCsv }: { title: string; head: string[]; rows: string[][]; onCsv: () => void }) {
  return (
    <div className="mb-5">
      <div className="flex items-center mb-1">
        <h3 className="font-semibold">{title}</h3>
        <button onClick={onCsv} disabled={rows.length === 0} className="ml-auto text-sm bg-emerald-600 text-white px-3 py-1 rounded disabled:opacity-40">CSV</button>
      </div>
      <table className="w-full border text-sm bg-white">
        <thead className="bg-gray-100"><tr>{head.map((h, i) => <th key={i} className={`p-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className={`p-2 ${j === 0 ? 'text-left font-medium' : 'text-right'}`}>{c}</td>)}</tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={head.length} className="p-3 text-gray-400">Καμία εγγραφή.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
