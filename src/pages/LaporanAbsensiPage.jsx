import { useState } from 'react';
import { getAttendanceRange, summarizeAttendance } from '../lib/attendanceService';
import { getOvertimeByEmployee } from '../lib/overtimeService';
import { OUTLETS } from '../lib/constants';
import { exportExcelReport } from '../lib/excelExport';

function todayId() {
  // Tanggal LOKAL WIB (UTC+7)
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

export default function LaporanAbsensiPage() {
  const [startDate, setStartDate] = useState(todayId());
  const [endDate, setEndDate] = useState(todayId());
  const [outletFilter, setOutletFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  async function handleLoad() {
    setLoading(true);
    try {
      const records = await getAttendanceRange(startDate, endDate, outletFilter || undefined);
      const summary = summarizeAttendance(records);

      // Gabungkan overtime OTOMATIS (dari data booking) per karyawan
      try {
        const autoOt = await getOvertimeByEmployee(startDate, endDate);
        Object.values(summary).forEach((s) => {
          const a = autoOt[s.employeeId];
          if (a) {
            s.autoOvertimeMinutes = a.totalOvertimeMinutes;
            s.autoOvertimeDays = a.daysCount;
          }
        });
        // Karyawan yang hanya lembur otomatis (tanpa catatan absensi manual)
        if (outletFilter === '') {
          Object.entries(autoOt).forEach(([empId, a]) => {
            if (!summary[empId]) {
              summary[empId] = {
                employeeId: empId, employeeName: a.employeeName,
                hadir: 0, sakit: 0, izin: 0, telat: 0, alpha: 0, lembur: 0,
                overtimeMinutes: 0, autoOvertimeMinutes: a.totalOvertimeMinutes, autoOvertimeDays: a.daysCount
              };
            }
          });
        }
      } catch (e) {
        console.warn('auto OT gagal dimuat', e);
      }

      setSummary(summary);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    const headers = ['Nama Karyawan', 'Hadir', 'Sakit', 'Izin', 'Telat', 'Alpha', 'Lembur', 'Menit Lembur Manual', 'Lembur Otomatis (Menit)', 'Total Lembur (Menit)'];
    const rows = Object.values(summary).map((s) => [
      s.employeeName, s.hadir, s.sakit, s.izin, s.telat, s.alpha, s.lembur,
      s.overtimeMinutes, s.autoOvertimeMinutes || 0, (s.overtimeMinutes || 0) + (s.autoOvertimeMinutes || 0)
    ]);
    const outletLabel = outletFilter ? OUTLETS.find((o) => o.id === outletFilter)?.name : 'Semua Outlet';
    await exportExcelReport({
      filename: `Laporan-Absensi-${outletLabel}-${startDate}_${endDate}`,
      title: 'Laporan Absensi — Dayang Spa',
      subtitle: `${outletLabel} · ${startDate} s/d ${endDate}`,
      headers, rows
    });
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Absensi</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Otomatis terbaru — muncul begitu absensi diinput di tab Absensi
      </p>

      <section>
        <p>Rentang tanggal</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ flex: 1 }} />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ flex: 1 }} />
        </div>
      </section>

      <section>
        <p>Outlet</p>
        <select
          value={outletFilter}
          onChange={(e) => setOutletFilter(e.target.value)}
          style={{ width: '100%', padding: 11, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)' }}
        >
          <option value="">Semua outlet</option>
          {OUTLETS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </section>

      <button onClick={handleLoad} disabled={loading}>
        {loading ? 'Memuat...' : 'Tampilkan laporan'}
      </button>

      {summary && (
        <section style={{ marginTop: 16 }}>
          {Object.keys(summary).length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada data absensi di rentang ini.</p>
          )}
          {Object.keys(summary).length > 0 && (
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', marginBottom: 10 }} onClick={handleDownload}>
              ⬇ Download Excel
            </button>
          )}
          {Object.values(summary).map((s, i) => (
            <div key={i} className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
              <strong style={{ fontSize: 14 }}>{s.employeeName}</strong>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Hadir: {s.hadir} · Sakit: {s.sakit} · Izin: {s.izin} · Telat: {s.telat} · Alpha: {s.alpha} · Lembur: {s.lembur}
                {(s.overtimeMinutes || 0) > 0 && ` (${s.overtimeMinutes} menit)`}
              </div>
              {(s.autoOvertimeMinutes || 0) > 0 && (
                <div style={{ fontSize: 12, color: 'var(--busy)', marginTop: 2 }}>
                  Lembur otomatis (dari booking): {s.autoOvertimeMinutes} menit
                  {s.autoOvertimeDays ? ` (${s.autoOvertimeDays} hari)` : ''}
                </div>
              )}
              {(s.overtimeMinutes || 0) + (s.autoOvertimeMinutes || 0) > 0 && (
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                  Total lembur: {(s.overtimeMinutes || 0) + (s.autoOvertimeMinutes || 0)} menit
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
