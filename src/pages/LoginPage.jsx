import { useState } from 'react';
import { login } from '../lib/authService';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (e) {
      setError('Email atau password salah');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" style={{ display: 'flex', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Dayang Spa</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Masuk ke akun Anda</p>
        </div>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: 20, boxShadow: 'var(--shadow)'
        }}>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="error">{error}</p>}
          <button onClick={handleLogin} disabled={busy || !email || !password}>
            {busy ? 'Memproses...' : 'Masuk'}
          </button>
        </div>
      </div>
    </div>
  );
}
