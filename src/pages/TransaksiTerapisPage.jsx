import { useCallback, useEffect, useMemo, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { getTherapistTransactionsRange } from '../lib/reportService';
import { exportExcelWorkbook } from '../lib/excelExport';
import { openWhatsAppMessage } from '../lib/bookingService';

const OUTLET_NAME = Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));

const METODE = {
  cash: 'Cash',
  cardless: 'Cardless'
};

const STATUS = {
  selesai: 'Selesai',
  berjalan: 'Berjalan',
  batal: 'Batal',
  batal_sebagian: 'Batal sebagian'
};

const rp = (n) => 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const angka = (n) => Number(n || 0).toLocaleString('id-ID');

function tglSingkat(iso) {
  if (!iso) return '-';
  const d = new Date(new Date(iso).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const [y, b, h] = d.split('-');
  return `${h}-${b}-${y}`;
}

function jamSingkat(iso) {
  if (!iso) return '-';
  return new Date(new Date(iso).getTime() + 8 * 3600000)
    .toISOString()
    .slice(11, 16);
}

function akhirBulan(tgl) {
  const d = new Date(tgl + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export default function TransaksiTerapisPage() {
  const [therapists, setTherapists] = useState([]);
  const [terpilih, setTerpilih] = useState('');
  const [cari, setCari] = useState('');
  const [mulai, setMulai] = useState('');
  const [sampai, setSampai] = useState('');
  const [sembunyiBatal, setSembunyiBatal] = useState(false);

  const [hasil, setHasil] = useState(null);
  const [sedangMuat, setSedangMuat] = useState(false);
  const [galat, setGalat] = useState('');

  useEffect(() => listenAllTherapists(setTherapists), []);

  // Default: bulan lalu sampai hari ini, karena itu yang paling sering dicari.
  useEffect(() => {
    const sekarang = new Date();
    const akhir = sekarang.toISOString().slice(0, 10);
    const d = new Date(akhir + 'T00:00:00Z');
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    setMulai(d.toISOString().slice(0, 10));
    setSampai(akhir);
  }, []);

  const daftar = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const urut = [...therapists].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );
    if (!q) return urut;
    return urut.filter((t) => (t.name || '').toLowerCase().includes(q));
  }, [therapists, cari]);

  const muat = useCallback(async () => {
    if (!terpilih || !mulai || !sampai) return;
    setSedangMuat(true);
    setGalat('');
    try {
      setHasil(await getTherapistTransactionsRange(terpilih, mulai, sampai));
    } catch (e) {
      setGalat('Gagal memuat: ' + (e.message || e));
      setHasil(null);
    } finally {
      setSedangMuat(false);
    }
  }, [terpilih, mulai, sampai]);

  const therapistDipilih = therapists.find((t) => t.id === terpilih);
  const nama = therapistDipilih?.name || '';

  const baris = useMemo(() => {
    if (!hasil) return [];
    const semua = hasil.semua.filter(
      (b) => !(sembunyiBatal && b.status === 'batal')
    );
    return semua;
  }, [hasil, sembunyiBatal]);

  // Ringkasan ikut mengikuti filter batal, supaya angka di atas tabel dan
  // isi tabel tidak berbeda.
  const rekap = useMemo(() => {
    if (!hasil) return null;
    if (!sembunyiBatal) return hasil.rekap;
    const valid = hasil.valid;
    return {
      ...hasil.rekap,
      jumlahValid: valid.length,
      jumlahBatal: 0,
      omzet: valid.reduce((n, b) => n + b.treatmentPrice, 0),
      komisi: valid.reduce((n, b) => n + b.commissionAmount, 0)
    };
  }, [hasil, sembunyiBatal]);

  const unduh = async () => {
    if (!hasil || !nama) return;
    const headers = [
      'Tanggal', 'Jam', 'Outlet', 'Treatment', 'Pelanggan', 'Harga',
      'Komisi %', 'Komisi', 'Komisi Hotel', 'Metode', 'Status', 'Bayar'
    ];
    const rows = baris.map((b) => [
      tglSingkat(b.createdAt),
      jamSingkat(b.createdAt),
      OUTLET_NAME[b.outletId] || b.outletId,
      b.treatmentName,
      b.customerName || '-',
      b.treatmentPrice,
      b.commissionPercent,
      b.commissionAmount,
      b.bookingSource === 'oncall' ? b.hotelCommission : 0,
      METODE[b.paymentMethod] || b.paymentMethod || '-',
      STATUS[b.status] || b.status,
      b.paid ? 'Lunas' : 'Belum lunas'
    ]);
    const totalRowIndex = rows.length + 1;

    try {
      await exportExcelWorkbook({
        filename:
          'transaksi-' + nama.replace(/\s+/g, '-').toLowerCase() +
          '-' + mulai + '_' + sampai,
        sheets: [{
          sheetName: 'Transaksi',
          title: 'Transaksi ' + nama,
          subtitle:
            mulai + ' s/d ' + sampai + '  -  ' + baris.length + ' baris',
          sections: [{
            title: 'Rincian transaksi',
            headers,
            rows,
            currencyColumns: [5, 7, 8],
            totalRowIndex,
            note:
              'Total harga ' +
              rp(rows.reduce((n, r) => n + Number(r[5] || 0), 0)) +
              '   Total komisi ' +
              rp(rows.reduce((n, r) => n + Number(r[7] || 0), 0)) +
              (sembunyiBatal ? '   (baris batal disembunyikan)' : '')
          }]
        }]
      });
    } catch (e) {
      setGalat('Gagal membuat Excel: ' + (e.message || e));
    }
  };
  const kirimWa = () => {
    if (!rekap || !nama) return;
    const teks =
      `Transaksi ${nama} ${tglSingkat(mulai)} s/d ${tglSingkat(sampai)}\n` +
      `Treatment : ${rekap.jumlahValid}\n` +
      `Omzet     : ${rp(rekap.omzet)}\n` +
      `Komisi    : ${rp(rekap.komisi)}\n` +
      `Sudah lunas : ${rekap.sudahLunas}\n` +
      `Belum lunas : ${rekap.belumLunas}`;
    openWhatsAppMessage(teks);
  };

  return (
    <div className="kasir-page">
      <h2>Transaksi Terapis</h2>
      <p className="muted">
        Semua transaksi milik satu terapis dalam rentang tanggal, lengkap
        dengan treatment, harga, metode bayar, dan komisinya. Kalau sudah
        mengunduh Excel dari laporan lain, masih harus mencari namanya di
        antara ratusan baris. Halaman ini karena itu ada.
      </p>

      <section>
        <label className="muted" style={{ fontSize: 12, display: 'block' }}>
          Cari terapis
        </label>
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Ketik nama, misalnya Ron"
          style={{ width: '100%', marginBottom: 8 }}
        />

        <label className="muted" style={{ fontSize: 12, display: 'block' }}>
          Terapis
        </label>
        <select
          value={terpilih}
          onChange={(e) => setTerpilih(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        >
          <option value="">-- pilih terapis --</option>
          {daftar.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.homeOutletId ? ' (' + (OUTLET_NAME[t.homeOutletId] || t.homeOutletId) + ')' : ''}
            </option>
          ))}
        </select>
        {therapists.length > 0 && daftar.length === 0 && (
          <p className="message warn">
            Tidak ada terapis bernama "{cari}".
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="muted" style={{ fontSize: 12, display: 'block' }}>
              Dari
            </label>
            <input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} />
          </div>
          <div>
            <label className="muted" style={{ fontSize: 12, display: 'block' }}>
              Sampai
            </label>
            <input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <button
            onClick={() => {
              const akhir = akhirBulan(mulai);
              setSampai(akhir);
            }}
            disabled={!mulai}
          >
            Sampai akhir bulan
          </button>
          <button
            onClick={muat}
            disabled={!terpilih || !mulai || !sampai || sedangMuat}
          >
            {sedangMuat ? 'Memuat...' : 'Tampilkan'}
          </button>
        </div>

        {sampai < mulai && (
          <p className="message warn">
            Tanggal awal lebih besar dari tanggal akhir. Rentang seperti ini
            tidak akan berisi transaksi. Kalau maksudnya bulan lalu sampai
            hari ini, tekan "Sampai akhir bulan".
          </p>
        )}
      </section>

      {galat && <p className="message warn">{galat}</p>}

      {!hasil && !sedangMuat && (
        <p className="muted">
          Pilih terapis dan tekan Tampilkan.
        </p>
      )}

      {hasil && rekap && (
        <>
          <section>
            <h3>
              {nama} &mdash; {tglSingkat(mulai)} s/d {tglSingkat(sampai)}
            </h3>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <td style={{ width: 200 }}>Treatment selesai</td>
                    <td><strong>{angka(rekap.jumlahValid)}</strong></td>
                    <td style={{ width: 200 }}>Sudah lunas</td>
                    <td><strong>{angka(rekap.sudahLunas)}</strong></td>
                  </tr>
                  <tr>
                    <td>Dibatalkan</td>
                    <td>{angka(rekap.jumlahBatal)}</td>
                    <td>Belum lunas</td>
                    <td><strong>{angka(rekap.belumLunas)}</strong></td>
                  </tr>
                  <tr>
                    <td>Omzet</td>
                    <td><strong>{rp(rekap.omzet)}</strong></td>
                    <td>Oncall</td>
                    <td>{angka(rekap.oncall)}</td>
                  </tr>
                  <tr>
                    <td>Komisi</td>
                    <td><strong>{rp(rekap.komisi)}</strong></td>
                    <td>Komisi hotel</td>
                    <td>{rp(rekap.hotelCommission)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={unduh} disabled={baris.length === 0}>
                Unduh Excel ({baris.length} baris)
              </button>
              <button onClick={kirimWa}>Kirim ringkasan ke WhatsApp</button>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={sembunyiBatal}
                  onChange={(e) => setSembunyiBatal(e.target.checked)}
                />
                Sembunyikan yang batal
              </label>
            </div>
          </section>

          <section>
            {baris.length === 0 ? (
              <p className="muted">Tidak ada transaksi pada rentang ini.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Jam</th>
                      <th>Outlet</th>
                      <th>Treatment</th>
                      <th>Pelanggan</th>
                      <th>Harga</th>
                      <th>Komisi</th>
                      <th>Metode</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baris.map((b) => (
                      <tr
                        key={b.id}
                        style={
                          b.status === 'batal'
                            ? { opacity: 0.55, textDecoration: 'line-through' }
                            : undefined
                        }
                      >
                        <td>{tglSingkat(b.createdAt)}</td>
                        <td>{jamSingkat(b.createdAt)}</td>
                        <td>{OUTLET_NAME[b.outletId] || b.outletId}</td>
                        <td>
                          {b.treatmentName}
                          {b.bookingSource === 'oncall' && (
                            <span className="badge warn" style={{ marginLeft: 6 }}>
                              oncall
                            </span>
                          )}
                          {b.usesOil && b.oilType && (
                            <div className="muted" style={{ fontSize: 11 }}>
              minyak: {b.oilType}
                            </div>
                          )}
                        </td>
                        <td>{b.customerName || '-'}</td>
                        <td>{rp(b.treatmentPrice)}</td>
                        <td>{rp(b.commissionAmount)}</td>
                        <td>{METODE[b.paymentMethod] || b.paymentMethod || '-'}</td>
                        <td>
                          {STATUS[b.status] || b.status}
                          <div className="muted" style={{ fontSize: 11 }}>
                            {b.paid ? 'lunas' : 'belum lunas'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={5}>TOTAL {baris.length} baris</th>
                      <th>{rp(baris.reduce((n, b) => n + b.treatmentPrice, 0))}</th>
                      <th>{rp(baris.reduce((n, b) => n + b.commissionAmount, 0))}</th>
                      <th colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section>
            <p className="muted" style={{ fontSize: 12 }}>
              Tanggal dihitung dari jam booking dicatat, bukan jam pembayaran. Transaksi
              yang dibatalkan tetap ditampilkan dengan coret, tapi tidak ikut
              dihitung di omzet maupun komisi.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
