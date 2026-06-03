import { useEffect, useState } from 'react';
import { api, type Show } from '../api';

interface OnlineConfig { supabase_url: string; sync_minutes_before: number; enabled: boolean; has_key: boolean; }
interface Publication {
  id: number; show_id: number; show_date: string; cloud_show_id: number | null;
  sales_close_at: string | null; enabled: number; pushed_at: string | null;
  last_pull_at: string | null; title: string; sold_online: number;
}

export default function Online() {
  const [cfg, setCfg] = useState<OnlineConfig>({ supabase_url: '', sync_minutes_before: 60, enabled: false, has_key: false });
  const [keyInput, setKeyInput] = useState('');
  const [shows, setShows] = useState<Show[]>([]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [showId, setShowId] = useState<number | ''>('');
  const [date, setDate] = useState('');        // ημερομηνία αναζήτησης θεάματος
  const [from, setFrom] = useState('');         // εύρος δημοσίευσης: από
  const [to, setTo] = useState('');             // εύρος δημοσίευσης: έως
  const [closeTime, setCloseTime] = useState('17:00'); // ημερήσια ώρα κλεισίματος online
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reload() {
    api.get<OnlineConfig>('/api/online/config').then(setCfg).catch((e) => setError(e.message));
    api.get<Publication[]>('/api/online/publications').then(setPubs).catch(() => {});
  }
  useEffect(reload, []);

  // Πρώτα ημερομηνία → φέρνει τα θεάματα που παίζουν εκείνη την ημέρα (με τις ώρες τους).
  useEffect(() => {
    setShowId(''); setShows([]);
    if (!date) return;
    api.get<Show[]>(`/api/shows?date=${date}`).then(setShows).catch(() => {});
  }, [date]);

  // Όταν επιλεγεί θέαμα, προτείνει εύρος δημοσίευσης = εύρος ισχύος του θεάματος (ή την ημέρα).
  useEffect(() => {
    const s = shows.find((x) => x.id === showId);
    if (!s) return;
    setFrom((s.valid_from ?? date).slice(0, 10) || date);
    setTo((s.valid_to ?? date).slice(0, 10) || date);
  }, [showId]);

  async function saveConfig() {
    setBusy(true); setError(''); setMsg('');
    try {
      const body: any = { supabase_url: cfg.supabase_url, sync_minutes_before: cfg.sync_minutes_before, enabled: cfg.enabled };
      if (keyInput) body.service_key = keyInput;
      const r = await api.put<OnlineConfig>('/api/online/config', body);
      setCfg(r); setKeyInput(''); setMsg('Οι ρυθμίσεις αποθηκεύτηκαν.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function publish() {
    if (!showId || !from || !to) { setError('Διάλεξε θέαμα και εύρος ημερομηνιών'); return; }
    if (from > to) { setError('Η ημερομηνία «από» είναι μετά το «έως»'); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api.post<{ count: number }>('/api/online/publish-range',
        { show_id: showId, from, to, close_time: closeTime });
      setMsg(`✓ Δημοσιεύτηκε online για ${r.count} ημέρες (θέσεις, τιμές & σχέδιο μεταφέρθηκαν).`);
      reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function unpublish(id: number) {
    if (!confirm('Απόσυρση του θεάματος από το online;')) return;
    setBusy(true); setError('');
    try { await api.post('/api/online/unpublish', { id }); reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function pull() {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api.post<{ pulled: number }>('/api/online/pull', {});
      setMsg(`Συγχρονισμός ολοκληρώθηκε — ${r.pulled} νέες online-πουλημένες θέσεις.`);
      reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Online Κρατήσεις</h1>
      {error && <div className="bg-red-100 text-red-700 p-2 rounded">{error}</div>}
      {msg && <div className="bg-green-100 text-green-700 p-2 rounded">{msg}</div>}

      {/* Σύνδεση */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold text-lg">Σύνδεση</h2>
        <label className="block">
          <span className="text-sm text-gray-600">Διεύθυνση Cloud (URL)</span>
          <input className="w-full border rounded px-3 py-2" placeholder="https://..."
            value={cfg.supabase_url} onChange={(e) => setCfg({ ...cfg, supabase_url: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Service role key {cfg.has_key && <em className="text-green-600">(αποθηκευμένο — άφησέ το κενό για να μην αλλάξει)</em>}</span>
          <input type="password" className="w-full border rounded px-3 py-2" placeholder={cfg.has_key ? '•••••••• αποθηκευμένο' : 'service_role key'}
            value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
        </label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            Auto-pull λεπτά πριν το θέαμα:
            <input type="number" className="w-20 border rounded px-2 py-1" value={cfg.sync_minutes_before}
              onChange={(e) => setCfg({ ...cfg, sync_minutes_before: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
            Ενεργό
          </label>
        </div>
        <button onClick={saveConfig} disabled={busy} className="bg-slate-800 text-white px-4 py-2 rounded disabled:opacity-40">Αποθήκευση</button>
        <p className="text-xs text-gray-400">Το service_role key είναι μυστικό· μένει μόνο τοπικά στον server και δεν φεύγει στον browser του πελάτη.</p>
      </div>

      {/* Δημοσίευση */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold text-lg">Δημοσίευση θεάματος online</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-sm text-gray-600">1. Ημερομηνία παράστασης</span>
            <input type="date" className="w-full border rounded px-3 py-2" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">2. Θέαμα της ημέρας</span>
            <select className="w-full border rounded px-3 py-2" value={showId} disabled={!date}
              onChange={(e) => setShowId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">{date ? (shows.length ? '— διάλεξε —' : 'καμία παράσταση αυτή τη μέρα') : 'διάλεξε ημερομηνία πρώτα'}</option>
              {shows.map((s) => <option key={s.id} value={s.id}>{s.start_time}{s.end_time ? `–${s.end_time}` : ''} · {s.title} ({s.hall_name})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">3. Ώρα κλεισίματος online (ανά ημέρα)</span>
            <input type="time" className="w-full border rounded px-3 py-2" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-gray-600">Δημοσίευση από</span>
            <input type="date" className="w-full border rounded px-3 py-2" value={from} disabled={!showId} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">έως</span>
            <input type="date" className="w-full border rounded px-3 py-2" value={to} disabled={!showId} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <button onClick={publish} disabled={busy || !cfg.enabled} className="bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-40">
          Δημοσίευση / Ενημέρωση online
        </button>
        {!cfg.enabled && <span className="text-sm text-amber-600 ml-3">Ενεργοποίησε & αποθήκευσε πρώτα τη σύνδεση.</span>}
      </div>

      {/* Δημοσιευμένα */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-lg">Δημοσιευμένα online</h2>
          <button onClick={pull} disabled={busy} className="bg-emerald-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-40">
            ⟳ Συγχρονισμός τώρα (κατέβασμα πωλήσεων)
          </button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="py-1">Θέαμα</th><th>Ημ/νία</th><th>Κλείσιμο</th><th>Πούλησε online</th><th>Τελ. sync</th><th></th>
          </tr></thead>
          <tbody>
            {pubs.filter((p) => p.enabled).map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-1.5">{p.title}</td>
                <td>{p.show_date}</td>
                <td>{p.sales_close_at ? new Date(p.sales_close_at).toLocaleString('el-GR') : '—'}</td>
                <td className="font-semibold">{p.sold_online}</td>
                <td>{p.last_pull_at ?? '—'}</td>
                <td className="text-right"><button onClick={() => unpublish(p.id)} className="text-red-600 hover:underline">Απόσυρση</button></td>
              </tr>
            ))}
            {pubs.filter((p) => p.enabled).length === 0 && <tr><td colSpan={6} className="text-gray-400 py-3">Κανένα θέαμα δεν είναι δημοσιευμένο online.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
