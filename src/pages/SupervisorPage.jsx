import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const WARNA = {
  jalan: { label: 'Jalan', cls: 'ok' },
  terlambat: { label: 'Terlambat', cls: 'warn' },
  gagal: { label: 'Gagal', cls: 'danger' },
  belum: { label: 'Belum pernah jalan', cls: 'danger' },
  nonaktif: { label: 'Nonaktif', cls: 'muted' }
};

const BERAT = { tinggi: 'danger', sedang: 'warn', rendah: 'muted' };

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
  const [daftar, setDaftar] = useState([]);
  const [terpilih, setTerpilih] = useState(null);
  const [riwayat, setRiwayat] = useState([]);
  const [temuan, setTemuan] = useState([]);
  const [semuaRiwayat, setSemuaRiwayat] = useState([]);
  const [sedangMuat, setSedangMuat] = useState(true);
  const [sedangJalan, setSedangJalan] = useState(false);
  const [galat, setGalat] = useState('');
  const [catatan, setCatatan] = useState('');

  const muat = useCallback(async (pilihan) => {
    setSedangMuat(true);
    setGalat('');
    try {
      const [a, r, f] = await Promise.all([
        supabase.rpc('supervisor_ringkasan'),
        supabase.rpc('supervisor_riwayat', { jumlah: 60 }),
        supabase.rpc('ringkasan_pemeriksaan')
      ]);
      if (a.error) throw new Error(a.error.message);
      if (r.error) throw new Error(r.error.message);
      if (f.error) throw new Error(f.error.message);

      setDaftar(a.data || []);
      setSemuaRiwayat(r.data || []);
      setTemuan(f.data || []);
      setTerpilih((sebelumnya) =>
        sebelumnya || (a.data && a.data.length ? a.data[0].kode : null)
      );
    } catch (e) {
      setGalat('Gagal memuat: ' + (e.message || e));
    } finally {
      setSedangMuat(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  // Riwayat agent yang sedang dibuka diambil terpisah supaya daftar utama
  // tidak ikut berubah setiap kali pindah agent.
  useEffect(() => {
    if (!terpilih) return;
    supabase
      .rpc('supervisor_riwayat_agent', { p_agent: terpilih, p_jumlah: 20 })
      .then(({ data, error }) => {
        if (error) setGalat('Gagal memuat riwayat: ' + error.message);
        else setRiwayat(data || []);
      });
  }, [terpilih, semuaRiwayat]);

  const jalankanSemua = async () => {
    setSedangJalan(true);
    setGalat('');
    setCatatan('');
    try {
      // Urutan penting: supervisor jalan paling akhir supaya menilai
      // pekerjaan agent lain yang barusan selesai.
      for (const nama of ['arsip', 'keamanan', 'kesalahan', 'pemeriksa_rekan']) {
        const { error } = await supabase.rpc('agent_' + nama);
        if (error) throw new Error(nama + ': ' + error.message);
      }
      setCatatan('Agent yang bisa dijalankan dari sini sudah selesai.');
      await muat(terpilih);
    } catch (e) {
      setGalat('Gagal: ' + (e.message || e));
    } finally {
      setSedangJalan(false);
    }
  };

  const agent = useMemo(
    () => daftar.find((a) => a.kode === terpilih) || null,
    [daftar, terpilih]
  );

  const temuanAgent = useMemo(
    () =>
      temuan
        .filter((t) => t.agent === terpilih)
        .sort((a, b) => {
          const urut = { tinggi: 0, sedang: 1, rendah: 2 };
          return (urut[a.berat] ?? 9) - (urut[b.berat] ?? 9) || b.total - a.total;
        }),
    [temuan, terpilih]
  );

  const bermasalah = daftar.filter(
    (a) => a.status !== 'jalan' && a.status !== 'nonaktif'
  );

  return (
    <div className="kasir-page">
      <h2>Supervisor</h2>
      <p className="muted">
        Lima agent bekerja sendiri di server. Klik salah satu untuk melihat
        rincian pekerjaannya.
      </p>

      <section>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={jalankanSemua} disabled={sedangJalan || sedangMuat}>
            {sedangJalan ? 'Menjalankan...' : 'Jalankan agent yang bisa dari sini'}
          </button>
          <button onClick={() => muat(terpilih)} disabled={sedangMuat}>Muat ulang</button>
        </div>
      </section>

      {galat && <p className="message warn">{galat}</p>}
      {catatan && <p className="message ok">{catatan}</p>}
      {bermasalah.length > 0 && !sedangMuat && (
        <p className="message warn">
          {bermasalah.length + ' agent perlu dilihat: ' +
            bermasalah.map((a) => a.nama).join(', ') + '.'}
        </p>
      )}

      {sedangMuat && <p className="muted">Memuat...</p>}

      {!sedangMuat && (
        <>
          {/* ---- pilihan agent ---- */}
          <section>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 10
              }}
            >
              {daftar.map((a) => {
                const w = WARNA[a.status] || { label: a.status, cls: 'muted' };
                const aktif = a.kode === terpilih;
                return (
                  <button
                    key={a.kode}
                    onClick={() => setTerpilih(a.kode)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 10,
                      border: aktif
                        ? '2px solid var(--accent, #2563eb)'
                        : '1px solid var(--border, #ddd)',
                      background: aktif ? 'rgba(37,99,235,.07)' : 'transparent',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {a.nama.replace('Agent ', '')}
                    </div>
                    <span className={'badge ' + w.cls}>{w.label}</span>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                      {a.temuan ?? '-'}
                      <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 5 }}>
                        temuan
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {jamWita(a.dijalankan)}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- rincian agent yang dipilih ---- */}
          {agent && (
            <section>
              <h3>{agent.nama}</h3>
              <p className="muted">{agent.tugas}</p>

              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <td style={{ width: 160 }}>Status</td>
                      <td>
                        <span className={'badge ' + (WARNA[agent.status]?.cls || '')}>
                          {WARNA[agent.status]?.label || agent.status}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>Jadwal</td>
                      <td>
                        {JADWAL_BACA[agent.frekuensi] || agent.frekuensi}
                        {agent.jadwal ? ' (' + agent.jadwal + ')' : ''}
                      </td>
                    </tr>
                    <tr>
                      <td>Terakhir jalan</td>
                      <td>{jamWita(agent.dijalankan)}</td>
                    </tr>
                    <tr>
                      <td>Lama</td>
                      <td>{agent.durasi_ms == null ? '-' : agent.durasi_ms + ' ms'}</td>
                    </tr>
                    <tr>
                      <td>Hasil terakhir</td>
                      <td>{agent.pesan || '-'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ---- temuan milik agent ini ---- */}
          {agent && (
            <section>
              <h4>Temuan {agent.nama.replace('Agent ', '')}</h4>
              {temuanAgent.length === 0 ? (
                <p className="message ok">
                  Tidak ada temuan. Yang diperiksa agent ini semuanya lolos.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Masalah</th>
                        <th>Level</th>
                        <th>Jumlah</th>
                        <th>Contoh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {temuanAgent.map((t) => (
                        <tr key={t.agent + t.kode}>
                          <td>
                            <strong>{t.judul}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {t.keterangan}
                            </div>
                          </td>
                          <td>
                            <span className={'badge ' + (BERAT[t.berat] || 'muted')}>
                              {t.berat}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700 }}>{t.total}</td>
                          <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>
                            {t.contoh || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ---- riwayat kerja agent ini ---- */}
          {agent && (
            <section>
              <h4>Riwayat kerja {agent.nama.replace('Agent ', '')}</h4>
              {riwayat.length === 0 ? (
                <p className="muted">Belum ada riwayat untuk agent ini.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu</th>
                        <th>Status</th>
                        <th>Temuan</th>
                        <th>Lama</th>
                        <th>Hasil</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riwayat.map((r, i) => (
                        <tr key={i}>
                          <td className="muted">{jamWita(r.selesai || r.mulai)}</td>
                          <td>{r.status}</td>
                          <td style={{ fontWeight: 700 }}>{r.temuan}</td>
                          <td className="muted">
                            {r.durasi_ms == null ? '-' : r.durasi_ms + ' ms'}
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {r.pesan || '-'}
                            {r.rincian && Object.keys(r.rincian).length > 0 && (
                              <div style={{ fontSize: 11, marginTop: 2 }}>
                                {Object.entries(r.rincian)
                                  .filter(([k]) => k !== 'catatan')
                                  .map(([k, v]) => k + ': ' + String(v))
                                  .join('  ')}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ---- semua agent berdampingan, untuk 비교 cepat ---- */}
          <section>
            <h4>Semua agent</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Terakhir jalan</th>
                    <th>Temuan</th>
                  </tr>
                </thead>
                <tbody>
                  {daftar.map((a) => (
                    <tr key={a.kode}>
                      <td>
                        <button
                          onClick={() => setTerpilih(a.kode)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'inherit',
                            textDecoration: 'underline'
                          }}
                        >
                          {a.nama}
                        </button>
                      </td>
                      <td>
                        <span className={'badge ' + (WARNA[a.status]?.cls || '')}>
                          {WARNA[a.status]?.label || a.status}
                        </span>
                      </td>
                      <td className="muted">{jamWita(a.dijalankan)}</td>
                      <td style={{ fontWeight: 700 }}>{a.temuan ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section>
        <p className="muted" style={{ fontSize: 12 }}>
          Agent adalah program dengan aturan, bukan AI yang berpikir. Semuanya
          bisa ditelusuri ke query yang dipakai. Agent Arsip Disk berjalan di
          komputer ini tiap malam pukul 01:30, jadi tidak bisa dijalankan dari
          halaman ini.
        </p>
      </section>
    </div>
  );
}
