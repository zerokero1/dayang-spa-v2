import { useEffect, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import {
  getDailyBookingsRange, summarizeDailyBookings, getCombinedDailyReport, getCommissionStaffReport
} from '../lib/reportService';
import { exportExcelReport } from '../lib/excelExport';

function todayId() {
  // Tanggal LOKAL WIB (UTC+7) — konsisten dengan reportService
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

export default function LaporanPage({ outletId, profile }) {
  const isKasir = profile?.role === 'kasir';
  const [startDate, setStartDate] = useState(todayId());
  const [endDate, setEndDate] = useState(todayId());
  const [mode, setMode] = useState('outlet'); // 'outlet' | 'gabungan' | 'komisi'
  const [loading, setLoading] = useState(false);
  const [outletSummary, setOutletSummary] = useState(null);
  const [rawBookings, setRawBookings] = useState([]);
  const [combined, setCombined] = useState(null);
  const [staffCommissions, setStaffCommissions] = useState(null);

  const rangeLabel = startDate === endDate ? startDate : `${startDate} s/d ${endDate}`;

  async function loadOutletReport() {
    setLoading(true);
    try {
      const bookings = await getDailyBookingsRange(outletId, startDate, endDate);
      setRawBookings(bookings.filter((b) => b.status !== 'batal'));
      setOutletSummary(summarizeDailyBookings(bookings));
    } finally {
      setLoading(false);
    }
  }

  async function loadCombinedReport() {
    setLoading(true);
    try {
      const result = await getCombinedDailyReport(startDate, endDate);
      setCombined(result);
    } finally {
      setLoading(false);
    }
  }

  async function loadCommissionReport() {
    setLoading(true);
    try {
      const result = await getCommissionStaffReport(startDate, endDate);
      setStaffCommissions(result);
    } finally {
      setLoading(false);
    }
  }

  function handleLoad() {
    if (mode === 'outlet') loadOutletReport();
    else if (mode === 'gabungan') loadCombinedReport();
    else loadCommissionReport();
  }

  // Muat otomatis saat halaman dibuka + refresh berkala supaya selalu real-time.
  useEffect(() => {
    if (loading) return;
    handleLoad();
    const timer = setInterval(() => handleLoad(), 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDownloadOutlet() {
    const headers = ['Terapis', 'Treatment', 'Harga', 'Komisi %', 'Komisi Rp', 'Komisi Hotel', 'Metode Bayar', 'Status Bayar', 'Pelanggan'];
    const rows = rawBookings.map((b) => [
      b.therapistName, b.treatmentName, b.treatmentPrice,
      b.commissionPercent, b.commissionAmount, b.hotelCommission,
      b.paymentMethod === 'cardless' ? 'Cardless' : 'Cash',
      b.paid ? 'Lunas' : 'Belum Bayar',
      b.customerName || '-'
    ]);
    rows.push(['', 'TOTAL', outletSummary.totalRevenue, '', outletSummary.totalCommission, outletSummary.totalHotelCommission, '', '', '']);
    const totalRowIndex = rows.length - 1;
    if (outletSummary.oncallRevenue) {
      rows.push(['', 'OMZET ONCALL (tersendiri)', outletSummary.oncallRevenue, '', outletSummary.oncallCommission, '', '', '', '']);
    }
    await exportExcelReport({
      filename: `Laporan-Keuangan-${outletId}-${startDate}_${endDate}`,
      title: 'Laporan Keuangan — Dayang Spa',
      subtitle: `Outlet ${outletId} · ${rangeLabel}`,
      headers, rows,
      currencyColumns: [2, 4, 5],
      totalRowIndex
    });
  }

  async function handleDownloadCombined() {
    const headers = ['Outlet', 'Jumlah Treatment', 'Total Omzet', 'Total Komisi', 'Komisi Hotel', 'Omzet Oncall'];
    const rows = Object.values(combined.perOutlet).map((o) => [
      o.outletName, o.totalTreatment, o.totalRevenue, o.totalCommission, o.totalHotelCommission, o.oncallRevenue
    ]);
    rows.push(['GRAND TOTAL', combined.grandTotalTreatment, combined.grandTotalRevenue, combined.grandTotalCommission, combined.grandTotalHotelCommission, combined.grandOncallRevenue]);
    await exportExcelReport({
      filename: `Laporan-Keuangan-Gabungan-${startDate}_${endDate}`,
      title: 'Laporan Keuangan Gabungan — Dayang Spa',
      subtitle: `Semua Outlet · ${rangeLabel}`,
      headers, rows,
      currencyColumns: [2, 3, 4, 5],
      totalRowIndex: rows.length - 1
    });
  }

  async function handleDownloadKomisi() {
    const headers = [
      'Staff', 'Jumlah Treatment', 'Total Omzet', 'Total Komisi', 'Komisi Hotel', 'Outlet'
    ];
    const rows = staffCommissions.map((s) => [
      s.therapistName, s.treatmentCount, s.revenueTotal, s.commissionTotal,
      s.hotelCommissionTotal, s.outlets.join(', ')
    ]);
    const totalKomisi = staffCommissions.reduce((sum, s) => sum + s.commissionTotal, 0);
    const totalOmzet = staffCommissions.reduce((sum, s) => sum + s.revenueTotal, 0);
    const totalHotel = staffCommissions.reduce((sum, s) => sum + s.hotelCommissionTotal, 0);
    const totalTrx = staffCommissions.reduce((sum, s) => sum + s.treatmentCount, 0);
    rows.push(['TOTAL', totalTrx, totalOmzet, totalKomisi, totalHotel, '']);
    await exportExcelReport({
      filename: `Laporan-Komisi-Staff-${startDate}_${endDate}`,
      title: 'Laporan Komisi Staff — Dayang Spa',
      subtitle: `Semua Outlet · ${rangeLabel}`,
      headers, rows,
      currencyColumns: [2, 3, 4],
      totalRowIndex: rows.length - 1
    });
  }

  const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

  return (
    <div className="kasir-page">
      <h2>Laporan Keuangan</h2>
      <p className="muted">
        Omzet di laporan ini menghitung <strong>semua</strong> transaksi yang tidak
        dibatalkan, termasuk yang belum dibayar. Laporan Keseluruhan hanya menghitung
        yang sudah lunas — jadi angkanya lebih kecil di sana. Selisihnya sama dengan
        bagian "Belum dibayar" di Laporan Keuangan ini.
      </p>

      <section>
        <p>Rentang tanggal</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Atur selama 1 minggu / 1 bulan untuk rekap mingguan / bulanan.
        </p>
      </section>

      <section>
        <p>Tampilan</p>
        <div className="grid-2">
          <button className={mode === 'outlet' ? 'active' : ''} onClick={() => setMode('outlet')}>
            Outlet ini saja
          </button>
          {!isKasir && (
            <>
              <button className={mode === 'gabungan' ? 'active' : ''} onClick={() => setMode('gabungan')}>
                Gabungan 6 outlet
              </button>
              <button className={mode === 'komisi' ? 'active' : ''} onClick={() => setMode('komisi')}>
                Komisi Staff
              </button>
            </>
          )}
        </div>
        {isKasir && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Kasir hanya dapat melihat laporan outlet sendiri.
          </p>
        )}
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
          <p>Omzet outlet (tanpa oncall): {rp(outletSummary.totalRevenue)}</p>
          {outletSummary.oncallCount > 0 && (
            <p>Omzet oncall (tersendiri): {rp(outletSummary.oncallRevenue)} ({outletSummary.oncallCount} transaksi)</p>
          )}
          <p>Total komisi: {rp(outletSummary.totalCommission)}</p>
          {outletSummary.totalHotelCommission > 0 && (
            <p>Total komisi hotel (oncall): {rp(outletSummary.totalHotelCommission)}</p>
          )}
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
          <p>Omzet outlet (tanpa oncall): {rp(combined.grandTotalRevenue)}</p>
          {combined.grandOncallCount > 0 && (
            <p>Omzet oncall (tersendiri): {rp(combined.grandOncallRevenue)} ({combined.grandOncallCount} transaksi)</p>
          )}
          <p>Belum dibayar: {rp(combined.grandUnpaidRevenue)} ({combined.grandUnpaidCount} transaksi)</p>
          <p style={{ fontWeight: 600, color: 'var(--primary-dark)' }}>
            Omzet lunas saja (= Laporan Keseluruhan):{' '}
            {rp(combined.grandTotalRevenue - combined.grandUnpaidRevenue)}
          </p>
          <p>Total komisi: {rp(combined.grandTotalCommission)}</p>
          {combined.grandTotalHotelCommission > 0 && (
            <p>Total komisi hotel (oncall): {rp(combined.grandTotalHotelCommission)}</p>
          )}
          <h4>Per outlet</h4>
          {Object.values(combined.perOutlet).map((o, i) => (
            <p key={i}>
              {o.outletName}: {o.totalTreatment} treatment - omzet {rp(o.totalRevenue)} - komisi {rp(o.totalCommission)}
            </p>
          ))}
        </section>
      )}

      {mode === 'komisi' && staffCommissions && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Komisi Staff</h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadKomisi}>
              ⬇ Download Excel
            </button>
          </div>

          {staffCommissions.length === 0 ? (
            <p>Tidak ada data komisi untuk rentang tanggal ini.</p>
          ) : (
            <>
              <div className="summary-chips" style={{ margin: '12px 0' }}>
                <span className="chip">{staffCommissions.length} orang</span>
                <span className="chip">
                  Total treatment {staffCommissions.reduce((s, x) => s + x.treatmentCount, 0)}
                </span>
                <span className="chip">Omzet {rp(staffCommissions.reduce((s, x) => s + x.revenueTotal, 0))}</span>
                <span className="chip chip-purple">Komisi {rp(staffCommissions.reduce((s, x) => s + x.commissionTotal, 0))}</span>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Trx</th>
                      <th>Omzet</th>
                      <th>Komisi</th>
                      <th>Komisi Hotel</th>
                      <th>Outlet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffCommissions.map((s) => (
                      <tr key={s.therapistName}>
                        <td><strong>{s.therapistName}</strong></td>
                        <td style={{ textAlign: 'center' }}>{s.treatmentCount}</td>
                        <td style={{ textAlign: 'right' }}>{rp(s.revenueTotal)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{rp(s.commissionTotal)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {s.hotelCommissionTotal > 0 ? rp(s.hotelCommissionTotal) : '-'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.outlets.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>TOTAL</strong></td>
                      <td style={{ textAlign: 'center' }}><strong>{staffCommissions.reduce((s, x) => s + x.treatmentCount, 0)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{rp(staffCommissions.reduce((s, x) => s + x.revenueTotal, 0))}</strong></td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}><strong>{rp(staffCommissions.reduce((s, x) => s + x.commissionTotal, 0))}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{rp(staffCommissions.reduce((s, x) => s + x.hotelCommissionTotal, 0))}</strong></td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
