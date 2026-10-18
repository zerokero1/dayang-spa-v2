import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const WARNA = {
  jalan: { label: 'Jalan', cls: 'ok' },
  terlambat: { label: 'Terlambat', cls: 'warn' },
  gagal: { label: 'Gagal', cls: 'danger' },
  belum: { label: 'Belum pernah jalan', cls: 'danger' },
  nonaktif: { label: 'Nonaktif', cls: 'muted' }
};

const JADWAL_BACA = {
  harian: 'setiap hari',
  setiap_jam: 'beberapa kali sehari'
};

function jamWita(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Makassar',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

export default function SupervisorPage() {
  const [agent, setAgent] = useState([]);
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
      const [a, r] = await Promise.all([
        supabase.rpc('supervisor_ringkasan'),
        supabase.rpc('supervisor_riwayat', { jumlah: 40 })
      ]);
      if (a.error) throw new Error(a.error.message);
      if (r.error) throw new Error(r.error.message);
      setAgent(a.data || []);
      setRiwayat(r.data || []);
    } catch (e) {
      setGalat('Gagal memuat: ' + (e.message || e));
    } finally {
      setSedangMuat(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  // Semua agent dipanggil berurutan dari sisi server lewat satu tombol.
  // Urutannya penting: pemeriksa_rekan dijalankan paling akhir supaya dia
  // menilai pekerjaan agent lain yang barusan selesai.
  const jalankanSemua = async () => {
    setSedangJalan(true);
    setGalat('');
    setCatatan('');
    try {
      for (const nama of ['arsip', 'keamanan', 'kesalahan', 'pemeriksa_rekan']) {
        const { error } = await supabase.rpc('agent_' + nama);
        if (error) throw new Error(nama + ': ' + error.message);
      }
      setCatatan('Keempat agent sudah dijalankan. Supervisor menilai hasilnya.');
      await muat();
    } catch (e) {
      setGalat('Gagal: ' + (e.message || e));
    } finally {
      setSedangJalan(false);
    }
  };

  const bermasalah = agent.filter((a) => a.status !== 'jalan' && a.status !== 'nonaktif');
  const totalTemuan = agent.reduce((n, a) => n + (a.temuan || 0), 0);

  return (
    <div className="kasir-page">
      <h2>Supervisor</h2>
      <p className="muted">
        Empat agent bekerja sendiri di server. Supervisor memanggil mereka,
        lalu menilai apakah mereka benar-benar jalan, berhasil, dan hasilnya
        masuk akal. Tidak perlu ada yang membuka aplikasi ini.
      </p>

      <section>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={jalankanSemua} disabled={sedangJalan || sedangMuat}>
            {sedangJalan ? 'Menjalankan...' : 'Jalankan semua agent'}
          </button>
          <button onClick={muat} disabled={sedangMuat}>Muat ulang</button>
          <button onClick={() => setBukaRiwayat((v) => !v)}>
            {bukaRiwayat ? 'Sembunyikan riwayat' : 'Lihat riwayat kerja'}
          </button>
        </div>
      </section>

      {galat && <p className="message warn">{galat}</p>}
      {catatan && <p className="message ok">{catatan}</p>}

      {sedangMuat && <p className="muted">Memuat...</p>}

      {!sedangMuat && agent.length > 0 && (
        <p className={bermasalah.length > 0 ? 'message warn' : 'message ok'}>
          {bermasalah.length === 0
            ? 'Semua agent jalan. Total temuan sejam ini: ' + totalTemuan + '.'
            : bermasalah.length + ' agent perlu dilihat: ' +
              bermasalah.map((a) => a.nama).join(', ') + '.'}
        </p>
      )}

      {!sedangMuat && agent.map((a) => {
        const w = WARNA[a.status] || { label: a.status, cls: 'muted' };
        return (
          <section key={a.kode}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>{a.nama}</h3>
              <span className={'badge ' + w.cls}>{w.label}</span>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>{a.tugas}</p>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <td style={{ width: 160 }}>Jadwal</td>
                    <td>
                      {JADWAL_BACA[a.frekuensi] || a.freqensi}
                      {a.jadwal ? ' (UTC ' + a.jadwal + ')' : ''}
                    </td>
                  </tr>
                  <tr>
                    <td>Terakhir jalan</td>
                    <td>{jamWita(a.dijalankan)}</td>
                  </tr>
                  <tr>
                    <td>Lama</td>
                    <td>{a.durasi_ms == null ? '-' : a.durasi_ms + ' ms'}</td>
                  </tr>
                  <tr>
                    <td>Temuan</td>
                    <td>
                      <strong style={{ fontSize: 18 }}>{a.temuan ?? '-'}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Hasil</td>
                    <td>{a.pesan || '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {bukaRiwayat && (
        <section>
          <h3>Riwayat kerja</h3>
          {riwayat.length === 0 ? (
            <p className="muted">Belum ada riwayat.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Waktu</th>
                    <th>Status</th>
                    <th>Temuan</th>
                    <th>Hasil</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat.map((r, i) => (
                    <tr key={i}>
                      <td>{r.agent}</td>
                      <td className="muted">{jamWita(r.selesai || r.mulai)}</td>
                      <td>{r.status}</td>
                      <td>{r.temuan}</td>
                      <td className="muted">{r.pesan || '-'}</td>
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
          Agent adalah program dengan aturan, bukan AI yang berpikir. Semuanya
          bisa ditelusuri ke query yang dipakai, dan tidak ada yang mengubah
          data tanpa disengaja.
        </p>
      </section>
    </div>
  );
}
