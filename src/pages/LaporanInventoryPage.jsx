import { useEffect, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { listenOilInventory } from '../lib/oilInventoryService';
import { listenInventory } from '../lib/inventoryService';
import { exportExcelReport } from '../lib/excelExport';

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

  const lowStockOils = oils.filter((o) => (o.stock || 0) <= 1);
  const lowStockItems = items.filter((i) => (i.stock || 0) <= 2);
  const outletName = OUTLETS.find((o) => o.id === outletFilter)?.name || outletFilter;

  async function handleDownload() {
    const headers = ['Kategori', 'Nama', 'Ukuran/Satuan', 'Stok', 'Status'];
    const oilRows = oils.map((o) => [
      'Minyak', o.oilType, o.size, o.stock, (o.stock || 0) <= 1 ? 'MENIPIS' : 'Aman'
    ]);
    const itemRows = items.map((i) => [
      'Barang Lain', i.name, i.unit, i.stock, (i.stock || 0) <= 2 ? 'MENIPIS' : 'Aman'
    ]);
    await exportExcelReport({
      filename: `Laporan-Inventory-${outletName}`,
      title: 'Laporan Inventory — Dayang Spa',
      subtitle: `Outlet ${outletName} · ${new Date().toLocaleDateString('id-ID')}`,
      headers, rows: [...oilRows, ...itemRows],
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

      <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', marginBottom: 12 }} onClick={handleDownload}>
        ⬇ Download Excel
      </button>

      {(lowStockOils.length > 0 || lowStockItems.length > 0) && (
        <section>
          <p style={{ color: 'var(--busy)' }}>⚠ Stok Menipis</p>
          {lowStockOils.map((o) => (
            <div key={o.id} className="oil-card" style={{ marginBottom: 6, borderColor: 'var(--busy)' }}>
              {o.oilType} ({o.size}): <strong>{o.stock}</strong> botol
            </div>
          ))}
          {lowStockItems.map((i) => (
            <div key={i.id} className="oil-card" style={{ marginBottom: 6, borderColor: 'var(--busy)' }}>
              {i.name}: <strong>{i.stock}</strong> {i.unit}
            </div>
          ))}
        </section>
      )}

      <section>
        <p>Stok Minyak</p>
        <div className="grid-2">
          {oils.map((o) => (
            <div key={o.id} className="oil-card">
              {o.oilType} ({o.size}): <strong>{o.stock}</strong> botol
            </div>
          ))}
        </div>
      </section>

      <section>
        <p>Barang Lain</p>
        {items.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada barang tercatat.</p>}
        <div className="grid-2">
          {items.map((i) => (
            <div key={i.id} className="oil-card">
              {i.name}: <strong>{i.stock}</strong> {i.unit}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
