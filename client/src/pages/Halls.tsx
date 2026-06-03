import { useEffect, useState } from 'react';
import { api, type Hall, type Seat } from '../api';

const KINDS: Record<Seat['kind'], { label: string; cls: string }> = {
  seat: { label: 'Θέση', cls: 'bg-emerald-500 text-white' },
  aisle: { label: 'Διάδρομος', cls: 'bg-gray-200 text-gray-400' },
  gap: { label: 'Κενό', cls: 'bg-transparent border-dashed text-gray-300' },
};

export default function Halls() {
  const [halls, setHalls] = useState<Hall[]>([]);
  const [sel, setSel] = useState<Hall | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [gen, setGen] = useState({ rows: 8, cols: 12, rowMode: 'alpha' as 'alpha' | 'numeric', colStart: 1 });

  async function loadHalls() {
    try { setHalls(await api.get<Hall[]>('/api/halls')); } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { loadHalls(); }, []);

  async function openHall(h: Hall) {
    setError('');
    const res = await api.get<{ hall: Hall; seats: Seat[]; locked: boolean }>(`/api/halls/${h.id}`);
    setSel(res.hall); setSeats(res.seats); setLocked(!!res.locked);
  }

  async function createHall() {
    if (!newName.trim()) return;
    const h = await api.post<Hall>('/api/halls', { name: newName.trim() });
    setNewName(''); await loadHalls(); openHall(h);
  }

  async function toggleActive(h: Hall) {
    await api.put(`/api/halls/${h.id}/active`, { enabled: !h.enabled });
    await loadHalls();
    if (sel?.id === h.id) setSel({ ...sel, enabled: h.enabled ? 0 : 1 });
  }

  async function renameHall() {
    if (!sel) return;
    const name = prompt('Νέο όνομα αίθουσας:', sel.name);
    if (!name || name === sel.name) return;
    try { await api.put(`/api/halls/${sel.id}`, { name, rows: sel.rows, cols: sel.cols }); setSel({ ...sel, name }); loadHalls(); }
    catch (e) { setError((e as Error).message); }
  }

  async function deleteHall() {
    if (!sel) return;
    if (!confirm(`Διαγραφή αίθουσας «${sel.name}»;`)) return;
    try { await api.del(`/api/halls/${sel.id}`); setSel(null); setSeats([]); loadHalls(); }
    catch (e) { setError((e as Error).message); }
  }

  async function generate() {
    if (!sel) return;
    try {
      const res = await api.post<{ seats: Seat[] }>(`/api/halls/${sel.id}/generate`, gen);
      setSeats(res.seats); loadHalls();
    } catch (e) { setError((e as Error).message); }
  }

  function cycleKind(s: Seat) {
    if (locked) return;
    const order: Seat['kind'][] = ['seat', 'aisle', 'gap'];
    const next = order[(order.indexOf(s.kind) + 1) % 3];
    setSeats((prev) => prev.map((p) => (p.id === s.id ? { ...p, kind: next } : p)));
  }

  async function saveLayout() {
    if (!sel) return;
    try {
      const updated = await api.put<Seat[]>(`/api/halls/${sel.id}/layout`, { seats, rowMode: gen.rowMode });
      setSeats(updated); // ανανέωση με τη νέα αρίθμηση (αγνοεί διαδρόμους/κενά)
      loadHalls();
      setError('✓ Η διάταξη αποθηκεύτηκε — η αρίθμηση αγνοεί διαδρόμους/κενά');
    } catch (e) { setError((e as Error).message); }
  }

  const rows = sel ? Math.max(0, ...seats.map((s) => s.y + 1)) : 0;
  const cols = sel ? Math.max(0, ...seats.map((s) => s.x + 1)) : 0;
  const grid: (Seat | null)[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => seats.find((s) => s.y === y && s.x === x) ?? null)
  );

  return (
    <div className="p-4 flex gap-4 h-full">
      {/* Λίστα αιθουσών */}
      <div className="w-64 shrink-0">
        <h2 className="text-xl font-bold mb-3">Αίθουσες</h2>
        <div className="flex gap-1 mb-3">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Όνομα αίθουσας"
            className="border rounded px-2 py-1 flex-1" />
          <button onClick={createHall} className="bg-slate-800 text-white px-3 rounded">+</button>
        </div>
        <ul className="space-y-1">
          {halls.map((h) => (
            <li key={h.id} className="flex items-center gap-1">
              <button onClick={() => openHall(h)}
                className={`flex-1 text-left px-3 py-2 rounded ${sel?.id === h.id ? 'bg-slate-200' : 'hover:bg-gray-100'} ${h.enabled ? '' : 'opacity-50'}`}>
                {h.name} <span className="text-xs text-gray-500">({h.seat_count ?? 0} θέσεις)</span>
                {h.locked ? <span className="ml-1" title="Κλειδωμένη — έχει εκδοθέντα εισιτήρια">🔒</span> : null}
                {!h.enabled ? <span className="text-xs text-red-500"> (ανενεργή)</span> : null}
              </button>
              <button onClick={() => toggleActive(h)} title={h.enabled ? 'Απενεργοποίηση' : 'Ενεργοποίηση'}
                className={`px-2 py-1 rounded text-xs ${h.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                {h.enabled ? 'ON' : 'OFF'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Editor διάταξης */}
      <div className="flex-1 overflow-auto">
        {error && <div className="bg-blue-50 text-blue-700 p-2 rounded mb-2 text-sm">{error}</div>}
        {!sel && <div className="text-gray-400">Διάλεξε ή δημιούργησε μια αίθουσα.</div>}
        {sel && (
          <>
            <div className="flex flex-wrap items-end gap-2 mb-3 bg-white p-3 rounded border">
              <strong className="mr-1">{sel.name}{!sel.enabled ? ' (ανενεργή)' : ''}</strong>
              <button onClick={renameHall} className="text-blue-600 text-xs mr-1">✎ Μετονομασία</button>
              <button onClick={deleteHall} disabled={locked} title={locked ? 'Έχει εκδοθέντα εισιτήρια' : 'Διαγραφή'} className="text-red-600 text-xs mr-2 disabled:opacity-30">🗑 Διαγραφή</button>
              <label className="text-sm">Γραμμές<input type="number" value={gen.rows} min={1} max={50} disabled={locked}
                onChange={(e) => setGen({ ...gen, rows: +e.target.value })} className="block border rounded px-2 py-1 w-20 disabled:bg-gray-100" /></label>
              <label className="text-sm">Στήλες<input type="number" value={gen.cols} min={1} max={60} disabled={locked}
                onChange={(e) => setGen({ ...gen, cols: +e.target.value })} className="block border rounded px-2 py-1 w-20 disabled:bg-gray-100" /></label>
              <label className="text-sm">Αρίθμηση γραμμών
                <select value={gen.rowMode} disabled={locked} onChange={(e) => setGen({ ...gen, rowMode: e.target.value as any })}
                  className="block border rounded px-2 py-1 disabled:bg-gray-100">
                  <option value="alpha">Γράμματα (A,B,…)</option>
                  <option value="numeric">Αριθμοί (1,2,…)</option>
                </select>
              </label>
              <button onClick={generate} disabled={locked} className="bg-amber-600 text-white px-3 py-1.5 rounded disabled:opacity-40">Δημιουργία πλέγματος</button>
              <button onClick={saveLayout} disabled={locked} className="bg-emerald-600 text-white px-3 py-1.5 rounded ml-auto disabled:opacity-40">Αποθήκευση διάταξης</button>
            </div>

            {locked && (
              <div className="bg-amber-50 text-amber-800 p-2 rounded mb-2 text-sm">
                🔒 Η αίθουσα έχει εκδοθέντα εισιτήρια — η δομή είναι κλειδωμένη. Μπορείς να την ενεργοποιήσεις/απενεργοποιήσεις, αλλά όχι να αλλάξεις θέσεις.
              </div>
            )}
            <p className="text-xs text-gray-500 mb-2">Κλικ σε κελί: εναλλαγή Θέση → Διάδρομος → Κενό. (Το πλέγμα δημιουργεί όλες τις θέσεις· μετά ορίζεις διαδρόμους.)</p>
            <div className="inline-block bg-white p-3 rounded border">
              {grid.length === 0 && <div className="text-gray-400">Δεν υπάρχει πλέγμα — πάτησε «Δημιουργία πλέγματος».</div>}
              {grid.map((row, y) => (
                <div key={y} className="flex gap-1 mb-1 items-center">
                  <span className="w-6 text-xs text-gray-400 text-right mr-1">{row.find((c) => c)?.row_label ?? ''}</span>
                  {row.map((cell, x) => cell ? (
                    <button key={x} onClick={() => cycleKind(cell)} title={cell.display_name ?? ''}
                      className={`w-8 h-8 rounded text-[10px] border ${KINDS[cell.kind].cls}`}>
                      {cell.kind === 'seat' ? cell.col_label : ''}
                    </button>
                  ) : <span key={x} className="w-8 h-8" />)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
