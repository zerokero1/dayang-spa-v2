import { useCallback, useEffect, useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getDiscountRange, groupDiscountReasons, flagDiscountIssues } from '../lib/reportService';
import { exportExcelReport } from '../lib/excelExport';

const ALL_OUTLETS = '__all__';

const todayId = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 7 * 3600000 - n * 86400000).toISOString().slice(0, 10);

const rp = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
const OUTLET_NAME = Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));
const navBtn = { width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' };
const hint = { fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' };

function wibStamp(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

/**
 * Laporan Diskon / Potongan Harga.
 *
 * Bedanya dengan laporan omzet: laporan ini tidak menunjukkan uncontrollable
 * apa yang/laku, tapi berapa harga yang dikurangi kasir dari harga daftar, dan
 * apakah pengurangannya masuk akal. Karena itu halaman ini tidak hanya
 * menjumlahkan, tapi juga menandai yang perlu ditinjau:
 *
 *   - tanpa alasan        alasan diskonnya kosong
 *   - persen kosong       harga diturunkan tapi discount_pct tidak diisi
 *   - harga 0             treatment gratis padahal ada di katalog
 *   - harga di atas katalog  treatment-nya dihitung lebih mahal dari katalog
 *
 * Kolom "Komisi Kurang" menunjukkan berapa komisi terapis hilang kalau
 * seharusnya harga yang dibayar pelanggan sama dengan harga katalog.
 */
export default function LaporanDiskonPage({ active, profile }) {
  const isKasir = profile?.role === 'kasir';
  const myOutletId = profile?.outletId;

  const [outletId, setOutletId] = useState(isKasir ? myOutletId : ALL_OUTLETS);
  const [startDate, setStartDate] = useState(() => daysAgo(9));
  const [endDate, setEndDate] = useState(todayId);
  const [cari, setCari] = useState('');
  const [hanyaBermasalah, setHanyaBermasalah] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const target = isKasir ? myOutletId : outletId;
  const outletLabel = target === ALL_OUTLETS ? 'Semua Outlet' : (OUTLET_NAME[target] || target);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await getDiscountRange(startDate, endDate, target === ALL_OUTLETS ? '' : target));
    } catch (e) {
      setRows(null);
      setError(e?.message || 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, target]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // Setiap baris digabung dengan penanda masalahnya sekali saja.
  const denganFlag = useMemo(
    () => (rows || []).map((r) => ({ ...r, issues: flagDiscountIssues(r) })),
    [rows]
  );

  const bermasalah = useMemo(() => denganFlag.filter((r) => r.issues.length > 0), [denganFlag]);

  constshown = useMemo(() => {
    const q = cari.trim().toLowerCase();
    let out = hanyaBermasalah ? bermasalah : denganFlag;
    if (q) {
      out = out.filter((r) => [r.therapistName, r.treatmentName, r.customerName, r.alasan, r.outletId]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
    }
    return out;
  }, [denganFlag, bermasalah, hanyaBermasalah, cari]);

  const totalDiskon = shown.reduce((s, r) => s + (r.nilaiDiskon || 0), 0);
  const totalKomisiKurang = shown.reduce((s, r) => s + (r.komisiSelisih || 0), 0);

  const perAlasan = useMemo(() => groupDiscountReasons(shown), [shown]);

  const perOutlet = useMemo(() => {
    const m = {};
    shown.forEach((r) => {
      const k = r.outletId || '-';
      m[k] = m[k] || { n: 0, nilai: 0, komisi: 0 };
      m[k].n++; m[k].nilai += r.nilaiDiskon || 0; m[k].komisi += r.komisiSelisih || 0;
    });
    return Object.entries(m).sort((a, b) => b[1].nilai - a[1].nilai);
  }, [shown]);

  async function handleDownload() {
    if (!shown.length) return;
    const headers = [
      'Tanggal', 'Jam', 'Outlet', 'Terapis', 'Treatment', 'Harga Katalog',
      'Harga Dibayar', 'Potongan', 'Diskon %', 'Komisi', 'Komisi Kurang',
      'Alasan', 'Perlu Ditinjau'
    ];
    const body = shown.map((r) => [
      wibStamp(r.createdAt).slice(0, 10),
      wibStamp(r.createdAt).slice(11),
      r.outletId,
      r.therapistName || '-',
      r.treatmentName || '-',
      r.katalogPrice,
      r.treatmentPrice,
      r.nilaiDiskon,
      r.diskonPersenEfektif,
      r.commissionAmount,
      r.komisiSelisih,
      r.alasan,
      r.issues.join(', ')
    ]);
    body.push([]);
    body.push([
      'SUBTOTAL', '', '', '', `${shown.length} transaksi berdiskon`,
      '', shown.reduce((s, r) => s + (r.treatmentPrice || 0), 0),
      totalDiskon, '', '', totalKomisiKurang, '', ''
    ]);

    await exportExcelReport({
      filename: `Laporan-Diskon-${target === ALL_OUTLETS ? 'Semua-Outlet' : target}-${startDate}_${endDate}`,
      title: 'Laporan Diskon / Potongan Harga — Dayang Spa',
      subtitle: `${outletLabel} · ${startDate} s/d ${endDate}`,
      headers,
      rows: body,
      currencyColumns: [5, 6, 7, 9, 10]
    });
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Diskon / Potongan Harga</h2>
      <p className="muted">
        Daftar transaksi yang harganya dikurangi dari harga daftar. Kolom
        <strong> Potongan</strong> menunjukkan berapa harga yang dipotong, dan
        <strong> Komisi Kurang</strong> berapa komisi terapis yang hilang kalau
        seharusnya pelanggan bayar harga katalog. Booking oncall tidak termasuk
        karena harga oncall memang berbeda dari harga katalog.
      </p>

      <section>
        <p>Outlet</p>
        {isKasir ? (
          <p style={{ margin: 0, fontWeight: 600 }}>{outletLabel}</p>
        ) : (
          <div className="grid-2">
            <button
              className={outletId === ALL_OUTLETS ? 'active' : ''}
              onClick={() => setOutletId(ALL_OUTLETS)}
            >
              Semua Outlet
            </button>
            {OUTLETS.map((o) => (
              <button
                key={o.id}
                className={outletId === o.id ? 'active' : ''}
                onClick={() => setOutletId(o.id)}
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
          <button style={navBtn} onClick={() => { setStartDate(daysAgo(9)); setEndDate(todayId()); }}>
            10 hari
          </button>
          <button style={navBtn} onClick={() => { setStartDate(daysAgo(29)); setEndDate(todayId()); }}>
            30 hari
          </button>
          <button style={navBtn} onClick={() => { setStartDate(daysAgo(89)); setEndDate(todayId()); }}>
            90 hari
          </button>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>s/d</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <button style={navBtn} onClick={load} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat ulang'}
          </button>
        </div>
      </section>

      {error && <p className="message warn">{error}</p>}

      {rows && (
        <>
          <section className="summary-chips" style={{ margin: '12px 0' }}>
            <span className="chip">{shown.length} transaksi berdiskon</span>
            <span className="chip chip-warn">Potongan {rp(totalDiskon)}</span>
            <span className="chip">Komisi kurang {rp(totalKomisiKurang)}</span>
            <span className="chip">{bermasalah.length} perlu ditinjau</span>
          </section>

          {bermasalah.length > 0 && (
            <div className="message warn" style={{ marginBottom: 12 }}>
              ⚠ <strong>{bermasalah.length} transaksi</strong> perlu ditinjau:
              alasan kosong, persen diskon tidak diisi, harga 0, atau harga di atas
              katalog. Total komisi terkait {rp(bermasalah.reduce((s, r) => s + (r.komisiSelisih || 0), 0))}.
            </div>
          )}

          <section>
            <p>Cari</p>
            <input
              placeholder="Nama terapis, treatment, pelanggan, atau alasan..."
              value={cari}
              onChange={(e) => setCari(e.target.value)}
            />
          </section>

          {perAlasan.length > 0 && (
            <details open style={{ marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Alasan diskon yang dipakai ({perAlasan.length} jenis)
              </summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr><th>Alasan</th><th>Transaksi</th><th>Potongan</th><th>Komisi kurang</th></tr>
                  </thead>
                  <tbody>
                    {perAlasan.map((g) => (
                      <tr key={g.kunci}>
                        <td>{g.label}</td>
                        <td>{g.n}</td>
                        <td style={{ fontWeight: 600 }}>{rp(g.nilai)}</td>
                        <td>{rp(g.komisi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {perOutlet.length > 1 && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Potongan per outlet
              </summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr><th>Outlet</th><th>Transaksi</th><th>Potongan</th><th>Komisi kurang</th></tr>
                  </thead>
                  <tbody>
                    {perOutlet.map(([id, v]) => (
                      <tr key={id}>
                        <td>{OUTLET_NAME[id] || id}</td>
                        <td>{v.n}</td>
                        <td style={{ fontWeight: 600 }}>{rp(v.nilai)}</td>
                        <td>{rp(v.komisi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              className={hanyaBermasalah ? 'pos-chip' : 'pos-chip active'}
              onClick={() => setHanyaBermasalah(false)}
              style={{ fontSize: 12 }}
            >
              Semua ({denganFlag.length})
            </button>
            <button
              className={hanyaBermasalah ? 'pos-chip active' : 'pos-chip'}
              onClick={() => setHanyaBermasalah(true)}
              style={{ fontSize: 12 }}
            >
              Perlu ditinjau ({bermasalah.length})
            </button>
            <button style={navBtn} onClick={handleDownload} disabled={!shown.length}>
              ⬇ Download Excel
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="muted">
              {hanyaBermasalah
                ? 'Semua diskon pada rentang ini punya alasan dan persen yang wajar.'
                : 'Tidak ada transaksi berdiskon pada rentang ini.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tanggal</th><th>Outlet</th><th>Terapis</th><th>Treatment</th>
                    <th>Katalog</th><th>Dibayar</th><th>Potongan</th><th>%</th>
                    <th>Komisi Kurang</th><th>Alasan</th><th>Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 400).map((r) => (
                    <tr key={r.id} style={r.issues.length ? { background: 'var(--busy-bg)' } : undefined}>
                      <td>{wibStamp(r.createdAt).slice(0, 10)}</td>
                      <td>{OUTLET_NAME[r.outletId] || r.outletId}</td>
                      <td>{r.therapistName || '-'}</td>
                      <td>{r.treatmentName || '-'}</td>
                      <td>{r.katalogPrice == null ? '-' : rp(r.katalogPrice)}</td>
                      <td style={{ fontWeight: 600 }}>{rp(r.treatmentPrice)}</td>
                      <td>{r.nilaiDiskon ? rp(r.nilaiDiskon) : '-'}</td>
                      <td>{r.diskonPersenEfektif ? r.diskonPersenEfektif + '%' : '-'}</td>
                      <td>{r.komisiSelisih ? rp(r.komisiSelisih) : '-'}</td>
                      <td style={{ fontSize: 12 }}>{r.alasan || <em>—</em>}</td>
                      <td style={{ fontSize: 11, color: 'var(--busy)' }}>
                        {r.issues.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}><strong>{shown.length} transaksi</strong></td>
                    <td style={{ fontWeight: 700 }}>
                      {rp(shown.reduce((s, r) => s + (r.treatmentPrice || 0), 0))}
                    </td>
                    <td style={{ fontWeight: 700 }}>{rp(totalDiskon)}</td>
                    <td colSpan={2} />
                    <td style={{ fontWeight: 700 }}>{rp(totalKomisiKurang)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {shown.length > 400 && (
            <p style={hint}>Menampilkan 400 baris pertama dari {shown.length}. Download Excel untuk daftar lengkapnya.</p>
          )}

          <p style={hint}>
            <strong>Perlu ditinjau</strong> berarti salah satu dari: alasan kosong,
            persen diskon tidak diisi padahal harganya turun, harga masuk Rp0, atau
            harga masuk di atas harga katalog. Baris seperti itu diberi warna
            kuning. Oncall tidak termasuk karena harganya memang beda dari
            katalog.
          </p>
        </>
      )}
    </div>
  );
}