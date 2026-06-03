import { useEffect, useMemo, useState } from 'react';
import { api, type Hall, type Show, type ShowTicketType, type TicketType } from '../api';

interface Slot { start_time: string; end_time: string; }
interface Range { valid_from: string; valid_to: string; }
interface Draft {
  id?: number; hall_id: number | ''; title: string;
  slots: Slot[]; ranges: Range[]; ticketTypeIds: number[];
  seating_mode: 'seated' | 'general'; capacity: number | '';
}

const emptyDraft = (): Draft => ({
  hall_id: '', title: '', slots: [{ start_time: '18:00', end_time: '20:00' }],
  ranges: [{ valid_from: '', valid_to: '' }], ticketTypeIds: [],
  seating_mode: 'seated', capacity: '',
});

/** 24ωρη επιλογή ώρας (χωρίς AM/PM) με dropdowns. */
function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = (value || '00:00').split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const mins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  return (
    <span className="inline-flex items-center gap-1">
      <select className="border rounded px-1 py-1" value={h} onChange={(e) => onChange(`${e.target.value}:${m ?? '00'}`)}>
        {hours.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span>:</span>
      <select className="border rounded px-1 py-1" value={mins.includes(m) ? m : '00'} onChange={(e) => onChange(`${h ?? '00'}:${e.target.value}`)}>
        {mins.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}

type SortKey = 'valid_from' | 'start_time' | 'title' | 'hall_name';

export default function Shows() {
  const [halls, setHalls] = useState<Hall[]>([]);
  const [allTypes, setAllTypes] = useState<TicketType[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('valid_from');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  async function load() {
    try {
      setHalls(await api.get<Hall[]>('/api/halls'));
      setAllTypes(await api.get<TicketType[]>('/api/ticket-types'));
      setShows(await api.get<Show[]>('/api/shows'));
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { load(); }, []);

  const enabledHalls = halls.filter((h) => h.enabled);
  const enabledTypes = allTypes.filter((t) => t.enabled);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = shows.filter((s) =>
      !q || (s.title ?? '').toLowerCase().includes(q) || (s.hall_name ?? '').toLowerCase().includes(q)
    );
    return [...arr].sort((a, b) => {
      const av = String((a as any)[sortKey] ?? ''); const bv = String((b as any)[sortKey] ?? '');
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
  }, [shows, search, sortKey, sortDir]);

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  }

  async function edit(s: Show) {
    const res = await api.get<{ show: Show; ticketTypes: ShowTicketType[] }>(`/api/shows/${s.id}`);
    const sm = ((s as any).seating_mode === 'general') ? 'general' : 'seated';
    setDraft({
      id: s.id, hall_id: s.hall_id ?? '', title: s.title,
      slots: [{ start_time: (s.start_time ?? '18:00').slice(0, 5), end_time: (s.end_time ?? '').slice(0, 5) }],
      ranges: [{ valid_from: (s.valid_from ?? '').slice(0, 10), valid_to: (s.valid_to ?? '').slice(0, 10) }],
      ticketTypeIds: res.ticketTypes.map((t) => t.ticket_type_id).filter((x): x is number => x != null),
      seating_mode: sm, capacity: (s as any).capacity || '',
    });
  }

  async function save() {
    if (!draft) return;
    const general = draft.seating_mode === 'general';
    if (!draft.title) { setError('Συμπλήρωσε τίτλο'); return; }
    if (!general && !draft.hall_id) { setError('Συμπλήρωσε αίθουσα (ή επίλεξε Event χωρίς θέσεις)'); return; }
    if (!draft.ranges.every((r) => r.valid_from && r.valid_to)) { setError('Κάθε διάστημα χρειάζεται ημ/νία από–έως'); return; }
    setError('');
    const hall_id = general ? null : Number(draft.hall_id);
    const capacity = general ? (Number(draft.capacity) || 0) : 0;
    try {
      if (draft.id) {
        // Το αρχικό θέαμα ενημερώνεται (διατηρείται — ασφαλές για κρατήσεις)
        const s0 = draft.slots[0], r0 = draft.ranges[0];
        await api.put(`/api/shows/${draft.id}`, {
          hall_id, title: draft.title,
          start_time: s0.start_time, end_time: s0.end_time,
          valid_from: r0.valid_from, valid_to: r0.valid_to,
          ticketTypeIds: draft.ticketTypeIds,
        });
        // Τυχόν επιπλέον συνδυασμοί (ώρα × ημερομηνίες) δημιουργούνται ως νέα θεάματα
        for (let i = 0; i < draft.slots.length; i++) {
          for (let j = 0; j < draft.ranges.length; j++) {
            if (i === 0 && j === 0) continue;
            await api.post('/api/shows', {
              hall_id, title: draft.title, seating_mode: draft.seating_mode, capacity,
              timeSlots: [draft.slots[i]], dateRanges: [draft.ranges[j]], ticketTypeIds: draft.ticketTypeIds,
            });
          }
        }
      } else {
        await api.post('/api/shows', {
          hall_id, title: draft.title, seating_mode: draft.seating_mode, capacity,
          timeSlots: draft.slots, dateRanges: draft.ranges, ticketTypeIds: draft.ticketTypeIds,
        });
      }
      setDraft(null); load();
    } catch (e) { setError((e as Error).message); }
  }

  async function toggleActive(s: Show & { enabled?: number }) {
    await api.put(`/api/shows/${s.id}/active`, { enabled: !s.enabled });
    load();
  }
  async function copy(s: Show) {
    const vf = prompt('Αντιγραφή — Ισχύει ΑΠΟ (YYYY-MM-DD):', s.valid_from ?? '');
    if (!vf) return;
    const vt = prompt('Ισχύει ΕΩΣ (YYYY-MM-DD):', s.valid_to ?? vf);
    if (!vt) return;
    await api.post(`/api/shows/${s.id}/copy`, { valid_from: vf, valid_to: vt });
    load();
  }
  async function remove(id: number) {
    if (!confirm('Διαγραφή θεάματος;')) return;
    try { await api.del(`/api/shows/${id}`); load(); }
    catch (e) { setError((e as Error).message); }
  }
  function toggleType(id: number) {
    if (!draft) return;
    const has = draft.ticketTypeIds.includes(id);
    setDraft({ ...draft, ticketTypeIds: has ? draft.ticketTypeIds.filter((x) => x !== id) : [...draft.ticketTypeIds, id] });
  }

  const Th = ({ k, children }: { k: SortKey; children: any }) => (
    <th className="text-left p-2 cursor-pointer select-none" onClick={() => setSort(k)}>
      {children}{sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xl font-bold">Πρόγραμμα θεαμάτων</h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Αναζήτηση τίτλου/αίθουσας"
          className="border rounded px-3 py-1.5 ml-4 w-64" />
        <button onClick={() => setDraft(emptyDraft())} className="ml-auto bg-slate-800 text-white px-4 py-1.5 rounded">+ Νέο πρόγραμμα</button>
      </div>
      {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-2">{error}</div>}
      {enabledHalls.length === 0 && <div className="bg-amber-50 text-amber-700 p-2 rounded mb-2 text-sm">Δεν υπάρχουν ενεργές αίθουσες. Φτιάξε μία στις «Αίθουσες».</div>}

      <table className="w-full border text-sm bg-white">
        <thead className="bg-gray-100"><tr>
          <Th k="start_time">Ώρα</Th><Th k="valid_from">Ημερομηνίες</Th>
          <Th k="title">Τίτλος</Th><Th k="hall_name">Αίθουσα</Th>
          <th className="text-center p-2">Ενεργό</th><th></th>
        </tr></thead>
        <tbody>
          {filtered.map((s: any) => (
            <tr key={s.id} className={`border-t ${s.enabled ? '' : 'opacity-50'}`}>
              <td className="p-2">{(s.start_time ?? '').slice(0, 5)}{s.end_time ? '–' + s.end_time.slice(0, 5) : ''}</td>
              <td className="p-2">{(s.valid_from ?? '').slice(0, 10)} → {(s.valid_to ?? '').slice(0, 10)}</td>
              <td className="p-2 font-medium">{s.title}</td>
              <td className="p-2">{s.seating_mode === 'general' ? <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">Event χωρίς θέσεις</span> : s.hall_name}</td>
              <td className="p-2 text-center">
                <button onClick={() => toggleActive(s)} className={`px-2 py-0.5 rounded text-xs ${s.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                  {s.enabled ? 'ON' : 'OFF'}
                </button>
              </td>
              <td className="p-2 text-right whitespace-nowrap">
                <button onClick={() => edit(s)} className="text-blue-600 mr-2">Επεξεργασία</button>
                <button onClick={() => copy(s)} className="text-amber-600 mr-2">Αντιγραφή</button>
                <button onClick={() => remove(s.id)} className="text-red-600">Διαγραφή</button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={6} className="p-3 text-gray-400">Κανένα θέαμα.</td></tr>}
        </tbody>
      </table>

      {draft && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setDraft(null)}>
          <div className="bg-white rounded-xl p-5 w-[38rem] max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">{draft.id ? 'Επεξεργασία' : 'Νέο'} πρόγραμμα</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm col-span-2">Τίτλος
                <input className="inp" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>

              {/* Τύπος θεάματος: με θέσεις (αίθουσα) ή ελεύθερη είσοδος (event) */}
              <div className="col-span-2 flex gap-2">
                <button type="button"
                  onClick={() => setDraft({ ...draft, seating_mode: 'seated' })}
                  className={`flex-1 px-3 py-2 rounded border text-sm ${draft.seating_mode === 'seated' ? 'bg-slate-800 text-white' : 'bg-white'}`}>
                  🎭 Με θέσεις (αίθουσα)
                </button>
                <button type="button"
                  onClick={() => setDraft({ ...draft, seating_mode: 'general' })}
                  className={`flex-1 px-3 py-2 rounded border text-sm ${draft.seating_mode === 'general' ? 'bg-slate-800 text-white' : 'bg-white'}`}>
                  🎟️ Event χωρίς θέσεις
                </button>
              </div>

              {draft.seating_mode === 'seated' ? (
                <label className="text-sm col-span-2">Αίθουσα
                  <select className="inp" value={draft.hall_id} onChange={(e) => setDraft({ ...draft, hall_id: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">— επιλογή —</option>
                    {enabledHalls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select></label>
              ) : (
                <label className="text-sm col-span-2">Χωρητικότητα <span className="text-gray-500 font-normal">(0 ή κενό = απεριόριστη)</span>
                  <input className="inp" type="number" min={0} placeholder="απεριόριστη"
                    value={draft.capacity}
                    onChange={(e) => setDraft({ ...draft, capacity: e.target.value === '' ? '' : Number(e.target.value) })} />
                  <span className="text-xs text-gray-500">Ελεύθερη είσοδος με αύξουσα αρίθμηση — χωρίς σχέδιο αίθουσας.</span>
                </label>
              )}
            </div>

            {/* Ωριαία διαστήματα */}
            <h4 className="font-semibold mt-4 mb-1">Ωριαία διαστήματα <span className="font-normal text-xs text-gray-500">(κάθε ώρα = ξεχωριστό θέαμα προς επιλογή)</span></h4>
            {draft.slots.map((s, i) => (
              <div key={i} className="flex items-center gap-2 mb-1 text-sm">
                <span>Από</span><TimeInput value={s.start_time} onChange={(v) => setDraft({ ...draft, slots: draft.slots.map((x, j) => j === i ? { ...x, start_time: v } : x) })} />
                <span>έως</span><TimeInput value={s.end_time} onChange={(v) => setDraft({ ...draft, slots: draft.slots.map((x, j) => j === i ? { ...x, end_time: v } : x) })} />
                {draft.slots.length > 1 && <button onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, j) => j !== i) })} className="text-red-500 px-1">✕</button>}
              </div>
            ))}
            <button type="button" onClick={() => setDraft({ ...draft, slots: [...draft.slots, { start_time: '20:30', end_time: '22:30' }] })} className="text-sm text-blue-600 hover:underline">+ Προσθήκη ώρας</button>

            {/* Διαστήματα ημερομηνιών */}
            <h4 className="font-semibold mt-4 mb-1">Διαστήματα ημερομηνιών</h4>
            {draft.ranges.map((r, i) => (
              <div key={i} className="flex items-center gap-2 mb-1 text-sm">
                <span>Από</span><input type="date" className="border rounded px-2 py-1" value={r.valid_from} onChange={(e) => setDraft({ ...draft, ranges: draft.ranges.map((x, j) => j === i ? { ...x, valid_from: e.target.value } : x) })} />
                <span>έως</span><input type="date" className="border rounded px-2 py-1" value={r.valid_to} onChange={(e) => setDraft({ ...draft, ranges: draft.ranges.map((x, j) => j === i ? { ...x, valid_to: e.target.value } : x) })} />
                {draft.ranges.length > 1 && <button onClick={() => setDraft({ ...draft, ranges: draft.ranges.filter((_, j) => j !== i) })} className="text-red-500 px-1">✕</button>}
              </div>
            ))}
            <button type="button" onClick={() => setDraft({ ...draft, ranges: [...draft.ranges, { valid_from: '', valid_to: '' }] })} className="text-sm text-blue-600 hover:underline">+ Προσθήκη διαστήματος ημερομηνιών</button>

            {/* Είδη εισιτηρίων */}
            <h4 className="font-semibold mt-4 mb-1">Επιτρεπόμενα εισιτήρια</h4>
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto border rounded p-2">
              {enabledTypes.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm py-0.5">
                  <input type="checkbox" checked={draft.ticketTypeIds.includes(t.id)} onChange={() => toggleType(t.id)} className="w-4 h-4" />
                  {t.title} <span className="text-gray-500">({t.price.toFixed(2)}€)</span>
                </label>
              ))}
              {enabledTypes.length === 0 && <div className="text-gray-400 text-sm col-span-2">Δεν υπάρχουν ενεργοί τύποι.</div>}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDraft(null)} className="px-4 py-2 rounded border">Άκυρο</button>
              <button onClick={save} className="px-4 py-2 rounded bg-slate-800 text-white">Αποθήκευση</button>
            </div>
          </div>
        </div>
      )}
      <style>{`.inp{width:100%;border:1px solid #d1d5db;border-radius:.375rem;padding:.4rem .6rem}`}</style>
    </div>
  );
}
