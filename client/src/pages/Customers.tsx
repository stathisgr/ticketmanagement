import { useEffect, useState } from 'react';
import { api, dmy, type Customer } from '../api';

const blank = (): Partial<Customer> => ({ full_name: '', marketing_opt_in: 0 });

export default function Customers() {
  const [list, setList] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [custTickets, setCustTickets] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  async function openEdit(c: Customer) {
    setEditing(c); setCustTickets([]);
    try { setCustTickets(await api.get<any[]>(`/api/customers/${c.id}/tickets`)); } catch { /* ignore */ }
  }

  async function load() {
    try { setList(await api.get<Customer[]>(`/api/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)); }
    catch (e) { setMsg((e as Error).message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function save() {
    if (!editing?.full_name) { setMsg('Λείπει το ονοματεπώνυμο'); return; }
    setMsg('');
    try {
      if (editing.id) await api.put(`/api/customers/${editing.id}`, editing);
      else await api.post('/api/customers', editing);
      setEditing(null); load();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function remove(c: Customer) {
    if (!confirm(`Διαγραφή πελάτη «${c.full_name}»;`)) return;
    try { await api.del(`/api/customers/${c.id}`); load(); } catch (e) { setMsg((e as Error).message); }
  }

  function exportCsv() {
    const head = ['Ονοματεπώνυμο', 'ΑΦΜ', 'Email', 'Τηλ1', 'Τηλ2', 'Διεύθυνση', 'ΤΚ', 'Πόλη', 'Marketing', 'Αγορές'];
    const rows = list.map((c) => [c.full_name, c.vat_number, c.email, c.phone1, c.phone2, c.address, c.postal_code, c.city, c.marketing_opt_in ? 'ΝΑΙ' : 'ΟΧΙ', c.purchases ?? 0]
      .map((v) => `${v ?? ''}`.replace(/;/g, ',')).join(';'));
    const blob = new Blob(['﻿' + [head.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'pelatologio.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xl font-bold mr-2">Πελατολόγιο</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="🔍 Όνομα / τηλέφωνο / email / ΑΦΜ" className="border rounded px-3 py-1.5 w-72" />
        <button onClick={load} className="bg-slate-700 text-white px-3 py-1.5 rounded">Αναζήτηση</button>
        <button onClick={exportCsv} disabled={!list.length} className="bg-emerald-600 text-white px-3 py-1.5 rounded disabled:opacity-40">CSV</button>
        <button onClick={() => setEditing(blank())} className="ml-auto bg-slate-800 text-white px-4 py-1.5 rounded">+ Νέος πελάτης</button>
      </div>
      {msg && <div className="bg-red-100 text-red-700 p-2 rounded mb-2 text-sm">{msg}</div>}

      <table className="w-full border text-sm bg-white">
        <thead className="bg-gray-100"><tr>
          <th className="text-left p-2">Ονοματεπώνυμο</th><th className="text-left p-2">Τηλέφωνο</th>
          <th className="text-left p-2">Email</th><th className="text-left p-2">ΑΦΜ</th>
          <th className="text-left p-2">Πόλη</th><th className="text-center p-2">Marketing</th>
          <th className="text-right p-2">Αγορές</th><th></th>
        </tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2 font-medium">{c.full_name}</td>
              <td className="p-2">{c.phone1}{c.phone2 ? ` / ${c.phone2}` : ''}</td>
              <td className="p-2 text-gray-600">{c.email}</td>
              <td className="p-2">{c.vat_number}</td>
              <td className="p-2">{c.city}</td>
              <td className="p-2 text-center">{c.marketing_opt_in ? '✓' : '—'}</td>
              <td className="p-2 text-right">{c.purchases ?? 0}</td>
              <td className="p-2 text-right whitespace-nowrap">
                <button onClick={() => openEdit(c)} className="text-blue-600 mr-2">Επεξεργασία</button>
                <button onClick={() => remove(c)} className="text-red-600">Διαγραφή</button>
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={8} className="p-3 text-gray-400">Κανένας πελάτης.</td></tr>}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl p-5 w-[34rem] max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">{editing.id ? 'Επεξεργασία' : 'Νέος'} πελάτης</h3>
            <div className="grid grid-cols-2 gap-3">
              <F label="Ονοματεπώνυμο / Επωνυμία" full><input className="inp" value={editing.full_name ?? ''} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></F>
              <F label="ΑΦΜ"><input className="inp" value={editing.vat_number ?? ''} onChange={(e) => setEditing({ ...editing, vat_number: e.target.value })} /></F>
              <F label="Email"><input className="inp" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></F>
              <F label="Τηλέφωνο 1"><input className="inp" value={editing.phone1 ?? ''} onChange={(e) => setEditing({ ...editing, phone1: e.target.value })} /></F>
              <F label="Τηλέφωνο 2"><input className="inp" value={editing.phone2 ?? ''} onChange={(e) => setEditing({ ...editing, phone2: e.target.value })} /></F>
              <F label="Διεύθυνση" full><input className="inp" value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></F>
              <F label="ΤΚ"><input className="inp" value={editing.postal_code ?? ''} onChange={(e) => setEditing({ ...editing, postal_code: e.target.value })} /></F>
              <F label="Πόλη"><input className="inp" value={editing.city ?? ''} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></F>
              <F label="Σημειώσεις" full><input className="inp" value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></F>
              <label className="text-sm flex items-center gap-2 col-span-2 mt-1">
                <input type="checkbox" checked={!!editing.marketing_opt_in} onChange={(e) => setEditing({ ...editing, marketing_opt_in: e.target.checked ? 1 : 0 })} className="w-5 h-5" />
                Συναίνεση για ενημερώσεις / marketing
              </label>
            </div>

            {editing.id && (
              <div className="mt-4 border-t pt-3">
                <div className="font-semibold text-sm mb-1">Εισιτήρια / αγορές ({custTickets.length})</div>
                <div className="max-h-48 overflow-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100"><tr><th className="text-left p-1.5">Ημ/νία</th><th className="text-left p-1.5">Εισιτήριο</th><th className="text-left p-1.5">Θέση/Θέαμα</th><th className="text-right p-1.5">Αξία</th><th className="text-center p-1.5">Είσοδος</th></tr></thead>
                    <tbody>
                      {custTickets.map((t) => (
                        <tr key={t.id} className="border-t">
                          <td className="p-1.5">{dmy(t.datetime)} {(t.datetime ?? '').replace('T', ' ').slice(11, 16)}</td>
                          <td className="p-1.5 font-mono">{t.serial} · {t.title}</td>
                          <td className="p-1.5 text-gray-600">{t.seat ?? ''}{t.show_title ? ` · ${t.show_title}` : ''}{t.show_date ? ` (${dmy(t.show_date)})` : ''}</td>
                          <td className="p-1.5 text-right">{Number(t.line_total ?? 0).toFixed(2)} €</td>
                          <td className="p-1.5 text-center">{t.checked_in_at ? '✓' : '—'}</td>
                        </tr>
                      ))}
                      {custTickets.length === 0 && <tr><td colSpan={5} className="p-2 text-gray-400">Καμία αγορά.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded border">Άκυρο</button>
              <button onClick={save} className="px-4 py-2 rounded bg-slate-800 text-white">Αποθήκευση</button>
            </div>
          </div>
        </div>
      )}
      <style>{`.inp{width:100%;border:1px solid #d1d5db;border-radius:.375rem;padding:.4rem .6rem}`}</style>
    </div>
  );
}

function F({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`text-sm ${full ? 'col-span-2' : ''}`}>
      <span className="block text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
