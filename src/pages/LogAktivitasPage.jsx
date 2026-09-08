import { useEffect, useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getAllLogs } from '../lib/logActivityService';

const ACTION_LABEL = {
  login: 'Login Office',
  create: 'Buat booking',
  pay: 'Tandai lunas',
  discount: 'Diskon',
  edit: 'Koreksi booking',
  cancel: 'Hapus / batal booking',
  cancel_partial: 'Batal sebagian'
};

const OUTLET_NAME = Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));

function wibDateStr(ts) {
  const d = new Date(ts + 7 * 3600000);
  return d.toISOString().slice(0, 10);
}

function fmtWib(ts) {
  return new Date(ts).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function detailText(detail) {
  if (!detail) return '-';
  const obj = typeof detail === 'string' ? JSON.parse(detail) : detail;
  if (!obj || typeof obj !== 'object') return String(detail);
  const arr = Object.entries(obj).filter(([, v]) => v !== null && v !== '' && v !== "{}");
  if (arr.length === 0) return '-';
  return arr.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ');
}

export default function LogAktivitasPage({ active, user }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState('');
  const [outletId, setOutletId] = useState('semua');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await getAllLogs();
      setList(data);
    } catch (e) {
      setMessage('Gagal memuat log: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active) load();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [active]);

  const filtered = useMemo(() => {
    return list.filter((r) => {
      if (outletId !== 'semua' && r.outlet_id !== outletId) return false;
      if (date) {
        const d = (r.created_at ? new Date(r.created_at).getTime() : 0);
        if (wibDateStr(d) !== date) return false;
      }
      return true;
    });
  }, [list, outletId, date]);

  return (
    <div className="kasir-page">
      <h2>Log Aktivitas</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Riwayat tindakan SEMUA akun (kasir & office): membuat booking, lunas/diskon, koreksi, hapus treatment, dan login. Khusus akun office. Diperbarui tiap 60 detik.
      </p>

      <section>
        <p>Outlet</p>
        <div className="grid-2">
          <button className={outletId === 'semua' ? 'active' : ''} onClick={() => setOutletId('semua')}>Semua outlet</button>
          {OUTLETS.map((o) => (
            <button key={o.id} className={outletId === o.id ? 'active' : ''} onClick={() => setOutletId(o.id)}>{o.name}</button>
          ))}
        </div>
      </section>

      <section>
        <p>Tanggal</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </section>

      <button onClick={load} disabled={loading}>
        {loading ? 'Memuat...' : 'Muat ulang log'}
      </button>

      {message && <p style={{ fontSize: 13, color: 'var(--danger)' }}>{message}</p>}

      {!loading && filtered.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada aktivitas pada filter ini.</p>
      )}

      {filtered.map((r) => (
        <div key={r.id} className="oil-card" style={{ margin: 0, marginBottom: 8, padding: '10px 12px', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{ACTION_LABEL[r.action] || r.action}</strong>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtWib(new Date(r.created_at).getTime())}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            <strong style={{ color: 'var(--primary-dark)' }}>{r.actor_name || 'system'}</strong>
            {r.outlet_id ? ` · ${OUTLET_NAME[r.outlet_id] || r.outlet_id}` : ''}
            {r.record_id ? ` · Booking: ${r.record_id.slice(0, 8)}…` : ''}
          </div>
          {r.action !== 'login' && r.detail && (
            <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text)', wordBreak: 'break-word' }}>
              {detailText(r.detail)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}