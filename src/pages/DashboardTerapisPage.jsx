import { useCallback, useEffect, useRef, useState } from 'react';
import { OUTLETS, SHIFT_LABEL } from '../lib/constants';
import { getTherapistBoard, todayWib } from '../lib/therapistBoardService';

const REFRESH_MS = 60000;

// Urutan status + warna badge.
const STATUS_META = {
  busy: { label: 'Ambil Tamu', bg: 'var(--busy)', fg: '#fff' },
  overtime: { label: 'Lembur', bg: '#7c3aed', fg: '#fff' },
  break: { label: 'Break', bg: 'var(--warning, #f59e0b)', fg: '#3b2500' },
  jeda: { label: 'Jeda Shift', bg: '#0ea5e9', fg: '#fff' },
  free: { label: 'Free', bg: '#16a34a', fg: '#fff' },
  libur: { label: 'Libur', bg: '#6b7280', fg: '#fff' }
};

function statusOf(r) {
  if (r.isOvertimeNow) return 'overtime';
  if (r.isBusy) return 'busy';
  if (r.isBreak) return 'break';
  if (r.isLibur) return 'libur';
  if (r.shiftWindow === 'jeda') return 'jeda';
  return 'free';
}

function Badge({ kind, children }) {
  const m = STATUS_META[kind] || STATUS_META.free;
  return (
    <span style={{
      display: 'inline-block', background: m.bg, color: m.fg, fontSize: 11,
      fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap'
    }}>
      {children || m.label}
    </span>
  );
}

function fmtMinShort(min) {
  if (min == null) return '-';
  const n = Math.round(min);
  if (n <= 0) return 'selesai';
  if (n < 60) return `${n} mnt lagi`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}j ${m}m lagi` : `${h} jam lagi`;
}

function TherapistCard({ r }) {
  const kind = statusOf(r);
  const accent = (STATUS_META[kind] || STATUS_META.free).bg;

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--border)', borderLeft: `6px solid ${accent}`,
      borderRadius: 12, padding: 14
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{r.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {r.shift ? (SHIFT_LABEL[r.shift] || r.shift) : 'Tanpa shift'}
            {r.shiftEndTime ? ` · selesai ${r.shiftEndTime}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {r.isOvertimeNow && <Badge kind="overtime">Lembur {r.overtimeText}</Badge>}
          <Badge kind={kind} />
        </div>
      </div>

      {/* Lokasi: outlet tempat therapeutic ini sekarang bekerja */}
      <div style={{ marginTop: 10, fontSize: 13 }}>
        {r.isBusy ? (
          <div style={{ fontWeight: 700 }}>
            📍 {r.currentOutletName}
            {r.movedOutlet && (
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>
                {' '}(dari {r.homeOutletName})
              </span>
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--text-secondary)' }}>📍 {r.homeOutletName}</div>
        )}
      </div>

      {r.guests.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {r.guests.map((g) => (
            <div key={g.bookingId} style={{ background: 'var(--bg, #f7f7f7)', borderRadius: 10, padding: 10, marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>
                  {g.customerName || g.treatmentName}
                </strong>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtMinShort(g.minutesLeft)}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {g.customerName ? `${g.treatmentName} · ` : ''}{g.outletName}
                {g.isOncall ? ' · oncall' : ''}
              </div>
              {g.progress != null && (
                <div style={{ height: 6, background: '#e5e7eb', borderRadius: 999, marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${g.progress}%`, height: '100%', background: accent }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {r.isBreak && (
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: '#b45309' }}>
          ☕ Sedang break
        </div>
      )}
      {!r.isBusy && !r.isBreak && !r.isLibur && !r.guests.length && r.shiftWindow === 'jeda' && (
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: '#0369a1' }}>
          ☕ Jeda shift (jam istirahat)
        </div>
      )}
      {!r.isBusy && !r.isBreak && !r.isLibur && r.shiftWindow === 'diluar_jam' && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          Di luar jam shift{r.overtimeMinutes > 0 ? ` · total lembur hari ini ${r.overtimeText}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span>Treatment hari ini: <strong>{r.todayCount}</strong></span>
        {r.overtimeMinutes > 0 && <span>Lembur: <strong>{r.overtimeText}</strong>{r.adjusted ? ' (koreksi)' : ''}</span>}
        {r.lastEndTime !== '-' && <span>Selesai terakhir: <strong>{r.lastEndTime}</strong></span>}
      </div>

      {r.next && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Berikutnya: </span>
          <strong>{r.next.customerName || r.next.treatmentName}</strong>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            · {r.next.customerName ? r.next.treatmentName : r.next.outletName} · {r.next.startTime}
          </span>
        </div>
      )}
    </div>
  );
}

export default function DashboardTerapisPage({ profile, active }) {
  const isKasir = profile?.role === 'kasir';
  const myOutletId = profile?.outletId;

  const [date, setDate] = useState(todayWib());
  const [outletFilter, setOutletFilter] = useState(isKasir ? (myOutletId || 'semua') : 'semua');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(Date.now());
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const ids = isKasir
        ? [myOutletId].filter(Boolean)
        : (outletFilter === 'semua' ? null : [outletFilter]);
      const res = await getTherapistBoard({ date, outletIds: ids });
      setData(res);
      setTick(Date.now());
    } catch (e) {
      setError('Gagal memuat dashboard: ' + e.message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [date, outletFilter, isKasir, myOutletId]);

  useEffect(() => { load(); }, [load, active]);

  // Auto-refresh tiap menit supaya status lembur/break tetap akurat.
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [auto, load]);

  // Hitung ulang label "X mnt lagi" tanpa query ulang.
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const s = data?.summary;
  const rows = data?.rows || [];

  return (
    <div className="kasir-page">
      <h2>Dashboard Terapis</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 14 }}>
        Terapis ambil tamu di outlet mana, siapa yang break, siapa yang lembur.
      </p>

      {!isKasir && (
        <section>
          <p>Outlet</p>
          <div className="grid-2">
            <button className={outletFilter === 'semua' ? 'active' : ''} onClick={() => setOutletFilter('semua')}>
              Semua Outlet
            </button>
            {OUTLETS.map((o) => (
              <button key={o.id} className={outletFilter === o.id ? 'active' : ''} onClick={() => setOutletFilter(o.id)}>
                {o.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <p>Tanggal</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}
            onClick={() => setDate(todayWib())}
            disabled={date === todayWib()}
          >
            Hari ini
          </button>
          <button
            style={{
              width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none',
              background: auto ? 'var(--primary-dark)' : undefined, color: auto ? '#fff' : undefined
            }}
            onClick={() => setAuto((a) => !a)}
          >
            Auto-refresh {auto ? 'ON' : 'OFF'}
          </button>
          <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={load} disabled={loading}>
            {loading ? 'Memuat...' : '⟳ Muat ulang'}
          </button>
        </div>
        {data && (
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
            Diperbarui {new Date(tick).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            {auto ? ` · auto setiap ${REFRESH_MS / 1000} detik` : ''}
          </p>
        )}
      </section>

      {error && (
        <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>⚠ {error}</p>
      )}

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8, margin: '12px 0 4px' }}>
          <SummaryTile label="Ambil Tamu" value={s.busy} bg="var(--busy)" />
          <SummaryTile label="Lembur" value={s.overtime} bg="#7c3aed" />
          <SummaryTile label="Break" value={s.break} bg="var(--warning, #f59e0b)" />
          <SummaryTile label="Jeda Shift" value={s.jeda} bg="#0ea5e9" />
          <SummaryTile label="Free" value={s.free} bg="#16a34a" />
          <SummaryTile label="Libur" value={s.libur} bg="#6b7280" />
        </div>
      )}

      {s && s.totalOvertimeMinutes > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Total lembur {data.date}: <strong>{fmtMinShort(s.totalOvertimeMinutes).replace(' lagi', '')}</strong>
        </p>
      )}

      <section style={{ marginTop: 12 }}>
        <p>Daftar terapis ({rows.length})</p>
        {!data && !error && <p style={{ fontSize: 13 }}>Memuat…</p>}
        {data && rows.length === 0 && (
          <p style={{ fontSize: 13 }}>Tidak ada terapis untuk outlet ini.</p>
        )}
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {rows.map((r) => <TherapistCard key={r.id} r={r} />)}
        </div>
      </section>
    </div>
  );
}

function SummaryTile({ label, value, bg }) {
  return (
    <div style={{ background: bg, color: '#fff', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.95 }}>{label}</div>
    </div>
  );
}