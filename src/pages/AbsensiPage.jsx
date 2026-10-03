import { useCallback, useEffect, useMemo, useState } from 'react';
import { ATTENDANCE_TYPES, OUTLETS, SHIFTS, SHIFT_LABEL } from '../lib/constants';
import { getAttendanceRange, recordAttendance, saveOvertime } from '../lib/attendanceService';
import { listenAllTherapists } from '../lib/therapistService';
import { clockToMinutes, minutesToClock, minutesToDuration, shiftStartMinutes } from '../lib/shiftService';
import AbsensiBulanan from './AbsensiBulanan';

// Status kehadiran yang dipilih kasir. LEMBUR sengaja TIDAK ada di sini:
// lembur bukan kondisi kerja, melainkan keterangan tambahan hari yang sama,
// jadi kasir tetap "Hadir" lalu mengisi menit lembur di kolomnya.
const STATUS_OPTIONS = [
  { value: ATTENDANCE_TYPES.HADIR, label: 'Hadir' },
  { value: ATTENDANCE_TYPES.TELAT, label: 'Telat' },
  { value: ATTENDANCE_TYPES.SAKIT, label: 'Sakit' },
  { value: ATTENDANCE_TYPES.IZIN, label: 'Izin' },
  { value: ATTENDANCE_TYPES.ALPHA, label: 'Alpha' },
  { value: ATTENDANCE_TYPES.LIBUR, label: 'Libur' }
];

function todayWib() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function outletName(id) {
  return OUTLETS.find((o) => o.id === id)?.name || id || '-';
}

/** "12:05" -> 725, dipakai untuk tombol cepat "sekarang". */
function nowMinutes() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

export default function AbsensiPage({ outletId, active, user }) {
  const [tab, setTab] = useState('harian');
  const [date, setDate] = useState(todayWib);
  const [outletFilter, setOutletFilter] = useState('');
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [draft, setDraft] = useState({});   // employeeId -> { status, checkIn, checkOut, lembur, note }
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!active) return;
    const unsub = listenAllTherapists(setEmployees);
    return () => unsub();
  }, [active]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getAttendanceRange(date, date, outletFilter || undefined);
      setRecords(rows);
    } catch (e) {
      setMessage('Gagal memuat absensi: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [date, outletFilter]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // Isi draft dari data yang tersimpan supaya layar tidak flicker saat reload.
  useEffect(() => {
    const next = {};
    records.forEach((r) => {
      next[r.employeeId] = {
        status: r.type,
        checkIn: minutesToClock(r.checkIn),
        checkOut: minutesToClock(r.checkOut),
        lembur: r.overtimeMinutes > 0 ? String(r.overtimeMinutes) : '',
        note: r.note || '',
        // late_minutes yang tersimpan selalu dianggap hasil koreksi kasir kalau
        // sumbernya manual, supaya angka yang sudah dikoreksi tidak ditimpa
        // ulang oleh perhitungan otomatis.
        lateManual: r.source === 'manual' && r.lateMinutes != null,
        lateOverride: r.lateMinutes != null ? String(r.lateMinutes) : ''
      };
    });
    setDraft(next);
  }, [records]);

  // Grid menampilkan semua staf outlet terpilih + staf yang sudah absen.
  const rows = useMemo(() => {
    const byId = {};
    employees.forEach((e) => {
      byId[e.id] = {
        id: e.id,
        name: e.name,
        role: e.role,
        // PENTING: listenAllTherapists mengembalikan objek hasil mapTherapist,
        // yang key-nya camelCase (homeOutletId), bukan home_outlet_id.
        // Pakai yang snake_case membuat outletId selalu undefined, sehingga
        // filter per outlet membuang semua orang (semua outlet tetap tampil).
        outletId: e.homeOutletId,
        shift: e.shift || ''
      };
    });
    records.forEach((r) => {
      if (!byId[r.employeeId]) {
        byId[r.employeeId] = {
          id: r.employeeId, name: r.employeeName, role: '-',
          outletId: r.outletId, shift: ''
        };
      }
    });
    return Object.values(byId)
      .filter((e) => (outletFilter ? e.outletId === outletFilter : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, records, outletFilter]);

  const edit = (employeeId, patch) => {
    setDraft((d) => ({ ...d, [employeeId]: { ...(d[employeeId] || {}), ...patch } }));
  };

  /** Keterlambatan = jam datang dikurangi jam mulai shift. */
  function previewLate(employee, rowDraft) {
    // Kalau kasir memilih koreksi manual, angka itulah yang dipakai.
    if (rowDraft?.lateManual) {
      const v = Number(rowDraft.lateOverride);
      return Number.isFinite(v) && rowDraft.lateOverride !== '' ? Math.max(0, v) : null;
    }
    const inMin = clockToMinutes(rowDraft?.checkIn);
    if (inMin == null) return null;
    const start = shiftStartMinutes(employee.shift);
    if (start == null) return null;
    return Math.max(0, inMin - start);
  }

  async function saveRow(employee) {
    const rowDraft = draft[employee.id] || {};
    setSavingId(employee.id);
    setMessage('');
    try {
      let lateText = '';
      if (rowDraft.status) {
        const { lateMinutes, overridden } = await recordAttendance({
          outletId: employee.outletId || outletId || null,
          employeeId: employee.id,
          employeeName: employee.name,
          type: rowDraft.status,
          note: rowDraft.note,
          date,
          checkIn: clockToMinutes(rowDraft.checkIn),
          checkOut: clockToMinutes(rowDraft.checkOut),
          shift: employee.shift || null,
          recordedBy: user?.email || user?.name || null,
          lateMinutesOverride: rowDraft.lateManual ? Number(rowDraft.lateOverride) || 0 : null
        });
        if (lateMinutes > 0) {
          lateText = ` (telat ${minutesToDuration(lateMinutes)}${overridden ? ', dikoreksi kasir' : ''})`;
        }
      }
      if (Number(rowDraft.lembur) > 0) {
        await saveOvertime({
          outletId: employee.outletId || outletId || null,
          employeeId: employee.id,
          employeeName: employee.name,
          minutes: Number(rowDraft.lembur),
          date,
          note: rowDraft.note,
          recordedBy: user?.email || user?.name || null
        });
      }
      await load();
      setMessage(`Absensi ${employee.name} tersimpan${lateText}`);
    } catch (e) {
      setMessage(`Gagal menyimpan ${employee.name}: ${e.message}`);
    } finally {
      setSavingId(null);
    }
  }

  /** Isi jam datang dengan waktu sekarang untuk semua yang belum absen. */
  function fillAllCheckIn() {
    const clock = minutesToClock(nowMinutes());
    setDraft((d) => {
      const next = { ...d };
      rows.forEach((e) => {
        const row = next[e.id] || {};
        if (!row.checkIn) next[e.id] = { ...row, status: row.status || ATTENDANCE_TYPES.HADIR, checkIn: clock };
      });
      return next;
    });
  }

  const stats = useMemo(() => {
    let hadir = 0, telat = 0, sakit = 0, izin = 0, alpha = 0, lembur = 0;
    Object.values(draft).forEach((r) => {
      if (r.status === ATTENDANCE_TYPES.HADIR) hadir++;
      if (r.status === ATTENDANCE_TYPES.TELAT) telat++;
      if (r.status === ATTENDANCE_TYPES.SAKIT) sakit++;
      if (r.status === ATTENDANCE_TYPES.IZIN) izin++;
      if (r.status === ATTENDANCE_TYPES.ALPHA) alpha++;
      if (Number(r.lembur) > 0) lembur++;
    });
    return { hadir, telat, sakit, izin, alpha, lembur };
  }, [draft]);

  return (
    <div className="kasir-page">
      <h2>Absensi</h2>

      <div className="att-tabs">
        <button
          type="button"
          className={tab === 'harian' ? 'active' : ''}
          onClick={() => setTab('harian')}
        >
          Harian
        </button>
        <button
          type="button"
          className={tab === 'bulanan' ? 'active' : ''}
          onClick={() => setTab('bulanan')}
        >
          Bulanan
        </button>
      </div>

      {tab === 'bulanan' ? (
        <AbsensiBulanan
          active={active}
          employees={employees}
          outletFilter={outletFilter}
          onOutletChange={setOutletFilter}
          user={user}
        />
      ) : (
        <>
      <p className="muted">
        Isi jam datang &amp; jam pulang. Telat dihitung otomatis dari jam datang
        dibanding jam mulai shift, jadi tidak perlu dihitung sendiri.
      </p>

      <section className="filters">
        <label>
          Tanggal
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Outlet
          <select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
            <option value="">Semua outlet</option>
            {OUTLETS.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={fillAllCheckIn}>Isi jam datang = sekarang</button>
        <button type="button" onClick={load} disabled={loading}>
          {loading ? 'Memuat...' : 'Muat ulang'}
        </button>
      </section>

      <section className="summary-chips">
        <span className="chip">Hadir {stats.hadir}</span>
        <span className="chip chip-warn">Telat {stats.telat}</span>
        <span className="chip">Sakit {stats.sakit}</span>
        <span className="chip">Izin {stats.izin}</span>
        <span className="chip">Alpha {stats.alpha}</span>
        <span className="chip chip-purple">Lembur {stats.lembur}</span>
      </section>

      {message && <p className="message">{message}</p>}

      <section className="table-wrap">
        <table className="attendance-grid">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Outlet</th>
              <th>Shift</th>
              <th>Status</th>
              <th>Masuk</th>
              <th>Pulang</th>
              <th>Telat</th>
              <th>Lembur (menit)</th>
              <th>Catatan</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const rowDraft = draft[e.id] || {};
              const late = previewLate(e, rowDraft);
              const dirty = Boolean(
                rowDraft.status || rowDraft.checkIn || rowDraft.checkOut ||
                rowDraft.lembur || rowDraft.lateManual
              );
              return (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td>{outletName(e.outletId)}</td>
                  <td>{e.shift ? (SHIFT_LABEL[e.shift] || e.shift) : '-'}</td>
                  <td>
                    <select
                      value={rowDraft.status || ''}
                      onChange={(ev) => edit(e.id, { status: ev.target.value })}
                    >
                      <option value="">Belum absen</option>
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="time"
                      step="300"
                      value={rowDraft.checkIn || ''}
                      onChange={(ev) => edit(e.id, { checkIn: ev.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      step="300"
                      value={rowDraft.checkOut || ''}
                      onChange={(ev) => edit(e.id, { checkOut: ev.target.value })}
                    />
                  </td>
                  <td>
                    {rowDraft.lateManual ? (
                      <>
                        <input
                          type="number"
                          min="0"
                          placeholder="menit"
                          value={rowDraft.lateOverride || ''}
                          onChange={(ev) => edit(e.id, { lateOverride: ev.target.value })}
                        />
                        {late != null && late > 0
                          ? <span className="late-badge">{minutesToDuration(late)}</span>
                          : null}
                        <button
                          type="button"
                          onClick={() => edit(e.id, {
                            lateManual: false, lateOverride: ''
                          })}
                        >
                          Otomatis
                        </button>
                      </>
                    ) : (
                      <>
                        {rowDraft.checkIn
                          ? (late == null
                            ? <span className="muted" title="Shift belum diatur, telat tidak bisa dihitung">?</span>
                            : (late > 0
                              ? <span className="late-badge">{minutesToDuration(late)}</span>
                              : <span className="ok-badge">Tepat</span>))
                          : '-'}
                        <button
                          type="button"
                          onClick={() => edit(e.id, {
                            lateManual: true,
                            lateOverride: late == null ? '' : String(late)
                          })}
                        >
                          Koreksi
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={rowDraft.lembur || ''}
                      onChange={(ev) => edit(e.id, { lembur: ev.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      placeholder="opsional"
                      value={rowDraft.note || ''}
                      onChange={(ev) => edit(e.id, { note: ev.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={savingId === e.id || (!dirty && !rowDraft.status)}
                      onClick={() => saveRow(e)}
                    >
                      {savingId === e.id ? '...' : 'Simpan'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10}>Tidak ada karyawan untuk outlet ini.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="muted">
        Keterlambatan dihitung dari {Object.values(SHIFTS).length} jenis shift.
        Tekan <strong>Koreksi</strong> untuk mengoreksi menit telat secara manual
        (mis. ada izin datang di tengah). Data sebelum 2026-10-03 belum punya jam
        datang, jadi kolom masuk/pulang kosong dan telat mengikuti catatan status lama.
      </p>
        </>
      )}
    </div>
  );
}
