import { useEffect, useState } from 'react';
import { api, setToken, getStation, setStation, type User, type Venue, type Station } from './api';
import Login from './pages/Login';
import POS from './pages/POS';
import SeatPOS from './pages/SeatPOS';
import Settings from './pages/Settings';
import Till from './pages/Till';
import Halls from './pages/Halls';
import Shows from './pages/Shows';
import Reports from './pages/Reports';
import Customers from './pages/Customers';
import CheckIn from './pages/Checkin';
import Online from './pages/Online';
import Documents from './pages/Documents';

type View = 'pos' | 'seats' | 'checkin' | 'till' | 'reports' | 'customers' | 'halls' | 'shows' | 'online' | 'documents' | 'settings';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [view, setView] = useState<View>('pos');
  const [booting, setBooting] = useState(true);
  const [stations, setStations] = useState<Station[]>([]);
  const [station, setStationState] = useState<string>(getStation());
  const [providerMode, setProviderMode] = useState(false);

  async function loadVenue(role?: string) {
    try {
      const v = await api.get<Venue>('/api/venue');
      setVenue(v);
      setView(role === 'checker' ? 'checkin' : v.pos_mode === 'halls' ? 'seats' : 'pos');
    } catch { /* ignore */ }
    try { setStations(await api.get<Station[]>('/api/stations')); } catch { /* ignore */ }
    try { const f = await api.get<any>('/api/fiscal'); setProviderMode(f?.issue_mode === 'provider'); } catch { /* ignore */ }
  }
  function chooseStation(name: string) { setStation(name); setStationState(name); }

  // Επαναφορά session από sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('tm_session');
    if (saved) {
      try {
        const { token, user } = JSON.parse(saved);
        setToken(token);
        setUser(user);
        loadVenue(user.role);
      } catch { /* ignore */ }
    }
    setBooting(false);
  }, []);

  function handleLogin(token: string, u: User) {
    setToken(token);
    setUser(u);
    sessionStorage.setItem('tm_session', JSON.stringify({ token, user: u }));
    loadVenue(u.role);
  }

  function logout() {
    setToken(null);
    setUser(null);
    setVenue(null);
    sessionStorage.removeItem('tm_session');
  }

  if (booting) return <div className="p-8 text-gray-500">Φόρτωση…</div>;
  if (!user) return <Login onLogin={handleLogin} />;

  const mode = venue?.pos_mode ?? 'both';
  const showSerial = mode === 'serial' || mode === 'both';
  const showHalls = mode === 'halls' || mode === 'both';
  const isChecker = user.role === 'checker';
  const roleLabel = user.role === 'manager' ? 'Διαχειριστής' : user.role === 'checker' ? 'Ελεγκτής' : 'Ταμίας';
  const who = user.full_name && user.full_name !== roleLabel ? `${user.full_name} · ${roleLabel}` : roleLabel;

  const tabs: { id: View; label: string; show: boolean; managerOnly?: boolean }[] = [
    { id: 'pos', label: 'Έκδοση POS', show: showSerial && !isChecker },
    { id: 'seats', label: 'Έκδοση Αίθουσες', show: showHalls && !isChecker },
    { id: 'checkin', label: 'Είσοδος', show: true },
    { id: 'till', label: 'Ταμείο', show: !isChecker },
    { id: 'reports', label: 'Αναφορές', show: true, managerOnly: true },
    { id: 'customers', label: 'Πελάτες', show: true, managerOnly: true },
    { id: 'shows', label: 'Πρόγραμμα', show: showHalls, managerOnly: true },
    { id: 'online', label: 'Online', show: showHalls, managerOnly: true },
    { id: 'documents', label: 'Παραστατικά', show: providerMode, managerOnly: true },
    { id: 'settings', label: 'Ρυθμίσεις', show: true, managerOnly: true },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-100">
      <header className="bg-slate-800 text-white flex items-center px-4 h-14 shrink-0">
        <span className="font-bold text-lg mr-6 flex items-center gap-2">
          <img src="/assets/logo_install.svg" alt="" className="h-9 w-auto"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          {venue?.name ?? 'Ticket Manager'}
        </span>
        <nav className="flex gap-1">
          {tabs
            .filter((t) => t.show && (!t.managerOnly || user.role === 'manager'))
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`px-4 py-2 rounded ${view === t.id ? 'bg-slate-600' : 'hover:bg-slate-700'}`}
              >
                {t.label}
              </button>
            ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-slate-300">Σταθμός:</span>
            <select value={station} onChange={(e) => chooseStation(e.target.value)} className="bg-slate-700 text-white rounded px-2 py-1">
              <option value="">— (browser)</option>
              {stations.map((s) => <option key={s.id} value={s.name}>{s.name}{s.printer_name ? ` → ${s.printer_name}` : ''}</option>)}
            </select>
          </label>
          <span>{who}</span>
          <button onClick={logout} className="px-3 py-1 bg-slate-600 rounded hover:bg-slate-500">Έξοδος</button>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        {view === 'pos' && <POS />}
        {view === 'seats' && <SeatPOS />}
        {view === 'checkin' && <CheckIn />}
        {view === 'till' && <Till role={user.role} />}
        {view === 'reports' && user.role === 'manager' && <Reports />}
        {view === 'customers' && user.role === 'manager' && <Customers />}
        {view === 'shows' && user.role === 'manager' && <Shows />}
        {view === 'halls' && user.role === 'manager' && <Halls />}
        {view === 'online' && user.role === 'manager' && <Online />}
        {view === 'documents' && user.role === 'manager' && <Documents />}
        {view === 'settings' && user.role === 'manager' && <Settings onSaved={loadVenue} />}
      </main>
    </div>
  );
}
