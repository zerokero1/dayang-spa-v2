import { useCallback, useEffect, useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import {
  buildBookSheets, getReportBook, outletName, todayWib
} from '../lib/reportBookService';
import { exportExcelWorkbook } from '../lib/excelExport';

function daysAgo(n) {
  return new Date(Date.now() + 7 * 3600000 - n * 24 * 3600000).toISOString().slice(0, 10);
}

const PRESETS = [
  { label: 'Hari ini', from: () => todayWib(), to: () => todayWib() },
  { label: '7 hari', from: () => daysAgo(6), to: () => todayWib() },
  { label: '30 hari', from: () => daysAgo(29), to: () => todayWib() },
  { label: 'Bulan ini', from: () => todayWib().slice(0, 8) + '01', to: () => todayWib() }
];

function rupiah(n) {
  return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
}

function clock(minutes) {
  if (minutes == null) return '-';
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Laporan Keseluruhan — satu halaman yang merangkum 4 laporan dalam format
 * yang sama: Inventory, Absensi, Komisi 10%, dan Revenue. Tombol unduh
 * menghasilkan SATU file Excel berisi semua sheet di bawah ini.
 */
export default function LaporanKeseluruhanPage({ active }) {
  const [startDate, setStartDate] = useState(() => daysAgo(29));
  const [endDate, setEndDate] = useState(() => todayWib());
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getReportBook({ startDate, endDate, outletId });
      setData(result);
    } catch (e) {
      setError('Gagal memuat laporan: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, outletId]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const outletLabel = outletId ? outletName(outletId) : 'Semua outlet';

  async function handleExport() {
    if (!data) return;
    setExporting(true);
    try {
      const sheets = buildBookSheets({
        range: `${startDate} s/d ${endDate}`,
        outletLabel,
        inventory: data.inventory,
        attendance: data.attendance,
        revenueCommission: data.revenueCommission
      });
      await exportExcelWorkbook({
        filename: `Buku-Laporan-${outletId || 'Semua-Outlet'}-${startDate}_${endDate}`,
        sheets
      });
    } catch (e) {
      setError('Gagal membuat file: ' + e.message);
    } finally {
      setExporting(false);
    }
  }

  const rc = data?.revenueCommission;
  const totals = useMemo(() => ({
    revenue: rc?.grandTotal?.omzet || 0,
    trx: rc?.grandTotal?.trx || 0,
    komisi: rc?.commissionTotal || 0,
    sisaStok: (data?.inventory?.stockRows || []).length,
    movements: (data?.inventory?.movementRows || []).length,
    absensiRows: (data?.attendance?.detail || []).length,
    telatRows: (data?.attendance?.lateOnly || []).length
  }), [rc, data]);

  return (
    <div className="kasir-page">
      <h2>Laporan Keseluruhan</h2>
      <p className="muted">
        Satu berkas untuk 4 laporan: Inventory, Absensi, Komisi 10%, dan Revenue.
        Seluruh angka dihitung dari data yang benar-benar tercatat.
      </p>

      <section className="filters">
        <label>
          Dari
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          Sampai
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label>
          Outlet
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">Semua outlet</option>
            {OUTLETS.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <div className="preset-buttons">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => { setStartDate(p.from()); setEndDate(p.to()); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="actions">
        <button type="button" onClick={load} disabled={loading}>
          {loading ? 'Memuat...' : 'Muat laporan'}
        </button>
        <button
          type="button"
          className="primary"
          onClick={handleExport}
          disabled={!data || exporting || loading}
        >
          {exporting ? 'Menyiapkan file...' : 'Unduh Buku Laporan (1 file, 4 laporan)'}
        </button>
      </section>

      {error && <p className="message error">{error}</p>}

      {data && (
        <>
          <section className="summary-cards">
            <div className="card">
              <span className="card-label">Revenue</span>
              <strong>{rupiah(totals.revenue)}</strong>
              <span className="muted">{totals.trx} transaksi</span>
            </div>
            <div className="card">
              <span className="card-label">Komisi 10%</span>
              <strong>{rupiah(totals.komisi)}</strong>
              <span className="muted">
                {rc?.ratesUsed?.length ? `Tarif ${rc.ratesUsed.join('%, ')}%` : 'Belum ada transaksi'}
              </span>
            </div>
            <div className="card">
              <span className="card-label">Posisi stock</span>
              <strong>{totals.sisaStok} item</strong>
              <span className="muted">{totals.movements} pergerakan tercatat</span>
            </div>
            <div className="card">
              <span className="card-label">Absensi</span>
              <strong>{totals.absensiRows} baris</strong>
              <span className="muted">{totals.telatRows} catatan telat</span>
            </div>
          </section>

          {/* ------------------------------ INVENTORY ------------------------------ */}
          <section className="report-block">
            <h3>1. Inventory Per Outlet</h3>
            <p className="muted">Sisa stock posisi sekarang, barang masuk/keluar, dan pemakaian harian.</p>

            {data.inventory.caveats.map((c, i) => (
              <p key={i} className="message warn">{c}</p>
            ))}

            <details open>
              <summary>Sisa Stock ({data.inventory.stockRows.length} baris)</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Outlet</th><th>Kategori</th><th>Nama</th><th>Ukuran</th><th>Satuan</th><th>Sisa</th></tr>
                  </thead>
                  <tbody>
                    {data.inventory.stockRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.outlet}</td><td>{r.kategori}</td><td>{r.nama}</td>
                        <td>{r.ukuran}</td><td>{r.satuan}</td><td>{r.stok}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <details>
              <summary>Barang Masuk / Keluar ({data.inventory.movementRows.length} baris)</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th><th>Outlet</th><th>Kategori</th><th>Nama</th>
                      <th>Masuk</th><th>Keluar</th><th>Sisa</th><th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inventory.movementRows.length === 0 && (
                      <tr><td colSpan={8}>Belum ada pergerakan stok tercatat di periode ini.</td></tr>
                    )}
                    {data.inventory.movementRows.slice(0, 300).map((r, i) => (
                      <tr key={i}>
                        <td>{r.tanggal}</td><td>{r.outlet}</td><td>{r.kategori}</td>
                        <td>{r.nama} {r.ukuran !== '-' ? `(${r.ukuran})` : ''}</td>
                        <td>{r.masuk || '-'}</td><td>{r.keluar || '-'}</td>
                        <td>{r.sisa ?? '-'}</td><td>{r.catatan}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.inventory.movementRows.length > 300 && (
                  <p className="muted">
                    Menampilkan 300 baris pertama dari {data.inventory.movementRows.length}.
                    File Excel berisi semuanya.
                  </p>
                )}
              </div>
            </details>

            <details>
              <summary>Pemakaian Harian ({data.inventory.usageRows.length} baris)</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Tanggal</th><th>Outlet</th><th>Kategori</th><th>Nama</th><th>Satuan</th><th>Dipakai</th></tr>
                  </thead>
                  <tbody>
                    {data.inventory.usageRows.slice(0, 300).map((r, i) => (
                      <tr key={i}>
                        <td>{r.tanggal}</td><td>{r.outlet}</td><td>{r.kategori}</td>
                        <td>{r.nama} {r.ukuran !== '-' ? `(${r.ukuran})` : ''}</td>
                        <td>{r.satuan}</td><td>{r.dipakai}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {/* ------------------------------ ABSENSI ------------------------------ */}
          <section className="report-block">
            <h3>2. Absensi</h3>
            <p className="muted">Data telat, jam masuk, dan jam pulang.</p>

            {data.attendance.caveats.map((c, i) => (
              <p key={i} className="message warn">{c}</p>
            ))}

            <details open>
              <summary>Data Telat ({data.attendance.lateOnly.length} baris)</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Tanggal</th><th>Nama</th><th>Outlet</th><th>Shift</th><th>Jam Masuk</th><th>Telat (menit)</th><th>Catatan</th></tr>
                  </thead>
                  <tbody>
                    {data.attendance.lateOnly.length === 0 && (
                      <tr><td colSpan={7}>Tidak ada keterlambatan tercatat.</td></tr>
                    )}
                    {data.attendance.lateOnly.slice(0, 300).map((d, i) => (
                      <tr key={i}>
                        <td>{d.tanggal}</td><td>{d.nama}</td><td>{d.outlet}</td><td>{d.shift}</td>
                        <td>{clock(d.jamMasuk)}</td><td>{d.telat ?? '-'}</td><td>{d.catatan}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <details>
              <summary>Seluruh Absensi ({data.attendance.detail.length} baris)</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th><th>Nama</th><th>Outlet</th><th>Shift</th><th>Status</th>
                      <th>Masuk</th><th>Pulang</th><th>Telat</th><th>Lembur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.attendance.detail.slice(0, 300).map((d, i) => (
                      <tr key={i}>
                        <td>{d.tanggal}</td><td>{d.nama}</td><td>{d.outlet}</td><td>{d.shift}</td>
                        <td>{d.status}</td><td>{clock(d.jamMasuk)}</td><td>{clock(d.jamPulang)}</td>
                        <td>{d.telat ?? '-'}</td><td>{d.lembur ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {/* ------------------------------ KOMISI ------------------------------ */}
          <section className="report-block">
            <h3>3. Komisi 10%</h3>
            <p className="muted">Per terapis, per hari, dan per outlet.</p>
            {rc.caveats.map((c, i) => (
              <p key={i} className="message warn">{c}</p>
            ))}

            <details open>
              <summary>Per Terapis — total {rupiah(rc.commissionTotal)}</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Nama</th><th>Transaksi</th><th>Omzet</th><th>Komisi</th><th>Persentase</th></tr>
                  </thead>
                  <tbody>
                    {rc.commissionByTherapist.map((t, i) => (
                      <tr key={i}>
                        <td>{t.nama}</td><td>{t.trx}</td><td>{rupiah(t.omzet)}</td>
                        <td>{rupiah(t.komisi)}</td>
                        <td>{t.omzet ? `${((t.komisi / t.omzet) * 100).toFixed(2)}%` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>TOTAL</strong></td>
                      <td>{rc.commissionByTherapist.reduce((s, t) => s + t.trx, 0)}</td>
                      <td><strong>{rupiah(rc.omzetTotal)}</strong></td>
                      <td><strong>{rupiah(rc.commissionTotal)}</strong></td>
                      <td>{rc.omzetTotal ? `${((rc.commissionTotal / rc.omzetTotal) * 100).toFixed(2)}%` : '-'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>

            <details>
              <summary>Per Outlet</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Outlet</th><th>Transaksi</th><th>Omzet</th><th>Komisi</th><th>Persentase</th></tr>
                  </thead>
                  <tbody>
                    {rc.commissionOutlets.map((o, i) => (
                      <tr key={i}>
                        <td>{o.outlet}</td><td>{o.trx}</td><td>{rupiah(o.omzet)}</td>
                        <td>{rupiah(o.komisi)}</td>
                        <td>{o.omzet ? `${((o.komisi / o.omzet) * 100).toFixed(2)}%` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {/* ------------------------------ REVENUE ------------------------------ */}
          <section className="report-block">
            <h3>4. Revenue</h3>
            <p className="muted">Income per hari dan grand total per outlet.</p>

            <details open>
              <summary>Grand Total per Outlet — {rupiah(rc.grandTotal.omzet)}</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Outlet</th><th>Transaksi</th><th>Omzet</th><th>Cash</th><th>Non-Cash</th><th>Rata-rata</th></tr>
                  </thead>
                  <tbody>
                    {rc.grandByOutlet.map((g, i) => (
                      <tr key={i}>
                        <td>{g.outlet}</td><td>{g.trx}</td><td>{rupiah(g.omzet)}</td>
                        <td>{rupiah(g.cash)}</td><td>{rupiah(g.nonCash)}</td>
                        <td>{rupiah(g.trx ? Math.round(g.omzet / g.trx) : 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>GRAND TOTAL</strong></td>
                      <td>{rc.grandTotal.trx}</td>
                      <td><strong>{rupiah(rc.grandTotal.omzet)}</strong></td>
                      <td><strong>{rupiah(rc.grandTotal.cash)}</strong></td>
                      <td><strong>{rupiah(rc.grandTotal.nonCash)}</strong></td>
                      <td>{rupiah(rc.grandTotal.trx ? Math.round(rc.grandTotal.omzet / rc.grandTotal.trx) : 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>

            <details>
              <summary>Income Per Hari ({rc.dailyRows.length} baris)</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Tanggal</th><th>Outlet</th><th>Transaksi</th><th>Omzet</th><th>Cash</th><th>Non-Cash</th><th>Diskon</th></tr>
                  </thead>
                  <tbody>
                    {rc.dailyRows.slice(0, 400).map((r, i) => (
                      <tr key={i} className={r.outlet === 'TOTAL' ? 'row-total' : ''}>
                        <td>{r.tanggal}</td><td>{r.outlet}</td><td>{r.trx}</td>
                        <td>{rupiah(r.omzet)}</td><td>{rupiah(r.cash)}</td>
                        <td>{rupiah(r.nonCash)}</td><td>{rupiah(r.diskon)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
