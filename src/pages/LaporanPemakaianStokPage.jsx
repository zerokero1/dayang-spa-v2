import { useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getOilStockUsage, getItemStockUsage } from '../lib/stockUsageService';
import { exportExcelReport } from '../lib/excelExport';

const todayId = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

export default function LaporanPemakaianStokPage({ isOffice }) {
  const [outletId, setOutletId] = useState(OUTLETS[0].id);
  const [startDate, setStartDate] = useState(todayId());
  const [endDate, setEndDate] = useState(todayId());
  const [loading, setLoading] = useState(false);
  const [oil, setOil] = useState(null);
  const [items, setItems] = useState(null);

  async function handleLoad() {
    setLoading(true);
    try {
      const [o, i] = await Promise.all([
        getOilStockUsage(outletId, startDate, endDate),
        getItemStockUsage(outletId, startDate, endDate)
      ]);
      setOil(o);
      setItems(i);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadOil() {
    if (!oil) return;
    const headers = ['Tanggal', 'Minyak', 'Ukuran', 'Stok Awal', 'Terpakai', 'Stok Akhir'];
    const rows = oil.rows.map((r) => [r.date, r.oilType, r.size, r.stockAwal, r.used, r.stockAkhir]);
    await exportExcelReport({
      filename: `Pemakaian-Minyak-${outletId}-${startDate}_${endDate}`,
      title: 'Pemakaian Minyak per Hari — Dayang Spa',
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
        <h2>Laporan Pemakaian Stok</h2>
        <p>Halaman ini hanya tersedia untuk akun Office.</p>
      </div>
    );
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Pemakaian Stok</h2>

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

      {oil && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>
              Minyak — stok hari ini: {oil.current.map((c) => `${c.oilType} (${c.size}): ${c.stock}`).join(' · ')}
            </h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadOil}>
              ⬇ Download Excel
            </button>
          </div>
          {oil.estimated && (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0' }}>
              * Stok awal/akhir minyak adalah estimasi (dihitung mundur dari stok saat ini; akurat bila tidak ada pengisian stok di rentang tersebut).
            </p>
          )}
          {oil.rows.length === 0 ? (
            <p>Tidak ada data pemakaian minyak di rentang ini.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cellHead}>Tanggal</th>
                  <th style={cellHead}>Minyak</th>
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