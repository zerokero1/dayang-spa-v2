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
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo">🫧</span>
          <div className="login-brand-text">
            <strong>Dayang Spa</strong>
            <small>Sistem Manajemen Spa</small>
          </div>
        </div>

        <h1 className="login-title">Masuk ke akun Anda</h1>
        <p className="login-sub">Gunakan email yang terdaftar untuk accessing.</p>

        <label className="login-field">
          Email
          <input
            type="email"
            autoComplete="username"
            placeholder="nama@dayang.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="login-field">
          Password
          <input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary btn-lg btn-block" onClick={handleLogin} disabled={busy || !email || !password}>
          {busy ? 'Memproses...' : 'Masuk'}
        </button>

        <p className="login-note">Pastikan perangkat terhubung internet untuk akses data.</p>
      </div>
    </div>
  );
}
