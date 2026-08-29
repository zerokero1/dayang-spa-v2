import { useState } from 'react';
import { OUTLETS } from '../lib/constants';
import {
  getDailyBookings, summarizeDailyBookings, getCombinedDailyReport
} from '../lib/reportService';
import { exportExcelReport } from '../lib/excelExport';

function todayId() {
  return new Date().toISOString().slice(0, 10);
}

export default function LaporanPage({ outletId }) {
  const [date, setDate] = useState(todayId());
  const [mode, setMode] = useState('outlet'); // 'outlet' | 'gabungan'
  const [loading, setLoading] = useState(false);
  const [outletSummary, setOutletSummary] = useState(null);
  const [rawBookings, setRawBookings] = useState([]);
  const [combined, setCombined] = useState(null);

  async function loadOutletReport() {
    setLoading(true);
    try {
      const bookings = await getDailyBookings(outletId, date);
      setRawBookings(bookings.filter((b) => b.status !== 'batal'));
      setOutletSummary(summarizeDailyBookings(bookings));
    } finally {
      setLoading(false);
    }
  }

  async function loadCombinedReport() {
    setLoading(true);
    try {
      const result = await getCombinedDailyReport(date);
      setCombined(result);
    } finally {
      setLoading(false);
    }
  }

  function handleLoad() {
    if (mode === 'outlet') loadOutletReport();
    else loadCombinedReport();
  }

  async function handleDownloadOutlet() {
    const headers = ['Terapis', 'Treatment', 'Harga', 'Komisi %', 'Komisi Rp', 'Metode Bayar', 'Status Bayar', 'Pelanggan'];
    const rows = rawBookings.map((b) => [
      b.therapistName, b.treatmentName, b.treatmentPrice,
      b.commissionPercent, b.commissionAmount,
      b.paymentMethod === 'cardless' ? 'Cardless' : 'Cash',
      b.paid ? 'Lunas' : 'Belum Bayar',
      b.customerName || '-'
    ]);
    rows.push(['', 'TOTAL', outletSummary.totalRevenue, '', outletSummary.totalCommission, '', '', '']);
    await exportExcelReport({
      filename: `Laporan-Keuangan-${outletId}-${date}`,
      title: 'Laporan Keuangan — Dayang Spa',
      subtitle: `Outlet ${outletId} · ${date}`,
      headers, rows,
      currencyColumns: [2, 4],
      totalRowIndex: rows.length - 1
    });
  }

  async function handleDownloadCombined() {
    const headers = ['Outlet', 'Jumlah Treatment', 'Total Omzet', 'Total Komisi'];
    const rows = Object.values(combined.perOutlet).map((o) => [
      o.outletName, o.totalTreatment, o.totalRevenue, o.totalCommission
    ]);
    rows.push(['GRAND TOTAL', combined.grandTotalTreatment, combined.grandTotalRevenue, combined.grandTotalCommission]);
    await exportExcelReport({
      filename: `Laporan-Keuangan-Gabungan-${date}`,
      title: 'Laporan Keuangan Gabungan — Dayang Spa',
      subtitle: `Semua Outlet · ${date}`,
      headers, rows,
      currencyColumns: [2, 3],
      totalRowIndex: rows.length - 1
    });
  }

  const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

  return (
    <div className="kasir-page">
      <h2>Laporan Keuangan</h2>

      <section>
        <p>Tanggal</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </section>

      <section>
        <p>Tampilan</p>
        <div className="grid-2">
          <button className={mode === 'outlet' ? 'active' : ''} onClick={() => setMode('outlet')}>
            Outlet ini saja
          </button>
          <button className={mode === 'gabungan' ? 'active' : ''} onClick={() => setMode('gabungan')}>
            Gabungan 6 outlet
          </button>
        </div>
      </section>

      <button onClick={handleLoad} disabled={loading}>
        {loading ? 'Memuat...' : 'Tampilkan laporan'}
      </button>

      {mode === 'outlet' && outletSummary && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{outletId}</h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadOutlet}>
              ⬇ Download Excel
            </button>
          </div>
          <p>Treatment laku: {outletSummary.totalTreatment}</p>
          {outletSummary.totalBatal > 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Dibatalkan: {outletSummary.totalBatal}</p>
          )}
          <p>Total omzet: {rp(outletSummary.totalRevenue)}</p>
          <p>Total komisi: {rp(outletSummary.totalCommission)}</p>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0' }}>
            <div>Cash: {rp(outletSummary.cashRevenue)}</div>
            <div>Cardless: {rp(outletSummary.cardlessRevenue)}</div>
            {outletSummary.unpaidCount > 0 && (
              <div style={{ color: 'var(--busy)', fontWeight: 600 }}>
                Belum dibayar: {rp(outletSummary.unpaidRevenue)} ({outletSummary.unpaidCount} treatment)
              </div>
            )}
          </div>
          <h4>Per terapis</h4>
          {Object.values(outletSummary.byTherapist).map((t, i) => (
            <p key={i}>{t.therapistName}: {t.treatmentCount} treatment - komisi {rp(t.commissionTotal)}</p>
          ))}
        </section>
      )}

      {mode === 'gabungan' && combined && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Rekap semua outlet</h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadCombined}>
              ⬇ Download Excel
            </button>
          </div>
          <p>Total treatment: {combined.grandTotalTreatment}</p>
          <p>Total omzet: {rp(combined.grandTotalRevenue)}</p>
          <p>Total komisi: {rp(combined.grandTotalCommission)}</p>
          <h4>Per outlet</h4>
          {Object.values(combined.perOutlet).map((o, i) => (
            <p key={i}>
              {o.outletName}: {o.totalTreatment} treatment - omzet {rp(o.totalRevenue)} - komisi {rp(o.totalCommission)}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
