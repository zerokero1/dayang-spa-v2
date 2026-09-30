import { useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getOilStockUsage, getItemStockUsage, getConsumableUsage } from '../lib/stockUsageService';
import { exportExcelReport } from '../lib/excelExport';

const todayId = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const rp = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');

export default function LaporanPemakaianStokPage({ isOffice }) {
  const [outletId, setOutletId] = useState(OUTLETS[0].id);
  const [startDate, setStartDate] = useState(todayId());
  const [endDate, setEndDate] = useState(todayId());
  const [loading, setLoading] = useState(false);
  const [oil, setOil] = useState(null);
  const [items, setItems] = useState(null);
  const [konsum, setKonsum] = useState(null);

  async function handleLoad() {
    setLoading(true);
    try {
      const [o, i, k] = await Promise.all([
        getOilStockUsage(outletId, startDate, endDate),
        getItemStockUsage(outletId, startDate, endDate),
        getConsumableUsage(outletId, startDate, endDate)
      ]);
      setOil(o);
      setItems(i);
      setKonsum(k);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadKonsum() {
    if (!konsum || !konsum.ok) return;
    const headers = ['Barang', 'Satuan', 'Pemakaian', 'Harga Satuan', 'Estimasi Pengeluaran', 'Stok Sekarang'];
    const rows = konsum.items.map((r) => [r.name, r.unit, r.qty, r.unitCost, r.estimatedCost, r.stock ?? '']);
    rows.push(['', '', '', '', '', '']);
    rows.push(['TOTAL', '', '', '', konsum.total, '']);
    await exportExcelReport({
      filename: `Estimasi-Pengeluaran-FullBodyMassage-${outletId}-${startDate}_${endDate}`,
      title: 'Estimasi Pengeluaran Full Body Massage — Dayang Spa',
      subtitle: `Outlet ${outletId} · ${startDate} s/d ${endDate} · ${konsum.totalCount} treatment full body`,
      headers, rows
    });
  }

  async function handleDownloadOil() {
    if (!oil) return;
    const headers = ['Tanggal', 'Produk', 'Ukuran', 'Stok Awal', 'Terpakai', 'Stok Akhir'];
    const rows = oil.rows.map((r) => [r.date, r.oilType, r.size, r.stockAwal, r.used, r.stockAkhir]);
    await exportExcelReport({
      filename: `Pemakaian-Produk-${outletId}-${startDate}_${endDate}`,
      title: 'Pemakaian Produk per Hari — Dayang Spa',
      subtitle: `Outlet ${outletId} · ${startDate} s/d ${endDate}${oil.estimated ? ' · Stok awal/akhir estimasi' : ''}`,
      headers, rows
    });
  }

  async function handleDownloadItems() {
    if (!items) return;
    const headers = ['Tanggal', 'Barang', 'Satuan', 'Stok Awal', 'Masuk', 'Keluar', 'Stok Akhir'];
    const rows = items.rows.map((r) => [r.date, r.name, r.unit, r.stockAwal, r.masuk, r.keluar, r.stockAkhir]);
    await exportExcelReport({
      filename: `Pemakaian-Barang-${outletId}-${startDate}_${endDate}`,
      title: 'Pemakaian Barang per Hari — Dayang Spa',
      subtitle: `Outlet ${outletId} · ${startDate} s/d ${endDate}`,
      headers, rows
    });
  }

  if (!isOffice) {
    return (
      <div className="kasir-page">
        <h2>Laporan Produk</h2>
        <p>Halaman ini hanya tersedia untuk akun Office.</p>
      </div>
    );
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Produk</h2>

      <section>
        <p>Outlet</p>
        <div className="grid-2">
          {OUTLETS.map((o) => (
            <button key={o.id} className={outletId === o.id ? 'active' : ''} onClick={() => setOutletId(o.id)}>{o.name}</button>
          ))}
        </div>
      </section>

      <section>
        <p>Rentang tanggal</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Atur selama 1 minggu / 1 bulan untuk melihat pemakaian stok per hari.
        </p>
      </section>

      <button onClick={handleLoad} disabled={loading}>
        {loading ? 'Memuat...' : 'Tampilkan laporan'}
      </button>

      {konsum && konsum.ok && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>
              Estimasi Pengeluaran Full Body Massage
            </h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadKonsum}>
              ⬇ Download Excel
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
            {konsum.totalCount} treatment full body di rentang ini. Aturan: 1 treatment = 1 Hole Sheet + 1 Single Sheet + 1 Face Cradle.
          </p>

          {konsum.belumAdaHarga && (
            <p style={{ fontSize: 12, color: 'var(--danger)', margin: '0 0 10px' }}>
              ⚠️ Beberapa barang belum punya harga satuan, jadi estimasi rupiahnya belum lengkap. Isi di halaman Inventory → pilih barang → "Harga satuan".
            </p>
          )}

          <div className="oil-card" style={{ textAlign: 'center', padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Estimasi Pengeluaran</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary-dark)', marginTop: 4 }}>{rp(konsum.total)}</div>
          </div>

          {konsum.items.length === 0 ? (
            <p>Tidak ada treatment full body massage di rentang ini.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cellHead}>Barang</th>
                  <th style={cellHead}>Satuan</th>
                  <th style={cellHead}>Pemakaian</th>
                  <th style={cellHead}>Harga Satuan</th>
                  <th style={cellHead}>Estimasi</th>
                  <th style={cellHead}>Stok</th>
                </tr>
              </thead>
              <tbody>
                {konsum.items.map((r) => (
                  <tr key={r.name}>
                    <td style={cell}>{r.name}</td>
                    <td style={cell}>{r.unit}</td>
                    <td style={{ ...cell, fontWeight: 600 }}>{r.qty}</td>
                    <td style={cell}>{r.unitCost > 0 ? rp(r.unitCost) : <span style={{ color: 'var(--danger)' }}>belum diisi</span>}</td>
                    <td style={{ ...cell, fontWeight: 700, color: 'var(--primary-dark)' }}>{rp(r.estimatedCost)}</td>
                    <td style={cell}>{r.stock ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {konsum.byTreatment.length > 0 && (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 6px' }}>Rincian per treatment</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={cellHead}>Treatment</th>
                    <th style={cellHead}>Jumlah</th>
                    <th style={cellHead}>Kebutuhan</th>
                  </tr>
                </thead>
                <tbody>
                  {konsum.byTreatment.map((t) => (
                    <tr key={t.treatmentId}>
                      <td style={cell}>{t.treatmentName}</td>
                      <td style={{ ...cell, fontWeight: 600 }}>{t.count}</td>
                      <td style={cell}>{t.items.map((i) => `${i.qty} ${i.itemName}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {konsum.days.length > 0 && (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 6px' }}>Rincian per hari</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={cellHead}>Tanggal</th>
                    <th style={cellHead}>Pemakaian</th>
                    <th style={cellHead}>Estimasi</th>
                  </tr>
                </thead>
                <tbody>
                  {konsum.days.map((d) => (
                    <tr key={d.date}>
                      <td style={cell}>{d.date}</td>
                      <td style={cell}>
                        {Object.entries(d.perItem).map(([n, q]) => `${n}: ${q}`).join(' · ')}
                      </td>
                      <td style={{ ...cell, fontWeight: 600 }}>{rp(d.estimatedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {konsum && !konsum.ok && (
        <p style={{ fontSize: 13, color: 'var(--danger)' }}>⚠ {konsum.reason}</p>
      )}

      {oil && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>
              Produk — stok hari ini: {oil.current.map((c) => `${c.oilType} (${c.size}): ${c.stock}`).join(' · ')}
            </h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadOil}>
              ⬇ Download Excel
            </button>
          </div>
          {oil.estimated && (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0' }}>
              * Stok awal/akhir produk adalah estimasi (dihitung mundur dari stok saat ini; akurat bila tidak ada pengisian stok di rentang tersebut).
            </p>
          )}
          {oil.rows.length === 0 ? (
            <p>Tidak ada data pemakaian produk di rentang ini.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cellHead}>Tanggal</th>
                  <th style={cellHead}>Produk</th>
                  <th style={cellHead}>Ukuran</th>
                  <th style={cellHead}>Stok Awal*</th>
                  <th style={cellHead}>Terpakai</th>
                  <th style={cellHead}>Stok Akhir*</th>
                </tr>
              </thead>
              <tbody>
                {oil.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={cell}>{r.date}</td>
                    <td style={cell}>{r.oilType}</td>
                    <td style={cell}>{r.size}</td>
                    <td style={cell}>{r.stockAwal}</td>
                    <td style={{ ...cell, fontWeight: 600, color: r.used > 0 ? 'var(--busy)' : undefined }}>{r.used}</td>
                    <td style={cell}>{r.stockAkhir}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {items && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>
              Barang Lain — stok hari ini: {items.current.map((c) => `${c.name}: ${c.stock}${c.unit}`).join(' · ')}
            </h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadItems}>
              ⬇ Download Excel
            </button>
          </div>
          {items.rows.length === 0 ? (
            <p>Tidak ada data pemakaian barang di rentang ini.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cellHead}>Tanggal</th>
                  <th style={cellHead}>Barang</th>
                  <th style={cellHead}>Satuan</th>
                  <th style={cellHead}>Stok Awal</th>
                  <th style={cellHead}>Masuk</th>
                  <th style={cellHead}>Keluar</th>
                  <th style={cellHead}>Stok Akhir</th>
                </tr>
              </thead>
              <tbody>
                {items.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={cell}>{r.date}</td>
                    <td style={cell}>{r.name}</td>
                    <td style={cell}>{r.unit}</td>
                    <td style={cell}>{r.stockAwal}</td>
                    <td style={cell}>{r.masuk > 0 ? r.masuk : ''}</td>
                    <td style={{ ...cell, fontWeight: 600, color: r.keluar > 0 ? 'var(--busy)' : undefined }}>{r.keluar > 0 ? r.keluar : ''}</td>
                    <td style={cell}>{r.stockAkhir}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const cellHead = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left' };