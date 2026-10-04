import { useCallback, useEffect, useMemo, useState } from 'react';
import AbsensiGrid from '../components/AbsensiGrid';
import { daysOfMonth, daysOfRange, thisMonthWib, todayWib } from '../lib/attendanceGrid';
import {
  buildGridRows, buildRecMap, computeRecap, computeRecapTotals, gridCellText, presentCount
} from '../lib/attendanceGrid';
import { getOvertimeByEmployee } from '../lib/overtimeService';
import { listenAllTherapists } from '../lib/therapistService';
import { OUTLETS } from '../lib/constants';
import { exportAbsensiGrid } from '../lib/excelExport';

/**
 * Laporan Absensi memakai grid yang sama dengan halaman Absensi: baris = orang,
 * kolom = tanggal. Default satu bulan penuh, bisa diganti rentang bebas kalau
 * perlu rekap mingguan. Sel tetap bisa diklik untuk mengisi atau mengoreksi,
 * karena laporan sering dipakai saat mau betulkan data.
 *
 * Kolom rekap di kanan menambah hitungan yang tidak ada di grid absensi:
 * jumlah hari hadir, menit lembur manual, menit lembur otomatis (dihitung
 * dari jam selesai booking), dan totalnya.
 */

/** Kolom rekap tambahan. autoOv disuntikkan lewat makeRecapColumns(). */
function makeRecapColumns(autoOt) {
  return [
    { key: 'H', label: 'H', title: 'Jumlah hari hadir (hadir + telat)' },
    { key: 'S', label: 'S', title: 'Sakit' },
    { key: 'A', label: 'A', title: 'Alpha' },
    { key: 'I', label: 'I', title: 'Izin' },
    { key: 'OFF', label: 'Off', title: 'Libur' },
    { key: 'L', label: 'Lm', title: 'Lembur dari input absensi (menit)' },
    {
      key: 'auto',
      label: 'Lo',
      title: 'Lembur otomatis dari jam selesai booking (menit)',
      get: (employeeId) => autoOt[employeeId]?.totalOvertimeMinutes || 0
    },
    {
      key: 'totalLembur',
      label: 'Tot',
      title: 'Total lembur manual + otomatis (menit)',
      get: (employeeId, list) => (Number(autoOt[employeeId]?.totalOvertimeMinutes) || 0)
        + list.reduce((sum, r) => sum + (r.overtimeMinutes || 0), 0)
    }
  ];
}

export default function LaporanAbsensiPage({ active, user }) {
  const [period, setPeriod] = useState('bulan');           // 'bulan' | 'rentang'
  const [month, setMonth] = useState(thisMonthWib);
  const [startDate, setStartDate] = useState(todayWib);
  const [endDate, setEndDate] = useState(todayWib);
  const [outletFilter, setOutletFilter] = useState('');
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [autoOt, setAutoOt] = useState({});
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const unsub = listenAllTherapists(setEmployees);
    return () => unsub();
  }, [active]);

  const days = useMemo(
    () => (period === 'bulan' ? daysOfMonth(month) : daysOfRange(startDate, endDate)),
    [period, month, startDate, endDate]
  );
  const first = days[0]?.date || '';
  const last = days[days.length - 1]?.date || '';

  const loadAutoOvertime = useCallback(async (from, to) => {
    if (!from || !to) return;
    try {
      setAutoOt(await getOvertimeByEmployee(from, to));
    } catch (e) {
      console.warn('lembur otomatis gagal dimuat', e);
      setAutoOt({});
    }
  }, []);

  useEffect(() => {
    if (active) loadAutoOvertime(first, last);
  }, [active, first, last, loadAutoOvertime]);

  // Dipakai grid: begitu data tabel termuat, simpan di sini untuk ringkasan
  // dan export Excel.
  const handleRecordsLoaded = useCallback((rows) => { setRecords(rows); }, []);

  // Kolom rekap membaca autoOt, jadi daftar kolomnya dibuat ulang tiap
  // angka lembur otomatis berubah.
  const recapCols = useMemo(() => makeRecapColumns(autoOt), [autoOt]);

  // Data grid dipakai untuk membangkitkan file Excel. Dihitung dengan helper
  // yang sama dengan grid di layar supaya isi file dijamin identik dengan
  // tabel yang sedang dilihat — bukan tabel rekap yang terpisah.
  const gridRows = useMemo(
    () => buildGridRows(employees, records, outletFilter),
    [employees, records, outletFilter]
  );
  const gridRecap = useMemo(
    () => computeRecap(gridRows, records, recapCols, autoOt),
    [gridRows, records, recapCols, autoOt]
  );
  const gridRecapTotals = useMemo(
    () => computeRecapTotals(gridRows, gridRecap, recapCols),
    [gridRows, gridRecap, recapCols]
  );

  async function handleDownload() {
    if (!gridRows.length) return;
    const recMap = buildRecMap(records);

    // Satu sel = teks yang sama persis dengan yang dirender layar (token
    // status + menit telat, jam pulang, menit lembur). `type` dibawa terpisah
    // supaya Excel bisa mewarnai selnya seperti warna di aplikasi.
    const excelRows = gridRows.map((e) => ({
      name: e.name,
      shift: (e.shift || e.role || '-').toUpperCase(),
      cells: days.map((d) => {
        const rec = recMap[`${e.id}|${d.date}`];
        return { text: gridCellText(rec), type: rec?.type || '' };
      })
    }));

    const outletLabel = outletFilter ? (OUTLETS.find((o) => o.id === outletFilter)?.name || outletFilter) : 'Semua Outlet';
    const rangeLabel = first === last ? first : `${first} s/d ${last}`;

    setDownloading(true);
    try {
      await exportAbsensiGrid({
        filename: `Laporan-Absensi-${outletLabel}-${first}_${last}`,
        title: 'Laporan Absensi — Dayang Spa',
        subtitle: `${outletLabel} · ${rangeLabel}`,
        sheetName: 'Absensi',
        days,
        rows: excelRows,
        recapColumns: recapCols.map((c) => ({ label: c.label, title: c.title || c.label })),
        recapTotals: recapCols.map((c) => gridRecapTotals[c.key] || 0),
        presentByDay: days.map((d) => presentCount(records, d.date) || ''),
        note: 'H = hadir, T = telat, S = sakit, I = izin, A = alpha, OFF = libur. '
          + 'Angka setelah H/T = menit telat, /.. = jam pulang, +.. = menit lembur dari input absensi. '
          + 'Kolom rekap: H = jumlah hari hadir, S/A/I/Off = jumlah hari masing-masing, '
          + 'Lm = total menit lembur absensi, Lo = total menit lembur otomatis dari booking, Tot = Lm + Lo. '
          + 'Baris TOTAL: angka per tanggal = jumlah orang yang hadir hari itu.'
      });
    } catch (e) {
      alert('Gagal membuat file Excel: ' + e.message);
    } finally {
      setDownloading(false);
    }
  }

  const rangeTooLong = days.length > 62;
  const periodLabel = period === 'bulan' ? month : (first === last ? first : `${first} s/d ${last}`);

  return (
    <div className="kasir-page">
      <h2>Laporan Absensi</h2>

      <div className="att-tabs">
        <button type="button" className={period === 'bulan' ? 'active' : ''} onClick={() => setPeriod('bulan')}>
          Bulanan
        </button>
        <button type="button" className={period === 'rentang' ? 'active' : ''} onClick={() => setPeriod('rentang')}>
          Rentang tanggal
        </button>
      </div>

      {rangeTooLong && (
        <p className="message warn">
          Periode ini {days.length} hari — tabelnya jadi sangat lebar. Batasi rentang sekitar 2 bulan agar mudah dibaca.
        </p>
      )}

      <AbsensiGrid
        active={active}
        employees={employees}
        outletFilter={outletFilter}
        onOutletChange={setOutletFilter}
        user={user}
        days={days}
        first={first}
        last={last}
        recapColumns={recapCols}
        recapContext={autoOt}
        showTotals
        onRecordsLoaded={handleRecordsLoaded}
        controls={period === 'bulan' ? (
          <label>
            Bulan
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        ) : (
          <>
            <label>
              Dari
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              Sampai
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </>
        )}
        actions={(
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading || records.length === 0}
          >
            {downloading ? 'Menyiapkan...' : `⬇ Download Excel (${records.length} baris)`}
          </button>
        )}
        hint={(
          <>
            Periode <strong>{periodLabel}</strong> · {days.length} hari · {employees.length} karyawan.
            Klik sel untuk mengisi atau mengoreksi — datanya sama dengan halaman Absensi.
            <strong>H</strong> hadir, <strong>T</strong> telat, <strong>S</strong> sakit,
            <strong> I</strong> izin, <strong>A</strong> alpha, <strong>OFF</strong> libur.
            Angka setelah <strong>H/T</strong> = menit telat, <span className="out">/..</span> jam pulang,
            <span className="ot">+..</span> menit lembur. Kolom rekap dan baris <strong>TOTAL</strong> dihitung otomatis.
          </>
        )}
      />
    </div>
  );
}