import { useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getOilStockUsage, getItemStockUsage, getConsumableUsage } from '../lib/stockUsageService';
import { exportExcelReport } from '../lib/excelExport';

const todayId = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

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
    const headers = ['Tanggal', 'Treatment Full Body', ...konsum.itemNames, 'Total Item'];
    const rows = konsum.days.map((d) => [
      d.date,
      d.treatmentCount,
      ...konsum.itemNames.map((n) => d.perItem[n] || 0),
      d.totalItem
    ]);
    rows.push([]);
    rows.push(['TOTAL', konsum.totalCount, ...konsum.items.map((i) => i.keluar), konsum.totalItem]);
    await exportExcelReport({
      filename: `Pemakaian-FullBodyMassage-${outletId}-${startDate}_${endDate}`,
      title: 'Pemakaian Full Body Massage (Jumlah Item Keluar) — Dayang Spa',
      subtitle: `Outlet ${outletId} · ${startDate} s/d ${endDate}`,
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
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}
            onClick={() => { const t = todayId(); setStartDate(t); setEndDate(t); }}
          >
            Hari ini
          </button>
          <button
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}
            onClick={() => {
              const end = todayId();
              const start = new Date(Date.now() + 7 * 3600000 - 6 * 86400000).toISOString().slice(0, 10);
              setStartDate(start); setEndDate(end);
            }}
          >
            7 hari
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Atur selama 1 minggu / 1 bulan untuk melihat pemakaian stok per hari.
        </p>
      </section>

      <button onClick={handleLoad} disabled={loading}>
        {loading ? 'Memuat...' : 'Tampilkan laporan'}
      </button>

      {konsum && konsum.ok && startDate === endDate && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
          Menampilkan pemakaian <strong>{startDate}</strong> · {outletId}.
        </p>
      )}

      {konsum && konsum.ok && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Full Body Massage — Berapa Item yang Keluar</h3>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownloadKonsum}>
              ⬇ Download Excel
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
            Aturan: 1 treatment full body = 1 Hole Sheet + 1 Single Sheet + 1 Face Cradle.
            Dihitung otomatis dari booking yang tidak dibatalkan.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {konsum.items.map((i) => (
              <div key={i.name} className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{i.name}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: i.keluar > 0 ? 'var(--busy)' : 'var(--text-secondary)', marginTop: 4 }}>
                  {i.keluar}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {i.unit} keluar · stok {i.stock != null ? `${i.stock} ${i.unit}` : 'belum ada di Inventory'}
                </div>
              </div>
            ))}
          </div>

          <div className="oil-card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total item keluar di rentang ini</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary-dark)', marginTop: 2 }}>
              {konsum.totalItem} <span style={{ fontSize: 14, fontWeight: 600 }}>({konsum.totalCount} treatment full body)</span>
            </div>
          </div>

          {konsum.days.length === 0 ? (
            <p>Tidak ada treatment full body massage di rentang ini.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={cellHead}>Tanggal</th>
                  <th style={cellHead}>Treatment</th>
                  {konsum.itemNames.map((n) => <th key={n} style={cellHead}>{n}</th>)}
                  <th style={cellHead}>Total Item</th>
                </tr>
              </thead>
              <tbody>
                {konsum.days.map((d) => (
                  <tr key={d.date}>
                    <td style={{ ...cell, fontWeight: 600 }}>{d.date}</td>
                    <td style={cell}>{d.treatmentCount}</td>
                    {konsum.itemNames.map((n) => (
                      <td key={n} style={{ ...cell, fontWeight: 600, color: d.perItem[n] > 0 ? 'var(--busy)' : undefined }}>
                        {d.perItem[n] || 0}
                      </td>
                    ))}
                    <td style={{ ...cell, fontWeight: 700 }}>{d.totalItem}</td>
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
                    <th style={cellHead}>Item keluar</th>
                  </tr>
                </thead>
                <tbody>
                  {konsum.byTreatment.map((t) => (
                    <tr key={t.treatmentId}>
                      <td style={cell}>{t.treatmentName}</td>
                      <td style={{ ...cell, fontWeight: 600 }}>{t.count}</td>
                      <td style={cell}>{t.items.map((i) => `${i.itemName} ${i.qty}`).join(' · ')}</td>
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