import { useEffect, useState } from 'react';
import { api, type Customer } from '../api';

/**
 * Επιλογέας πελάτη για το POS. Προεπιλογή = «Λιανική» (χωρίς πελάτη → ανώνυμη ΑΠΥ).
 * Επιλέγεις συγκεκριμένο πελάτη μόνο όταν χρειάζεται (τιμολόγιο με ΑΦΜ, e-shop, marketing).
 */
export default function CustomerPicker({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [list, setList] = useState<Customer[]>([]);
  const [newName, setNewName] = useState('');
  const [newVat, setNewVat] = useState('');
  const [err, setErr] = useState('');

  async function search() {
    try { setList(await api.get<Customer[]>(`/api/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)); }
    catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { if (open) search(); /* eslint-disable-next-line */ }, [open]);

  async function quickAdd() {
    if (!newName.trim()) return;
    try {
      const c = await api.post<Customer>('/api/customers', { full_name: newName.trim(), vat_number: newVat.trim() || null });
      onChange(c); setOpen(false); setNewName(''); setNewVat('');
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="mb-2">
      <button onClick={() => setOpen(true)} className="w-full text-left border rounded px-3 py-2 bg-white hover:bg-gray-50 text-sm">
        <span className="text-gray-500">Πελάτης: </span>
        <span className="font-medium">{value ? value.full_name : 'Λιανική'}</span>
        {value?.vat_number ? <span className="text-gray-500"> · ΑΦΜ {value.vat_number}</span> : null}
        <span className="float-right text-gray-400">▾</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl p-4 w-[30rem] max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-2">
              <h3 className="font-bold">Επιλογή πελάτη</h3>
              <button onClick={() => { onChange(null); setOpen(false); }} className="ml-auto text-sm bg-gray-100 border rounded px-3 py-1">Λιανική (χωρίς πελάτη)</button>
            </div>
            {err && <div className="bg-red-100 text-red-700 p-2 rounded mb-2 text-sm">{err}</div>}
            <div className="flex gap-1 mb-2">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder="🔍 Όνομα / τηλέφωνο / ΑΦΜ" className="border rounded px-3 py-1.5 flex-1" />
              <button onClick={search} className="bg-slate-700 text-white px-3 rounded">Αναζήτηση</button>
            </div>
            <div className="border rounded divide-y max-h-56 overflow-auto mb-3">
              {list.map((c) => (
                <button key={c.id} onClick={() => { onChange(c); setOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                  <span className="font-medium">{c.full_name}</span>
                  {c.vat_number ? <span className="text-gray-500"> · ΑΦΜ {c.vat_number}</span> : null}
                  {c.phone1 ? <span className="text-gray-500"> · {c.phone1}</span> : null}
                </button>
              ))}
              {list.length === 0 && <div className="px-3 py-2 text-gray-400 text-sm">Κανένα αποτέλεσμα.</div>}
            </div>
            <div className="border-t pt-2">
              <div className="text-sm font-medium mb-1">Γρήγορη προσθήκη</div>
              <div className="flex gap-1">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ονοματεπώνυμο/Επωνυμία" className="border rounded px-2 py-1.5 flex-1" />
                <input value={newVat} onChange={(e) => setNewVat(e.target.value)} placeholder="ΑΦΜ (προαιρ.)" className="border rounded px-2 py-1.5 w-32" />
                <button onClick={quickAdd} className="bg-slate-800 text-white px-3 rounded">+</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
