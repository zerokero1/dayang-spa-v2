import { useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getConsumableUsage, getItemLedger, getOilLedger } from '../lib/stockUsageService';
import { exportExcelReport, exportStockLedger } from '../lib/excelExport';

const DAY_COUNT = 7;
const SUB_HEADERS = ['Stock', 'In', 'Out', 'Sisa'];

const todayId = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const shiftDate = (dateStr, delta) =>
  new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + delta * 86400000)
    .toISOString()
    .slice(0, 10);

// Mulai minggu di hari Senin supaya posisinya stabil tiap minggu.
const startOfWeek = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const mundur = (d.getUTCDay() + 6) % 7;
  return shiftDate(dateStr, -mundur);
};

const labelHari = (dateStr, withDay = false) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const nama = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][d.getUTCDay()];
  const angka = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  return withDay ? `${nama} ${angka}` : angka;
};

const sel = (v) => (v === null || v === undefined ? '–' : v);

export default function LaporanPemakaianStokPage({ profile, outletId: outletIdProp }) {
  // Kasir hanya boleh melihat stok outletnya sendiri.
  const isKasir = profile?.role === 'kasir';
  const myOutletId = profile?.outletId || outletIdProp;
  const outletList = isKasir ? OUTLETS.filter((o) => o.id === myOutletId) : OUTLETS;

  const [outletId, setOutletId] = useState(isKasir ? myOutletId : OUTLETS[0].id);
  const [startDate, setStartDate] = useState(() => startOfWeek(todayId()));
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [konsum, setKonsum] = useState(null);
  const [showKonsum, setShowKonsum] = useState(false);

  const target = isKasir ? myOutletId : outletId;
  const outletName = outletList.find((o) => o.id === target)?.name || target;

  async function handleLoad() {
    setLoading(true);
    try {
      const [oil, item] = await Promise.all([
        getOilLedger(target, startDate, DAY_COUNT),
        getItemLedger(target, startDate, DAY_COUNT)
      ]);
      setData({ oil, item });
    } catch (e) {
      setData(null);
      setKonsum({ ok: false, reason: e?.message || 'Gagal memuat data stok.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadKonsum() {
    setLoading(true);
    try {
      setKonsum(await getConsumableUsage(target, startDate, startDate));
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------------
  // Bentuk tabel: 2 blok. Kolom = No + nama, lalu 4 kolom per tanggal.
  // ------------------------------------------------------------------
  const blocks = useMemo(() => {
    if (!data) return [];
    const oilRows = data.oil.rows;
    const itemRows = data.item.rows;

    const angka = (row) =>
      (row ? [row.stock, row.in, row.out, row.sisa] : [null, null, null, null]);

    return [
      {
        title: 'Minyak',
        entries: data.oil.variants.map((v) => ({
          label: `${v.oilType} (${v.size})`,
          cells: data.oil.days.map((d) => angka(
            oilRows.find((r) => r.oilType === v.oilType && r.size === v.size && r.date === d)
          ))
        }))
      },
      {
        title: 'Produk & Laundry',
        entries: data.item.items.map((it) => ({
          label: it.unit ? `${it.name} (${it.unit})` : it.name,
          cells: data.item.days.map((d) => angka(
            itemRows.find((r) => r.itemId === it.id && r.date === d)
          ))
        }))
      }
    ];
  }, [data]);

  const catatan = useMemo(() => {
    if (!data) return null;
    const oil = data.oil.coverageFrom;
    const item = data.item.coverageFrom;
    const tgl = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
    const parts = [];
    if (oil) parts.push(`Minyak tercatat mulai ${tgl(oil)}`);
    else parts.push('Minyak belum ada catatan pergerakan');
    if (item) parts.push(`barang tercatat mulai ${tgl(item)}`);
    else parts.push('barang belum ada catatan pergerakan');
    return `${parts.join(' · ')}. Hari sebelum pencatatan pertama dikosongkan (–), bukan 0.`;
  }, [data]);

  // ------------------------------------------------------------------
  // Excel: satu sheet, dua blok, header tanggal di-merge per 4 kolom.
  // ------------------------------------------------------------------
  async function handleDownload() {
    if (!data) return;
    await exportStockLedger({
      filename: `Laporan-Produk-${target}-${startDate}`,
      title: 'Laporan Produk — Dayang Spa',
      subtitle: `${outletName} · ${labelHari(startDate, true)} s/d ${labelHari(data.oil.days[DAY_COUNT - 1], true)} ${startDate.slice(0, 4)}`,
      dates: data.oil.days.map((d) => labelHari(d, true)),
      blocks: blocks.map((b) => ({
        title: b.title,
        rows: b.entries.map((e, i) => [i + 1, e.label, ...e.cells.flat()])
      })),
      note: catatan,
      sheetName: 'Laporan Produk'
    });
  }

  async function handleDownloadKonsum() {
    if (!konsum || !konsum.ok) return;
    const headers = ['Tanggal', 'Treatment Full Body', ...konsum.itemNames, 'Total Item'];
    const rows = konsum.days.map((d) => [
      d.date, d.treatmentCount,
      ...konsum.itemNames.map((n) => d.perItem[n] || 0),
      d.totalItem
    ]);
    rows.push([]);
    rows.push(['TOTAL', konsum.totalCount, ...konsum.items.map((i) => i.keluar), konsum.totalItem]);
    await exportExcelReport({
      filename: `Pemakaian-FullBodyMassage-${target}-${startDate}`,
      title: 'Pemakaian Full Body Massage (Jumlah Item Keluar) — Dayang Spa',
      subtitle: `${outletName} · ${startDate}`,
      headers, rows
    });
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Produk</h2>

      <section>
        <p>Outlet</p>
        {isKasir ? (
          <p style={{ margin: 0, fontWeight: 600 }}>{outletName}</p>
        ) : (
          <div className="grid-2">
            {outletList.map((o) => (
              <button key={o.id} className={outletId === o.id ? 'active' : ''} onClick={() => { setOutletId(o.id); setData(null); }}>{o.name}</button>
            ))}
          </div>
        )}
      </section>

      <section>
        <p>Minggu laporan</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={navBtn}
            onClick={() => { setStartDate(shiftDate(startDate, -DAY_COUNT)); setData(null); }}
          >
            ◀ Minggu lalu
          </button>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(startOfWeek(e.target.value)); setData(null); }}
          />
          <button
            style={navBtn}
            onClick={() => { setStartDate(shiftDate(startDate, DAY_COUNT)); setData(null); }}
          >
            Minggu depan ▶
          </button>
          <button
            style={navBtn}
            onClick={() => { setStartDate(startOfWeek(todayId())); setData(null); }}
          >
            Minggu ini
          </button>
        </div>
        <p style={hint}>
          7 hari berurutan, mulai hari Senin. Anzahl otomatis mengikuti tanggal yang dipilih.
        </p>
      </section>

      <button onClick={handleLoad} disabled={loading}>
        {loading ? 'Memuat...' : 'Tampilkan laporan'}
      </button>

      {data && (
        <section style={{ marginTop: 16 }}>
          <div style={rowBetween}>
            <h3 style={{ margin: 0 }}>
              {outletName} · {labelHari(data.oil.days[0], true)} s/d {labelHari(data.oil.days[DAY_COUNT - 1], true)}
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
                        <th rowSpan={2} style={cellHeadNama}>Produk Treatment</th>
                        {data.oil.days.map((d, i) => (
                          <th key={d} colSpan={SUB_HEADERS.length} style={cellHeadGroup}>
                            {labelHari(d, true)}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {data.oil.days.flatMap((d) => (
                          SUB_HEADERS.map((s) => (
                            <th key={`${d}-${s}`} style={cellHeadSub}>{s}</th>
                          ))
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.entries.map((e, i) => (
                        <tr key={e.label}>
                          <td style={cellNo}>{i + 1}</td>
                          <td style={cellNama}>{e.label}</td>
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

      <section style={{ marginTop: 20 }}>
        <div style={rowBetween}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
            Rincian pemakaian Full Body Massage
          </p>
          <button style={navBtn} onClick={showKonsum ? handleDownloadKonsum : handleLoadKonsum}>
            {showKonsum ? '⬇ Download Excel' : 'Lihat rincian'}
          </button>
        </div>
        <p style={hint}>
          1 treatment full body = 1 Hole Sheet + 1 Single Sheet + 1 Face Cradle,
          dihitung otomatis dari booking yang tidak dibatalkan pada tanggal {labelHari(startDate, true)}.
        </p>

        {konsum && konsum.ok && showKonsum && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '10px 0 14px' }}>
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

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={cellHeadNo}>Tanggal</th>
                  <th style={cellHeadNo}>Treatment</th>
                  {konsum.itemNames.map((n) => <th key={n} style={cellHeadSub}>{n}</th>)}
                  <th style={cellHeadSub}>Total Item</th>
                </tr>
              </thead>
              <tbody>
                {konsum.days.map((d) => (
                  <tr key={d.date}>
                    <td style={{ ...cell, fontWeight: 600 }}>{d.date}</td>
                    <td style={{ ...cell, textAlign: 'center' }}>{d.treatmentCount}</td>
                    {konsum.itemNames.map((n) => (
                      <td key={n} style={{ ...cell, textAlign: 'right', fontWeight: 600, color: d.perItem[n] > 0 ? 'var(--busy)' : undefined }}>
                        {d.perItem[n] || 0}
                      </td>
                    ))}
                    <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{d.totalItem}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {konsum.byTreatment.length > 0 && (
              <>
                <p style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 6px' }}>Rincian per treatment</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={cellHeadNama}>Treatment</th>
                      <th style={cellHeadNo}>Jumlah</th>
                      <th style={cellHeadNama}>Item keluar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {konsum.byTreatment.map((t) => (
                      <tr key={t.treatmentId}>
                        <td style={cell}>{t.treatmentName}</td>
                        <td style={{ ...cell, textAlign: 'center', fontWeight: 600 }}>{t.count}</td>
                        <td style={cell}>{t.items.map((i) => `${i.itemName} ${i.qty}`).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {konsum && !konsum.ok && (
          <p style={{ fontSize: 13, color: 'var(--danger)' }}>⚠ {konsum.reason}</p>
        )}
      </section>
    </div>
  );
}

const navBtn = { width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' };
const rowBetween = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  flexWrap: 'wrap', gap: 8
};
const hint = { fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' };
const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const cellNo = { ...cell, textAlign: 'center' };
const cellNama = cell;
const cellHeadNo = { ...cell, textAlign: 'center', fontWeight: 700 };
const cellHeadNama = { ...cell, fontWeight: 700 };
const cellHeadGroup = { ...cell, textAlign: 'center', fontWeight: 700, borderBottom: '2px solid var(--border)' };
const cellHeadSub = { ...cell, textAlign: 'center', fontWeight: 600 };