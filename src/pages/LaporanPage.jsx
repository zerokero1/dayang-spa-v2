import { useEffect, useRef, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import {
  getDailyBookingsRange, summarizeDailyBookings, getCombinedDailyReport, getCommissionStaffReport,
  getDailyRevenueCommissionReport, getOncallReport
} from '../lib/reportService';
import { exportExcelReport, exportDailyRevenueCommission, exportExcelWorkbook } from '../lib/excelExport';
import { businessDate } from '../lib/businessDate';

export default function LaporanPage({ outletId, profile }) {
  const isKasir = profile?.role === 'kasir';
  const [startDate, setStartDate] = useState(businessDate());
  const [endDate, setEndDate] = useState(businessDate());
  const [mode, setMode] = useState('outlet'); // 'outlet' | 'gabungan' | 'komisi'
  const [loading, setLoading] = useState(false);
  const [outletSummary, setOutletSummary] = useState(null);
  const [rawBookings, setRawBookings] = useState([]);
  const [combined, setCombined] = useState(null);
  const [staffCommissions, setStaffCommissions] = useState(null);
  const [oncallReport, setOncallReport] = useState(null);
  const [oncallError, setOncallError] = useState('');

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

  async function loadOncallReport() {
    setLoading(true);
    setOncallError('');
    try {
      if (!startDate || !endDate || startDate > endDate) {
        throw new Error('Rentang tanggal tidak valid.');
      }
      setOncallReport(await getOncallReport(startDate, endDate));
    } catch (e) {
      setOncallReport(null);
      setOncallError('Gagal memuat laporan Oncall: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  function handleLoad() {
    if (mode === 'outlet') loadOutletReport();
    else if (mode === 'gabungan') loadCombinedReport();
    else if (mode === 'komisi') loadCommissionReport();
    else loadOncallReport();
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
    if (outletSummary.oncallRevenue) {
      rows.push([
        '', 'ONCALL NET (setelah komisi hotel)', outletSummary.oncallRevenue,
        '', outletSummary.oncallCommission, outletSummary.totalHotelCommission, '', '', ''
      ]);
    }
    rows.push(['', 'TOTAL REVENUE NET', outletSummary.totalRevenue + outletSummary.oncallRevenue, '', '', '', '', '', '']);
    const totalRowIndex = rows.length - 1;
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
    const headers = ['Outlet', 'Jumlah Treatment', 'Revenue Reguler', 'Total Komisi', 'Komisi Hotel', 'Oncall Net', 'Total Revenue Net'];
    const rows = Object.values(combined.perOutlet).map((o) => [
      o.outletName, o.totalTreatment, o.totalRevenue, o.totalCommission, o.totalHotelCommission,
      o.oncallRevenue, o.totalRevenue + o.oncallRevenue
    ]);
    rows.push([
      'GRAND TOTAL', combined.grandTotalTreatment, combined.grandTotalRevenue,
      combined.grandTotalCommission, combined.grandTotalHotelCommission,
      combined.grandOncallRevenue, combined.grandTotalRevenue + combined.grandOncallRevenue
    ]);
    await exportExcelReport({
      filename: `Laporan-Keuangan-Gabungan-${startDate}_${endDate}`,
      title: 'Laporan Keuangan Gabungan — Dayang Spa',
      subtitle: `Semua Outlet · ${rangeLabel}`,
      headers, rows,
      currencyColumns: [2, 3, 4, 5, 6],
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

  // Data blok harian hanya dipakai untuk file Excel, jadi diambil saat tombol
  // ditekan — bukan tiap refresh 60 detik. Ini yang bikin halaman berat.
  const [harianLoading, setHarianLoading] = useState(false);
  const [harianError, setHarianError] = useState('');
  const harianCache = useRef({ key: '', data: null });

  async function handleDownloadKomisiHarian() {
    const key = `${startDate}|${endDate}`;
    setHarianError('');
    setHarianLoading(true);
    try {
      let data = harianCache.current.key === key ? harianCache.current.data : null;
      if (!data) {
        data = await getDailyRevenueCommissionReport(startDate, endDate);
        harianCache.current = { key, data };
      }
      if (!data || !data.sheets.length) {
        setHarianError('Data harian kosong, tidak ada file yang dibuat.');
        return;
      }
      await exportDailyRevenueCommission({
        filename: `Laporan-Revenue-Komisi-Harian-${startDate}_${endDate}`,
        subtitle: `Semua Outlet · ${rangeLabel}`,
        sheets: data.sheets,
        note: 'Charge = harga yang dibayar pelanggan (sudah diskon). Komisi = 10% dari Charge. '
          + 'Transaksi batal tidak dihitung. Oncall tidak termasuk di sheet outlet. '
          + 'Kolom TOTAL PENDAPATAN berisi komisi per terapis untuk hari tersebut.'
      });
    } catch (e) {
      console.error('gagal membuat laporan harian', e);
      setHarianError('Gagal memuat data harian. Coba lagi beberapa saat.');
    } finally {
      setHarianLoading(false);
    }
  }

  async function handleDownloadOncall() {
    if (!oncallReport) return;
    const outletName = (id) => {
      const outlet = OUTLETS.find((item) => item.id === id);
      return outlet ? `${outlet.name} (${outlet.id})` : id || '-';
    };
    const summaryRows = oncallReport.summaries.map((row) => [
      row.date, outletName(row.outletId), row.transactionCount,
      row.grossCharge, row.hotelCommission, row.therapistCommission, row.netSpaIncome
    ]);
    summaryRows.push([
      'TOTAL', '', oncallReport.totals.transactionCount, oncallReport.totals.grossCharge,
      oncallReport.totals.hotelCommission, oncallReport.totals.therapistCommission,
      oncallReport.totals.netSpaIncome
    ]);

    const detailRows = oncallReport.transactions.map((booking) => [
      booking.wibDate, outletName(booking.outletId), booking.therapistName || '-',
      booking.treatmentName || '-', booking.customerName || '-',
      booking.charge, booking.hotelCommission, booking.therapistCommission,
      booking.netSpaIncome, booking.paymentMethod === 'cardless' ? 'Cardless' : 'Cash',
      booking.paid ? 'Lunas' : 'Belum lunas'
    ]);
    detailRows.push([
      'TOTAL', '', '', '', '', oncallReport.totals.grossCharge,
      oncallReport.totals.hotelCommission, oncallReport.totals.therapistCommission,
      oncallReport.totals.netSpaIncome, '', ''
    ]);

    await exportExcelWorkbook({
      filename: `Laporan-Oncall-${startDate}_${endDate}`,
      sheets: [
        {
          sheetName: 'Rekap Harian Outlet',
          title: 'Rekap Oncall per Tanggal dan Outlet',
          subtitle: `Semua Outlet · ${rangeLabel}`,
          headers: [
            'Tanggal', 'Outlet', 'Transaksi', 'Gross Charge',
            'Komisi Hotel', 'Komisi Terapis', 'Net Income Spa'
          ],
          rows: summaryRows,
          currencyColumns: [3, 4, 5, 6],
          totalRowIndex: summaryRows.length - 1
        },
        {
          sheetName: 'Rincian Transaksi',
          title: 'Rincian Transaksi Oncall',
          subtitle: `Semua Outlet · ${rangeLabel}`,
          headers: [
            'Tanggal', 'Outlet', 'Terapis', 'Treatment', 'Pelanggan',
            'Gross Charge', 'Komisi Hotel', 'Komisi Terapis',
            'Net Income Spa', 'Metode Bayar', 'Status Bayar'
          ],
          rows: detailRows,
          currencyColumns: [5, 6, 7, 8],
          totalRowIndex: detailRows.length - 1
        }
      ]
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
              <button className={mode === 'oncall' ? 'active' : ''} onClick={() => setMode('oncall')}>
                Laporan Oncall
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
            <button className="btn btn-outline btn-sm" onClick={handleDownloadOutlet}>
              ⬇ Download Excel
            </button>
          </div>
          <p>Treatment laku: {outletSummary.totalTreatment}</p>
          {outletSummary.totalBatal > 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Dibatalkan: {outletSummary.totalBatal}</p>
          )}
          <p>Revenue reguler: {rp(outletSummary.totalRevenue)}</p>
          {outletSummary.oncallCount > 0 && (
            <p>Omzet oncall (setelah komisi hotel): {rp(outletSummary.oncallRevenue)} ({outletSummary.oncallCount} transaksi)</p>
          )}
          <p style={{ fontWeight: 700 }}>Total revenue (komisi hotel sudah dikurangi): {rp(outletSummary.totalRevenue + outletSummary.oncallRevenue)}</p>
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
            <button className="btn btn-outline btn-sm" onClick={handleDownloadCombined}>
              ⬇ Download Excel
            </button>
          </div>
          <p>Total treatment: {combined.grandTotalTreatment}</p>
          <p>Revenue reguler: {rp(combined.grandTotalRevenue)}</p>
          {combined.grandOncallCount > 0 && (
            <p>Omzet oncall (setelah komisi hotel): {rp(combined.grandOncallRevenue)} ({combined.grandOncallCount} transaksi)</p>
          )}
          <p style={{ fontWeight: 700 }}>Total revenue (komisi hotel sudah dikurangi): {rp(combined.grandTotalRevenue + combined.grandOncallRevenue)}</p>
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
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline btn-sm" onClick={handleDownloadKomisi}>
                ⬇ Ringkasan per Staff
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleDownloadKomisiHarian}
                disabled={harianLoading}
              >
                {harianLoading ? 'Menyiapkan...' : '⬇ Download Excel'}
              </button>
            </div>
          </div>

          {harianError && <p style={{ color: '#b91c1c', fontSize: 12, margin: '6px 0 0' }}>{harianError}</p>}

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

      {mode === 'oncall' && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Laporan Oncall</h3>
            {oncallReport && (
              <button className="btn btn-outline btn-sm" onClick={handleDownloadOncall}>
                ⬇ Download Excel
              </button>
            )}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Gross Charge adalah harga transaksi. Net Income Spa dihitung dari Gross Charge
            dikurangi Komisi Hotel dan Komisi Terapis. Transaksi batal penuh tidak dihitung;
            status pembayaran ditampilkan pada rincian.
          </p>
          {oncallError && <p style={{ color: '#b91c1c', fontSize: 12 }}>{oncallError}</p>}
          {oncallReport && (
            <>
              <div className="summary-chips" style={{ margin: '12px 0' }}>
                <span className="chip">{oncallReport.totals.transactionCount} transaksi</span>
                <span className="chip">Gross Charge {rp(oncallReport.totals.grossCharge)}</span>
                <span className="chip">Komisi Hotel {rp(oncallReport.totals.hotelCommission)}</span>
                <span className="chip chip-purple">Komisi Terapis {rp(oncallReport.totals.therapistCommission)}</span>
                <span className="chip">Net Income Spa {rp(oncallReport.totals.netSpaIncome)}</span>
              </div>

              <h4>Rekap per tanggal dan outlet</h4>
              {oncallReport.summaries.length === 0 ? (
                <p>Tidak ada transaksi Oncall untuk rentang tanggal ini.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tanggal</th><th>Outlet</th><th>Trx</th><th>Gross Charge</th>
                        <th>Komisi Hotel</th><th>Komisi Terapis</th><th>Net Income Spa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {oncallReport.summaries.map((row) => {
                        const outlet = OUTLETS.find((item) => item.id === row.outletId);
                        return (
                          <tr key={`${row.date}-${row.outletId}`}>
                            <td>{row.date}</td>
                            <td>{outlet ? `${outlet.name} (${outlet.id})` : row.outletId || '-'}</td>
                            <td style={{ textAlign: 'center' }}>{row.transactionCount}</td>
                            <td style={{ textAlign: 'right' }}>{rp(row.grossCharge)}</td>
                            <td style={{ textAlign: 'right' }}>{rp(row.hotelCommission)}</td>
                            <td style={{ textAlign: 'right' }}>{rp(row.therapistCommission)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{rp(row.netSpaIncome)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan="2"><strong>TOTAL</strong></td>
                        <td style={{ textAlign: 'center' }}><strong>{oncallReport.totals.transactionCount}</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{rp(oncallReport.totals.grossCharge)}</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{rp(oncallReport.totals.hotelCommission)}</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{rp(oncallReport.totals.therapistCommission)}</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{rp(oncallReport.totals.netSpaIncome)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <h4>Rincian transaksi ({oncallReport.transactions.length})</h4>
              {oncallReport.transactions.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tanggal</th><th>Outlet</th><th>Terapis</th><th>Treatment</th>
                        <th>Pelanggan</th><th>Gross Charge</th><th>Komisi Hotel</th>
                        <th>Komisi Terapis</th><th>Net Income Spa</th><th>Metode</th><th>Bayar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {oncallReport.transactions.map((booking) => {
                        const outlet = OUTLETS.find((item) => item.id === booking.outletId);
                        return (
                          <tr key={booking.id}>
                            <td>{booking.wibDate}</td>
                            <td>{outlet ? `${outlet.name} (${outlet.id})` : booking.outletId || '-'}</td>
                            <td>{booking.therapistName || '-'}</td>
                            <td>{booking.treatmentName || '-'}</td>
                            <td>{booking.customerName || '-'}</td>
                            <td style={{ textAlign: 'right' }}>{rp(booking.charge)}</td>
                            <td style={{ textAlign: 'right' }}>{rp(booking.hotelCommission)}</td>
                            <td style={{ textAlign: 'right' }}>{rp(booking.therapistCommission)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{rp(booking.netSpaIncome)}</td>
                            <td>{booking.paymentMethod === 'cardless' ? 'Cardless' : 'Cash'}</td>
                            <td>{booking.paid ? 'Lunas' : 'Belum lunas'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
