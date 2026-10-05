import { useEffect, useMemo, useState } from 'react';
import { OUTLETS, INVENTORY_CATEGORIES, DEFAULT_INVENTORY_CATEGORY, isSingleSizeProduct, SIZE_NONE } from '../lib/constants';
import { getOilLedgerRange, getItemLedgerRange, getAllOutletLedger } from '../lib/stockUsageService';
import { exportStockLedger } from '../lib/excelExport';
import { labelHari, shiftDate, startOfWeek } from '../lib/stokLedger';

const LOW_STOCK_OIL = 1;
const LOW_STOCK_ITEM = 2;
const SUB_HEADERS = ['Stock', 'In', 'Out', 'Sisa'];
const ALL_OUTLETS = '__all__';
const MAX_DAYS = 62;

const todayId = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

// Nilai kosong ditampilkan "–", bukan 0. 0 berarti "tidak bergerak" dan itu
// berbeda dari "tidak punya catatan".
const sel = (v) => (v === null || v === undefined ? '–' : v);

const navBtn = { width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' };
const hint = { fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' };
const rowBetween = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 };
const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const cellNo = { ...cell, textAlign: 'center' };
const cellHeadNo = { ...cell, textAlign: 'center', fontWeight: 700 };
const cellHeadGroup = { ...cell, textAlign: 'center', fontWeight: 700, borderBottom: '2px solid var(--border)' };
const cellHeadSub = { ...cell, textAlign: 'center', fontWeight: 600 };

/** "Foot Cream (Besar)" -> "Foot Cream" untuk produk satu jenis. */
function labelOils(oilType, size) {
  if (isSingleSizeProduct(oilType) || size === SIZE_NONE) return oilType;
  return `${oilType} (${size})`;
}

export default function LaporanInventoryPage({ active, profile }) {
  const isKasir = profile?.role === 'kasir';
  const myOutletId = profile?.outletId;
  const outletList = isKasir ? OUTLETS.filter((o) => o.id === myOutletId) : OUTLETS;

  const [outletId, setOutletId] = useState(isKasir ? myOutletId : ALL_OUTLETS);
  const [startDate, setStartDate] = useState(() => startOfWeek(todayId()));
  const [endDate, setEndDate] = useState(todayId());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const target = isKasir ? myOutletId : outletId;
  const outletLabel = target === ALL_OUTLETS
    ? 'Semua Outlet'
    : (OUTLETS.find((o) => o.id === target)?.name || target);

  // Tanggal dibalik urutan supaya rentangnya tidak nol hari.
  const from = startDate <= endDate ? startDate : endDate;
  const to = startDate <= endDate ? endDate : startDate;
  const dayCount = Math.round(
    (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000
  ) + 1;

  useEffect(() => {
    if (!active) setData(null);
  }, [active]);

  async function handleLoad() {
    setLoading(true);
    setError('');
    try {
      if (target === ALL_OUTLETS) {
        const res = await getAllOutletLedger(
          OUTLETS.map((o) => o.id),
          from,
          to
        );
        setData(res);
      } else {
        const [oil, item] = await Promise.all([
          getOilLedgerRange(target, from, to),
          getItemLedgerRange(target, from, to)
        ]);
        setData({ days: oil.days, oil, item });
      }
    } catch (e) {
      console.error(e);
      setData(null);
      setError(e?.message || 'Gagal memuat data stok.');
    } finally {
      setLoading(false);
    }
  }

  const blocks = useMemo(() => {
    if (!data) return [];
    const angka = (row) => (row ? [row.stock, row.in, row.out, row.sisa] : [null, null, null, null]);
    const showOutlet = target === ALL_OUTLETS;

    const oilRows = data.oil.rows;
    const oilEntries = data.oil.variants.map((v) => ({
      label: showOutlet
        ? `[${v.outletId}] ${labelOils(v.oilType, v.size)}`
        : labelOils(v.oilType, v.size),
      cells: data.days.map((d) => angka(
        oilRows.find((r) => r.oilType === v.oilType && r.size === v.size && r.date === d && (!showOutlet || r.outletId === v.outletId))
      ))
    }));

    const itemEntries = data.item.items.map((it) => ({
      label: showOutlet ? `[${it.outletId}] ${it.unit ? `${it.name} (${it.unit})` : it.name}`
        : (it.unit ? `${it.name} (${it.unit})` : it.name),
      cells: data.days.map((d) => angka(
        data.item.rows.find((r) => r.itemId === it.id && r.date === d && (!showOutlet || r.outletId === it.outletId))
      ))
    }));

    return [
      { title: 'Minyak', entries: oilEntries },
      { title: 'Produk & Laundry', entries: itemEntries }
    ];
  }, [data, target]);

  // Ringkasan hanya untuk mode outlet tunggal, karena di mode gabungan setiap
  // nama barang berawalan outlet berbeda sehingga "habis" per nama tidak
  // bisa dijawab satu angka.
  const ringkasan = useMemo(() => {
    if (!data || target === ALL_OUTLETS) return null;
    const semua = [
      ...data.oil.variants.map((v) => ({
        key: `${v.oilType}-${v.size}`,
        name: labelOils(v.oilType, v.size),
        stock: Number(v.stock) || 0,
        lowAt: LOW_STOCK_OIL,
        unit: 'botol'
      })),
      ...data.item.items.map((it) => ({
        key: `item-${it.id}`,
        name: it.name,
        category: it.category || DEFAULT_INVENTORY_CATEGORY,
        stock: Number(it.stock) || 0,
        lowAt: LOW_STOCK_ITEM,
        unit: it.unit
      }))
    ];
    const low = semua.filter((r) => r.stock <= r.lowAt);
    const empty = semua.filter((r) => r.stock <= 0);
    const perCategory = {};
    semua.forEach((r) => {
      const c = r.category || 'Minyak';
      perCategory[c] = (perCategory[c] || 0) + 1;
    });
    return { total: semua.length, low, empty, perCategory };
  }, [data, target]);

  const catatan = useMemo(() => {
    if (!data) return null;
    const tgl = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
    const parts = [];
    if (data.oil.coverageFrom) parts.push(`Minyak tercatat mulai ${tgl(data.oil.coverageFrom)}`);
    else parts.push('Minyak belum ada catatan pergerakan');
    if (data.item.coverageFrom) parts.push(`barang tercatat mulai ${tgl(data.item.coverageFrom)}`);
    else parts.push('barang belum ada catatan pergerakan');
    return `${parts.join(' · ')}. Hari sebelum pencatatan pertama dikosongkan (–), bukan 0.`;
  }, [data]);

  async function handleDownload() {
    if (!data) return;
    await exportStockLedger({
      filename: `Laporan-Inventory-${target === ALL_OUTLETS ? 'Semua-Outlet' : target}-${from}_${to}`,
      title: 'Laporan Inventory — Dayang Spa',
      subtitle: `${outletLabel} · ${labelHari(from, true)} s/d ${labelHari(to, true)} ${from.slice(0, 4)}`,
      dates: data.days.map((d) => labelHari(d, true)),
      blocks: blocks.map((b) => ({
        title: b.title,
        rows: b.entries.map((e, i) => [i + 1, e.label, ...e.cells.flat()])
      })),
      note: catatan,
      sheetName: 'Laporan Inventory'
    });
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Inventory</h2>

      <section>
        <p>Outlet</p>
        {isKasir ? (
          <p style={{ margin: 0, fontWeight: 600 }}>{outletLabel}</p>
        ) : (
          <div className="grid-2">
            <button
              className={outletId === ALL_OUTLETS ? 'active' : ''}
              onClick={() => { setOutletId(ALL_OUTLETS); setData(null); }}
            >
              Semua Outlet
            </button>
            {outletList.map((o) => (
              <button
                key={o.id}
                className={outletId === o.id ? 'active' : ''}
                onClick={() => { setOutletId(o.id); setData(null); }}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <p>Rentang tanggal</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={navBtn}
            onClick={() => { const s = shiftDate(from, -7); setStartDate(s); setEndDate(shiftDate(to, -7)); setData(null); }}
          >
            ◀ Mingguan
          </button>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setData(null); }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>s/d</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setData(null); }}
          />
          <button
            style={navBtn}
            onClick={() => { const s = shiftDate(from, 7); setStartDate(s); setEndDate(shiftDate(to, 7)); setData(null); }}
          >
            Mingguan ▶
          </button>
          <button
            style={navBtn}
            onClick={() => { setStartDate(startOfWeek(todayId())); setEndDate(todayId()); setData(null); }}
          >
            Minggu ini
          </button>
          <button
            style={navBtn}
            onClick={() => { const bl = `${from.slice(0, 7)}-01`; setStartDate(bl); setEndDate(from); setData(null); }}
          >
            Bulan ini
          </button>
        </div>
        <p style={hint}>
          {dayCount} hari · {labelHari(from, true)} s/d {labelHari(to, true)} {from.slice(0, 4)}.
          Setiap tanggal punya 4 angka: Stock (awal hari), In (barang masuk), Out (barang keluar), Sisa (akhir hari).
        </p>
      </section>

      {dayCount > MAX_DAYS && (
        <p className="message warn">
          Periode ini {dayCount} hari — tabelnya jadi sangat lebar. Batasi sekitar 2 bulan agar mudah dibaca.
        </p>
      )}

      <button onClick={handleLoad} disabled={loading || dayCount > MAX_DAYS}>
        {loading ? 'Memuat...' : 'Tampilkan laporan'}
      </button>

      {error && <p className="message warn">⚠ {error}</p>}

      {ringkasan && (
        <section className="summary-chips" style={{ marginTop: 12 }}>
          <span className="chip">{ringkasan.total} jenis barang</span>
          {INVENTORY_CATEGORIES.map((c) => (
            ringkasan.perCategory[c] ? <span key={c} className="chip">{c} {ringkasan.perCategory[c]}</span> : null
          ))}
          {ringkasan.low.length > 0 && <span className="chip chip-warn">{ringkasan.low.length} menipis</span>}
          {ringkasan.empty.length > 0 && <span className="chip chip-warn">{ringkasan.empty.length} habis</span>}
        </section>
      )}

      {ringkasan?.low.length > 0 && (
        <div className="message warn" style={{ margin: '12px 0' }}>
          ⚠ Stok menipis: {ringkasan.low.map((r) => `${r.name} (${r.stock} ${r.unit})`).join(', ')}
        </div>
      )}

      {data && (
        <section style={{ marginTop: 16 }}>
          <div style={rowBetween}>
            <h3 style={{ margin: 0 }}>
              {outletLabel} · {labelHari(data.days[0], true)} s/d {labelHari(data.days[data.days.length - 1], true)}
            </h3>
            <button style={navBtn} onClick={handleDownload}>⬇ Download Excel</button>
          </div>
          {catatan && <p style={hint}>{catatan}</p>}

          {blocks.map((block) => (
            <div key={block.title} style={{ marginTop: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 6px' }}>{block.title}</p>
              {block.entries.length === 0 ? (
                <p style={hint}>Belum ada data {block.title.toLowerCase()} di outlet ini.</p>
              ) : (
                <div className="table-wrap">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={cellHeadNo}>No</th>
                        <th rowSpan={2} style={{ ...cell, fontWeight: 700 }}>Produk</th>
                        {data.days.map((d) => (
                          <th key={d} colSpan={SUB_HEADERS.length} style={cellHeadGroup}>
                            {labelHari(d, true)}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {data.days.flatMap((d) => SUB_HEADERS.map((s) => (
                          <th key={`${d}-${s}`} style={cellHeadSub}>{s}</th>
                        )))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.entries.map((e, i) => (
                        <tr key={e.label}>
                          <td style={cellNo}>{i + 1}</td>
                          <td style={cell}>{e.label}</td>
                          {e.cells.flat().map((v, j) => (
                            <td
                              key={j}
                              style={{
                                ...cell,
                                textAlign: 'right',
                                color: v === null ? 'var(--text-secondary)' : (j % 4 === 2 ? 'var(--busy)' : undefined),
                                fontWeight: j % 4 === 2 && v ? 600 : undefined
                              }}
                            >
                              {sel(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}