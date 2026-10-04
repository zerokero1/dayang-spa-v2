import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ATTENDANCE_TYPES, OUTLETS, SHIFT_LABEL } from '../lib/constants';
import {
  deleteAttendance, getAttendanceRange, deleteOvertime, recordAttendance, saveOvertime
} from '../lib/attendanceService';
import { clockToMinutes, minutesToClock, minutesToDuration, shiftStartMinutes } from '../lib/shiftService';
import {
  DOW, QUICK, cellClass, cellText, recapValue, todayWib, DEFAULT_RECAP
} from '../lib/attendanceGrid';

/**
 * Grid absensi dipakai dua halaman: Absensi (tab Bulanan) dan Laporan
 * Absensi. Semula grid ini hanya hidup di dalam AbsensiBulanan.jsx, jadi
 * laporan hanya bisa menampilkan daftar kartu — pola per tanggal tidak
 * terlihat. Semua logika sel, editor, dan rekap sekarang tinggal di sini.
 *
 * Bentuknya meniru spreadsheet "ABSENSI PER OUTLET":
 *   baris = orang, kolom = tanggal, sel = status singkat + jam datang.
 *
 * Halaman laporan memakai prop tambahan (recapColumns, showTotals, hint)
 * supaya tampilannya lebih lengkap tanpa mengubah perilaku input absensi.
 */

export default function AbsensiGrid({
  active,
  employees,
  outletFilter,
  onOutletChange,
  user,
  days,
  first,
  last,
  controls,
  actions,
  hint,
  showBulk = false,
  showTotals = false,
  recapColumns = DEFAULT_RECAP,
  recapContext = null,
  onRecordsLoaded
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [cellEdit, setCellEdit] = useState(null);   // { employeeId, date }
  const [cellDraft, setCellDraft] = useState({});
  const [savingCell, setSavingCell] = useState(false);
  const [bulkDate, setBulkDate] = useState(todayWib);

  // Callback parent selalu berubah tiap render. Simpan di ref supaya `load`
  // tidak ikut berubah dan memicu muat ulang tanpa henti.
  const notifyRef = useRef(onRecordsLoaded);
  notifyRef.current = onRecordsLoaded;

  const list = Array.isArray(days) ? days : [];

  const load = useCallback(async () => {
    if (!list.length) { setRecords([]); return; }
    setLoading(true);
    try {
      const rows = await getAttendanceRange(list[0].date, list[list.length - 1].date, outletFilter || undefined);
      setRecords(rows);
      if (notifyRef.current) notifyRef.current(rows);
    } catch (e) {
      setMessage('Gagal memuat absensi: ' + e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list[0]?.date, list[list.length - 1]?.date, outletFilter]);

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
      byId[e.id] = { id: e.id, name: e.name, role: e.role, outletId: e.homeOutletId, shift: e.shift || '' };
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

  // Rekap per orang. Nilai selalu dihitung dari sel yang sudah terisi, tidak
  // pernah diisi manual, supaya tidak mungkin beda dengan isi tabel.
  const recap = useMemo(() => {
    const out = {};
    rows.forEach((e) => { out[e.id] = {}; });
    const listByEmp = {};
    records.forEach((r) => {
      const row = out[r.employeeId];
      if (!row) return;
      (listByEmp[r.employeeId] = listByEmp[r.employeeId] || []).push(r);
    });
    rows.forEach((e) => {
      const listEmp = listByEmp[e.id] || [];
      recapColumns.forEach((col) => {
        out[e.id][col.key] = recapValue(col, e.id, listEmp, recapContext);
      });
    });
    return out;
  }, [rows, records, recapColumns, recapContext]);

  const recapTotals = useMemo(() => {
    const out = {};
    recapColumns.forEach((col) => {
      out[col.key] = rows.reduce((sum, e) => sum + (Number(recap[e.id]?.[col.key]) || 0), 0);
    });
    return out;
  }, [rows, recap, recapColumns]);

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

  /** Simpan hanya kolom kehadiran + jam, lalu muat ulang. */
  async function persistPresence(employee, draft, { closeEditor }) {
    const rec = recMap[`${employee.id}|${cellEdit.date}`];
    setSavingCell(true);
    try {
      const { lateMinutes } = await recordAttendance({
        outletId: employee.outletId || outletFilter || null,
        employeeId: employee.id,
        employeeName: employee.name,
        type: draft.status,
        note: draft.note || '',
        date: cellEdit.date,
        checkIn: clockToMinutes(draft.checkIn),
        checkOut: clockToMinutes(draft.checkOut),
        shift: employee.shift || null,
        recordedBy: user?.email || user?.name || null,
        lateMinutesOverride: null
      });

      // Lembur lama harus dihapus kalau kasir mengosongkan atau menurunkannya.
      // Kalau tidak, record lama di attendance_overtime tetap ikut terhitung di
      // laporan padahal selnya sudah tidak punya angka lembur.
      const lemburBaru = Number(draft.lembur) || 0;
      const lemburLama = rec?.overtimeMinutes || 0;
      if (lemburBaru > 0) {
        await saveOvertime({
          outletId: employee.outletId || outletFilter || null,
          employeeId: employee.id,
          employeeName: employee.name,
          minutes: lemburBaru,
          date: cellEdit.date,
          note: draft.note,
          recordedBy: user?.email || user?.name || null
        });
      } else if (lemburLama > 0) {
        await deleteOvertime(employee.id, cellEdit.date);
      }

      if (closeEditor) setCellEdit(null);
      const telat = lateMinutes > 0 ? ` (telat ${minutesToDuration(lateMinutes)})` : '';
      setMessage(`${employee.name} ${cellEdit.date}: ${draft.status}${telat}`);
      await load();
    } catch (e) {
      setMessage('Gagal menyimpan: ' + (e.message || e));
    } finally {
      setSavingCell(false);
    }
  }

  /**
   * Status clicked langsung tersimpan supaya kasir tidak perlu menekan
   * Simpan cuma untuk menandai hadir. Editor tetap terbuka supaya jam pulang
   * dan menit lembur bisa langsung diisi afterwards.
   */
  async function pickStatus(value) {
    const draftNext = {
      ...cellDraft,
      status: value,
      checkIn: value === ATTENDANCE_TYPES.TELAT ? cellDraft.checkIn : cellDraft.checkIn,
      lembur: value === ATTENDANCE_TYPES.LIBUR ? '' : cellDraft.lembur
    };
    setCellDraft(draftNext);
    if (!cellEdit) return;
    const employee = rows.find((e) => e.id === cellEdit.employeeId);
    if (!employee) return;
    await persistPresence(employee, draftNext, { closeEditor: false });
  }

  async function saveCell() {
    if (!cellEdit) return;
    const employee = rows.find((e) => e.id === cellEdit.employeeId);
    if (!employee) return;
    if (!cellDraft.status) { setMessage('Pilih status dulu (atau kosongkan sel).'); return; }
    await persistPresence(employee, cellDraft, { closeEditor: true });
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

  /** Telat = jam datang - jam mulai shift; null kalau tidak bisa dihitung. */
  const editLate = useMemo(() => {
    if (!editEmployee || cellDraft?.status !== ATTENDANCE_TYPES.TELAT || !cellDraft?.checkIn) return null;
    const inMin = clockToMinutes(cellDraft.checkIn);
    const start = shiftStartMinutes(editEmployee.shift);
    if (inMin == null || start == null) return null;
    return Math.max(0, inMin - start);
  }, [editEmployee, cellDraft]);

  // Tanggal borongan harus selalu berada di dalam periode yang sedang dibuka,
  // kalau tidak tombolnya diam-diam menulis ke periode lain.
  const bulkDateValid = (bulkDate >= first && bulkDate <= last) ? bulkDate : (first || todayWib());

  const colCount = list.length + 2 + recapColumns.length;

  return (
    <div className="att-month">
      <section className="filters">
        {controls}
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
        {actions}
      </section>

      {message && <p className="message">{message}</p>}

      {loading && <p className="muted">Memuat data…</p>}

      {!loading && (
        <section className="table-wrap att-month-wrap">
          <table className="att-month-grid">
            <thead>
              <tr>
                <th className="sticky-col sticky-name">Nama</th>
                <th className="sticky-col sticky-job">Shift</th>
                {list.map((d) => (
                  <th key={d.date} className={d.isToday ? 'is-today' : undefined} title={`${DOW[d.dow]}, ${d.date}`}>
                    <span className="dow">{DOW[d.dow]}</span>
                    <span className="dnum">{d.day}</span>
                  </th>
                ))}
                {recapColumns.map((c) => (
                  <th key={c.key} className="recap" title={c.title || c.label}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id}>
                  <td className="sticky-col sticky-name">
                    <span className="no">{i + 1}.</span> {e.name}
                  </td>
                  <td className="sticky-col sticky-job" title={SHIFT_LABEL[e.shift] || e.shift || ''}>
                    {(e.shift || e.role || '-').toUpperCase()}
                  </td>
                  {list.map((d) => {
                    const rec = recMap[`${e.id}|${d.date}`];
                    return (
                      <td key={d.date} className={cellClass(rec)} onClick={() => openCell(e, d.date)}>
                        {cellText(rec)}
                        {rec && rec.checkOut != null && <span className="out">/{minutesToClock(rec.checkOut)}</span>}
                        {rec && rec.overtimeMinutes > 0 && <span className="ot">+{rec.overtimeMinutes}</span>}
                      </td>
                    );
                  })}
                  {recapColumns.map((c) => (
                    <td key={c.key} className="recap">{recap[e.id]?.[c.key] || ''}</td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={colCount}>Tidak ada karyawan untuk outlet ini.</td></tr>
              )}
            </tbody>
            {showTotals && rows.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky-col sticky-name">TOTAL ({rows.length} orang)</td>
                  <td className="sticky-col sticky-job" />
                  {list.map((d) => (
                    <td key={d.date} className="recap">
                      {records.filter((r) => r.date === d.date && (r.type === ATTENDANCE_TYPES.HADIR || r.type === ATTENDANCE_TYPES.TELAT)).length || ''}
                    </td>
                  ))}
                  {recapColumns.map((c) => (
                    <td key={c.key} className="recap">{recapTotals[c.key] || ''}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </section>
      )}

      <p className="muted">
        {hint || (
          <>
            Klik sel untuk mengisi. <strong>H</strong> hadir, <strong>T</strong> telat,
            <strong> S</strong> sakit, <strong>I</strong> izin, <strong>A</strong> alpha,
            <strong> OFF</strong> libur. Angka setelahnya = menit telat, <span className="out">/..</span> jam pulang,
            <span className="ot">+..</span> menit lembur. Kolom di kanan
            dihitung otomatis dari sel yang sudah terisi.
          </>
        )}
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
                  disabled={savingCell}
                >
                  {q.token} {q.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              <label style={{ fontSize: 12 }}>
                Jam datang
                <input
                  type="time"
                  step="300"
                  value={cellDraft.checkIn}
                  onChange={(e) => setCellDraft((d) => ({ ...d, checkIn: e.target.value }))}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Jam pulang
                <input
                  type="time"
                  step="300"
                  value={cellDraft.checkOut}
                  onChange={(e) => setCellDraft((d) => ({ ...d, checkOut: e.target.value }))}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <label style={{ fontSize: 12 }}>
                Lembur (menit)
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={cellDraft.lembur}
                  onChange={(e) => setCellDraft((d) => ({ ...d, lembur: e.target.value }))}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Catatan
                <input
                  type="text"
                  placeholder="opsional"
                  value={cellDraft.note}
                  onChange={(e) => setCellDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </label>
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {editDraftLateText(cellDraft, editLate)}
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={saveCell} disabled={savingCell || !cellDraft.status}>
                {savingCell ? 'Menyimpan...' : 'Simpan'}
              </button>
              {editRec && (
                <button type="button" onClick={clearCell} disabled={savingCell} style={{ color: '#b91c1c' }}>
                  Kosongkan
                </button>
              )}
              <button type="button" onClick={() => setCellEdit(null)} disabled={savingCell}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulk && !loading && list.length > 0 && (
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
                const d = list.find((x) => x.isToday);
                fillWholeDay((d || list[0]).date, ATTENDANCE_TYPES.HADIR);
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

function editDraftLateText(draft, late) {
  if (draft?.status !== ATTENDANCE_TYPES.TELAT) return 'Telat dihitung otomatis dari jam datang dibanding mulai shift.';
  if (!draft?.checkIn) return 'Isi jam datang untuk menghitung menit telat.';
  if (late == null) return 'Shift belum diatur, telat tidak bisa dihitung.';
  return `Telat diperkirakan ${late} menit.`;
}
