import { useEffect, useMemo, useState } from 'react';
import { OUTLETS, INVENTORY_CATEGORIES, DEFAULT_INVENTORY_CATEGORY } from '../lib/constants';
import { listenOilInventory } from '../lib/oilInventoryService';
import { listenInventory } from '../lib/inventoryService';
import { exportExcelReport } from '../lib/excelExport';

const LOW_STOCK_OIL = 1;
const LOW_STOCK_ITEM = 2;

function statusBadge(stock, lowAt) {
  const value = Number(stock) || 0;
  if (value <= 0) return <span className="late-badge">HABIS</span>;
  if (value <= lowAt) return <span className="late-badge">MENIPIS</span>;
  return <span className="ok-badge">Aman</span>;
}

export default function LaporanInventoryPage({ active }) {
  const [outletFilter, setOutletFilter] = useState(OUTLETS[0].id);
  const [oils, setOils] = useState([]);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!active) return;
    const unsub1 = listenOilInventory(outletFilter, setOils);
    const unsub2 = listenInventory(outletFilter, setItems);
    return () => { unsub1(); unsub2(); };
  }, [active, outletFilter]);

  const outletName = OUTLETS.find((o) => o.id === outletFilter)?.name || outletFilter;

  // Baris laporan: minyak dulu, lalu barang per kategori.
  const rows = useMemo(() => {
    const oilRows = oils.map((o) => ({
      key: o.id,
      category: 'Minyak',
      name: o.oilType,
      size: o.size,
      stock: Number(o.stock) || 0,
      lowAt: LOW_STOCK_OIL,
      unit: 'botol'
    }));

    const itemRows = items.map((i) => ({
      key: i.id,
      category: i.category || DEFAULT_INVENTORY_CATEGORY,
      name: i.name,
      size: i.unit,
      stock: Number(i.stock) || 0,
      lowAt: LOW_STOCK_ITEM,
      unit: i.unit
    }));

    const categoryOrder = ['Minyak', ...INVENTORY_CATEGORIES];
    return [...oilRows, ...itemRows].sort((a, b) => {
      const ia = categoryOrder.indexOf(a.category);
      const ib = categoryOrder.indexOf(b.category);
      const oa = ia === -1 ? 99 : ia;
      const ob = ib === -1 ? 99 : ib;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
  }, [oils, items]);

  const lowRows = rows.filter((r) => r.stock <= r.lowAt);
  const emptyCount = rows.filter((r) => r.stock <= 0).length;

  const totals = useMemo(() => rows.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    acc.total = (acc.total || 0) + 1;
    return acc;
  }, {}), [rows]);

  async function handleDownload() {
    const headers = ['Kategori', 'Nama', 'Ukuran/Satuan', 'Stok', 'Status'];
    const body = rows.map((r) => [
      r.category,
      r.name,
      r.size,
      r.stock,
      r.stock <= 0 ? 'HABIS' : (r.stock <= r.lowAt ? 'MENIPIS' : 'Aman')
    ]);
    await exportExcelReport({
      filename: `Laporan-Inventory-${outletName}`,
      title: 'Laporan Inventory — Dayang Spa',
      subtitle: `Outlet ${outletName} · ${new Date().toLocaleDateString('id-ID')}`,
      headers,
      rows: body,
      currencyColumns: [3]
    });
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Inventory</h2>

      <section>
        <p>Outlet</p>
        <select
          value={outletFilter}
          onChange={(e) => setOutletFilter(e.target.value)}
          style={{ width: '100%', padding: 11, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)' }}
        >
          {OUTLETS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </section>

      <section className="actions" style={{ marginBottom: 12 }}>
        <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownload}>
          ⬇ Download Excel
        </button>
      </section>

      <section className="summary-chips" style={{ marginBottom: 12 }}>
        <span className="chip">{totals.total || 0} jenis barang</span>
        {INVENTORY_CATEGORIES.map((c) => (
          totals[c] ? <span key={c} className="chip">{c} {totals[c]}</span> : null
        ))}
        {lowRows.length > 0 && (
          <span className="chip chip-warn">{lowRows.length} menipis</span>
        )}
        {emptyCount > 0 && (
          <span className="chip chip-warn">{emptyCount} habis</span>
        )}
      </section>

      {lowRows.length > 0 && (
        <div className="message warn" style={{ marginBottom: 12 }}>
          ⚠ Stok menipis: {lowRows.map((r) => `${r.name} (${r.stock} ${r.unit})`).join(', ')}
        </div>
      )}

      <div className="report-block">
        <h3>Rincian Stok</h3>
        <p className="muted">
          Stok produk & laundry berkurang otomatis saat treatment dibooket, dan kembali
          saat booking dibatalkan.
        </p>

        {rows.length === 0 ? (
          <p className="muted">Belum ada barang tercatat.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kategori</th>
                  <th>Nama</th>
                  <th>Satuan</th>
                  <th>Stok</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.category}-${r.key}`}>
                    <td>{r.category}</td>
                    <td>{r.name}</td>
                    <td>{r.size}</td>
                    <td><strong>{r.stock}</strong></td>
                    <td>{statusBadge(r.stock, r.lowAt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total {totals.total || 0} jenis</td>
                  <td colSpan={2}>{emptyCount} habis / {lowRows.length} menipis</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}