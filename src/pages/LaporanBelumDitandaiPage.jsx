import { useCallback, useEffect, useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getUnpaidRange } from '../lib/reportService';
import { exportExcelReport } from '../lib/excelExport';

const ALL_OUTLETS = '__all__';

const todayId = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 7 * 3600000 - n * 86400000).toISOString().slice(0, 10);

const rp = (n) => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');

const STATUS_LABEL = {
  berjalan: 'Treatment masih berjalan',
  selesai: 'Selesai, belum ditandai bayar',
  batal_sebagian: 'Batal sebagian (potongan)'
};

const OUTLET_NAME = Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));

/** Umur transaksi dalam hari, dipakai untuk melihat yang paling lama tertinggal. */
function ageDays(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

function wibStamp(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

const navBtn = { width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' };
const hint = { fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' };

/**
 * Laporan Belum Ditandai — daftar transaksi yang paid = false, untuk
 * mencocokkan uang di laci kas dengan yang tercatat di aplikasi.
 *
 * Fokusnya baris `selesai`: treatment sudah rampung tapi kasir lupa menandai
 * lunas. Baris `berjalan` masih aktif jadi wajar belum bayar, dan ditampilkan
 * terpisah supaya tidak mengaburkan yang perlu ditindaklanjuti.
 */
export default function LaporanBelumDitandaiPage({ active, profile }) {
  const isKasir = profile?.role === 'kasir';
  const myOutletId = profile?.outletId;

  const [outletId, setOutletId] = useState(isKasir ? myOutletId : ALL_OUTLETS);
  const [startDate, setStartDate] = useState(() => daysAgo(9));
  const [endDate, setEndDate] = useState(todayId);
  const [onlyFinished, setOnlyFinished] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const target = isKasir ? myOutletId : outletId;
  const outletLabel = target === ALL_OUTLETS ? 'Semua Outlet' : (OUTLET_NAME[target] || target);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await getUnpaidRange(startDate, endDate, target === ALL_OUTLETS ? '' : target));
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

  const selesai = useMemo(() => (rows || []).filter((b) => b.status === 'selesai'), [rows]);
  const berjalan = useMemo(() => (rows || []).filter((b) => b.status === 'berjalan'), [rows]);
  const shown = onlyFinished ? selesai : (rows || []);

  const perOutlet = useMemo(() => {
    const m = {};
    selesai.forEach((b) => {
      const key = b.outletId || '-';
      m[key] = m[key] || { n: 0, omzet: 0, komisi: 0 };
      m[key].n++;
      m[key].omzet += b.treatmentPrice || 0;
      m[key].komisi += b.commissionAmount || 0;
    });
    return Object.entries(m).sort((a, b) => b[1].omzet - a[1].omzet);
  }, [selesai]);

  const totalSelesai = selesai.reduce((s, b) => s + (b.treatmentPrice || 0), 0);
  const totalJalan = berjalan.reduce((s, b) => s + (b.treatmentPrice || 0), 0);
  const totalKomisi = selesai.reduce((s, b) => s + (b.commissionAmount || 0), 0);

  async function handleDownload() {
    if (!shown.length) return;
    const headers = [
      'Tanggal', 'Jam', 'Outlet', 'Terapis', 'Treatment', 'Harga',
      'Komisi', 'Status', 'Umur (hari)', 'Pelanggan', 'Catatan'
    ];
    const body = shown.slice().sort((a, b) => (a.startAt || 0) - (b.startAt || 0)).map((b) => [
      wibStamp(b.createdAt).slice(0, 10),
      wibStamp(b.createdAt).slice(11),
      b.outletId,
      b.therapistName || '-',
      b.treatmentName || '-',
      b.treatmentPrice,
      b.commissionAmount,
      STATUS_LABEL[b.status] || b.status,
      ageDays(b.createdAt),
      b.customerName || '-',
      b.discountReason || ''
    ]);
    body.push([]);
    body.push(['SUBTOTAL', '', '', '', `${shown.length} transaksi belum ditandai`, shown.reduce((s, b) => s + (b.treatmentPrice || 0), 0), shown.reduce((s, b) => s + (b.commissionAmount || 0), 0)]);

    await exportExcelReport({
      filename: `Belum-Ditandai-${target === ALL_OUTLETS ? 'Semua-Outlet' : target}-${startDate}_${endDate}`,
      title: 'Laporan Belum Ditandai (Belum Lunas) — Dayang Spa',
      subtitle: `${outletLabel} · ${startDate} s/d ${endDate}`,
      headers,
      rows: body,
      currencyColumns: [5, 6]
    });
  }

  return (
    <div className="kasir-page">
      <h2>Belum Ditandai Lunas</h2>
      <p className="muted">
        Daftar transaksi yang <strong>belum ditandai lunas</strong>. Cocokkan dengan
        uang di laci kas. Baris <strong>Selesai</strong> perlu ditindaklanjuti —
        treatment sudah rampung tapi kasir lupa menandai. Baris <strong>Berjalan</strong>{' '}
        masih aktif, jadi wajar belum bayar.
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
          <button
            style={navBtn}
            onClick={() => { setStartDate(daysAgo(9)); setEndDate(todayId()); }}
          >
            10 hari
          </button>
          <button
            style={navBtn}
            onClick={() => { setStartDate(daysAgo(29)); setEndDate(todayId()); }}
          >
            30 hari
          </button>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>s/d</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <button style={navBtn} onClick={load} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat ulang'}
          </button>
        </div>
      </section>

      {error && <p className="message warn">{error}</p>}

      {rows && (
        <>
          <section className="summary-chips" style={{ margin: '12px 0' }}>
            <span className="chip chip-warn">{selesai.length} selesai belum bayar</span>
            <span className="chip">Rp{totalSelesai.toLocaleString('id-ID')}</span>
            <span className="chip">{berjalan.length} masih berjalan</span>
            <span className="chip">Rp{totalJalan.toLocaleString('id-ID')}</span>
          </section>

          {selesai.length > 0 && (
            <div className="message warn" style={{ marginBottom: 12 }}>
              ⚠ <strong>{selesai.length} transaksi</strong> ({rp(totalSelesai)}) sudah selesai
              tapi belum ditandai lunas. Komisi terkait {rp(totalKomisi)}.
            </div>
          )}

          {selesai.length > 0 && perOutlet.length > 1 && (
            <details open style={{ marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Selesai belum bayar per outlet
              </summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Outlet</th><th>Transaksi</th><th>Nilai</th><th>Komisi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perOutlet.map(([id, v]) => (
                      <tr key={id}>
                        <td>{OUTLET_NAME[id] || id}</td>
                        <td>{v.n}</td>
                        <td style={{ color: 'var(--busy)', fontWeight: 600 }}>{rp(v.omzet)}</td>
                        <td>{rp(v.komisi)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>TOTAL</strong></td>
                      <td><strong>{selesai.length}</strong></td>
                      <td><strong style={{ color: 'var(--busy)' }}>{rp(totalSelesai)}</strong></td>
                      <td><strong>{rp(totalKomisi)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              className={onlyFinished ? 'pos-chip' : 'pos-chip active'}
              onClick={() => setOnlyFinished(false)}
              style={{ fontSize: 12 }}
            >
              Semua ({rows.length})
            </button>
            <button
              className={onlyFinished ? 'pos-chip active' : 'pos-chip'}
              onClick={() => setOnlyFinished(true)}
              style={{ fontSize: 12 }}
            >
              Selesai saja ({selesai.length})
            </button>
            <button
              style={navBtn}
              onClick={handleDownload}
              disabled={!shown.length}
            >
              ⬇ Download Excel
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="muted">
              {onlyFinished
                ? 'Tidak ada transaksi selesai-butuh-bayar pada rentang ini.'
                : 'Semua transaksi pada rentang ini sudah ditandai lunas.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Jam</th>
                    <th>Outlet</th>
                    <th>Terapis</th>
                    <th>Treatment</th>
                    <th>Harga</th>
                    <th>Komisi</th>
                    <th>Status</th>
                    <th>Umur</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice().sort((a, b) => (a.startAt || 0) - (b.startAt || 0)).map((b) => {
                    const umur = ageDays(b.createdAt);
                    const perluTindak = b.status === 'selesai';
                    return (
                      <tr key={b.id} style={perluTindak ? { background: 'var(--busy-bg)' } : undefined}>
                        <td>{wibStamp(b.createdAt).slice(0, 10)}</td>
                        <td>{wibStamp(b.createdAt).slice(11)}</td>
                        <td>{OUTLET_NAME[b.outletId] || b.outletId}</td>
                        <td>{b.therapistName || '-'}</td>
                        <td>{b.treatmentName || '-'}</td>
                        <td style={{ fontWeight: 600 }}>{rp(b.treatmentPrice)}</td>
                        <td>{rp(b.commissionAmount)}</td>
                        <td style={{ fontSize: 12 }}>
                          {STATUS_LABEL[b.status] || b.status}
                        </td>
                        <td style={{ color: umur >= 7 ? 'var(--busy)' : undefined, fontWeight: umur >= 7 ? 600 : undefined }}>
                          {umur} hr
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}><strong>{shown.length} transaksi</strong></td>
                    <td style={{ fontWeight: 700 }}>
                      {rp(shown.reduce((s, b) => s + (b.treatmentPrice || 0), 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p style={hint}>
            Umur = berapa hari sejak transaksi dibuat. Yang sudah lewat 7 hari
            sebaiknya langsung dikonfirmasi ke kasir outletnya.
          </p>
        </>
      )}
    </div>
  );
}