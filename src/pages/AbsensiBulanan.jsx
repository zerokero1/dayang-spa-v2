import { useCallback, useEffect, useMemo, useState } from 'react';
import { ATTENDANCE_TYPES, OUTLETS, SHIFT_LABEL } from '../lib/constants';
import {
  deleteAttendance, getAttendanceRange, deleteOvertime, recordAttendance, saveOvertime
} from '../lib/attendanceService';
import { clockToMinutes, minutesToClock, minutesToDuration, shiftStartMinutes } from '../lib/shiftService';

/**
 * Grid absensi BULANAN - bentuknya meniru spreadsheet "ABSENSI PER OUTLET":
 * baris = orang, kolom = tanggal 1..n, sel = status singkat + jam datang.
 *
 * Bedanya dengan sheet: kode dan jam di sini BENAR-BENAR tersimpan ke
 * attendance (type + check_in_minutes), bukan sekadar coretan di file.
 * Jadi kolom rekap di kanan dan Laporan Absensi bisa menghitungnya.
 *
 * Kolom rekap memakai huruf yang sama dengan sheet:
 *   S = Sakit, A = Alpha, I = Izin, Off = Libur
 * Semua dihitung dari sel yang sudah terisi - tidak diisi manual, supaya
 * tidak mungkin beda dengan isi tabel.
 */

// Token per status. Sengaja pendek supaya muat di kolom 3 karakter.
const TOKEN = {
  [ATTENDANCE_TYPES.HADIR]: 'H',
  [ATTENDANCE_TYPES.TELAT]: 'T',
  [ATTENDANCE_TYPES.SAKIT]: 'S',
  [ATTENDANCE_TYPES.IZIN]: 'I',
  [ATTENDANCE_TYPES.ALPHA]: 'A',
  [ATTENDANCE_TYPES.LIBUR]: 'OFF'
};

const QUICK = [
  { value: ATTENDANCE_TYPES.HADIR, label: 'Hadir', token: 'H' },
  { value: ATTENDANCE_TYPES.TELAT, label: 'Telat', token: 'T' },
  { value: ATTENDANCE_TYPES.SAKIT, label: 'Sakit', token: 'S' },
  { value: ATTENDANCE_TYPES.IZIN, label: 'Izin', token: 'I' },
  { value: ATTENDANCE_TYPES.ALPHA, label: 'Alpha', token: 'A' },
  { value: ATTENDANCE_TYPES.LIBUR, label: 'Libur', token: 'OFF' }
];

const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function outletName(id) {
  return OUTLETS.find((o) => o.id === id)?.name || id || '-';
}

function thisMonthWib() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
}

function todayWib() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

/** "2026-10" -> [{ date, day, dow, isToday }, ...] sepanjang bulan itu. */
function daysOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayWib();
  const out = [];
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    out.push({ date, day: d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), isToday: date === today });
  }
  return out;
}

/** Teks yang tampil di dalam sel. */
function cellText(rec) {
  if (!rec) return '';
  const t = TOKEN[rec.type] || '';
  if (rec.type === ATTENDANCE_TYPES.HADIR || rec.type === ATTENDANCE_TYPES.TELAT) {
    return t + (rec.checkIn != null ? minutesToClock(rec.checkIn) : '');
  }
  return t;
}

export default function AbsensiBulanan({ active, employees, outletFilter, onOutletChange, user }) {
  const [month, setMonth] = useState(thisMonthWib);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [cellEdit, setCellEdit] = useState(null);   // { employeeId, date }
  const [cellDraft, setCellDraft] = useState({});
  const [savingCell, setSavingCell] = useState(false);
  const [bulkDate, setBulkDate] = useState(todayWib);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const first = days[0].date;
  const last = days[days.length - 1].date;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await getAttendanceRange(first, last, outletFilter || undefined));
    } catch (e) {
      setMessage('Gagal memuat absensi bulan ini: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [first, last, outletFilter]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // employeeId|date -> record. Satu baris attendance per orang per tanggal,
  // jadi tidak mungkin ada dua entri untuk sel yang sama.
  const recMap = useMemo(() => {
    const m = {};
    records.forEach((r) => { m[`${r.employeeId}|${r.date}`] = r; });
    return m;
  }, [records]);

  const rows = useMemo(() => {
    const byId = {};
    employees.forEach((e) => {
      byId[e.id] = { id: e.id, name: e.name, role: e.role, outletId: e.home_outlet_id, shift: e.shift || '' };
    });
    records.forEach((r) => {
      if (!byId[r.employeeId]) {
        byId[r.employeeId] = { id: r.employeeId, name: r.employeeName, role: '-', outletId: r.outletId, shift: '' };
      }
    });
    return Object.values(byId)
      .filter((e) => (outletFilter ? e.outletId === outletFilter : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, records, outletFilter]);

  // Rekap S / A / I / Off per orang, dihitung dari sel yang terisi.
  const recap = useMemo(() => {
    const out = {};
    rows.forEach((e) => { out[e.id] = { S: 0, A: 0, I: 0, OFF: 0, H: 0 }; });
    records.forEach((r) => {
      const row = out[r.employeeId];
      if (!row) return;
      if (r.type === ATTENDANCE_TYPES.SAKIT) row.S++;
      else if (r.type === ATTENDANCE_TYPES.ALPHA) row.A++;
      else if (r.type === ATTENDANCE_TYPES.IZIN) row.I++;
      else if (r.type === ATTENDANCE_TYPES.LIBUR) row.OFF++;
      else if (r.type === ATTENDANCE_TYPES.HADIR || r.type === ATTENDANCE_TYPES.TELAT) row.H++;
    });
    return out;
  }, [rows, records]);

  function openCell(employee, date) {
    const rec = recMap[`${employee.id}|${date}`];
    setCellEdit({ employeeId: employee.id, date });
    setCellDraft({
      status: rec?.type || '',
      checkIn: rec?.checkIn != null ? minutesToClock(rec.checkIn) : '',
      checkOut: rec?.checkOut != null ? minutesToClock(rec.checkOut) : '',
      lembur: rec?.overtimeMinutes > 0 ? String(rec.overtimeMinutes) : '',
      note: rec?.note || ''
    });
  }

  function pickStatus(value) {
    // Pilih shortcut harus langsung terasa di kasir: status sering dictates
    // jam. Kasir masih boleh isi jamnya sendiri setelah memilih kode.
    setCellDraft((d) => ({
      ...d,
      status: value,
      // Libur / sakit / izin / alpha tidak punya jam datang-pulang.
      checkIn: [ATTENDANCE_TYPES.LIBUR, ATTENDANCE_TYPES.SAKIT, ATTENDANCE_TYPES.IZIN, ATTENDANCE_TYPES.ALPHA].includes(value) ? '' : d.checkIn,
      checkOut: [ATTENDANCE_TYPES.LIBUR, ATTENDANCE_TYPES.SAKIT, ATTENDANCE_TYPES.IZIN, ATTENDANCE_TYPES.ALPHA].includes(value) ? '' : d.checkOut,
      lembur: value === ATTENDANCE_TYPES.LIBUR ? '' : d.lembur
    }));
  }

  /** Telat = jam datang - jam mulai shift; null kalau tidak bisa dihitung. */
  function previewLate(employee, draft) {
    if (!draft?.checkIn) return null;
    const inMin = clockToMinutes(draft.checkIn);
    const start = shiftStartMinutes(employee.shift);
    if (inMin == null || start == null) return null;
    return Math.max(0, inMin - start);
  }

  async function saveCell() {
    if (!cellEdit) return;
    const employee = rows.find((e) => e.id === cellEdit.employeeId);
    if (!employee) return;
    if (!cellDraft.status) { setMessage('Pilih status dulu (atau kosongkan sel).'); return; }
    setSavingCell(true);
    try {
      const { lateMinutes } = await recordAttendance({
        outletId: employee.outletId || outletFilter || null,
        employeeId: employee.id,
        employeeName: employee.name,
        type: cellDraft.status,
        note: cellDraft.note,
        date: cellEdit.date,
        checkIn: clockToMinutes(cellDraft.checkIn),
        checkOut: clockToMinutes(cellDraft.checkOut),
        shift: employee.shift || null,
        recordedBy: user?.email || user?.name || null
      });
      // Lembur lama harus dihapus kalau kasir mengosongkan atau menurunkannya.
      // Kalau tidak, record lama di attendance_overtime tetap ikut terhitung di
      // laporan padahal selnya sudah tidak punya angka lembur.
      const lemburBaru = Number(cellDraft.lembur) || 0;
      const lemburLama = editRec?.overtimeMinutes || 0;
      if (lemburBaru > 0) {
        await saveOvertime({
          outletId: employee.outletId || outletFilter || null,
          employeeId: employee.id,
          employeeName: employee.name,
          minutes: lemburBaru,
          date: cellEdit.date,
          note: cellDraft.note,
          recordedBy: user?.email || user?.name || null
        });
      } else if (lemburLama > 0) {
        await deleteOvertime(employee.id, cellEdit.date);
      }
      const telat = lateMinutes > 0 ? ` (telat ${minutesToDuration(lateMinutes)})` : '';
      setCellEdit(null);
      setMessage(`${employee.name} ${cellEdit.date}: ${cellDraft.status}${telat}`);
      await load();
    } catch (e) {
      setMessage('Gagal menyimpan: ' + (e.message || e));
    } finally {
      setSavingCell(false);
    }
  }

  async function clearCell() {
    if (!cellEdit) return;
    const employee = rows.find((e) => e.id === cellEdit.employeeId);
    if (!employee) return;
    if (!window.confirm(`Kosongkan absensi ${employee.name} tanggal ${cellEdit.date}? Kehadiran dan menit lembur hari itu dihapus.`)) return;
    setSavingCell(true);
    try {
      await deleteAttendance(employee.id, cellEdit.date);
      setCellEdit(null);
      setMessage(`${employee.name} ${cellEdit.date} dikosongkan.`);
      await load();
    } catch (e) {
      setMessage('Gagal mengosongkan: ' + (e.message || e));
    } finally {
      setSavingCell(false);
    }
  }

  /** Isi satu hari untuk semua orang: satu klik, bukan 30x ketik. */
  async function fillWholeDay(dateStr, status) {
    const targets = rows;
    // Isi ulang Daily Rekap hanya menulis kolom kehadiran. Kalau di hari itu
    // ada lembur, lembur itu HARUS ikut dibuang, kalau tidak laporan lembur
    // tetap menghitungnya padahal selnya sudah tidak menampilkan angka.
    // Diberi tahu dulu lewat dialog, supaya tidak diam-diam menghapus.
    const punyaLembur = targets.filter((e) => (recMap[`${e.id}|${dateStr}`]?.overtimeMinutes || 0) > 0);
    const list = targets.map((e) => `${e.name}: ${status}`).join(', ');
    const catatan = punyaLembur.length
      ? `\n\nPERINGATAN: ${punyaLembur.length} orang punya catatan lembur tanggal ini. `
        + 'Catatan lembur ikut terhapus.'
      : '';
    if (!window.confirm(`Isi ${targets.length} orang dengan "${status}" pada ${dateStr}?\n${list}${catatan}`)) return;
    setSavingCell(true);
    let ok = 0;
    let gagal = 0;
    for (const e of targets) {
      try {
        await recordAttendance({
          outletId: e.outletId || outletFilter || null,
          employeeId: e.id,
          employeeName: e.name,
          type: status,
          date: dateStr,
          shift: e.shift || null,
          recordedBy: user?.email || user?.name || null
        });
        if ((recMap[`${e.id}|${dateStr}`]?.overtimeMinutes || 0) > 0) {
          await deleteOvertime(e.id, dateStr);
        }
        ok++;
      } catch {
        gagal++;
      }
    }
    setSavingCell(false);
    setMessage(`${dateStr}: ${ok} tersimpan${gagal ? `, ${gagal} gagal` : ''}.`);
    await load();
  }

  const editEmployee = cellEdit ? rows.find((e) => e.id === cellEdit.employeeId) : null;
  const editRec = cellEdit ? recMap[`${cellEdit.employeeId}|${cellEdit.date}`] : null;
  const editLate = editEmployee ? previewLate(editEmployee, cellDraft) : null;

  // Tanggal borongan harus selalu berada di dalam bulan yang sedang dibuka,
  // kalau tidak tombolnya diam-diam menulis ke bulan lain.
  const bulkDateValid = bulkDate >= first && bulkDate <= last ? bulkDate : first;

  return (
    <div className="att-month">
      <section className="filters">
        <label>
          Bulan
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label>
          Outlet
          <select value={outletFilter} onChange={(e) => onOutletChange && onOutletChange(e.target.value)}>
            <option value="">Semua outlet</option>
            {OUTLETS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={load} disabled={loading}>
          {loading ? 'Memuat...' : 'Muat ulang'}
        </button>
      </section>

      {message && <p className="message">{message}</p>}

      {loading && <p className="muted">Memuat data bulan {month}…</p>}

      {!loading && (
        <section className="table-wrap att-month-wrap">
          <table className="att-month-grid">
            <thead>
              <tr>
                <th className="sticky-col sticky-name">Nama</th>
                <th className="sticky-col sticky-job">Shift</th>
                {days.map((d) => (
                  <th key={d.date} className={d.isToday ? 'is-today' : undefined} title={`${DOW[d.dow]}, ${d.date}`}>
                    <span className="dow">{DOW[d.dow]}</span>
                    <span className="dnum">{d.day}</span>
                  </th>
                ))}
                <th className="recap" title="Sakit">S</th>
                <th className="recap" title="Alpha">A</th>
                <th className="recap" title="Izin">I</th>
                <th className="recap" title="Libur">Off</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id}>
                  <td className="sticky-col sticky-name">
                    <span className="no">{i + 1}.</span> {e.name}
                  </td>
                  // Label shift lengkap ("Shift SP1 (11-14, 17-22)") terlalu lebar untuk kolom
                // sticky yang diulang di tiap baris, jadi di sini cukup kode singkatnya.
                <td className="sticky-col sticky-job" title={SHIFT_LABEL[e.shift] || e.shift || ''}>
                  {(e.shift || e.role || '-').toUpperCase()}
                </td>
                  {days.map((d) => {
                    const rec = recMap[`${e.id}|${d.date}`];
                    const txt = cellText(rec);
                    return (
                      <td
                        key={d.date}
                        className={
                          'cell' + (txt ? ' filled' : '') +
                          (rec && rec.type === ATTENDANCE_TYPES.TELAT ? ' c-telat' : '') +
                          (rec && rec.type === ATTENDANCE_TYPES.LIBUR ? ' c-libur' : '') +
                          (rec && (rec.type === ATTENDANCE_TYPES.SAKIT || rec.type === ATTENDANCE_TYPES.IZIN || rec.type === ATTENDANCE_TYPES.ALPHA) ? ' c-other' : '') +
                          (rec && rec.overtimeMinutes > 0 ? ' c-lembur' : '')
                        }
                        onClick={() => openCell(e, d.date)}
                      >
                        {txt}
                        {rec && rec.checkOut != null && <span className="out">/{minutesToClock(rec.checkOut)}</span>}
                        {rec && rec.overtimeMinutes > 0 && <span className="ot">+{rec.overtimeMinutes}</span>}
                      </td>
                    );
                  })}
                  <td className="recap">{recap[e.id]?.S || ''}</td>
                  <td className="recap">{recap[e.id]?.A || ''}</td>
                  <td className="recap">{recap[e.id]?.I || ''}</td>
                  <td className="recap">{recap[e.id]?.OFF || ''}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={days.length + 6}>Tidak ada karyawan untuk outlet ini.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <p className="muted">
        Klik sel untuk mengisi. <strong>H</strong> hadir, <strong>T</strong> telat,
        <strong> S</strong> sakit, <strong>I</strong> izin, <strong>A</strong> alpha,
        <strong> OFF</strong> libur. Angka setelahnya = jam datang, <span className="out">/..</span> jam pulang,
        <span className="ot">+..</span> menit lembur. Kolom <strong>S / A / I / Off</strong> di kanan
        dihitung otomatis dari sel yang sudah terisi.
      </p>

      {cellEdit && editEmployee && (
        <div className="att-cell-editor">
          <div className="oil-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{editEmployee.name}</strong>
              <span className="muted">{cellEdit.date}</span>
            </div>
            {editEmployee.shift && (
              <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                Shift {SHIFT_LABEL[editEmployee.shift] || editEmployee.shift} mulai{' '}
                {minutesToClock(shiftStartMinutes(editEmployee.shift)) || '-'}
              </p>
            )}

            <p style={{ fontSize: 13, marginBottom: 4 }}>Status</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {QUICK.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  className={cellDraft.status === q.value ? 'pos-chip active' : 'pos-chip'}
                  onClick={() => pickStatus(q.value)}
                >
                  {q.token} {q.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              <label style={{ fontSize: 12 }}>
                Jam datang
                <input
                  type="time" step="300"
                  value={cellDraft.checkIn}
                  onChange={(e) => setCellDraft((d) => ({ ...d, checkIn: e.target.value }))}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Jam pulang
                <input
                  type="time" step="300"
                  value={cellDraft.checkOut}
                  onChange={(e) => setCellDraft((d) => ({ ...d, checkOut: e.target.value }))}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <label style={{ fontSize: 12 }}>
                Lembur (menit)
                <input
                  type="number" min="0"
                  value={cellDraft.lembur}
                  onChange={(e) => setCellDraft((d) => ({ ...d, lembur: e.target.value }))}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Catatan
                <input
                  type="text"
                  value={cellDraft.note}
                  onChange={(e) => setCellDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </label>
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {editLate == null
                ? 'Telat belum bisa dihitung (jam datang atau shift belum diisi).'
                : editLate > 0
                  ? `Telat ${minutesToDuration(editLate)} dari jam mulai shift.`
                  : 'Tepat waktu.'}
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={saveCell} disabled={savingCell}>
                {savingCell ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setCellEdit(null)} disabled={savingCell}>
                Batal
              </button>
              {editRec && (
                <button type="button" className="btn-secondary" onClick={clearCell} disabled={savingCell}>
                  Kosongkan
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && days.length > 0 && (
        <section className="att-bulk">
          <p>Isi satu hari untuk semua orang (Shortcut):</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="date"
              value={bulkDateValid}
              min={first}
              max={last}
              onChange={(e) => setBulkDate(e.target.value)}
            />
            {QUICK.slice(0, 2).map((q) => (
              <button key={q.value} type="button" onClick={() => fillWholeDay(bulkDateValid, q.value)} disabled={savingCell}>
                Semua {q.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const d = days.find((x) => x.isToday);
                fillWholeDay((d || days[0]).date, ATTENDANCE_TYPES.HADIR);
              }}
              disabled={savingCell}
            >
              Semua Hadir (hari ini)
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Borongan ini menimpa sel yang sudah terisi di tanggal tersebut.
          </p>
        </section>
      )}
    </div>
  );
}