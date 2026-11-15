import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRevenueSementara } from '../lib/reportService';
import { openWhatsAppMessage } from '../lib/bookingService';

const OUTLET_BARIS = [
  ['RR', 'Dayang spa Rere'],
  ['DP', 'Dayang putri RP'],
  ['DR', 'Dream Healty SPA'],
  ['D1', 'Dayang Spa 1 Rp'],
  ['D2', 'Dayang spa 2 Rp'],
  ['Y', 'Yulis']
];

const rp = (n) => 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');

// Lombok (Kuta) memakai UTC+8 / WITA, bukan UTC+7 / WIB seperti di Jawa.
// Selisihnya satu jam, jadi kalau salah pakai +7, jam yang tampil satu jam
// lebih belakang dari jam yang sebenarnya di tangan kasir.
const OFFSET_LOKAL = 8 * 3600000;

function waktuLokal(iso) {
  const d = iso ? new Date(iso) : new Date();
  const s = new Date(d.getTime() + OFFSET_LOKAL).toISOString();
  return { tanggal: s.slice(0, 10), jam: s.slice(11, 16) };
}

function tanggalSlash() {
  const { tanggal } = waktuLokal();
  const [y, b, h] = tanggal.split('-');
  return `${h}/${b}/${y}`;
}

// Jam lokal dari waktu pengambilan data, bukan dari jam buka halaman, supaya
// angka dan jamnya selalu berasal dari momen yang sama.
function jamLokal(iso) {
  if (!iso) return '';
  return `${waktuLokal(iso).jam} WITA`;
}

export default function RevenueSementaraPage() {
  const [data, setData] = useState(null);
  const [sedangMuat, setSedangMuat] = useState(false);
  const [galat, setGalat] = useState('');
  const tglHariIni = waktuLokal().tanggal;
  const lsKey = `ds_retail_minyak_${tglHariIni}`;
  const [retailMinyak, setRetailMinyak] = useState(() => {
    try { return localStorage.getItem(lsKey) || ''; } catch { return ''; }
  });
  const [tersalin, setTersalin] = useState(false);

  const handleRetailChange = (val) => {
    setRetailMinyak(val);
    try { localStorage.setItem(lsKey, val); } catch { /* ignore */ }
  };

  const muat = useCallback(async () => {
    setSedangMuat(true);
    setGalat('');
    try {
      const hasil = await getRevenueSementara('');
      setData(hasil);
    } catch (e) {
      setGalat('Gagal memuat data: ' + (e.message || e));
      setData(null);
    } finally {
      setSedangMuat(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  const retail = Math.max(0, Number(retailMinyak) || 0);
  const grandTotal = (data ? data.total : 0) + retail;
  const grandTotalLunas = (data ? (data.totalLunas || 0) : 0) + retail;

  // Teks untuk dikirim ke grup WhatsApp, urutannya sama dengan rekap manual.
  const teks = useMemo(() => {
    if (!data) return '';
    const cari = (id) => data.daftarOutlet.find((o) => o.id === id);
    const baris = OUTLET_BARIS.map(([id, nama]) => {
      const o = cari(id);
      return `${nama} : ${rp(o ? o.omzet : 0)}`;
    });
    baris.push(`oncall : ${rp(data.oncall.omzet)}`);
    baris.push(`Retail minyak : ${retail ? rp(retail) : ''}`);
    baris.push(`Total : ${rp(grandTotal)}`);
    if (data.totalBelumBayar > 0) {
      baris.push(`(Lunas: ${rp(grandTotalLunas)} | Belum bayar: ${rp(data.totalBelumBayar)})`);
    }
    return `Revenue sementara ${tanggalSlash()} ${jamLokal(data.waktu)}\n${baris.join('\n')}`;
  }, [data, retail, grandTotal, grandTotalLunas]);

  // Sama seperti daftar terapis: buka WhatsApp dengan pesan yang sudah terisi,
  // jadi kasir tinggal menekan tombol kirim di WhatsApp.
  const kirimWa = () => {
    if (!teks) return;
    openWhatsAppMessage(teks);
  };

  const salin = async () => {
    if (!teks) return;
    try {
      await navigator.clipboard.writeText(teks);
      setTersalin(true);
      setTimeout(() => setTersalin(false), 2500);
    } catch {
      setGalat('Tidak bisa menyalin otomatis. Pilih teks di bawah lalu salin manual.');
    }
  };

  return (
    <div className="kasir-page">
      <h2>Revenue Sementara</h2>
      <p className="muted">
        Omzet berjalan hari ini per outlet, untuk rekap jam 15:00, 18:00, dan
        23:00. Tekan tombol kirim, WhatsApp terbuka dengan pesan yang sudah
        terisi â€” tinggal tekan kirim di WhatsApp.
      </p>

      <section>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={muat} disabled={sedangMuat}>
            {sedangMuat ? 'Memuat...' : 'Muat ulang'}
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Angka diambil {jamLokal(data?.waktu) || '-'}
          </span>
          <button onClick={kirimWa} disabled={!data}>
            Kirim ke WhatsApp
          </button>
          <button onClick={salin} disabled={!data}>
            {tersalin ? 'Tersalin' : 'Salin'}
          </button>
        </div>
      </section>

      {galat && <p className="message warn">{galat}</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, margin: '14px 0' }}>
            <div className="oil-card" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Kas Lunas Masuk</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary-dark)', marginTop: 4 }}>
                {rp(grandTotalLunas)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Cash: {rp(data.totalCash)} · Non-cash: {rp(data.totalCardless)}</div>
            </div>
            <div className="oil-card" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Belum Bayar (Gantung)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: data.totalBelumBayar > 0 ? 'var(--busy)' : 'inherit', marginTop: 4 }}>
                {rp(data.totalBelumBayar)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tamu masih treatment/belum lunas</div>
            </div>
            <div className="oil-card" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Grand Total Keseluruhan</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary-dark)', marginTop: 4 }}>
                {rp(grandTotal)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Lunas + Belum Bayar + Retail</div>
            </div>
          </div>

          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Transaksi</th>
                  <th>Lunas (Kas)</th>
                  <th>Belum Bayar</th>
                  <th>Total Omzet</th>
                </tr>
              </thead>
              <tbody>
                {OUTLET_BARIS.map(([id, nama]) => {
                  const o = data.daftarOutlet.find((x) => x.id === id);
                  return (
                    <tr key={id}>
                      <td>{nama}</td>
                      <td>{o ? o.transaksi : 0}</td>
                      <td style={{ color: 'var(--primary-dark)' }}>{rp(o ? o.lunas : 0)}</td>
                      <td style={{ color: (o && o.belumBayar > 0) ? 'var(--busy)' : 'var(--text-secondary)' }}>
                        {rp(o ? o.belumBayar : 0)}
                      </td>
                      <td><strong>{rp(o ? o.omzet : 0)}</strong></td>
                    </tr>
                  );
                })}
                <tr>
                  <td>oncall</td>
                  <td>{data.oncall.transaksi}</td>
                  <td style={{ color: 'var(--primary-dark)' }}>{rp(data.oncall.lunas)}</td>
                  <td style={{ color: data.oncall.belumBayar > 0 ? 'var(--busy)' : 'var(--text-secondary)' }}>
                    {rp(data.oncall.belumBayar)}
                  </td>
                  <td><strong>{rp(data.oncall.omzet)}</strong></td>
                </tr>
                <tr>
                  <td>Retail minyak</td>
                  <td>-</td>
                  <td style={{ color: 'var(--primary-dark)' }}>{rp(retail)}</td>
                  <td>-</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="10000"
                      value={retailMinyak}
                      placeholder="0"
                      onChange={(e) => handleRetailChange(e.target.value)}
                      style={{ width: 110, textAlign: 'right' }}
                    />
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th />
                  <th style={{ color: 'var(--primary-dark)' }}>{rp(grandTotalLunas)}</th>
                  <th style={{ color: data.totalBelumBayar > 0 ? 'var(--busy)' : 'inherit' }}>
                    {rp(data.totalBelumBayar)}
                  </th>
                  <th>{rp(grandTotal)}</th>
                </tr>
              </tfoot>
            </table>
          </section>

          <section>
            <p>Teks untuk ditempel ke grup</p>
            <textarea
              readOnly
              value={teks}
              rows={10}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
            />
          </section>

          <section>
            <p>Rincian oncall</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Outlet</th>
                    <th>Terapis</th>
                    <th>Treatment</th>
                    <th>Harga</th>
                    <th>Komisi hotel</th>
                    <th>Sisa spa</th>
                    <th>Komisi terapis</th>
                  </tr>
                </thead>
                <tbody>
                  {data.oncall.rincian.length === 0 && (
                    <tr><td colSpan={7} className="muted">Belum ada oncall hari ini.</td></tr>
                  )}
                  {data.oncall.rincian.map((r, i) => (
                    <tr key={i}>
                      <td>{r.outlet}</td>
                      <td>{r.therapistName}</td>
                      <td>{r.treatmentName}</td>
                      <td>{rp(r.treatmentPrice)}</td>
                      <td>{rp(r.hotelCommission)}</td>
                      <td>{rp(r.netSpa)}</td>
                      <td>{rp(r.commissionAmount)}</td>
                    </tr>
                  ))}
                  {data.oncall.transaksi > 0 && (
                    <tfoot>
                      <tr>
                        <th colSpan={3}>
                          TOTAL {data.oncall.transaksi} oncall
                        </th>
                        <th>{rp(data.oncall.hargaPenuh)}</th>
                        <th>{rp(data.oncall.komisiHotel)}</th>
                        <th>{rp(data.oncall.omzet)}</th>
                        <th>{rp(data.oncall.komisiTerapis)}</th>
                      </tr>
                    </tfoot>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="muted" style={{ fontSize: 12 }}>
            Angka oncall sudah dikurangi komisi hotel, karena bagian hotel
            tidak pernah masuk ke spa. Retail minyak tidak ada di database,
            jadi angkanya harus diketik di sini supaya total benar.
          </p>
        </>
      )}
    </div>
  );
}