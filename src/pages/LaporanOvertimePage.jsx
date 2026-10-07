import { useCallback, useEffect, useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getAttendanceRange } from '../lib/attendanceService';
import { getOvertimeByEmployee } from '../lib/overtimeService';
import { listenAllTherapists } from '../lib/therapistService';
import { exportExcelReport } from '../lib/excelExport';

const ALL_OUTLETS = '__all__';

const todayWib = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const thisMonthWib = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
const daysAgo = (n) => new Date(Date.now() + 7 * 3600000 - n * 86400000).toISOString().slice(0, 10);

/** 135 menit -> "2j 15m". Lebih enak dibaca daripada "135 menit" di tabel panjang. */
function durasi(menit) {
  const m = Number(menit) || 0;
  if (m <= 0) return '-';
  const j = Math.floor(m / 60);
  const sisa = m % 60;
  if (!j) return `${sisa}m`;
  if (!sisa) return `${j}j`;
  return `${j}j ${sisa}m`;
}

const navBtn = { width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' };
const hint = { fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' };

const OUTLET_NAME = Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));

/**
 * Laporan Overtime — diambil dari data absensi, sama persis dengan kolom
 * rekap "Lm" / "Lo" / "Tot" di Laporan Absensi.
 *
 * Dua sumber, sengaja tidak digabung diam-diam:
 *   Lm (manual)  = menit yang kasir isi di kotak edit sel Absensi.
 *                  Disimpan di tabel attendance_overtime.
 *   Lo (otomatis)= kelebihan treatment di atas jam selesai shift, dihitung
 *                  dari data booking.
 *   Tot          = Lm + Lo, sama seperti kolom "Tot" di Laporan Absensi.
 *
 * Bedanya dengan halaman Overtime (khusus Office): halaman itu menampilkan
 * angka OTOMATIS saja. Halaman ini menampilkan yang kasir catat sendiri —
 * itu yang dipakai untuk menghitung gaji.
 */
export default function LaporanOvertimePage({ active, profile }) {
  const isKasir = profile?.role === 'kasir';
  const myOutletId = profile?.outletId;

  const [outletId, setOutletId] = useState(isKasir ? myOutletId : ALL_OUTLETS);
  const [startDate, setStartDate] = useState(() => `${thisMonthWib()}-01`);
  const [endDate, setEndDate] = useState(todayWib);
  const [records, setRecords] = useState(null);
  const [autoOt, setAutoOt] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAuto, setShowAuto] = useState(true);

  const target = isKasir ? myOutletId : outletId;
  const outletLabel = target === ALL_OUTLETS ? 'Semua Outlet' : (OUTLET_NAME[target] || target);

  useEffect(() => {
    if (!active) return undefined;
    return listenAllTherapists(setEmployees);
  }, [active]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError('');
    try {
      const scope = target === ALL_OUTLETS ? undefined : target;
      const [att, auto] = await Promise.all([
        getAttendanceRange(startDate, endDate, scope),
        getOvertimeByEmployee(startDate, endDate)
      ]);
      setRecords(att);
      setAutoOt(auto || {});
    } catch (e) {
      setRecords(null);
      setError(e?.message || 'Gagal memuat data absensi.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, target]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // Rekap per orang. Sumber manual dihitung dari record absensi (kolom Lm di
  // Laporan Absensi), otomatis dari autoOt (kolom Lo).
  const perTherapist = useMemo(() => {
    if (!records) return [];

    const listByEmp = {};
    records.forEach((r) => {
      (listByEmp[r.employeeId] = listByEmp[r.employeeId] || []).push(r);
    });

    const ids = new Set([
      ...employees.map((e) => e.id),
      ...Object.keys(listByEmp),
      ...Object.keys(autoOt)
    ]);

    const out = [];
    ids.forEach((id) => {
      const emp = employees.find((e) => e.id === id);
      const list = listByEmp[id] || [];
      const manual = list.reduce((s, r) => s + (Number(r.overtimeMinutes) || 0), 0);
      const auto = Number(autoOt[id]?.totalOvertimeMinutes) || 0;
      if (manual <= 0 && auto <= 0) return;

      const hari = list.filter((r) => (Number(r.overtimeMinutes) || 0) > 0).length;
      const belumDitinjau = list.filter(
        (r) => (Number(r.overtimeMinutes) || 0) > 0 && r.overtimeVerified === false
      ).length;

      out.push({
        id,
        name: list[0]?.employeeName || emp?.name || '(tanpa nama)',
        shift: emp?.shift || '',
        hari,
        manual,
        auto,
        total: manual + auto,
        belumDitinjau
      });
    });

    return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [records, employees, autoOt]);

  const totals = useMemo(() => perTherapist.reduce((acc, t) => {
    acc.manual += t.manual;
    acc.auto += t.auto;
    acc.total += t.total;
    acc.hari += t.hari;
    acc.belumDitinjau += t.belumDitinjau;
    return acc;
  }, { manual: 0, auto: 0, total: 0, hari: 0, belumDitinjau: 0 }), [perTherapist]);

  async function handleDownload() {
    if (!perTherapist.length) return;
    const headers = [
      'Nama', 'Shift', 'Hari ada lembur', 'Lm (manual menit)', 'Lm (manual)',
      showAuto ? 'Lo (otomatis menit)' : null, showAuto ? 'Lo (otomatis)' : null,
      'Total menit', 'Total', 'Belum ditinjau'
    ].filter(Boolean);

    const body = perTherapist.map((t) => [
      t.name,
      t.shift ? t.shift.toUpperCase() : '-',
      t.hari,
      t.manual,
      durasi(t.manual),
      ...(showAuto ? [t.auto, durasi(t.auto)] : []),
      t.total,
      durasi(t.total),
      t.belumDitinjau || ''
    ]);

    body.push([]);
    body.push([
      'TOTAL', '', totals.hari, totals.manual, durasi(totals.manual),
      ...(showAuto ? [totals.auto, durasi(totals.auto)] : []),
      totals.total, durasi(totals.total), totals.belumDitinjau || ''
    ]);

    await exportExcelReport({
      filename: `Laporan-Overtime-Absensi-${target === ALL_OUTLETS ? 'Semua-Outlet' : target}-${startDate}_${endDate}`,
      title: 'Laporan Overtime (dari Absensi) — Dayang Spa',
      subtitle: `${outletLabel} · ${startDate} s/d ${endDate}`,
      headers,
      rows: body,
      currencyColumns: headers
        .map((h, i) => (/menit|^\d/.test(h) && i >= 2 ? i : -1))
        .filter((i) => i >= 0),
      totalRowIndex: body.length - 1
    });
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Overtime</h2>
      <p className="muted">
        Diambil dari data absensi — angka <strong>Lm</strong> di sini sama dengan
        kolom <strong>Lm</strong> di Laporan Absensi. Lm = menit yang kasir isi
        manual di kotak edit sel Absensi. Lo = lembur otomatis yang dihitung dari
        jam selesai treatment (opsional, bisa dimatikan lewat tombol di bawah).
      </p>

      <section>
        <p>Outlet</p>
        {isKasir ? (
          <p style={{ margin: 0, fontWeight: 600 }}>{outletLabel}</p>
        ) : (
          <div className="grid-2">
            <button
              className={outletId === ALL_OUTLETS ? 'active' : ''}
              onClick={() => setOutletId(ALL_OUTLETS)}
            >
              Semua Outlet
            </button>
            {OUTLETS.map((o) => (
              <button
                key={o.id}
                className={outletId === o.id ? 'active' : ''}
                onClick={() => setOutletId(o.id)}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <p>Rentang tanggal</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={navBtn}
            onClick={() => { const b = thisMonthWib(); setStartDate(`${b}-01`); setEndDate(todayWib()); }}
          >
            Bulan ini
          </button>
          <button
            style={navBtn}
            onClick={() => { setStartDate(daysAgo(29)); setEndDate(todayWib()); }}
          >
            30 hari
          </button>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>s/d</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <button style={navBtn} onClick={load} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat'}
          </button>
        </div>
      </section>

      {error && <p className="message warn">{error}</p>}

      {records && (
        <>
          <section className="summary-chips" style={{ margin: '12px 0' }}>
            <span className="chip chip-purple">Total {durasi(totals.total)}</span>
            <span className="chip">Lm manual {durasi(totals.manual)}</span>
            {showAuto && <span className="chip">Lo otomatis {durasi(totals.auto)}</span>}
            <span className="chip">{perTherapist.length} orang</span>
            <span className="chip">{totals.hari} hari terlPembayar</span>
          </section>

          {totals.belumDitinjau > 0 && (
            <div className="message warn" style={{ marginBottom: 12 }}>
              ⚠ <strong>{totals.belumDitinjau} catatan lembur</strong> berlabel
              “TANPA booking pendukung – perlu ditinjau”. Angkannya masuk di Lm
              tapi belum ada bukti treatment yang mendukung. Perlu dicek sebelum
              dibayar.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              className={showAuto ? 'pos-chip active' : 'pos-chip'}
              onClick={() => setShowAuto((v) => !v)}
              style={{ fontSize: 12 }}
            >
              {showAuto ? 'Sembunyikan otomatis (Lo)' : 'Tampilkan otomatis (Lo)'}
            </button>
            <button style={navBtn} onClick={handleDownload} disabled={!perTherapist.length}>
              ⬇ Download Excel
            </button>
          </div>

          {perTherapist.length === 0 ? (
            <p className="muted">Tidak ada lembur tercatat pada rentang ini.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th>Shift</th>
                    <th>Hari</th>
                    <th>Lm manual</th>
                    {showAuto && <th>Lo otomatis</th>}
                    <th>Total</th>
                    {totals.belumDitinjau > 0 && <th>Perlu ditinjau</th>}
                  </tr>
                </thead>
                <tbody>
                  {perTherapist.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.name}</strong></td>
                      <td>{t.shift ? t.shift.toUpperCase() : '-'}</td>
                      <td>{t.hari}</td>
                      <td>
                        {durasi(t.manual)}
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}> ({t.manual}m)</span>
                      </td>
                      {showAuto && (
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {durasi(t.auto)}
                          <span style={{ fontSize: 11 }}> ({t.auto}m)</span>
                        </td>
                      )}
                      <td style={{ fontWeight: 700 }}>{durasi(t.total)}</td>
                      {totals.belumDitinjau > 0 && (
                        <td style={{ color: t.belumDitinjau ? 'var(--busy)' : undefined, fontWeight: t.belumDitinjau ? 600 : undefined }}>
                          {t.belumDitinjau || '-'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>TOTAL</strong></td>
                    <td><strong>{totals.hari}</strong></td>
                    <td style={{ fontWeight: 700 }}>{durasi(totals.manual)}</td>
                    {showAuto && <td style={{ fontWeight: 700 }}>{durasi(totals.auto)}</td>}
                    <td style={{ fontWeight: 800, color: 'var(--primary-dark)' }}>{durasi(totals.total)}</td>
                    {totals.belumDitinjau > 0 && (
                      <td style={{ fontWeight: 700, color: 'var(--busy)' }}>{totals.belumDitinjau}</td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p style={hint}>
            Angka dalam kurung adalah menitmentara. <strong>Hari</strong> =
            berapa kali lembur tercatat untuk orang itu, bukan jumlah hari kerja.
          </p>
        </>
      )}
    </div>
  );
}