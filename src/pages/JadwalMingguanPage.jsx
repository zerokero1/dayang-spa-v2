import { useEffect, useMemo, useState } from 'react';
import { listenAllTherapists } from '../lib/therapistService';
import {
  HARI, OFF, PILIHAN_SHIFT, labelShift, jamShift,
  getWeeklySchedules, setWeeklySchedule, seedFromTherapistShift,
  applyToAllDays, isTabelBelumAda
} from '../lib/weeklyScheduleService';

const SETUP_SQL = `create table if not exists public.therapist_weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  shift_code text not null default 'off',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (therapist_id, day_of_week)
);
alter table public.therapist_weekly_schedules enable row level security;
create policy "authenticated all" on public.therapist_weekly_schedules
  for all to authenticated using (true) with check (true);`;

const OUTLET_SHORT = { D1: 'D1', D2: 'D2', DP: 'DP', DR: 'DR', RR: 'RR', Y: 'Y' };

function ShiftCell({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 140)}
        style={{
          width: '100%', padding: '5px 4px', fontSize: 12, fontWeight: 600,
          cursor: 'pointer',
          border: `1px solid ${value === OFF ? 'var(--border)' : 'var(--primary)'}`,
          borderRadius: 6,
          background: value === OFF ? 'transparent' : 'var(--primary-light, #e6f3ef)',
          color: value === OFF ? 'var(--text-secondary)' : 'var(--primary)'
        }}
      >
        {labelShift(value)}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 30, top: '100%', left: 0,
            minWidth: 130, background: '#fff', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.18)', padding: 4
          }}
        >
          {PILIHAN_SHIFT.map((p) => (
            <button
              key={p.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(p.code); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
                border: 0, background: p.code === value ? 'var(--primary-light, #e6f3ef)' : 'transparent',
                cursor: 'pointer', fontSize: 12, borderRadius: 5
              }}
            >
              <strong>{p.label}</strong>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>{p.jam}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function JadwalMingguanPage({ profile }) {
  const [therapists, setTherapists] = useState([]);
  const [jadwal, setJadwal] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [filterOutlet, setFilterOutlet] = useState('SEMUA');
  const [cari, setCari] = useState('');

  const bolehUbah = profile?.role !== 'kasir';

  useEffect(() => listenAllTherapists(setTherapists), []);

  async function muat() {
    setLoading(true);
    setError('');
    try {
      setJadwal(await getWeeklySchedules());
    } catch (e) {
      if (isTabelBelumAda(e)) setError('Tabel jadwal belum ada');
      else setError(e.message || 'Gagal memuat jadwal.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { muat(); }, []);

  async function ubah(therapistId, dow, kode) {
    // Optimis: cell berubah duluan supaya terasa responsif, lalu disimpan.
    setJadwal((j) => ({ ...j, [therapistId]: { ...(j[therapistId] || {}), [dow]: kode } }));
    try {
      await setWeeklySchedule(therapistId, dow, kode);
      setInfo('');
    } catch (e) {
      setError(isTabelBelumAda(e) ? 'Tabel jadwal belum ada' : (e.message || 'Gagal menyimpan.'));
      muat();
    }
  }

  async function isiDariShiftTetap() {
    if (!window.confirm('Isi jadwal mingguan dari shift tetap setiap terapis? Sel yang sudah diubah manual akan ditimpa.')) return;
    try {
      const n = await seedFromTherapistShift(therapists);
      await muat();
      setInfo(`${n} sel diisi dari shift tetap.`);
      setError('');
    } catch (e) {
      setError(isTabelBelumAda(e) ? 'Tabel jadwal belum ada' : (e.message || 'Gagal mengisi jadwal.'));
    }
  }

  async function terapkanSemuaHari(dow, kode) {
    const hari = HARI.find((h) => h.dow === dow);
    if (!window.confirm(`Ubah SEMUA terapis untuk ${hari.long} menjadi ${labelShift(kode)}?`)) return;
    try {
      const n = await applyToAllDays(therapists, dow, kode);
      await muat();
      setInfo(`${n} terapis diubah untuk ${hari.long}.`);
      setError('');
    } catch (e) {
      setError(isTabelBelumAda(e) ? 'Tabel jadwal belum ada' : (e.message || 'Gagal menyimpan.'));
    }
  }

  const outlets = useMemo(() => {
    const s = new Set(therapists.map((t) => t.homeOutletId).filter(Boolean));
    return ['SEMUA', ...[...s].sort()];
  }, [therapists]);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return therapists
      .filter((t) => (filterOutlet === 'SEMUA' ? true : t.homeOutletId === filterOutlet))
      .filter((t) => (q ? String(t.name).toLowerCase().includes(q) : true))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [therapists, filterOutlet, cari]);

  const belumTerisi = therapists.filter((t) => !jadwal[t.id]).length;
  const hariIni = new Date().getDay();

  return (
    <div className="kasir-page">
      <h2>Jadwal Mingguan</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>
        Pola shift per hari untuk setiap terapis. Klik kotaknya lalu pilih shift.
        {bolehUbah ? '' : ' (hanya bisa dilihat)'}
      </p>

      {error === 'Tabel jadwal belum ada' && (
        <div className="kasir-card" style={{ borderLeft: '4px solid var(--warning)', marginTop: 12 }}>
          <strong>Tabel jadwal belum dibuat</strong>
          <p style={{ fontSize: 13, margin: '6px 0' }}>
            Jalankan SQL ini sekali di Supabase Studio → SQL Editor. Setelah itu muat ulang halaman ini.
          </p>
          <pre style={{
            background: 'var(--bg, #f6f7f8)', padding: 10, borderRadius: 8, overflowX: 'auto',
            fontSize: 11, margin: 0
          }}>{SETUP_SQL}</pre>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 0 }}>
            File lengkapnya: <code>supabase/jadwal_mingguan.sql</code>
          </p>
        </div>
      )}

      {error && error !== 'Tabel jadwal belum ada' && (
        <p style={{ color: 'var(--busy)' }}>{error}</p>
      )}
      {info && <p style={{ color: 'var(--success)', fontSize: 13 }}>{info}</p>}

      <section style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterOutlet} onChange={(e) => setFilterOutlet(e.target.value)} style={{ width: 'auto' }}>
          {outlets.map((o) => (
            <option key={o} value={o}>
              {o === 'SEMUA' ? 'Semua outlet' : `${OUTLET_SHORT[o] || o} (${o})`}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Cari nama..."
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          style={{ width: 160 }}
        />
        {bolehUbah && (
          <button onClick={isiDariShiftTetap} disabled={loading || therapists.length === 0}>
            Isi dari shift tetap
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {therapists.length} terapis · belum punya jadwal: {belumTerisi}
        </span>
      </section>

      {loading ? <p>Memuat...</p> : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 130 }}>Terapis</th>
                {HARI.map((h) => (
                  <th key={h.dow} style={{ minWidth: 74, background: h.dow === hariIni ? 'var(--primary)' : undefined, color: h.dow === hariIni ? '#fff' : undefined }}>
                    {h.short}
                  </th>
                ))}
                <th style={{ minWidth: 78 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {tampil.length === 0 ? (
                <tr><td colSpan={HARI.length + 2}>Tidak ada terapis yang cocok.</td></tr>
              ) : tampil.map((t) => {
                const row = jadwal[t.id] || {};
                const kerja = HARI.filter((h) => row[h.dow] && row[h.dow] !== OFF && row[h.dow] !== 'libur').length;
                return (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>
                        {OUTLET_SHORT[t.homeOutletId] || '-'}
                      </span>
                    </td>
                    {HARI.map((h) => (
                      <td key={h.dow} style={{ padding: 4 }}>
                        <ShiftCell
                          value={row[h.dow] || OFF}
                          onChange={bolehUbah ? (kode) => ubah(t.id, h.dow, kode) : () => {}}
                        />
                      </td>
                    ))}
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{kerja} hari</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {bolehUbah && !loading && therapists.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 6px' }}>Ubah satu hari untuk semua orang</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {HARI.map((h) => (
              <div key={h.dow} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, width: 32 }}>{h.long}</span>
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { terapkanSemuaHari(h.dow, e.target.value); e.target.value = ''; } }}
                  style={{ width: 'auto', fontSize: 12 }}
                >
                  <option value="">pilih shift...</option>
                  {PILIHAN_SHIFT.map((p) => (
                    <option key={p.code} value={p.code}>{p.label} {p.jam !== '-' ? `(${p.jam})` : ''}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 18 }}>
        <h4 style={{ margin: '0 0 6px' }}>Arti shift</h4>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
          {PILIHAN_SHIFT.map((p) => (
            <span key={p.code} style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text)' }}>{p.label}</strong> {p.jam}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}