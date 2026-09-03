import { useState } from 'react';
import { getOvertimeReport } from '../lib/overtimeService';
import { exportExcelReport } from '../lib/excelExport';

function todayId() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

const SHIFT_LABEL = { sp: 'Shift SP (Split)', malam: 'Shift Malam', st: 'Shift ST (Short)' };

function fmtEnd(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export default function OvertimePage({ isOffice }) {
  const [startDate, setStartDate] = useState(todayId());
  const [endDate, setEndDate] = useState(todayId());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(null);

  async function handleLoad() {
    setLoading(true);
    try {
      const data = await getOvertimeReport(startDate, endDate);
      setRows(data);
    } catch (e) {
      alert('Gagal memuat: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    const headers = ['Tanggal', 'Terapis', 'Outlet', 'Shift', 'Jml Treatment', 'Selesai Terakhir', 'Lembur (menit)'];
    const total = (rows).reduce((s, r) => s + r.overtimeMinutes, 0);
    const rowsExcel = rows.map((r) => [
      r.date, r.therapistName, r.outletName,
      r.shift ? (SHIFT_LABEL[r.shift] || r.shift) : '-',
      r.treatmentCount, fmtEnd(r.maxEndAt), r.overtimeMinutes
    ]);
    rowsExcel.push(['TOTAL', '', '', '', '', '', total]);
    await exportExcelReport({
      filename: `Laporan-Overtime-${startDate}_${endDate}`,
      title: 'Laporan Overtime (dari data booking) — Dayang Spa',
      subtitle: `${startDate} s/d ${endDate}`,
      headers, rows: rowsExcel, totalRowIndex: rowsExcel.length - 1
    });
  }

  if (!isOffice) {
    return (
      <div className="kasir-page">
        <h2>Overtime</h2>
        <p>Halaman ini hanya tersedia untuk akun Office.</p>
      </div>
    );
  }

  const totalOvertime = rows ? rows.reduce((s, r) => s + r.overtimeMinutes, 0) : 0;

  return (
    <div className="kasir-page">
      <h2>Laporan Overtime</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Dihitung otomatis dari data booking: waktu treatment melebihi jam selesai shift terapis.
      </p>

      <section>
        <p>Rentang tanggal</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ flex: 1 }} />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ flex: 1 }} />
        </div>
      </section>

      <button onClick={handleLoad} disabled={loading}>
        {loading ? 'Memuat...' : 'Hitung overtime'}
      </button>

      {rows && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Total lembur: {totalOvertime} menit</strong>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownload}>
              ⬇ Download Excel
            </button>
          </div>

          {rows.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada data booking pada rentang ini.</p>
          )}

          {rows.map((r, i) => (
            <div key={i} className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{r.therapistName}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>({r.outletName})</span>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {r.date} · {r.treatmentCount} treatment · {r.shift ? (SHIFT_LABEL[r.shift] || r.shift) : 'tanpa shift'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Treatment terakhir selesai {fmtEnd(r.maxEndAt)}
                  </div>
                </div>
                <span style={{
                  fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                  color: r.overtimeMinutes > 0 ? 'var(--busy)' : 'var(--text-secondary)'
                }}>
                  {r.overtimeMinutes > 0 ? `${r.overtimeMinutes} menit lembur` : 'Tidak lembur'}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
