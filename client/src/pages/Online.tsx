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
  const [date, setDate] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reload() {
    api.get<OnlineConfig>('/api/online/config').then(setCfg).catch((e) => setError(e.message));
    api.get<Show[]>('/api/shows').then(setShows).catch(() => {});
    api.get<Publication[]>('/api/online/publications').then(setPubs).catch(() => {});
  }
  useEffect(reload, []);

  const selectedShow = shows.find((s) => s.id === showId);

  // Όταν επιλεγεί θέαμα, προτείνει ημερομηνία (valid_from) και cutoff 17:00 ίδιας μέρας.
  useEffect(() => {
    if (!selectedShow) return;
    const d = (selectedShow.valid_from ?? '').slice(0, 10);
    setDate(d);
    if (d) setCloseAt(`${d}T17:00`);
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
    if (!showId || !date) { setError('Διάλεξε θέαμα και ημερομηνία'); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      const closeIso = closeAt ? new Date(closeAt).toISOString() : null;
      await api.post('/api/online/publish', { show_id: showId, show_date: date, sales_close_at: closeIso });
      setMsg('✓ Το θέαμα δημοσιεύτηκε online (θέσεις & τιμές μεταφέρθηκαν).');
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
      <h1 className="text-2xl font-bold">Online Κρατήσεις (Supabase)</h1>
      {error && <div className="bg-red-100 text-red-700 p-2 rounded">{error}</div>}
      {msg && <div className="bg-green-100 text-green-700 p-2 rounded">{msg}</div>}

      {/* Σύνδεση */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold text-lg">Σύνδεση</h2>
        <label className="block">
          <span className="text-sm text-gray-600">Supabase URL</span>
          <input className="w-full border rounded px-3 py-2" placeholder="https://xxxx.supabase.co"
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
            <span className="text-sm text-gray-600">Θέαμα</span>
            <select className="w-full border rounded px-3 py-2" value={showId} onChange={(e) => setShowId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— διάλεξε —</option>
              {shows.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.hall_name})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">Ημερομηνία παράστασης</span>
            <input type="date" className="w-full border rounded px-3 py-2" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">Κλείσιμο online πωλήσεων</span>
            <input type="datetime-local" className="w-full border rounded px-3 py-2" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
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
