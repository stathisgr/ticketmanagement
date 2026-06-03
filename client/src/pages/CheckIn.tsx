import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Result { status: 'ok' | 'already' | 'not_found' | 'wrong_time'; title?: string; seat?: string; show?: string; show_date?: string; serial?: string; at?: string; code?: string; message?: string; }
interface Stats { issued: number; entered: number; date: string; }
interface Recent { id: number; serial: string; checked_in_at: string; title: string; seat?: string; show_title?: string; }

export default function CheckIn() {
  const [code, setCode] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try { setStats(await api.get<Stats>('/api/checkin/stats')); setRecent(await api.get<Recent[]>('/api/checkin/recent')); } catch { /* ignore */ }
  }
  useEffect(() => { refresh(); inputRef.current?.focus(); }, []);

  async function submit(value: string) {
    const c = value.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      const r = await api.post<Result>('/api/checkin', { code: c });
      setRes(r);
      refresh();
    } catch (e) { setRes({ status: 'not_found', code: c }); }
    finally { setBusy(false); setCode(''); setTimeout(() => inputRef.current?.focus(), 30); }
  }

  const banner = res && {
    ok: { cls: 'bg-emerald-600', icon: '✓', label: 'ΕΓΚΥΡΟ — ΕΙΣΟΔΟΣ' },
    already: { cls: 'bg-amber-500', icon: '⚠', label: 'ΗΔΗ ΕΧΕΙ ΜΠΕΙ' },
    not_found: { cls: 'bg-red-600', icon: '✕', label: 'ΑΓΝΩΣΤΟ ΕΙΣΙΤΗΡΙΟ' },
    wrong_time: { cls: 'bg-orange-600', icon: '⏱', label: 'ΕΚΤΟΣ ΩΡΑΣ ΕΙΣΟΔΟΥ' },
  }[res.status];

  async function syncCloud() {
    setBusy(true);
    try { const r = await api.post<{ pulled: number }>('/api/online/pull', {}); setRes({ status: 'ok', title: `Συγχρονισμός Cloud: ${r.pulled} νέες θέσεις` } as Result); refresh(); }
    catch (e) { setRes({ status: 'not_found', code: (e as Error).message } as Result); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xl font-bold">Έλεγχος εισόδου</h2>
        <button onClick={syncCloud} disabled={busy}
          className="ml-auto text-sm bg-emerald-700 text-white rounded px-3 py-1 disabled:opacity-40" title="Διάβασε εισιτήρια από το Cloud (online πωλήσεις)">
          ⟳ Συγχρονισμός Cloud
        </button>
        {stats && (
          <span className="text-sm bg-slate-100 rounded px-3 py-1">
            Μπήκαν σήμερα: <b>{stats.entered}</b> / {stats.issued}
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(code); }}
        placeholder="Σάρωσε QR ή πληκτρολόγησε αριθμό εισιτηρίου και Enter"
        className="w-full border-2 rounded-lg px-4 py-4 text-lg mb-3"
        autoFocus
      />

      {banner && res && (
        <div className={`${banner.cls} text-white rounded-xl p-5 mb-4`}>
          <div className="text-3xl font-bold">{banner.icon} {banner.label}</div>
          {res.status === 'wrong_time' ? (
            <div className="mt-1 text-lg">
              {res.message}
              <div className="text-sm opacity-90">{res.title}{res.show ? ` · ${res.show}` : ''} — Νο {res.serial}</div>
            </div>
          ) : res.status !== 'not_found' ? (
            <div className="mt-1 text-lg">
              {res.title}{res.seat ? ` · Θέση ${res.seat}` : ''}{res.show ? ` · ${res.show}` : ''}{res.show_date ? ` (${res.show_date})` : ''}
              <div className="text-sm opacity-90">Νο {res.serial}{res.status === 'already' && res.at ? ` — είχε μπει: ${res.at}` : ''}</div>
            </div>
          ) : (
            <div className="mt-1 text-sm opacity-90">Κωδικός: {res.code}</div>
          )}
        </div>
      )}

      <h3 className="font-semibold mb-1">Πρόσφατες είσοδοι</h3>
      <table className="w-full border text-sm bg-white">
        <thead className="bg-gray-100"><tr><th className="text-left p-2">Ώρα</th><th className="text-left p-2">Νο</th><th className="text-left p-2">Εισιτήριο</th><th className="text-left p-2">Θέση/Θέαμα</th></tr></thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">{(r.checked_in_at ?? '').slice(11, 16)}</td>
              <td className="p-2 font-mono">{r.serial}</td>
              <td className="p-2">{r.title}</td>
              <td className="p-2 text-gray-600">{r.seat ?? ''}{r.show_title ? ` · ${r.show_title}` : ''}</td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td colSpan={4} className="p-3 text-gray-400">Καμία είσοδος ακόμη.</td></tr>}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">Συμβουλή: σύνδεσε QR scanner (λειτουργεί ως πληκτρολόγιο) — σαρώνει &amp; πατά Enter αυτόματα. Το πεδίο επανεστιάζεται μόνο του.</p>
    </div>
  );
}
