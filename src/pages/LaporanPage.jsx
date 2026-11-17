import { useEffect, useRef, useState } from 'react';
import {
  getDailyBookingsRange, summarizeDailyBookings, getCombinedDailyReport, getCommissionStaffReport,
  getDailyRevenueCommissionReport
} from '../lib/reportService';
import { exportExcelReport, exportDailyRevenueCommission } from '../lib/excelExport';
import { businessDate, shiftBusinessDate } from '../lib/businessDate';

/** Senin sebagai awal minggu, sama seperti halaman stok/inventory. */
function startOfWeek(dateStr) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return shiftBusinessDate(dateStr, -((day + 6) % 7));
}

function previousMonthRange(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10)
  };
}

function countDays(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return 0;
  return Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1;
}

export default function LaporanPage({ outletId, profile }) {
  const isKasir = profile?.role === 'kasir';
  const today = businessDate();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('outlet'); // 'outlet' | 'gabungan' | 'komisi'
  const [loading, setLoading] = useState(false);
  const [outletSummary, setOutletSummary] = useState(null);
  const [rawBookings, setRawBookings] = useState([]);
  const [combined, setCombined] = useState(null);
  const [staffCommissions, setStaffCommissions] = useState(null);

  const rangeLabel = startDate === endDate ? startDate : `${startDate} s/d ${endDate}`;
  const rangeDays = countDays(startDate, endDate);
  const reqRef = useRef(0);

  async function loadOutletReport() {
    const token = ++reqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const bookings = await getDailyBookingsRange(outletId, startDate, endDate);
      if (token !== reqRef.current) return;
      setRawBookings(bookings.filter((b) => b.status !== 'batal'));
      setOutletSummary(summarizeDailyBookings(bookings));
    } catch (e) {
      if (token !== reqRef.current) return;
      console.error('gagal memuat laporan keuangan', e);
      setLoadError('Gagal memuat laporan. Periksa koneksi lalu coba lagi.');
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }

  async function loadCombinedReport() {
    const token = ++reqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await getCombinedDailyReport(startDate, endDate);
      if (token !== reqRef.current) return;
      setCombined(result);
    } catch (e) {
      if (token !== reqRef.current) return;
      console.error('gagal memuat laporan gabungan', e);
      setLoadError('Gagal memuat laporan. Periksa koneksi lalu coba lagi.');
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }

  async function loadCommissionReport() {
    const token = ++reqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await getCommissionStaffReport(startDate, endDate);
      if (token !== reqRef.current) return;
      setStaffCommissions(result);
    } catch (e) {
      if (token !== reqRef.current) return;
      console.error('gagal memuat komisi staff', e);
      setLoadError('Gagal memuat laporan. Periksa koneksi lalu coba lagi.');
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }

  function handleLoad() {
    if (!startDate || !endDate) {
      setLoadError('Isi tanggal awal dan akhir.');
      return;
    }
    if (endDate < startDate) {
      setLoadError('Tanggal akhir tidak boleh lebih awal dari tanggal awal.');
      return;
    }
    if (mode === 'outlet') loadOutletReport();
    else if (mode === 'gabungan') loadCombinedReport();
    else loadCommissionReport();
  }

  // Simpan versi terbaru supaya refresh berkala memakai rentang yang sedang
  // dipilih, bukan rentang saat halaman pertama dibuka.
  const loadRef = useRef(handleLoad);
  loadRef.current = handleLoad;

  // Muat otomatis saat halaman dibuka dan setiap rentang/tampilan diubah.
  useEffect(() => {
    loadRef.current();
  }, [startDate, endDate, mode, outletId]);

  // Refresh berkala (real-time) tanpa mengubah rentang yang sedang dilihat.
  useEffect(() => {
    const timer = setInterval(() => loadRef.current(), 60000);
    return () => clearInterval(timer);
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

  const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

  const prevMonth = previousMonthRange(today);
  const presets = [
    { label: 'Hari ini', start: today, end: today },
    { label: '7 hari', start: shiftBusinessDate(today, -6), end: today },
    { label: '30 hari', start: shiftBusinessDate(today, -29), end: today },
    { label: 'Minggu ini', start: startOfWeek(today), end: today },
    { label: 'Bulan ini', start: `${today.slice(0, 7)}-01`, end: today },
    { label: 'Bulan lalu', start: prevMonth.start, end: prevMonth.end }
  ];

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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {presets.map((p) => (
            <button
              key={p.label}
              style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}
              className={startDate === p.start && endDate === p.end ? 'active' : ''}
              onClick={() => { setStartDate(p.start); setEndDate(p.end); }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              const value = e.target.value;
              setStartDate(value);
              if (value && endDate && value > endDate) setEndDate(value);
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>s/d</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
          {rangeDays > 0
            ? `Periode aktif: ${rangeLabel} (${rangeDays} hari). Pilih cepat 7 hari / 30 hari / satu bulan, atau atur tanggal sendiri.`
            : 'Tanggal akhir tidak boleh lebih awal dari tanggal awal.'}
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
        {loading ? 'Memuat...' : 'Muat ulang'}
      </button>

      {loadError && <p className="message warn" style={{ marginTop: 10 }}>{loadError}</p>}

      {mode === 'outlet' && outletSummary && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{outletId}</h3>
            <button className="btn btn-outline btn-sm" onClick={handleDownloadOutlet}>
              ⬇ Download Excel
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
            Periode: {rangeLabel} · {rangeDays} hari · {rawBookings.length} transaksi
          </p>
          <p>Treatment laku: {outletSummary.totalTreatment}</p>
          {outletSummary.totalBatal > 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Dibatalkan: {outletSummary.totalBatal}</p>
          )}
          <p>Revenue reguler: {rp(outletSummary.totalRevenue)}</p>
          {outletSummary.oncallCount > 0 && (
            <p>Omzet oncall (setelah komisi hotel): {rp(outletSummary.oncallRevenue)} ({outletSummary.oncallCount} transaksi)</p>
          )}
          <p style={{ fontWeight: 700 }}>Total revenue (komisi hotel sudah dikurangi): {rp(outletSummary.totalRevenueNet || (outletSummary.totalRevenue + outletSummary.oncallRevenue))}</p>
          <p>Total komisi: {rp(outletSummary.totalCommission)}</p>
          {outletSummary.totalHotelCommission > 0 && (
            <p>Total komisi hotel (oncall): {rp(outletSummary.totalHotelCommission)}</p>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0' }}>
            <div>Cash (Kas Lunas): {rp(outletSummary.cashRevenue)}</div>
            <div>Cardless (Non-tunai Lunas): {rp(outletSummary.cardlessRevenue)}</div>
            <div style={{ fontWeight: 600, color: 'var(--primary-dark)', marginTop: 2 }}>
              Total Lunas Masuk Kas: {rp(outletSummary.paidRevenue || (outletSummary.cashRevenue + outletSummary.cardlessRevenue))}
            </div>
            {outletSummary.unpaidCount > 0 && (
              <div style={{ color: 'var(--busy)', fontWeight: 600, marginTop: 2 }}>
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
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
            Periode: {rangeLabel} · {rangeDays} hari
          </p>
          <p>Total treatment: {combined.grandTotalTreatment}</p>
          <p>Revenue reguler: {rp(combined.grandTotalRevenue)}</p>
          {combined.grandOncallCount > 0 && (
            <p>Omzet oncall (setelah komisi hotel): {rp(combined.grandOncallRevenue)} ({combined.grandOncallCount} transaksi)</p>
          )}
          <p style={{ fontWeight: 700 }}>Total revenue (komisi hotel sudah dikurangi): {rp(combined.grandTotalRevenueNet || (combined.grandTotalRevenue + combined.grandOncallRevenue))}</p>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0' }}>
            <div>Cash (Kas): {rp(combined.grandCashRevenue || 0)}</div>
            <div>Cardless (Non-tunai): {rp(combined.grandCardlessRevenue || 0)}</div>
            <div style={{ fontWeight: 600, color: 'var(--primary-dark)', marginTop: 2 }}>
              Omzet lunas saja (= Laporan Keseluruhan):{' '}
              {rp(combined.grandPaidRevenue || (combined.grandTotalRevenueNet - combined.grandUnpaidRevenue))}
            </div>
            {combined.grandUnpaidCount > 0 && (
              <div style={{ color: 'var(--busy)', fontWeight: 600, marginTop: 2 }}>
                Belum dibayar: {rp(combined.grandUnpaidRevenue)} ({combined.grandUnpaidCount} transaksi)
              </div>
            )}
          </div>
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

          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Periode: {rangeLabel} · {rangeDays} hari
          </p>

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
    </div>
  );
}
