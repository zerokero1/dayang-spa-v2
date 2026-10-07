import { useCallback, useEffect, useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getAttendanceRange } from '../lib/attendanceService';
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
 * Laporan Overtime — hanya lembur yang dicatat MANUAL di halaman Absensi.
 *
 * Angka di sini sama persis dengan kolom "Lm" di Laporan Absensi, karena
 * keduanya memanggil getAttendanceRange() yang sama. Tidak ada kolom lembur
 * otomatis: hitungan otomatis dari jam selesai treatment (yang di halaman
 * Overtime untuk Office) sengaja tidak ikut karena bisa berbeda jauh dari
 * yang dicatat kasir, dan untuk menghitung gaji yang dipakai angka yang
 * dicatat manusia.
 */
export default function LaporanOvertimePage({ active, profile }) {
  const isKasir = profile?.role === 'kasir';
  const myOutletId = profile?.outletId;

  const [outletId, setOutletId] = useState(isKasir ? myOutletId : ALL_OUTLETS);
  const [startDate, setStartDate] = useState(() => `${thisMonthWib()}-01`);
  const [endDate, setEndDate] = useState(todayWib);
  const [records, setRecords] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      setRecords(await getAttendanceRange(startDate, endDate, scope));
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

  // Rekap per orang dari menit lembur yang tercatat di absensi (kolom Lm).
  const perTherapist = useMemo(() => {
    if (!records) return [];

    const listByEmp = {};
    records.forEach((r) => {
      (listByEmp[r.employeeId] = listByEmp[r.employeeId] || []).push(r);
    });

    const ids = new Set([...employees.map((e) => e.id), ...Object.keys(listByEmp)]);

    const out = [];
    ids.forEach((id) => {
      const emp = employees.find((e) => e.id === id);
      const list = listByEmp[id] || [];
      const total = list.reduce((s, r) => s + (Number(r.overtimeMinutes) || 0), 0);
      if (total <= 0) return;

      const catatan = list.filter((r) => (Number(r.overtimeMinutes) || 0) > 0).length;
      const belumDitinjau = list.filter(
        (r) => (Number(r.overtimeMinutes) || 0) > 0 && r.overtimeVerified === false
      ).length;

      out.push({
        id,
        name: list[0]?.employeeName || emp?.name || '(tanpa nama)',
        shift: emp?.shift || '',
        catatan,
        total,
        belumDitinjau
      });
    });

    return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [records, employees]);

  const totals = useMemo(() => perTherapist.reduce((acc, t) => {
    acc.total += t.total;
    acc.catatan += t.catatan;
    acc.belumDitinjau += t.belumDitinjau;
    return acc;
  }, { total: 0, catatan: 0, belumDitinjau: 0 }), [perTherapist]);

  async function handleDownload() {
    if (!perTherapist.length) return;
    const headers = ['Nama', 'Shift', 'Jumlah catatan', 'Total menit', 'Total', 'Perlu ditinjau'];
    const body = perTherapist.map((t) => [
      t.name,
      t.shift ? t.shift.toUpperCase() : '-',
      t.catatan,
      t.total,
      durasi(t.total),
      t.belumDitinjau || ''
    ]);

    body.push([]);
    body.push(['TOTAL', '', totals.catatan, totals.total, durasi(totals.total), totals.belumDitinjau || '']);

    await exportExcelReport({
      filename: `Laporan-Overtime-Absensi-${target === ALL_OUTLETS ? 'Semua-Outlet' : target}-${startDate}_${endDate}`,
      title: 'Laporan Overtime (dari Absensi) — Dayang Spa',
      subtitle: `${outletLabel} · ${startDate} s/d ${endDate}`,
      headers,
      rows: body,
      currencyColumns: [3],
      totalRowIndex: body.length - 1
    });
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Overtime</h2>
      <p className="muted">
        Hanya lembur yang <strong>dicatat manual</strong> di halaman Absensi — kolom
        <strong> Lm</strong> di Laporan Absensi. Angka di sini memakai data yang
        sama, jadi tidak mungkin berbeda. Lembur otomatis dari jam selesai
        treatment tidak dihitung di laporan ini.
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
            <span className="chip">{totals.total} menit</span>
            <span className="chip">{perTherapist.length} orang</span>
            <span className="chip">{totals.catatan} catatan lembur</span>
          </section>

          {totals.belumDitinjau > 0 && (
            <div className="message warn" style={{ marginBottom: 12 }}>
              ⚠ <strong>{totals.belumDitinjau} catatan lembur</strong> berlabel
              “TANPA booking pendukung – perlu ditinjau”. Angkanya sudah masuk di
              total di bawah, tapi belum ada bukti treatment yang mendukung.
              Perlu dicek sebelum dibayar.
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
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
                    <th>Catatan</th>
                    <th>Total</th>
                    <th>Menit</th>
                    {totals.belumDitinjau > 0 && <th>Perlu ditinjau</th>}
                  </tr>
                </thead>
                <tbody>
                  {perTherapist.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.name}</strong></td>
                      <td>{t.shift ? t.shift.toUpperCase() : '-'}</td>
                      <td>{t.catatan}</td>
                      <td style={{ fontWeight: 700 }}>{durasi(t.total)}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{t.total}</td>
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
                    <td><strong>{totals.catatan}</strong></td>
                    <td style={{ fontWeight: 800, color: 'var(--primary-dark)' }}>{durasi(totals.total)}</td>
                    <td style={{ fontWeight: 700 }}>{totals.total}</td>
                    {totals.belumDitinjau > 0 && (
                      <td style={{ fontWeight: 700, color: 'var(--busy)' }}>{totals.belumDitinjau}</td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p style={hint}>
            <strong>Catatan</strong> = berapa kali lembur dicatat untuk orang itu,
            bukan jumlah hari kerja. Kolom <strong>Perlu ditinjau</strong> menghitung
            catatan berlabel “TANPA booking pendukung”.
          </p>
        </>
      )}
    </div>
  );
}