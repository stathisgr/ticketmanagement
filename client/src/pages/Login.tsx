import { useState } from 'react';
import { api, type User } from '../api';

export default function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function doLogin(u: string, p: string) {
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: User }>('/api/login', { username: u, password: p });
      onLogin(res.token, res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function submit(e: React.FormEvent) { e.preventDefault(); doLogin(username, password); }

  return (
    <div className="h-full flex items-center justify-center bg-slate-800">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-8 w-80">
        <img src="/assets/favicon-128x128.png" alt="" className="h-16 w-16 mx-auto mb-2 rounded-xl"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <h1 className="text-2xl font-bold mb-1 text-center">Ticket Manager</h1>
        <p className="text-gray-500 text-sm text-center mb-6">Σύνδεση χρήστη</p>
        <label className="block text-sm font-medium mb-1">Όνομα χρήστη</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3"
          autoFocus
        />
        <label className="block text-sm font-medium mb-1">Κωδικός</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />
        {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
        <button
          disabled={loading}
          className="w-full bg-slate-800 text-white py-2 rounded font-medium hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? '…' : 'Σύνδεση'}
        </button>

        <div className="flex items-center gap-2 my-4 text-gray-400 text-xs">
          <div className="flex-1 border-t" /> ή <div className="flex-1 border-t" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={loading} onClick={() => doLogin('user', '')}
            className="bg-emerald-600 text-white py-2 rounded font-medium hover:bg-emerald-700 disabled:opacity-50">
            Ως Ταμίας
          </button>
          <button type="button" disabled={loading} onClick={() => doLogin('checker', '')}
            className="bg-indigo-600 text-white py-2 rounded font-medium hover:bg-indigo-700 disabled:opacity-50">
            Ως Ελεγκτής
          </button>
        </div>
        <p className="text-[11px] text-gray-400 text-center mt-2">Ταμίας/Ελεγκτής: χωρίς κωδικό · Διαχειριστής: admin / admin</p>
      </form>
    </div>
  );
}
