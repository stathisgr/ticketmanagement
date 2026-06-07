import { useEffect, useState } from 'react';
import { api, getToken, type TicketType, type Venue, type FiscalConfig, type PrintTemplate, type Printer, type Station } from '../api';
import Halls from './Halls';

type Tab = 'business' | 'printers' | 'documents' | 'ticket' | 'types' | 'halls' | 'online' | 'about';

export default function Settings({ onSaved }: { onSaved?: () => void }) {
  const [tab, setTab] = useState<Tab>('business');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'business', label: 'Επιχείρηση' },
    { id: 'printers', label: 'Εκτυπωτές' },
    { id: 'documents', label: 'Παραστατικά' },
    { id: 'ticket', label: 'Φόρμες' },
    { id: 'types', label: 'Εκδοτήριο' },
    { id: 'halls', label: 'Αίθουσες' },
    { id: 'online', label: 'Online Ρυθμίσεις' },
    { id: 'about', label: 'Σχετικά' },
  ];
  return (
    <div className={`p-4 mx-auto ${tab === 'halls' ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <div className="flex gap-1 border-b mb-4 flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 -mb-px border-b-2 ${tab === t.id ? 'border-slate-800 font-semibold' : 'border-transparent text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'business' && <BusinessTab onSaved={onSaved} />}
      {tab === 'printers' && <PrintersTab />}
      {tab === 'documents' && <DocumentsTab />}
      {tab === 'ticket' && <><TicketFormTab /><RetailFormSection /></>}
      {tab === 'types' && <TypesTab />}
      {tab === 'halls' && <Halls />}
      {tab === 'online' && <OnlineTab />}
      {tab === 'about' && <AboutTab />}
      <style>{`.inp{width:100%;border:1px solid #d1d5db;border-radius:.375rem;padding:.45rem .6rem}`}</style>
    </div>
  );
}

function Msg({ text }: { text: string }) {
  if (!text) return null;
  const ok = text.startsWith('✓');
  return <div className={`${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} p-2 rounded mb-3 text-sm`}>{text}</div>;
}

/* ---------------- Online Ρυθμίσεις (Cloud σύνδεση) ---------------- */
interface OnlineCfg { supabase_url: string; sync_minutes_before: number; auto_sync_minutes?: number; enabled: boolean; has_key: boolean; last_auto_sync_at?: string | null; last_auto_sync_info?: string | null; }
function OnlineTab() {
  const [cfg, setCfg] = useState<OnlineCfg>({ supabase_url: '', sync_minutes_before: 60, auto_sync_minutes: 0, enabled: false, has_key: false });
  const [keyInput, setKeyInput] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [posProvider, setPosProvider] = useState<'none' | 'viva'>('none');
  const [posCfg, setPosCfg] = useState<any>({ env: 'demo' });
  const [email, setEmailState] = useState<any>({});
  const setEmail = (k: string, v: any) => setEmailState((e: any) => ({ ...e, [k]: v }));

  useEffect(() => {
    api.get<OnlineCfg>('/api/online/config').then(setCfg).catch(() => {});
    api.get<FiscalConfig>('/api/fiscal').then((fc) => {
      setPosProvider((fc.pos_provider as any) ?? 'none');
      try { setPosCfg({ env: 'demo', ...(fc.pos_config ? JSON.parse(fc.pos_config) : {}) }); } catch { setPosCfg({ env: 'demo' }); }
      try { const conf = fc.config ? JSON.parse(fc.config) : {}; setEmailState(conf.email ?? {}); } catch { setEmailState({}); }
    }).catch(() => {});
  }, []);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const body: any = { supabase_url: cfg.supabase_url, sync_minutes_before: cfg.sync_minutes_before, auto_sync_minutes: cfg.auto_sync_minutes ?? 0, enabled: cfg.enabled };
      if (keyInput) body.service_key = keyInput;
      const r = await api.put<OnlineCfg>('/api/online/config', body);
      setCfg(r); setKeyInput(''); setMsg('✓ Αποθηκεύτηκε');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function savePos() {
    setMsg('');
    try { await api.put('/api/fiscal', { pos_provider: posProvider, pos_config: posCfg }); setMsg('✓ Αποθηκεύτηκε (POS)'); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function testPos() {
    setMsg('Δοκιμή σύνδεσης POS…');
    try { const r = await api.post<{ ok: boolean; error?: string }>('/api/pos/test', {}); setMsg(r.ok ? '✓ Σύνδεση Viva ΟΚ (token)' : '✗ ' + (r.error ?? 'Αποτυχία')); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function testCheckout() {
    try {
      const r = await api.post<{ checkoutUrl: string; orderCode: string }>('/api/pos/checkout', { amount: 1.0, merchantTrns: 'Δοκιμή', customerTrns: 'Δοκιμαστική πληρωμή' });
      window.open(r.checkoutUrl, '_blank');
      setMsg(`✓ Δοκιμαστική πληρωμή 1,00€ (orderCode ${r.orderCode}) — άνοιξε το checkout.`);
    } catch (e) { setMsg((e as Error).message); }
  }
  async function saveEmail() {
    setMsg('');
    try {
      const fc = await api.get<FiscalConfig>('/api/fiscal');
      let conf: any = {}; try { conf = fc.config ? JSON.parse(fc.config) : {}; } catch { /* */ }
      conf.email = email;
      await api.put('/api/fiscal', { config: conf });
      setMsg('✓ Αποθηκεύτηκε (Email)');
    } catch (e) { setMsg((e as Error).message); }
  }
  async function testEmail() {
    const to = window.prompt('Δοκιμαστική αποστολή email σε:');
    if (!to) return;
    setMsg('Αποθήκευση + αποστολή δοκιμαστικού email…');
    try {
      const fc = await api.get<FiscalConfig>('/api/fiscal');
      let conf: any = {}; try { conf = fc.config ? JSON.parse(fc.config) : {}; } catch { /* */ }
      conf.email = email;
      await api.put('/api/fiscal', { config: conf });
      const r = await api.post<{ ok: boolean; error?: string }>('/api/fiscal/provider/test-email', { to });
      setMsg(r.ok ? `✓ Στάλθηκε δοκιμαστικό email στο ${to}` : '✗ ' + (r.error ?? 'Αποτυχία αποστολής'));
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div className="max-w-2xl">
      <Msg text={msg} />

      {/* 1) Σύνδεση POS / Κάρτες */}
      <h3 className="font-semibold mb-2">Σύνδεση POS / Κάρτες</h3>
      <L label="Πάροχος καρτών (POS)">
        <select className="inp" value={posProvider} onChange={(e) => setPosProvider(e.target.value as any)}>
          <option value="none">Χωρίς σύνδεση POS</option>
          <option value="viva">Viva Payments</option>
        </select>
      </L>
      {posProvider === 'viva' && (
        <div className="border rounded p-3 bg-gray-50">
          <div className="grid grid-cols-2 gap-3">
            <L label="Περιβάλλον">
              <select className="inp" value={posCfg.env ?? 'demo'} onChange={(e) => setPosCfg({ ...posCfg, env: e.target.value })}>
                <option value="demo">Demo</option>
                <option value="prod">Production</option>
              </select>
            </L>
            <L label="Merchant ID"><input className="inp" value={posCfg.merchantId ?? ''} onChange={(e) => setPosCfg({ ...posCfg, merchantId: e.target.value })} /></L>
            <L label="API Key (για κατάσταση πληρωμής)"><input type="password" className="inp" value={posCfg.apiKey ?? ''} onChange={(e) => setPosCfg({ ...posCfg, apiKey: e.target.value })} /></L>
            <L label="Smart Checkout — Client ID" full><input className="inp" value={posCfg.smartClientId ?? ''} onChange={(e) => setPosCfg({ ...posCfg, smartClientId: e.target.value })} /></L>
            <L label="Smart Checkout — Client Secret" full><input type="password" className="inp" value={posCfg.smartClientSecret ?? ''} onChange={(e) => setPosCfg({ ...posCfg, smartClientSecret: e.target.value })} /></L>
            <L label="POS (Cloud Terminal) — Client ID" full><input className="inp" value={posCfg.posClientId ?? ''} onChange={(e) => setPosCfg({ ...posCfg, posClientId: e.target.value })} /></L>
            <L label="POS — Client Secret" full><input type="password" className="inp" value={posCfg.posClientSecret ?? ''} onChange={(e) => setPosCfg({ ...posCfg, posClientSecret: e.target.value })} /></L>
            <L label="Terminal ID (φυσικό POS / SoftPOS)"><input className="inp" value={posCfg.terminalId ?? ''} onChange={(e) => setPosCfg({ ...posCfg, terminalId: e.target.value })} /></L>
            <L label="Source code ΤΑΜΕΙΟΥ"><input className="inp" placeholder="π.χ. 3859 (ή κενό = Default)" value={posCfg.sourceCode ?? ''} onChange={(e) => setPosCfg({ ...posCfg, sourceCode: e.target.value })} /></L>
            <L label="Source code ONLINE (πληροφοριακό)"><input className="inp" placeholder="ορίζεται στο cloud" value={posCfg.onlineSourceCode ?? ''} onChange={(e) => setPosCfg({ ...posCfg, onlineSourceCode: e.target.value })} /></L>
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-1">
            ⚠️ <b>Source code ΤΑΜΕΙΟΥ</b>: η πηγή Viva για τις πληρωμές στο ταμείο (π.χ. ο κωδικός χώρου Physical Payments). Άφησέ το <b>κενό</b> για την προεπιλεγμένη πηγή (web2/success – δεν κάνει redirect στο online). Αυτό χρησιμοποιεί η εφαρμογή για το ταμείο.<br />
            <b>Source code ONLINE</b>: μόνο πληροφοριακό εδώ — το online χρησιμοποιεί τη δική του πηγή πληρωμής (με Success URL → booking site) που ορίζεται στο cloud, όχι από αυτό το πεδίο.
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={testPos} className="bg-blue-600 text-white px-4 py-1.5 rounded">Δοκιμή σύνδεσης</button>
            <button onClick={testCheckout} className="bg-indigo-600 text-white px-4 py-1.5 rounded">Δοκιμή πληρωμής 1€</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Αποθήκευσε πρώτα. «Δοκιμή σύνδεσης» = έλεγχος credentials (OAuth token). «Δοκιμή πληρωμής» ανοίγει σελίδα Viva για 1,00€ (demo).</p>
        </div>
      )}
      <div><button onClick={savePos} className="mt-3 bg-slate-800 text-white px-5 py-2 rounded">Αποθήκευση POS</button></div>

      <hr className="my-5" />
      {/* 2) Email (αποδείξεις online & ειδοποιήσεις) */}
      <h3 className="font-semibold mb-2">Email (αποδείξεις online &amp; ειδοποιήσεις)</h3>
      <p className="text-xs text-gray-500 mb-2">Στις online πωλήσεις στέλνεται email με σύνδεσμο προς την επίσημη απόδειξη (ΑΠΥ/ΜΑΡΚ). Διάλεξε <b>Πάροχο</b>: <b>Resend</b> (API key) ή <b>Microsoft 365</b> (Graph — app registration με Application permission <i>Mail.Send</i> &amp; admin consent· το «Αποστολέας/From» πρέπει να είναι το mailbox, π.χ. noreply@domain.gr).</p>
      <div className="grid grid-cols-2 gap-3">
        <L label="Ενεργό">
          <select className="inp" value={email.enabled ? '1' : '0'} onChange={(e) => setEmail('enabled', e.target.value === '1')}>
            <option value="0">Όχι</option><option value="1">Ναι</option>
          </select>
        </L>
        <L label="Πάροχος">
          <select className="inp" value={email.provider ?? 'resend'} onChange={(e) => setEmail('provider', e.target.value)}>
            <option value="resend">Resend</option>
            <option value="graph">Microsoft 365 (Graph)</option>
          </select>
        </L>
        <L label="Αποστολέας (From)"><input className="inp" placeholder={(email.provider === 'graph') ? 'noreply@domain.gr (mailbox)' : 'Όνομα <noreply@domain.gr>'} value={email.from ?? ''} onChange={(e) => setEmail('from', e.target.value)} /></L>
        <L label="Reply-To (προαιρετικό)"><input className="inp" placeholder="info@domain.gr" value={email.replyTo ?? ''} onChange={(e) => setEmail('replyTo', e.target.value)} /></L>
        {(email.provider ?? 'resend') === 'graph' ? (
          <>
            <L label="Tenant ID (MS 365)"><input className="inp" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={email.tenantId ?? ''} onChange={(e) => setEmail('tenantId', e.target.value)} /></L>
            <L label="Client ID"><input className="inp" placeholder="application (client) id" value={email.clientId ?? ''} onChange={(e) => setEmail('clientId', e.target.value)} /></L>
            <L label="Client Secret"><input type="password" className="inp" value={email.clientSecret ?? ''} onChange={(e) => setEmail('clientSecret', e.target.value)} /></L>
          </>
        ) : (
          <L label="Resend API key"><input type="password" className="inp" placeholder="••••••••" value={email.resendKey ?? ''} onChange={(e) => setEmail('resendKey', e.target.value)} /></L>
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={saveEmail} className="bg-slate-800 text-white px-5 py-2 rounded">Αποθήκευση Email</button>
        <button onClick={testEmail} className="bg-sky-600 text-white px-4 py-1.5 rounded">Δοκιμαστικό email</button>
      </div>

      <hr className="my-5" />
      {/* 3) Online Cloud βάση */}
      <h3 className="font-semibold mb-1">Online Cloud βάση</h3>
      <p className="text-xs text-gray-500 mb-3">Σύνδεση με την cloud βάση των online κρατήσεων. Το κλειδί μένει μόνο τοπικά στον server και δεν φεύγει στον browser του πελάτη.</p>
      <L label="Διεύθυνση Cloud (URL)">
        <input className="inp" placeholder="https://..." value={cfg.supabase_url} onChange={(e) => setCfg({ ...cfg, supabase_url: e.target.value })} />
      </L>
      <L label={`Κλειδί υπηρεσίας (service key)${cfg.has_key ? ' — αποθηκευμένο, άφησέ το κενό για να μην αλλάξει' : ''}`}>
        <input type="password" className="inp" placeholder={cfg.has_key ? '•••••••• αποθηκευμένο' : 'service key'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
      </L>
      <div className="grid grid-cols-3 gap-3 mt-2">
        <L label="Λεπτά πριν το θέαμα (κλείσιμο online)">
          <input type="number" min={0} className="inp" value={cfg.sync_minutes_before} onChange={(e) => setCfg({ ...cfg, sync_minutes_before: Number(e.target.value) })} />
        </L>
        <L label="Αυτόματος συγχρονισμός κάθε (λεπτά, 0=ανενεργό)">
          <input type="number" min={0} className="inp" value={cfg.auto_sync_minutes ?? 0} onChange={(e) => setCfg({ ...cfg, auto_sync_minutes: Number(e.target.value) })} />
        </L>
        <label className="flex items-end gap-2 text-sm pb-2">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Ενεργό
        </label>
      </div>
      <p className="text-xs text-gray-500 mt-1">Ο αυτόματος συγχρονισμός τρέχει στον server (κατέβασμα online πωλήσεων + έκδοση παραστατικών) <b>χωρίς να χρειάζεται συνδεδεμένος χρήστης</b>. Απαιτεί ενεργή σύνδεση cloud.</p>
      {(cfg.auto_sync_minutes ?? 0) > 0 && !cfg.enabled && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">⚠ Έχεις ορίσει αυτόματο συγχρονισμό κάθε {cfg.auto_sync_minutes}′ αλλά το <b>«Ενεργό»</b> δεν είναι τσεκαρισμένο — ο συγχρονισμός <b>δεν τρέχει</b>. Τσέκαρε «Ενεργό» και πάτα Αποθήκευση.</p>
      )}
      {(cfg.auto_sync_minutes ?? 0) > 0 && cfg.enabled && (
        <p className="text-sm text-gray-600 mt-2">
          Τελευταίος αυτόματος συγχρονισμός: <b>{cfg.last_auto_sync_at ? new Date(cfg.last_auto_sync_at).toLocaleString('el-GR') : 'δεν έχει τρέξει ακόμη'}</b>
          {cfg.last_auto_sync_info ? <> — {cfg.last_auto_sync_info}</> : null}
          {!cfg.last_auto_sync_at ? <span className="block text-xs text-gray-400">Η πρώτη εκτέλεση γίνεται έως {cfg.auto_sync_minutes}′ μετά την αποθήκευση/επανεκκίνηση του server.</span> : null}
        </p>
      )}
      <div className="mt-2"><button onClick={() => api.get<OnlineCfg>('/api/online/config').then(setCfg).catch(() => {})} className="text-sm text-slate-600 underline">↻ Ανανέωση κατάστασης</button></div>
      <button onClick={save} disabled={busy} className="mt-3 bg-slate-800 text-white px-5 py-2 rounded disabled:opacity-40">Αποθήκευση Cloud</button>

      <p className="text-sm text-gray-500 mt-4"><b>Πάροχος ηλεκτρονικής έκδοσης (RapidSign)</b> παραμένει στην καρτέλα «Εκτυπωτές» (δεμένος με τις φορολογικές ρυθμίσεις).</p>
    </div>
  );
}
/* ---------------- Επιχείρηση ---------------- */
function BusinessTab({ onSaved }: { onSaved?: () => void }) {
  const [v, setV] = useState<Venue | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get<Venue>('/api/venue').then(setV); }, []);
  if (!v) return <div className="text-gray-400">Φόρτωση…</div>;
  const set = (k: keyof Venue, val: any) => setV({ ...v, [k]: val });

  async function save() {
    try { await api.put('/api/venue', v); setMsg('✓ Αποθηκεύτηκε'); onSaved?.(); }
    catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div>
      <Msg text={msg} />
      <div className="grid grid-cols-2 gap-3">
        <L label="Επωνυμία" full><input className="inp" value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} /></L>
        <L label="ΑΦΜ"><input className="inp" value={v.vat_number ?? ''} onChange={(e) => set('vat_number', e.target.value)} /></L>
        <L label="ΔΟΥ"><input className="inp" value={v.tax_office ?? ''} onChange={(e) => set('tax_office', e.target.value)} /></L>
        <L label="Διεύθυνση" full><input className="inp" value={v.address ?? ''} onChange={(e) => set('address', e.target.value)} /></L>
        <L label="ΤΚ"><input className="inp" value={v.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} /></L>
        <L label="Πόλη"><input className="inp" value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} /></L>
        <L label="Τηλέφωνο"><input className="inp" value={v.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></L>
        <L label="Email"><input className="inp" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} /></L>
        <L label="Συντ. ΦΠΑ %"><input type="number" className="inp" value={v.default_vat ?? 24} onChange={(e) => set('default_vat', Number(e.target.value))} /></L>
      </div>

      <h3 className="font-semibold mt-5 mb-2">Τρόπος λειτουργίας έκδοσης</h3>
      <div className="flex gap-3">
        {([['serial', 'Σειριακή (POS)'], ['halls', 'Αίθουσες/Θέσεις'], ['both', 'Και τα δύο']] as const).map(([val, lbl]) => (
          <label key={val} className={`flex-1 border rounded-lg p-3 cursor-pointer ${v.pos_mode === val ? 'ring-2 ring-slate-700 bg-slate-50' : ''}`}>
            <input type="radio" name="posmode" className="mr-2" checked={v.pos_mode === val} onChange={() => set('pos_mode', val)} />
            {lbl}
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-1">Καθορίζει ποιες οθόνες έκδοσης εμφανίζονται (Έκδοση ή/και Θέσεις).</p>

      <button onClick={save} className="mt-5 bg-slate-800 text-white px-5 py-2 rounded">Αποθήκευση</button>

      <PasswordSection />
      <BackupSection />
    </div>
  );
}

/* ---------------- Αλλαγή κωδικού (συνδεδεμένος χρήστης) ---------------- */
function PasswordSection() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [conf, setConf] = useState('');
  const [msg, setMsg] = useState('');

  async function save() {
    setMsg('');
    if (next.length < 4) { setMsg('Ο νέος κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες'); return; }
    if (next !== conf) { setMsg('Ο νέος κωδικός και η επιβεβαίωση δεν ταιριάζουν'); return; }
    try {
      await api.post('/api/me/password', { current: cur, next });
      setMsg('✓ Ο κωδικός άλλαξε'); setCur(''); setNext(''); setConf('');
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div className="mt-8 border-t pt-4">
      <h3 className="font-semibold mb-2">Κωδικός διαχειριστή</h3>
      <Msg text={msg} />
      <p className="text-xs text-gray-500 mb-2">Αλλαγή του κωδικού του συνδεδεμένου λογαριασμού. Συνιστάται να αλλάξεις τον προεπιλεγμένο κωδικό.</p>
      <div className="grid grid-cols-3 gap-3 max-w-2xl">
        <L label="Τρέχων κωδικός"><input type="password" className="inp" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></L>
        <L label="Νέος κωδικός"><input type="password" className="inp" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></L>
        <L label="Επιβεβαίωση"><input type="password" className="inp" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" /></L>
      </div>
      <button onClick={save} className="mt-2 bg-slate-800 text-white px-4 py-1.5 rounded text-sm">Αλλαγή κωδικού</button>
    </div>
  );
}

/* ---------------- Αντίγραφα ασφαλείας ---------------- */
function BackupSection() {
  const [list, setList] = useState<{ file: string; size: number; mtime: string }[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() { try { setList(await api.get('/api/backups')); } catch { /* ignore */ } }
  useEffect(() => { load(); }, []);

  function saveBlob(file: string, bytes: Uint8Array) {
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = file; a.click();
    URL.revokeObjectURL(url);
  }

  async function createBackup() {
    setBusy(true); setMsg('');
    try {
      const res = await api.post<{ file: string; base64: string; size: number }>('/api/backup', {});
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      saveBlob(res.file, bytes);
      setMsg(`✓ Δημιουργήθηκε & κατέβηκε: ${res.file} (${(res.size / 1024).toFixed(0)} KB)`);
      load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function download(file: string) {
    const r = await fetch(`/api/backups/${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) { setMsg('Αποτυχία λήψης'); return; }
    saveBlob(file, new Uint8Array(await r.arrayBuffer()));
  }

  async function del(file: string) {
    if (!window.confirm(`Διαγραφή αντιγράφου «${file}»;`)) return;
    setBusy(true); setMsg('');
    try { await api.del(`/api/backups/${encodeURIComponent(file)}`); setMsg(`✓ Διαγράφηκε: ${file}`); load(); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-8 border-t pt-4">
      <div className="flex items-center mb-2">
        <h3 className="font-semibold">Αντίγραφα ασφαλείας (βάση δεδομένων)</h3>
        <button onClick={createBackup} disabled={busy} className="ml-auto bg-emerald-600 text-white px-4 py-1.5 rounded disabled:opacity-50">
          {busy ? '…' : 'Δημιουργία & λήψη backup'}
        </button>
      </div>
      <Msg text={msg} />
      <p className="text-xs text-gray-500 mb-2">Δημιουργεί συνεπές αντίγραφο της βάσης (ασφαλές ακόμη κι ενώ τρέχει) στον φάκελο <code>backups/</code> του server και το κατεβάζει στον υπολογιστή σου.</p>
      {list.length > 0 && (
        <table className="w-full border text-sm bg-white">
          <thead className="bg-gray-100"><tr><th className="text-left p-2">Αρχείο</th><th className="text-right p-2">Μέγεθος</th><th className="text-left p-2">Ημ/νία</th><th></th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.file} className="border-t">
                <td className="p-2 font-mono">{b.file}</td>
                <td className="p-2 text-right">{(b.size / 1024).toFixed(0)} KB</td>
                <td className="p-2">{b.mtime.replace('T', ' ').slice(0, 16)}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button onClick={() => download(b.file)} className="text-blue-600 mr-3">Λήψη</button>
                  <button onClick={() => del(b.file)} disabled={busy} className="text-red-600 disabled:opacity-40">Διαγραφή</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Εκτυπωτές + Ταμειακή ---------------- */
const blankPrinter = (): Partial<Printer> => ({ name: '', type: 'escpos80', connection: 'network', address: '', copies: 1, auto_cut: 1, drawer_kick: 0, is_default: 0 });

function PrintersTab() {
  const [f, setF] = useState<FiscalConfig | null>(null);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [editing, setEditing] = useState<Partial<Printer> | null>(null);
  const [prov, setProv] = useState<any>({ env: 'dev' });
  const [msg, setMsg] = useState('');

  async function load() {
    const fc = await api.get<FiscalConfig>('/api/fiscal');
    setF(fc);
    try { setProv({ env: 'dev', ...(fc.config ? JSON.parse(fc.config) : {}) }); } catch { setProv({ env: 'dev' }); }
    setPrinters(await api.get<Printer[]>('/api/printers'));
    setStations(await api.get<Station[]>('/api/stations'));
  }
  useEffect(() => { load().catch((e) => setMsg((e as Error).message)); }, []);

  async function saveFiscal() {
    if (!f) return;
    // Μόνο φορολογικά πεδία (το POS/Κάρτες μεταφέρθηκε στην καρτέλα «Online Ρυθμίσεις»).
    try { await api.put('/api/fiscal', { issue_mode: f.issue_mode, legal_note: f.legal_note, export_folder: f.export_folder, provider: f.provider, config: prov }); setMsg('✓ Αποθηκεύτηκε'); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function testProvider() {
    setMsg('Δοκιμή σύνδεσης…');
    try {
      const r = await api.post<{ ok: boolean; error?: string; lookups?: any }>('/api/fiscal/provider/test', {});
      if (r.ok) {
        const it = r.lookups?.invoiceTypes?.jsonData?.idNames ?? r.lookups?.invoiceTypes?.idNames ?? [];
        setMsg(`✓ Σύνδεση ΟΚ με τον πάροχο (${Array.isArray(it) ? it.length : '—'} τύποι παραστατικών). Ρύθμισε τα παραστατικά στην καρτέλα «Παραστατικά».`);
      } else setMsg('✗ ' + (r.error ?? 'Αποτυχία σύνδεσης'));
    } catch (e) { setMsg((e as Error).message); }
  }

  async function savePrinter() {
    if (!editing?.name) { setMsg('Λείπει το όνομα εκτυπωτή'); return; }
    try {
      if (editing.id) await api.put(`/api/printers/${editing.id}`, editing);
      else await api.post('/api/printers', editing);
      setEditing(null); setMsg('✓ Αποθηκεύτηκε'); load();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function delPrinter(id: number) { if (confirm('Διαγραφή εκτυπωτή;')) { await api.del(`/api/printers/${id}`); load(); } }
  async function testPrint(id: number) {
    try {
      const r = await api.post<{ dispatch: { sent: boolean; reason?: string } }>(`/api/printers/${id}/test`, {});
      setMsg(r.dispatch.sent ? '✓ Στάλθηκε δοκιμαστική εκτύπωση στον εκτυπωτή' : `ℹ️ Render OK. Αποστολή: ${r.dispatch.reason ?? '—'}`);
    } catch (e) { setMsg((e as Error).message); }
  }

  async function addStation() {
    const name = prompt('Όνομα σταθμού (π.χ. ΤΑΜΕΙΟ 1):'); if (!name) return;
    try { await api.post('/api/stations', { name }); load(); } catch (e) { setMsg((e as Error).message); }
  }
  async function setStationPrinter(id: number, printer_id: number | null, name: string) {
    await api.put(`/api/stations/${id}`, { name, printer_id }); load();
  }
  async function delStation(id: number) { if (confirm('Διαγραφή σταθμού;')) { await api.del(`/api/stations/${id}`); load(); } }

  const connLabel = (c: string) => ({ network: 'Δίκτυο (IP)', usb: 'USB', system: 'Windows', file: 'Αρχείο' } as any)[c] ?? c;
  const typeLabel = (t: string) => ({ escpos58: '58mm', escpos80: '80mm', zpl: 'Zebra ZPL' } as any)[t] ?? t;

  return (
    <div>
      <Msg text={msg} />

      {/* Εκτυπωτές */}
      <div className="flex items-center mb-2">
        <h3 className="font-semibold">Εκτυπωτές</h3>
        <button onClick={() => setEditing(blankPrinter())} className="ml-auto bg-slate-800 text-white px-4 py-1.5 rounded">+ Νέος εκτυπωτής</button>
      </div>
      <table className="w-full border text-sm bg-white mb-2">
        <thead className="bg-gray-100"><tr>
          <th className="text-left p-2">Όνομα</th><th className="text-left p-2">Τύπος</th>
          <th className="text-left p-2">Σύνδεση</th><th className="text-left p-2">Διεύθυνση</th>
          <th className="text-center p-2">Αντίγρ.</th><th className="text-center p-2">Κοπή</th>
          <th className="text-center p-2">Συρτάρι</th><th className="text-center p-2">Προεπ/νος</th><th></th>
        </tr></thead>
        <tbody>
          {printers.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="p-2 font-medium">{p.name}</td>
              <td className="p-2">{typeLabel(p.type)}</td>
              <td className="p-2">{connLabel(p.connection)}</td>
              <td className="p-2 text-gray-600">{p.address}</td>
              <td className="p-2 text-center">{p.copies}</td>
              <td className="p-2 text-center">{p.auto_cut ? '✓' : '—'}</td>
              <td className="p-2 text-center">{p.drawer_kick ? '✓' : '—'}</td>
              <td className="p-2 text-center">{p.is_default ? '★' : ''}</td>
              <td className="p-2 text-right whitespace-nowrap">
                <button onClick={() => testPrint(p.id)} className="text-emerald-700 mr-2">Δοκιμή</button>
                <button onClick={() => setEditing(p)} className="text-blue-600 mr-2">Επεξεργασία</button>
                <button onClick={() => delPrinter(p.id)} className="text-red-600">✕</button>
              </td>
            </tr>
          ))}
          {printers.length === 0 && <tr><td colSpan={9} className="p-3 text-gray-400">Κανένας εκτυπωτής.</td></tr>}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mb-5">Δικτυακοί θερμικοί (IP:9100) εκτυπώνουν απευθείας. USB/Windows χρειάζονται τοπικό agent/OS spooler (επόμενο βήμα deployment).</p>

      {/* Σταθμοί */}
      <div className="flex items-center mb-2">
        <h3 className="font-semibold">Σταθμοί / Ταμεία</h3>
        <button onClick={addStation} className="ml-auto bg-slate-800 text-white px-4 py-1.5 rounded">+ Νέος σταθμός</button>
      </div>
      <table className="w-full border text-sm bg-white mb-1">
        <thead className="bg-gray-100"><tr><th className="text-left p-2">Σταθμός</th><th className="text-left p-2">Εκτυπωτής</th><th></th></tr></thead>
        <tbody>
          {stations.map((st) => (
            <tr key={st.id} className="border-t">
              <td className="p-2 font-medium">{st.name}</td>
              <td className="p-2">
                <select className="border rounded px-2 py-1" value={st.printer_id ?? ''} onChange={(e) => setStationPrinter(st.id, e.target.value ? Number(e.target.value) : null, st.name)}>
                  <option value="">— κανένας —</option>
                  {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td className="p-2 text-right"><button onClick={() => delStation(st.id)} className="text-red-600">✕</button></td>
            </tr>
          ))}
          {stations.length === 0 && <tr><td colSpan={3} className="p-3 text-gray-400">Κανένας σταθμός.</td></tr>}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mb-5">Κάθε Η/Υ-ταμείο δηλώνει το όνομα σταθμού του (στον browser) και χρησιμοποιεί τον αντίστοιχο εκτυπωτή.</p>

      {/* Φορολογικά */}
      {f && (
        <>
          <h3 className="font-semibold mb-2">Λειτουργία έκδοσης</h3>
          <L label="Τι εκδίδεται σε κάθε πώληση">
            <select className="inp" value={f.issue_mode ?? 'ticket_only'} onChange={(e) => setF({ ...f, issue_mode: e.target.value as any })}>
              <option value="disabled">Χωρίς έκδοση (τίποτα)</option>
              <option value="ticket_only">Μόνο εισιτήριο — χωρίς φορολογικό παραστατικό</option>
              <option value="cash_register">Εισιτήριο + Ταμειακή (ΦΗΜ) — η ταμειακή εκδίδει/ανεβάζει myDATA</option>
              <option value="provider">Εισιτήριο μέσω Παρόχου — το εισιτήριο ΕΙΝΑΙ το παραστατικό (myDATA)</option>
            </select>
          </L>
          <p className="text-xs text-gray-500 mb-2">
            {f.issue_mode === 'disabled' && 'Δεν εκτυπώνεται/καταχωρείται φορολογικά τίποτα.'}
            {(!f.issue_mode || f.issue_mode === 'ticket_only') && 'Εκτυπώνεται μόνο εισιτήριο με την ένδειξη ότι δεν είναι φορολογικό παραστατικό (π.χ. απαλλασσόμενη επιχείρηση).'}
            {f.issue_mode === 'cash_register' && 'Το εισιτήριο (με ένδειξη «μη φορολογικό») + η απόδειξη πάει στην ταμειακή που είναι το φορολογικό στοιχείο.'}
            {f.issue_mode === 'provider' && 'Το εισιτήριο αποστέλλεται στον πάροχο, παίρνει ΜΑΡΚ/QR και γίνεται το νόμιμο παραστατικό· αν υπάρχει πελάτης, αποστέλλεται και με email.'}
          </p>
          {(f.issue_mode === 'ticket_only' || f.issue_mode === 'cash_register' || !f.issue_mode) && (
            <L label="Κείμενο ένδειξης «μη φορολογικού» (τυπώνεται στο εισιτήριο)" full>
              <input className="inp" value={f.legal_note ?? 'Δεν αποτελεί φορολογικό παραστατικό'} onChange={(e) => setF({ ...f, legal_note: e.target.value })} />
            </L>
          )}
          {f.issue_mode === 'cash_register' && (
            <L label="Φάκελος αποθήκευσης TXT (όπου τα διαβάζει ο agent της ταμειακής)" full>
              <input className="inp" placeholder="π.χ. C:\Capture" value={f.export_folder ?? ''} onChange={(e) => setF({ ...f, export_folder: e.target.value })} />
            </L>
          )}
          {f.issue_mode === 'provider' && (
            <div className="border rounded p-3 bg-gray-50">
              <div className="font-medium text-sm mb-2">Πάροχος: RapidSign / MyMat</div>
              <div className="grid grid-cols-2 gap-3">
                <L label="Περιβάλλον">
                  <select className="inp" value={prov.env ?? 'dev'} onChange={(e) => setProv({ ...prov, env: e.target.value })}>
                    <option value="dev">Dev (δοκιμές) — dev.rapidsign.com.gr</option>
                    <option value="prod">Production — app.rapidsign.com.gr</option>
                  </select>
                </L>
                <L label="Username"><input className="inp" value={prov.username ?? ''} onChange={(e) => setProv({ ...prov, username: e.target.value })} /></L>
                <L label="Password"><input type="password" className="inp" value={prov.password ?? ''} onChange={(e) => setProv({ ...prov, password: e.target.value })} /></L>
                <L label="Activation code"><input className="inp" value={prov.activationCode ?? ''} onChange={(e) => setProv({ ...prov, activationCode: e.target.value })} /></L>
                <L label="ΑΦΜ εκδότη"><input className="inp" value={prov.issuerVat ?? ''} onChange={(e) => setProv({ ...prov, issuerVat: e.target.value })} /></L>
                <L label="Σειρά (Series)"><input className="inp" placeholder="π.χ. ΑΠΥ" value={prov.series ?? ''} onChange={(e) => setProv({ ...prov, series: e.target.value })} /></L>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={testProvider} className="bg-blue-600 text-white px-4 py-1.5 rounded">Δοκιμή σύνδεσης</button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Πρώτα Αποθήκευση, μετά «Δοκιμή σύνδεσης». Η ρύθμιση των παραστατικών (ΑΠΥ, Ακυρωτικό) και οι παράμετροι myDATA γίνονται στην καρτέλα <b>«Παραστατικά»</b>.</p>
            </div>
          )}
          <div><button onClick={saveFiscal} className="mt-3 bg-slate-800 text-white px-5 py-2 rounded">Αποθήκευση</button></div>
          <p className="text-xs text-gray-400 mt-2">Η «Σύνδεση POS / Κάρτες (Viva)» μεταφέρθηκε στην καρτέλα «Online Ρυθμίσεις».</p>
        </>
      )}

      {/* Modal εκτυπωτή */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl p-5 w-[28rem]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">{editing.id ? 'Επεξεργασία' : 'Νέος'} εκτυπωτής</h3>
            <div className="grid grid-cols-2 gap-3">
              <L label="Όνομα" full><input className="inp" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></L>
              <L label="Τύπος">
                <select className="inp" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}>
                  <option value="escpos58">Θερμικός 58mm</option>
                  <option value="escpos80">Θερμικός 80mm</option>
                  <option value="zpl">Zebra (ZPL)</option>
                </select>
              </L>
              <L label="Σύνδεση">
                <select className="inp" value={editing.connection} onChange={(e) => setEditing({ ...editing, connection: e.target.value as any })}>
                  <option value="network">Δίκτυο (IP:port)</option>
                  <option value="usb">USB</option>
                  <option value="system">Windows (όνομα)</option>
                  <option value="file">Αρχείο (φάκελος)</option>
                </select>
              </L>
              <L label={editing.connection === 'network' ? 'Διεύθυνση (π.χ. 192.168.1.50:9100)' : 'Διεύθυνση/Όνομα'} full>
                <input className="inp" value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
              </L>
              <L label="Αντίγραφα"><input type="number" min={1} className="inp" value={editing.copies ?? 1} onChange={(e) => setEditing({ ...editing, copies: Number(e.target.value) })} /></L>
              <L label="Προεπιλεγμένος"><input type="checkbox" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked ? 1 : 0 })} className="w-5 h-5" /></L>
              <L label="Αυτόματη κοπή"><input type="checkbox" checked={!!editing.auto_cut} onChange={(e) => setEditing({ ...editing, auto_cut: e.target.checked ? 1 : 0 })} className="w-5 h-5" /></L>
              <L label="Άνοιγμα συρταριού"><input type="checkbox" checked={!!editing.drawer_kick} onChange={(e) => setEditing({ ...editing, drawer_kick: e.target.checked ? 1 : 0 })} className="w-5 h-5" /></L>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded border">Άκυρο</button>
              <button onClick={savePrinter} className="px-4 py-2 rounded bg-slate-800 text-white">Αποθήκευση</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Παραστατικά (myDATA) — ρύθμιση ανά παραστατικό ---------------- */
// Migration παλιού μοντέλου (apy/credit/extra/productDocId/productCreditDocId) → ενιαία λίστα.
// Ίδια λογική με τον server (fiscal/docs.ts) ώστε UI & engine να συμφωνούν.
let _docSeq = 0;
const _docId = () => Date.now() + (++_docSeq);
function migrateDocList(docs: any): any[] {
  if (docs && Array.isArray(docs.list) && docs.list.length) return docs.list;
  const out: any[] = [];
  const apy = (docs && docs.apy) || {};
  const credit = (docs && docs.credit) || {};
  const extra: any[] = (docs && docs.extra) || [];
  const CREDIT_TYPES = new Set([5, 16, 22, 23, 24]);
  const looksCredit = (e: any) => CREDIT_TYPES.has(Number(e?.invoiceTypeId)) || /πιστωτ/i.test(String(e?.label || ''));
  const svcCreditId: number = Number(credit.id) || _docId();
  out.push({ id: svcCreditId, label: 'Πιστωτικό Υπηρεσιών (ΠΑΠΥ)', enabled: true, role: 'credit', for: 'service', counterpart: 'retail', creditDocId: null, invoiceTypeId: credit.invoiceTypeId ?? 22, series: credit.series ?? 'ΠΑΠΥ', aaStart: credit.aaStart ?? '', incomeCatId: credit.incomeCatId ?? 2, incomeValId: credit.incomeValId ?? 8, vatExemptionId: credit.vatExemptionId ?? 0, paymentCashId: 3, paymentCardId: 7, acquirerId: credit.acquirerId ?? 0, paymentStatus: 2 });
  out.push({ id: Number(apy.id) || _docId(), label: 'Απόδειξη Παροχής Υπηρεσιών (ΑΠΥ)', enabled: true, role: 'sale', for: 'service', counterpart: 'retail', creditDocId: svcCreditId, invoiceTypeId: apy.invoiceTypeId ?? 20, series: apy.series ?? 'ΑΠΥ', aaStart: apy.aaStart ?? '', incomeCatId: apy.incomeCatId ?? 2, incomeValId: apy.incomeValId ?? 8, vatExemptionId: apy.vatExemptionId ?? 0, paymentCashId: apy.paymentCashId ?? 3, paymentCardId: apy.paymentCardId ?? 7, acquirerId: apy.acquirerId ?? 0, paymentStatus: apy.paymentStatus ?? 2 });
  for (const e of extra) {
    const isCr = looksCredit(e);
    out.push({ id: Number(e.id) || _docId(), label: e.label || 'Παραστατικό', enabled: e.enabled !== false, role: isCr ? 'credit' : 'sale', for: 'product', counterpart: 'retail', creditDocId: isCr ? null : (String(e.id) === String(docs?.productDocId) ? (docs?.productCreditDocId ?? null) : null), invoiceTypeId: e.invoiceTypeId ?? 0, series: e.series ?? '', aaStart: e.aaStart ?? '', incomeCatId: e.incomeCatId ?? 2, incomeValId: e.incomeValId ?? 8, vatExemptionId: e.vatExemptionId ?? 0, paymentCashId: e.paymentCashId ?? 3, paymentCardId: e.paymentCardId ?? 7, acquirerId: e.acquirerId ?? 0, paymentStatus: e.paymentStatus ?? 2 });
  }
  for (const d of out) {
    if (d.role === 'sale' && d.creditDocId == null) {
      const c = out.find((x) => x.role === 'credit' && x.for === d.for);
      if (c) d.creditDocId = c.id;
    }
  }
  return out;
}

function DocumentsTab() {
  const [cfg, setCfg] = useState<any | null>(null);   // πλήρες config παρόχου (creds + docs)
  const [lookups, setLookups] = useState<any>(null);
  const [lastGuid, setLastGuid] = useState('');
  const [lastMark, setLastMark] = useState('');
  const [msg, setMsg] = useState('');
  const [editId, setEditId] = useState<number | null>(null);

  useEffect(() => {
    api.get<FiscalConfig>('/api/fiscal').then((fc) => {
      let c: any = {}; try { c = fc.config ? JSON.parse(fc.config) : {}; } catch { /* ignore */ }
      // Migration: αν δεν υπάρχει ακόμη η ενιαία λίστα, φτιάξ' την από το παλιό μοντέλο.
      c.docs = c.docs ?? {};
      if (!Array.isArray(c.docs.list) || !c.docs.list.length) c.docs.list = migrateDocList(c.docs);
      setCfg(c);
    }).catch((e) => setMsg((e as Error).message));
  }, []);
  if (!cfg) return <div className="text-gray-400">Φόρτωση…</div>;

  const hasProvider = !!cfg.username;
  const email = cfg.email || {};
  const setEmail = (k: string, v: any) => setCfg((c: any) => ({ ...c, email: { ...(c.email ?? {}), [k]: v } }));
  const list: any[] = (cfg.docs && cfg.docs.list) || [];
  const setList = (arr: any[]) => setCfg((c: any) => ({ ...c, docs: { ...(c.docs ?? {}), list: arr } }));
  const updDoc = (id: number, k: string, v: any) => setList(list.map((d) => (d.id === id ? { ...d, [k]: v } : d)));
  const addDoc = (role: 'sale' | 'credit') => {
    const id = Date.now();
    setList([...list, { id, label: role === 'credit' ? 'Νέο πιστωτικό' : 'Νέο παραστατικό', enabled: true, role, for: 'service', counterpart: 'retail', creditDocId: null, invoiceTypeId: role === 'credit' ? 22 : 20, series: '', aaStart: '', incomeCatId: 2, incomeValId: 8, vatExemptionId: 0, paymentCashId: 3, paymentCardId: 7, acquirerId: 0, paymentStatus: 2 }]);
    setEditId(id);
  };
  const delDoc = (id: number) => { setList(list.filter((d) => d.id !== id)); if (editId === id) setEditId(null); };
  const editing = list.find((d) => d.id === editId) || null;
  const creditDocs = list.filter((d) => d.role === 'credit');
  const hasEnabledApy = list.some((d) => d.role === 'sale' && d.enabled && d.for === 'service' && d.counterpart === 'retail');
  const usageLabel = (d: any) => `${d.for === 'product' ? 'Προϊόντα' : 'Υπηρεσίες'} · ${d.counterpart === 'invoice' ? 'Τιμολόγιο' : 'Λιανική'}`;
  const typeName = (id: any) => { const t = lookups?.invoiceTypes?.find((x: any) => String(x.id) === String(id)); return t ? `${t.id} — ${t.name}` : (id ? String(id) : '—'); };

  async function save() {
    setMsg('');
    try { await api.put('/api/fiscal', { config: cfg }); setMsg('✓ Αποθηκεύτηκαν οι ρυθμίσεις παραστατικών'); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function loadLookups() {
    setMsg('Φόρτωση λιστών παρόχου…');
    try { setLookups(await api.get('/api/fiscal/provider/lookups')); setMsg('✓ Φορτώθηκαν οι λίστες του παρόχου'); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function testInvoice() {
    setMsg('Δοκιμαστική έκδοση ΑΠΥ…');
    try {
      const r = await api.post<{ ok: boolean; error?: string; mark?: string; qrCode?: string; guid?: string }>('/api/fiscal/provider/test-invoice', {});
      if (r.ok) { setLastGuid(r.guid ?? ''); setLastMark(r.mark ?? ''); setMsg(`✓ Εκδόθηκε δοκιμαστικό ΑΠΥ — MARK ${r.mark}${r.guid ? ' · guid ' + r.guid : ''}. ${r.qrCode ? 'QR: ' + r.qrCode : ''}`); }
      else setMsg('✗ ' + (r.error ?? 'Αποτυχία έκδοσης'));
    } catch (e) { setMsg((e as Error).message); }
  }
  async function testCredit() {
    if (!lastMark) { setMsg('Κάνε πρώτα «Δοκιμή έκδοσης ΑΠΥ» για να πάρεις ΜΑΡΚ.'); return; }
    setMsg('Δοκιμαστική έκδοση Πιστωτικού…');
    try {
      const r = await api.post<{ ok: boolean; error?: string; mark?: string }>('/api/fiscal/provider/test-credit', { mark: lastMark });
      setMsg(r.ok ? `✓ Εκδόθηκε Πιστωτικό για το ΜΑΡΚ ${lastMark} — νέο ΜΑΡΚ ${r.mark}` : '✗ ' + (r.error ?? 'Αποτυχία έκδοσης πιστωτικού'));
    } catch (e) { setMsg((e as Error).message); }
  }
  async function testVoid() {
    if (!lastGuid) { setMsg('Κάνε πρώτα «Δοκιμή έκδοσης ΑΠΥ» για να πάρεις guid.'); return; }
    setMsg('Δοκιμαστική ακύρωση (void)…');
    try {
      const r = await api.post<{ ok: boolean; error?: string }>('/api/fiscal/provider/void-test', { guid: lastGuid, reason: 'Δοκιμή ακύρωσης' });
      setMsg(r.ok ? `✓ Ακυρώθηκε (void) το παραστατικό (guid ${lastGuid})` : '✗ ' + (r.error ?? 'Αποτυχία void'));
    } catch (e) { setMsg((e as Error).message); }
  }
  async function testEmail() {
    const to = window.prompt('Δοκιμαστική αποστολή email απόδειξης σε:');
    if (!to) return;
    setMsg('Αποθήκευση + αποστολή δοκιμαστικού email…');
    try {
      await api.put('/api/fiscal', { config: cfg });   // αποθήκευσε πρώτα τη ρύθμιση email
      const r = await api.post<{ ok: boolean; error?: string }>('/api/fiscal/provider/test-email', { to });
      setMsg(r.ok ? `✓ Στάλθηκε δοκιμαστικό email στο ${to}` : '✗ ' + (r.error ?? 'Αποτυχία αποστολής'));
    } catch (e) { setMsg((e as Error).message); }
  }

  const Sel = ({ list, value, onChange, fallback }: { list?: any[]; value: any; onChange: (v: number | null) => void; fallback: number }) =>
    list ? (
      <select className="inp" value={value ?? fallback} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">—</option>
        {list.map((x: any) => <option key={x.id} value={x.id}>{(x.twoLetterCode || x.myDataCode) ? `${x.twoLetterCode || x.myDataCode} — ` : ''}{x.name}</option>)}
      </select>
    ) : <input className="inp" type="number" value={value ?? fallback} onChange={(e) => onChange(Number(e.target.value))} />;

  return (
    <div className="max-w-3xl">
      <Msg text={msg} />
      {!hasProvider && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-sm mb-3">
          Δεν έχει ρυθμιστεί πάροχος. Πήγαινε στην καρτέλα <b>«Εκτυπωτές» → Λειτουργία έκδοσης → «Εισιτήριο μέσω Παρόχου»</b>, βάλε τα στοιχεία σύνδεσης και κάνε «Δοκιμή σύνδεσης». Μετά γύρνα εδώ.
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold">Παραστατικά &amp; παράμετροι myDATA</h3>
        <button onClick={loadLookups} className="ml-auto bg-slate-600 text-white px-4 py-1.5 rounded text-sm">Φόρτωση λιστών παρόχου</button>
      </div>
      <p className="text-xs text-gray-500 mb-4">Πάτα «Φόρτωση λιστών παρόχου» για να γεμίσουν οι επιλογές με τους επίσημους κωδικούς (τύποι, κατηγορίες/χαρακτηρισμοί εσόδου, acquirers). Ο συντελεστής ΦΠΑ αντιστοιχίζεται αυτόματα ανά τύπο εισιτηρίου (24%→1, 13%→2, 6%→3, 0%→7).</p>

      {/* ΕΝΙΑΙΑ ΛΙΣΤΑ ΠΑΡΑΣΤΑΤΙΚΩΝ */}
      <div className="border rounded-lg p-4 mb-4 bg-white">
        <div className="flex items-center mb-2 gap-2 flex-wrap">
          <h4 className="font-semibold">Παραστατικά</h4>
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">πώληση &amp; πιστωτικό</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => addDoc('sale')} className="text-sm bg-slate-700 text-white px-3 py-1 rounded">+ Πώλησης</button>
            <button onClick={() => addDoc('credit')} className="text-sm bg-red-700 text-white px-3 py-1 rounded">+ Πιστωτικό</button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-2">Κάθε παραστατικό δηλώνει τη <b>χρήση</b> του (Υπηρεσίες/Προϊόντα · Λιανική/Τιμολόγιο). Σε κάθε παραστατικό <b>πώλησης</b> ορίζεις ποιο είναι το <b>πιστωτικό</b> του. Η έκδοση διαλέγει αυτόματα το σωστό παραστατικό ανά πώληση. <i>Προς το παρόν εκδίδονται μόνο Λιανικής (ΑΠΥ/ΑΛΠ)· τα Τιμολόγια ορίζονται αλλά δεν μπαίνουν ακόμη στη ροή.</i> Πάτησε σε γραμμή για επεξεργασία.</p>
        {!hasEnabledApy && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2 rounded text-xs mb-2">⚠ Πρέπει να υπάρχει τουλάχιστον ΕΝΑ ενεργό παραστατικό πώλησης «Υπηρεσίες · Λιανική» (ΑΠΥ).</div>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr><th className="py-1">Ονομασία</th><th>Ρόλος</th><th>Τύπος</th><th>Σειρά</th><th>Χρήση</th><th>Πιστωτικό</th><th className="text-center">Ενεργό</th><th></th></tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} className="text-gray-400 py-2">Δεν έχουν οριστεί παραστατικά.</td></tr>}
            {list.map((d: any) => (
              <tr key={d.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setEditId(d.id)}>
                <td className="py-1.5 font-medium">{d.label}</td>
                <td>{d.role === 'credit' ? <span className="text-red-700">Πιστωτικό</span> : <span className="text-emerald-700">Πώληση</span>}</td>
                <td className="text-gray-600">{typeName(d.invoiceTypeId)}</td>
                <td>{d.series || '—'}</td>
                <td className="text-gray-600">{usageLabel(d)}</td>
                <td className="text-gray-600">{d.role === 'sale' ? (list.find((x: any) => String(x.id) === String(d.creditDocId))?.label || '—') : ''}</td>
                <td className="text-center" onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" className="w-4 h-4" checked={d.enabled !== false} onChange={(ev) => updDoc(d.id, 'enabled', ev.target.checked)} />
                </td>
                <td className="text-right" onClick={(ev) => ev.stopPropagation()}>
                  <button onClick={() => delDoc(d.id)} className="text-red-600 text-xs px-2">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2 mt-3 flex-wrap border-t pt-3">
          <button onClick={testInvoice} className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm">Δοκιμή έκδοσης ΑΠΥ</button>
          <button onClick={testCredit} disabled={!lastMark} className="bg-red-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-40">Δοκιμή Πιστωτικού (ΜΑΡΚ)</button>
          <button onClick={testVoid} disabled={!lastGuid} className="bg-orange-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-40">Δοκιμή ακύρωσης (void)</button>
        </div>
      </div>

      {/* MODAL: επεξεργασία παραστατικού */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditId(null)}>
          <div className="bg-white rounded-xl p-5 w-[34rem] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">Επεξεργασία παραστατικού</h3>
            <div className="grid grid-cols-2 gap-3">
              <L label="Ονομασία" full><input className="inp" value={editing.label ?? ''} onChange={(e) => updDoc(editing.id, 'label', e.target.value)} /></L>
              <L label="Ρόλος">
                <select className="inp" value={editing.role} onChange={(e) => updDoc(editing.id, 'role', e.target.value)}>
                  <option value="sale">Πώληση (έκδοση)</option>
                  <option value="credit">Πιστωτικό (ακύρωση)</option>
                </select>
              </L>
              <L label="Ενεργό">
                <select className="inp" value={editing.enabled !== false ? '1' : '0'} onChange={(e) => updDoc(editing.id, 'enabled', e.target.value === '1')}>
                  <option value="1">Ναι</option><option value="0">Όχι</option>
                </select>
              </L>
              <L label="Για">
                <select className="inp" value={editing.for} onChange={(e) => updDoc(editing.id, 'for', e.target.value)}>
                  <option value="service">Υπηρεσίες (εισιτήρια)</option>
                  <option value="product">Εμπορικά προϊόντα</option>
                </select>
              </L>
              <L label="Τύπος συναλλαγής">
                <select className="inp" value={editing.counterpart} onChange={(e) => updDoc(editing.id, 'counterpart', e.target.value)}>
                  <option value="retail">Λιανική (ΑΠΥ/ΑΛΠ)</option>
                  <option value="invoice">Τιμολόγιο</option>
                </select>
              </L>
              {editing.role === 'sale' && (
                <L label="Πιστωτικό του">
                  <select className="inp" value={editing.creditDocId ?? ''} onChange={(e) => updDoc(editing.id, 'creditDocId', e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">— κανένα —</option>
                    {creditDocs.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </L>
              )}
              <L label="Τύπος παραστατικού (myDATA)"><Sel list={lookups?.invoiceTypes} value={editing.invoiceTypeId} fallback={editing.role === 'credit' ? 22 : 20} onChange={(v) => updDoc(editing.id, 'invoiceTypeId', v)} /></L>
              <L label="Σειρά"><input className="inp" value={editing.series ?? ''} onChange={(e) => updDoc(editing.id, 'series', e.target.value)} /></L>
              <L label="Τρέχον ΑΑ (αυτόματο — ρυθμιζόμενο)"><input className="inp" type="number" placeholder="κενό = συνέχεια αρίθμησης" value={editing.aaStart ?? ''} onChange={(e) => updDoc(editing.id, 'aaStart', e.target.value === '' ? '' : Number(e.target.value))} /><small style={{ color: '#6b7280', display: 'block', marginTop: 2 }}>Ενημερώνεται αυτόματα με τον τελευταίο αα που εκδόθηκε. Άλλαξέ το για να ορίσεις από πού θα συνεχίσει η αρίθμηση.</small></L>
              <L label="Κατηγορία εσόδου (myDATA)"><Sel list={lookups?.incomeCategories} value={editing.incomeCatId} fallback={2} onChange={(v) => updDoc(editing.id, 'incomeCatId', v)} /></L>
              <L label="Χαρακτηρισμός εσόδου (E3)"><Sel list={lookups?.incomeValues} value={editing.incomeValId} fallback={8} onChange={(v) => updDoc(editing.id, 'incomeValId', v)} /></L>
              <L label="Κατηγορία απαλλαγής ΦΠΑ (0% / δωρεάν)"><Sel list={lookups?.vatExemptions} value={editing.vatExemptionId} fallback={0} onChange={(v) => updDoc(editing.id, 'vatExemptionId', v)} /></L>
              <L label="Πληρωμή · Μετρητά (PaymentId)"><input className="inp" type="number" value={editing.paymentCashId ?? 3} onChange={(e) => updDoc(editing.id, 'paymentCashId', Number(e.target.value))} /></L>
              <L label="Πληρωμή · Κάρτα (PaymentId)"><input className="inp" type="number" value={editing.paymentCardId ?? 7} onChange={(e) => updDoc(editing.id, 'paymentCardId', Number(e.target.value))} /></L>
              <L label="Acquirer κάρτας"><Sel list={lookups?.acquirers} value={editing.acquirerId} fallback={0} onChange={(v) => updDoc(editing.id, 'acquirerId', v)} /></L>
              <L label="Διασύνδεση POS">
                <select className="inp" value={editing.paymentStatus ?? 2} onChange={(e) => updDoc(editing.id, 'paymentStatus', Number(e.target.value))}>
                  <option value={2}>Με Διασύνδεση</option>
                  <option value={1}>Χωρίς Διασύνδεση</option>
                </select>
              </L>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => delDoc(editing.id)} className="text-red-600 px-3 py-1.5 text-sm">Διαγραφή</button>
              <button onClick={() => setEditId(null)} className="bg-slate-800 text-white px-5 py-1.5 rounded text-sm">Κλείσιμο</button>
            </div>
          </div>
        </div>
      )}

      <button onClick={save} className="bg-slate-800 text-white px-5 py-2 rounded">Αποθήκευση παραστατικών</button>

      <p className="text-xs text-gray-500 mt-4 border-t pt-3">
        Η αναλυτική λίστα παραστατικών (ΜΑΡΚ, κατάσταση, πελάτης, έκδοση πιστωτικού, επανεκτύπωση, αναζήτηση/φίλτρα)
        βρίσκεται πλέον στην καρτέλα <b>«Παραστατικά»</b> του μενού.
      </p>
    </div>
  );
}

/* ---------------- Φόρμα εισιτηρίου (print template) ---------------- */
function AboutTab() {
  return (
    <div className="max-w-2xl">
      <div className="bg-white border rounded-xl p-6 text-center">
        <img src="/assets/logo-alpha.webp" alt="Alpha ΠΛΗΡΟΦΟΡΙΚΗ ΑΕ" className="h-20 mx-auto mb-4"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <h3 className="text-xl font-bold">Alpha ΠΛΗΡΟΦΟΡΙΚΗ ΑΕ</h3>
        <p className="text-gray-600 mt-1">Λ. Δημοκρατίας 39 — Αλεξανδρούπολη 68132</p>
        <div className="mt-4 grid gap-1.5 text-sm">
          <div>Τηλ.: <a className="text-blue-600" href="tel:+302551038444">+30 2551038444</a></div>
          <div>Support E-Mail: <a className="text-blue-600" href="mailto:support@alphait.gr">support@alphait.gr</a></div>
          <div>Web Site: <a className="text-blue-600" href="https://axd.gr" target="_blank" rel="noreferrer">https://axd.gr</a></div>
        </div>
        <div className="mt-4">
          <a className="text-blue-600 font-medium" href="https://get.teamviewer.com/alphapc" target="_blank" rel="noreferrer">Ζήτα Online Τεχνική Υποστήριξη</a>
          <p className="text-[11px] text-gray-400 mt-1">Κατέβασε την εφαρμογή, εκτέλεσέ την και δώσε στο τεχνικό μας τμήμα το ID του συστήματός σου.</p>
        </div>
        <p className="text-xs text-gray-400 mt-5">Alpha Ticket Manager — © 2026 Alpha ΠΛΗΡΟΦΟΡΙΚΗ ΑΕ. All Rights Reserved.</p>
      </div>
    </div>
  );
}

/* ---------------- Φόρμα Απόδειξης Λιανικής (προϊόντα) ---------------- */
function RetailFormSection() {
  const [t, setT] = useState<any>(null);
  const [showVat, setShowVat] = useState(true);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.get<any>('/api/retail-template').then((row) => {
      setT(row);
      let p: any = {}; try { p = JSON.parse(row.params ?? '{}'); } catch { /* default */ }
      setShowVat(p.showVat !== false);
    }).catch(() => {});
  }, []);
  if (!t) return null;
  async function save() {
    try { await api.put('/api/retail-template', { header: t.header, footer: t.footer, showVat }); setMsg('✓ Αποθηκεύτηκε'); }
    catch (e) { setMsg((e as Error).message); }
  }
  const PH = ['venueName', 'vatNumber', 'taxOffice', 'address', 'cityLine', 'phone', 'docType', 'series', 'aa', 'datetime', 'customerName', 'customerVat', 'total', 'paymentMethod', 'mark'];
  return (
    <div className="mt-8 border-t pt-5 max-w-3xl">
      <h3 className="font-bold mb-1">Φόρμα Απόδειξης Λιανικής (προϊόντα)</h3>
      <p className="text-xs text-gray-500 mb-1">Επεξεργάζεσαι μόνο το <b>Header</b> (στοιχεία επιχείρησης) και το <b>Footer</b>. Τα <b>είδη, η ανάλυση ΦΠΑ και τα σύνολα</b> μπαίνουν αυτόματα. Το πλάτος (58/80mm) προσαρμόζεται αυτόματα στον εκτυπωτή.</p>
      <Msg text={msg} />
      <label className="text-sm block mb-2">Header (στοιχεία επιχείρησης)
        <textarea className="inp" rows={5} value={t.header ?? ''} onChange={(e) => setT({ ...t, header: e.target.value })} /></label>
      <label className="text-sm block mb-2">Footer (κλείσιμο)
        <textarea className="inp" rows={3} value={t.footer ?? ''} onChange={(e) => setT({ ...t, footer: e.target.value })} /></label>
      <div className="flex gap-4 items-center flex-wrap mb-2 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={showVat} onChange={(e) => setShowVat(e.target.checked)} /> Ανάλυση ΦΠΑ ανά συντελεστή</label>
        <span className="text-xs text-gray-400">Ελληνικά / code page: από τις ρυθμίσεις εκτυπωτή της φόρμας εισιτηρίου.</span>
      </div>
      <div className="text-xs text-gray-500 mb-2">Διαθέσιμες παράμετροι: {PH.map((x) => `{{${x}}}`).join('  ')} · Το QR του myDATA μπαίνει αυτόματα όταν υπάρχει ΜΑΡΚ.</div>
      <button onClick={save} className="bg-slate-800 text-white px-5 py-2 rounded">Αποθήκευση φόρμας λιανικής</button>
    </div>
  );
}

const PLACEHOLDERS = ['venueName', 'vatNumber', 'address', 'cityLine', 'phone', 'email', 'title', 'subtitle', 'qty', 'unitPrice', 'lineTotal', 'total', 'vatRate', 'vatAmount', 'netValue', 'serial', 'datetime', 'paymentMethod', 'seat', 'show', 'showDate', 'showTime', 'showDateTime', 'customerName', 'customerVat', 'docType', 'series', 'aa', 'mark', 'legalNote'];
const SAMPLE: Record<string, string> = {
  venueName: 'ΜΟΥΣΕΙΟ', vatNumber: '123456789', address: 'Οδός 1', cityLine: '10675 Αθήνα', phone: '2100000000', email: 'info@x.gr',
  title: 'ΚΑΝΟΝΙΚΟ', subtitle: 'Γενική Είσοδος', qty: '1', unitPrice: '5.00', lineTotal: '5.00', total: '10.00', vatRate: '6',
  vatAmount: '0.28', netValue: '4.72',
  serial: '00000123', datetime: '01/06/2026 19:49', paymentMethod: 'ΜΕΤΡΗΤΑ', seat: 'A12', show: 'ΤΑΙΝΙΑ 1',
  showDate: '06/06/2026', showTime: '21:00', showDateTime: '06/06/2026 21:00',
  customerName: 'ΠΑΠΑΔΟΠΟΥΛΟΣ Α.', customerVat: '044556677', docType: 'ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', series: 'ΑΠΥ', aa: '5',
  mark: '400001234567890',
  legalNote: 'Δεν αποτελεί φορολογικό παραστατικό',
};
const stripTags = (line: string) => {
  let s = line; let isQr = false;
  const re = /^\s*\[(s[1-4]|c|l|r|b|qr)\]/i;
  let m: RegExpMatchArray | null;
  while ((m = s.match(re))) { if (m[1].toLowerCase() === 'qr') isQr = true; s = s.slice(m[0].length); }
  return isQr ? '[QR]' : s;
};
const fill = (s: string) =>
  (s ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => SAMPLE[k] ?? '').split('\n').map(stripTags).join('\n');

function TicketFormTab() {
  const [t, setT] = useState<PrintTemplate | null>(null);
  const [withQr, setWithQr] = useState(true);
  const [qrContent, setQrContent] = useState<'serial' | 'serial_uid'>('serial_uid');
  const [codePage, setCodePage] = useState('cp737');
  const [pageId, setPageId] = useState(14);
  const [sizes, setSizes] = useState({ header: 2, details: 1, footer: 1 });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.get<PrintTemplate>('/api/print-template').then((row) => {
      setT(row);
      try {
        const p = JSON.parse(row.params ?? '{}');
        setWithQr(p.withQr !== false);
        setQrContent(p.qrContent === 'serial' ? 'serial' : 'serial_uid');
        if (p.codePage) setCodePage(p.codePage);
        if (Number.isFinite(p.escposPageId)) setPageId(p.escposPageId);
        if (p.sizes) setSizes({ header: p.sizes.header ?? 2, details: p.sizes.details ?? 1, footer: p.sizes.footer ?? 1 });
      } catch { /* defaults */ }
    });
  }, []);
  if (!t) return <div className="text-gray-400">Φόρτωση…</div>;

  async function testPrintForm() {
    try {
      const printers = await api.get<any[]>('/api/printers');
      const p = printers.find((x) => x.is_default) ?? printers[0];
      if (!p) { setMsg('Δεν υπάρχει εκτυπωτής — πρόσθεσε έναν στην καρτέλα «Εκτυπωτές».'); return; }
      const r = await api.post<{ dispatch: { sent: boolean; reason?: string } }>(`/api/printers/${p.id}/test`, {});
      setMsg(r.dispatch.sent ? `✓ Στάλθηκε δοκιμή στον «${p.name}»` : `ℹ️ Render OK στον «${p.name}». Αποστολή: ${r.dispatch.reason ?? '—'}`);
    } catch (e) { setMsg((e as Error).message); }
  }

  // Προεπιλεγμένο pageId ανά code page (συχνές τιμές — ρυθμιζόμενο).
  function pickCodePage(cp: string) {
    setCodePage(cp);
    if (cp === 'cp737') setPageId(14);
    else if (cp === 'windows-1253') setPageId(47);
    else if (cp === 'cp437') setPageId(0);
  }

  async function save() {
    try { await api.put('/api/print-template', { ...t, withQr, qrContent, codePage, escposPageId: pageId, sizes }); setMsg('✓ Αποθηκεύτηκε'); }
    catch (e) { setMsg((e as Error).message); }
  }
  const isThermal = t.printer_type !== 'zpl';

  const preview = [
    fill(t.header ?? ''),
    '--------------------------------',
    fill(t.details ?? ''),
    withQr ? '[ ▦ QR: ' + SAMPLE.serial + ' ]' : '',
    '--------------------------------',
    fill(t.footer ?? ''),
  ].filter(Boolean).join('\n');

  return (
    <div>
      <Msg text={msg} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <L label="Τύπος εκτυπωτή">
            <select className="inp" value={t.printer_type} onChange={(e) => setT({ ...t!, printer_type: e.target.value as any })}>
              <option value="escpos58">Θερμικός 58mm</option>
              <option value="escpos80">Θερμικός 80mm</option>
              <option value="zpl">Zebra (ZPL)</option>
            </select>
          </L>
          <L label="Κεφαλίδα (Header)" full><textarea className="inp h-24 font-mono text-sm" value={t.header ?? ''} onChange={(e) => setT({ ...t!, header: e.target.value })} /></L>
          <L label="Σώμα (Details)" full><textarea className="inp h-24 font-mono text-sm" value={t.details ?? ''} onChange={(e) => setT({ ...t!, details: e.target.value })} /></L>
          <L label="Υποσέλιδο (Footer)" full><textarea className="inp h-20 font-mono text-sm" value={t.footer ?? ''} onChange={(e) => setT({ ...t!, footer: e.target.value })} /></L>
          <div className="text-xs text-gray-500 -mt-1 mb-1 bg-amber-50 border rounded p-2">
            <b>Ετικέτες ανά γραμμή</b> (στην αρχή): <code>[s1]…[s4]</code> μέγεθος, <code>[c]</code>/<code>[l]</code>/<code>[r]</code> στοίχιση, <code>[b]</code> έντονα, <code>[qr]</code> το QR.
            Π.χ. <code>[s2][c]{'{{venueName}}'}</code>
          </div>
          <label className="flex items-center gap-2 text-sm mt-1">
            <input type="checkbox" checked={withQr} onChange={(e) => setWithQr(e.target.checked)} className="w-4 h-4" /> Εκτύπωση QR Code
          </label>
          {withQr && (
            <L label="Περιεχόμενο QR">
              <select className="inp" value={qrContent} onChange={(e) => setQrContent(e.target.value as any)}>
                <option value="serial_uid">Αριθμός εισιτηρίου + μοναδικός κωδικός</option>
                <option value="serial">Μόνο αριθμός εισιτηρίου</option>
              </select>
            </L>
          )}

          {isThermal && (
            <div className="mt-3 border-t pt-3">
              <div className="text-sm font-semibold mb-1">Ελληνικά & μέγεθος (θερμικός)</div>
              <div className="grid grid-cols-2 gap-3">
                <L label="Κωδικοσελίδα (Ελληνικά)">
                  <select className="inp" value={codePage} onChange={(e) => pickCodePage(e.target.value)}>
                    <option value="cp737">Ελληνικά CP737 (DOS)</option>
                    <option value="windows-1253">Ελληνικά Windows-1253</option>
                    <option value="cp437">Λατινικά / PC437</option>
                  </select>
                </L>
                <L label="ESC t page (π.χ. 64 για το μοντέλο σου)">
                  <input type="number" className="inp" value={pageId} onChange={(e) => setPageId(Number(e.target.value))} />
                </L>
                <L label="Μέγεθος κεφαλίδας">
                  <select className="inp" value={sizes.header} onChange={(e) => setSizes({ ...sizes, header: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}×</option>)}
                  </select>
                </L>
                <L label="Μέγεθος σώματος">
                  <select className="inp" value={sizes.details} onChange={(e) => setSizes({ ...sizes, details: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}×</option>)}
                  </select>
                </L>
                <L label="Μέγεθος υποσέλιδου">
                  <select className="inp" value={sizes.footer} onChange={(e) => setSizes({ ...sizes, footer: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}×</option>)}
                  </select>
                </L>
              </div>
              <p className="text-xs text-gray-500 mt-1">Αν δεν τυπώνονται σωστά τα ελληνικά, δοκίμασε άλλη κωδικοσελίδα ή άλλο «ESC t page» (διαφέρει ανά μοντέλο — συχνά 14 για CP737). Δοκίμασε με το κουμπί «Δοκιμή» στους Εκτυπωτές.</p>
            </div>
          )}
        </div>
        <div>
          <div className="text-sm font-semibold mb-1">Προεπισκόπηση</div>
          <pre className="bg-gray-50 border rounded p-3 text-xs whitespace-pre-wrap min-h-[12rem]">{preview}</pre>
          <div className="text-xs text-gray-500 mt-2">
            <div className="font-semibold mb-1">Διαθέσιμες παράμετροι (κλικ για αντιγραφή):</div>
            <div className="flex flex-wrap gap-1">
              {PLACEHOLDERS.map((p) => (
                <button key={p} onClick={() => navigator.clipboard?.writeText(`{{${p}}}`)}
                  className="px-1.5 py-0.5 bg-gray-100 border rounded font-mono hover:bg-gray-200">{`{{${p}}}`}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={save} className="bg-slate-800 text-white px-5 py-2 rounded">Αποθήκευση φόρμας</button>
        <button onClick={testPrintForm} className="bg-emerald-600 text-white px-5 py-2 rounded">Δοκιμή εκτύπωσης</button>
      </div>
      <p className="text-xs text-gray-500 mt-1">Η «Δοκιμή» στέλνει δοκιμαστικό στον προεπιλεγμένο εκτυπωτή (Αποθήκευσε πρώτα για να ισχύσουν code page/μέγεθος).</p>
    </div>
  );
}

/* ---------------- Τύποι Εισιτηρίων ---------------- */
const blank = (): Partial<TicketType> => ({
  title: '', subtitle: '', price: 0, default_qty: 1, vat_rate: 24,
  default_payment: 'prompt', enabled: 1, sort_order: 0, color: '#f3f4f6', kind: 0,
});
const payText = (p?: string) => (p === 'cash' ? 'Μετρητά' : p === 'card' ? 'Κάρτα' : '— επιλογή —');
// Έτοιμα εικονίδια (emoji) — υπηρεσίες + προϊόντα. Χωρίς φόρτωση εικόνων (~100).
const ICONS = [
  // Εισιτήρια / θεάματα / κινηματογράφος / θέατρο
  '🎫', '🎟️', '🎬', '🎥', '📽️', '🎞️', '🍿', '🎭', '🎪', '🎨', '🖼️', '🎙️',
  // Μουσική / συναυλίες / χορός
  '🎵', '🎶', '🎤', '🎧', '🎷', '🎸', '🎹', '🎺', '🥁', '🎻', '🪕', '💃', '🕺', '🩰',
  // Πολιτισμός / μουσεία / εκπαίδευση
  '🏛️', '🗿', '🗽', '⛪', '🕌', '🎓', '📚', '🔬', '🔭', '🦖', '🦕', '🐉', '🌍', '🪐', '🧪',
  // Αθλήματα
  '⚽', '🏀', '🏐', '🏈', '⚾', '🎾', '🏉', '🥏', '🎱', '🏓', '🏸', '🥅', '🏒', '🏑', '🏏', '⛳', '🏹', '🥊', '🥋', '⛸️', '🎿', '🏂', '🏊', '🚴', '🏆', '🥇', '🏅',
  // Παιχνίδια / διασκέδαση / λούνα παρκ
  '🎮', '🕹️', '🎯', '🎲', '♟️', '🧩', '🎰', '🎡', '🎢', '🎠', '🤡', '🎈', '🎉', '🎊', '✨', '⭐', '🌟', '🎆', '🎇', '🎃', '🎄',
  // Παιδικά / οικογένεια / πρόσβαση / πάρκινγκ / μεταφορές
  '🧒', '👶', '👨‍👩‍👧', '♿', '🅿️', '🚌', '🚆', '🚢', '⛴️',
  // Ποτά
  '☕', '🍵', '🥤', '🧃', '🧋', '💧', '🍺', '🍻', '🍷', '🍸', '🍹', '🥂', '🧊',
  // Φαγητό / σνακ / γλυκά
  '🍔', '🍟', '🍕', '🌭', '🥨', '🥪', '🌮', '🍦', '🍨', '🍩', '🍪', '🧁', '🍰', '🎂', '🍫', '🍬', '🍭', '🥜',
  // Λιανική / διάφορα
  '🛍️', '🎁', '📦', '🏷️', '🔖', '🧾', '🛒', '💶', '⭐',
];

/* Αρίθμηση εισιτηρίων (venue-level) — ζει στους Τύπους Εισιτηρίων. */
function NumberingSection() {
  const [v, setV] = useState<Venue | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get<Venue>('/api/venue').then(setV).catch(() => {}); }, []);
  if (!v) return null;
  const set = (k: keyof Venue, val: any) => setV({ ...v, [k]: val });
  async function save() {
    try { await api.put('/api/venue', v); setMsg('✓ Αποθηκεύτηκε'); } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div className="bg-white border rounded-lg p-4 mb-5">
      <h3 className="font-semibold mb-2">Αρίθμηση εισιτηρίων</h3>
      <Msg text={msg} />
      <div className="flex gap-3 mb-2">
        {([['unified', 'Ενιαία (ένας μετρητής για όλα)'], ['per_type', 'Ανά τύπο (πρόθεμα + δικός του μετρητής)']] as const).map(([val, lbl]) => (
          <label key={val} className={`flex-1 border rounded-lg p-3 cursor-pointer ${v.numbering_mode === val ? 'ring-2 ring-slate-700 bg-slate-50' : ''}`}>
            <input type="radio" name="numbering" className="mr-2" checked={v.numbering_mode === val} onChange={() => set('numbering_mode', val)} />
            {lbl}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {v.numbering_mode === 'unified' && (
          <L label="Επόμενος αριθμός (αρχή σειράς)"><input type="number" min={1} className="inp" value={v.serial_next ?? 1} onChange={(e) => set('serial_next', Number(e.target.value))} /></L>
        )}
        <L label="Ψηφία (zero-padding)"><input type="number" min={1} max={12} className="inp" value={v.serial_width ?? 6} onChange={(e) => set('serial_width', Number(e.target.value))} /></L>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {v.numbering_mode === 'unified'
          ? `Παράδειγμα επόμενου: ${String(v.serial_next ?? 1).padStart(Math.min(12, Math.max(1, v.serial_width ?? 6)), '0')}. Κάθε εισιτήριο παίρνει τον επόμενο αριθμό.`
          : 'Όρισε το πρόθεμα & την αρχή σε κάθε τύπο εισιτηρίου παρακάτω, π.χ. Α000001, Β000001.'}
      </p>
      <h3 className="font-semibold mt-5 mb-2">Έλεγχος εισόδου (check-in)</h3>
      <L label="Λεπτά πριν την έναρξη που ανοίγει η είσοδος (0 = χωρίς όριο)">
        <input type="number" min={0} max={240} className="inp" value={v.checkin_window_min ?? 30}
          onChange={(e) => set('checkin_window_min', Number(e.target.value))} />
      </L>
      <p className="text-xs text-gray-500 mt-1">Το check-in δέχεται εισιτήρια μόνο για το θέαμα που «τρέχει» τώρα — ανοίγει τόσα λεπτά πριν την έναρξη και κλείνει στη λήξη, ανεξαρτήτως αίθουσας.</p>
      <button onClick={save} className="mt-3 bg-slate-800 text-white px-4 py-1.5 rounded text-sm">Αποθήκευση</button>
    </div>
  );
}

function TypesTab() {
  const [types, setTypes] = useState<TicketType[]>([]);
  const [editing, setEditing] = useState<Partial<TicketType> | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try { setTypes(await api.get<TicketType[]>('/api/ticket-types')); } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setError('');
    try {
      if (editing.id) await api.put(`/api/ticket-types/${editing.id}`, editing);
      else await api.post('/api/ticket-types', editing);
      setEditing(null); load();
    } catch (e) { setError((e as Error).message); }
  }
  async function remove(id: number) {
    if (!confirm('Διαγραφή τύπου εισιτηρίου;')) return;
    await api.del(`/api/ticket-types/${id}`); load();
  }

  const nextOrder = Math.max(0, ...types.map((t) => t.sort_order || 0)) + 10;

  return (
    <div>
      <div className="flex items-center mb-3">
        <h3 className="font-semibold">Τύποι εισιτηρίων</h3>
        <button onClick={() => setEditing({ ...blank(), sort_order: nextOrder })} className="ml-auto bg-slate-800 text-white px-4 py-1.5 rounded">+ Νέο</button>
      </div>
      <p className="text-xs text-gray-500 mb-2">Η «Σειρά» καθορίζει τη σειρά εμφάνισης των κουμπιών στην Έκδοση POS και στις Αίθουσες (π.χ. 10, 20, 30…).</p>
      <Msg text={error} />
      <table className="w-full border text-sm bg-white">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-right p-2">Σειρά</th>
            <th className="text-left p-2">Τίτλος</th><th className="text-left p-2">Υπότιτλος</th>
            <th className="text-right p-2">Τεμ.</th><th className="text-right p-2">Τιμή</th>
            <th className="text-right p-2">ΦΠΑ</th><th className="text-center p-2">Πληρωμή</th>
            <th className="text-center p-2">Ενεργό</th><th></th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} className="border-t">
              <td className="p-2 text-right text-gray-500">{t.sort_order}</td>
              <td className="p-2 font-medium">{t.title}</td>
              <td className="p-2 text-gray-600">{t.subtitle}</td>
              <td className="p-2 text-right">{t.default_qty}</td>
              <td className="p-2 text-right">{t.price.toFixed(2)} €</td>
              <td className="p-2 text-right">{t.vat_rate}%</td>
              <td className="p-2 text-center">{payText(t.default_payment)}</td>
              <td className="p-2 text-center">{t.enabled ? '✓' : '—'}</td>
              <td className="p-2 text-right whitespace-nowrap">
                <button onClick={() => setEditing(t)} className="text-blue-600 mr-2">Επεξεργασία</button>
                <button onClick={() => remove(t.id)} className="text-red-600">Διαγραφή</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl p-5 w-[28rem]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">{editing.id ? 'Επεξεργασία' : 'Νέο'} εισιτήριο</h3>
            <div className="grid grid-cols-2 gap-3">
              <L label="Τίτλος" full><input className="inp" value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></L>
              <L label="Υπότιτλος" full><input className="inp" value={editing.subtitle ?? ''} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} /></L>
              <L label="Τύπος">
                <select className="inp" value={editing.kind ?? 0} onChange={(e) => setEditing({ ...editing, kind: Number(e.target.value) })}>
                  <option value={0}>Υπηρεσία (εισιτήριο · ΑΠΥ)</option>
                  <option value={1}>Εμπορικό προϊόν (λιανική · ΑΛΠ)</option>
                </select>
              </L>
              <L label="Τιμή (€)"><input type="number" step="0.01" className="inp" value={editing.price ?? 0} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></L>
              <L label="Προεπιλ. τεμάχια"><input type="number" className="inp" value={editing.default_qty ?? 1} onChange={(e) => setEditing({ ...editing, default_qty: Number(e.target.value) })} /></L>
              <L label="ΦΠΑ %"><input type="number" className="inp" value={editing.vat_rate ?? 24} onChange={(e) => setEditing({ ...editing, vat_rate: Number(e.target.value) })} /></L>
              <L label="Σειρά εμφάνισης"><input type="number" step="10" className="inp" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></L>
              <L label="Πρόθεμα σειράς (αρίθμηση ανά τύπο)"><input className="inp" placeholder="π.χ. Α" value={editing.series_prefix ?? ''} onChange={(e) => setEditing({ ...editing, series_prefix: e.target.value })} /></L>
              <L label="Επόμενος αριθμός σειράς"><input type="number" min={1} className="inp" value={editing.series_next ?? 1} onChange={(e) => setEditing({ ...editing, series_next: Number(e.target.value) })} /></L>
              <L label="Προεπιλ. πληρωμή">
                <select className="inp" value={editing.default_payment} onChange={(e) => setEditing({ ...editing, default_payment: e.target.value as any })}>
                  <option value="prompt">Επιλογή κατά την έκδοση</option>
                  <option value="cash">Πάντα Μετρητά</option>
                  <option value="card">Πάντα Κάρτα</option>
                </select>
              </L>
              <L label="Χρώμα"><input type="color" className="inp h-9" value={editing.color ?? '#f3f4f6'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} /></L>
              <L label="Ενεργό"><input type="checkbox" checked={!!editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked ? 1 : 0 })} className="w-5 h-5" /></L>
              <div className="col-span-2">
                <div className="text-sm mb-1">Εικονίδιο</div>
                <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto border rounded p-2 bg-white">
                  <button type="button" onClick={() => setEditing({ ...editing, icon: '' })}
                    className={`w-9 h-9 rounded border text-xs ${!editing.icon ? 'ring-2 ring-slate-700 bg-slate-100' : 'bg-white'}`}>—</button>
                  {ICONS.map((ic) => (
                    <button type="button" key={ic} onClick={() => setEditing({ ...editing, icon: ic })}
                      className={`w-9 h-9 rounded border text-lg leading-none ${editing.icon === ic ? 'ring-2 ring-slate-700 bg-slate-100' : 'bg-white'}`}>{ic}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded border">Άκυρο</button>
              <button onClick={save} className="px-4 py-2 rounded bg-slate-800 text-white">Αποθήκευση</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6"><NumberingSection /></div>
    </div>
  );
}

function L({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`text-sm block mb-2 ${full ? 'col-span-2' : ''}`}>
      <span className="block text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}