import { useCallback, useEffect, useState } from 'react';
import {
  getPemeriksaanSistem,
  jalankanPemeriksaan,
  getRiwayatPemeriksaan
} from '../lib/reportService';

const WARNA = {
  tinggi: { label: 'Perlu ditangani', cls: 'danger' },
  sedang: { label: 'Periksa', cls: 'warn' },
  rendah: { label: 'Tahu saja', cls: 'muted' }
};

const KATEGORI = [
  ['keamanan', 'Keamanan'],
  ['supervisor', 'Supervisor'],
  ['transaksi', 'Transaksi'],
  ['stok', 'Stok'],
  ['absensi', 'Absensi']
];

export default function PemeriksaanSistemPage() {
  const [temuan, setTemuan] = useState([]);
  const [riwayat, setRiwayat] = useState([]);
  const [sedangMuat, setSedangMuat] = useState(true);
  const [sedangJalan, setSedangJalan] = useState(false);
  const [galat, setGalat] = useState('');
  const [catatan, setCatatan] = useState('');
  const [bukaRiwayat, setBukaRiwayat] = useState(false);

  const muat = useCallback(async () => {
    setSedangMuat(true);
    setGalat('');
    try {
      setTemuan(await getPemeriksaanSistem());
      setRiwayat(await getRiwayatPemeriksaan(14));
    } catch (e) {
      setGalat('Gagal memuat hasil pemeriksaan: ' + (e.message || e));
    } finally {
      setSedangMuat(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  const jalankanSekarang = async () => {
    setSedangJalan(true);
    setGalat('');
    setCatatan('');
    try {
      const n = await jalankanPemeriksaan();
      setCatatan('Pemeriksaan selesai, ' + n + ' temuan.');
      await muat();
    } catch (e) {
      setGalat('Gagal menjalankan: ' + (e.message || e));
    } finally {
      setSedangJalan(false);
    }
  };

  const totalTinggi = temuan.filter((t) => t.berat === 'tinggi').length;
  const totalSemua = temuan.reduce((n, t) => n + t.total, 0);

  return (
    <div className="kasir-page">
      <h2>Pemeriksaan Sistem</h2>
      <p className="muted">
        Menyorot hal yang kelihatan benar di layar tapi angkanya salah: transaksi
        yang tidak pernah diselesaikan, metode pembayaran yang rusak, komisi yang
        tidak sesuai rumus, nomor grup yang dipakai lintas outlet, dan catatan
        absensi yang tidak cocok dengan treatment.
      </p>
      <p className="muted">
        Pemeriksaan berjalan sendiri setiap hari pada pukul 15:00, 18:00, dan
        23:00 WIB. Tidak perlu ada yang membuka aplikasi.
      </p>

      <section>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={jalankanSekarang} disabled={sedangJalan || sedangMuat}>
            {sedangJalan ? 'Memeriksa...' : 'Jalankan pemeriksaan sekarang'}
          </button>
          <button onClick={muat} disabled={sedangMuat}>Muat ulang</button>
          <button onClick={() => setBukaRiwayat((v) => !v)}>
            {bukaRiwayat ? 'Sembunyikan riwayat' : 'Lihat riwayat 14 hari'}
          </button>
        </div>
      </section>

      {galat && <p className="message warn">{galat}</p>}
      {catatan && <p className="message ok">{catatan}</p>}

      {sedangMuat && <p className="muted">Memuat hasil...</p>}

      {!sedangMuat && temuan.length === 0 && (
        <p className="message ok">
          Tidak ada temuan. Semua aturan yang diperiksa lolos.
        </p>
      )}

      {!sedangMuat && temuan.length > 0 && (
        <>
          <p className={totalTinggi > 0 ? 'message warn' : 'muted'}>
            {totalSemua} masalah di {temuan.length} jenis, davon {totalTinggi}{' '}
            yang perlu ditangani.
          </p>

          {KATEGORI.map(([kat, judul]) => {
            const isi = temuan.filter((t) => t.kategori === kat);
            if (!isi.length) return null;
            return (
              <section key={kat}>
                <h3>{judul}</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Masalah</th>
                        <th>Level</th>
                        <th>Jumlah</th>
                        <th>Terakhir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isi.map((t) => (
                        <tr key={t.kode}>
                          <td>
                            <strong>{t.judul}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {t.keterangan}
                            </div>
                            {t.contoh && (
                              <details style={{ marginTop: 6 }}>
                                <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                                  Lihat contoh
                                </summary>
                                <pre
                                  style={{
                                    whiteSpace: 'pre-wrap',
                                    fontSize: 11,
                                    background: 'rgba(0,0,0,.04)',
                                    padding: 8,
                                    borderRadius: 6,
                                    marginTop: 4
                                  }}
                                >
                                  {t.contoh}
                                </pre>
                              </details>
                            )}
                          </td>
                          <td>
                            <span className={'badge ' + (WARNA[t.berat]?.cls || '')}>
                              {WARNA[t.berat]?.label || t.berat}
                            </span>
                          </td>
                          <td>{t.total}</td>
                          <td className="muted">{t.tanggal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}

      {bukaRiwayat && (
        <section>
          <h3>Riwayat 14 hari terakhir</h3>
          {riwayat.length === 0 ? (
            <p className="muted">Belum ada riwayat tersimpan.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Masalah</th>
                    <th>Level</th>
                    <th>Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat.map((r, i) => (
                    <tr key={r.tanggal + r.kode + i}>
                      <td>{r.tanggal}</td>
                      <td>{r.judul}</td>
                      <td>
                        <span className={'badge ' + (WARNA[r.berat]?.cls || '')}>
                          {WARNA[r.berat]?.label || r.berat}
                        </span>
                      </td>
                      <td>{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section>
        <p className="muted" style={{ fontSize: 12 }}>
          Pemeriksaan hanya membaca dan mencatat, tidak mengubah data apa pun.
          Apa pun yang perlu diperbaiki tetap diputuskan manual.
        </p>
      </section>
    </div>
  );
}
