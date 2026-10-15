import { useMemo, useState } from 'react';
import { getPayslip } from '../lib/reportService';
import { OUTLETS } from '../lib/constants';
import { exportExcelReport } from '../lib/excelExport';

const baris = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const tombolAksi = { width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' };
const separator = { fontSize: 12, color: 'var(--text-secondary)' };
const hint = { fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' };

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
// Nama kolom mengikuti format slip gaji: periode 1, periode 2, totalnya.
function labelPeriode(p) {
  if (!POLA_TANGGAL.test(p.startDate) || !POLA_TANGGAL.test(p.endDate)) return 'PERIODE';
  const singkas = (d) => d.slice(8, 10);
  if (p.startDate === p.endDate) return singkas(p.startDate);
  return `${singkas(p.startDate)}-${singkas(p.endDate)}`;
}

export default function SlipGajiPage() {
  const [periodeA, setPeriodeA] = useState({ startDate: '', endDate: '' });
  const [periodeB, setPeriodeB] = useState({ startDate: '', endDate: '' });
  const [outletId, setOutletId] = useState('');
  const [sertakanNol, setSertakanNol] = useState(false);

  const [data, setData] = useState(null);
  const [sedangMuat, setSedangMuat] = useState(false);
  const [galat, setGalat] = useState('');
  const [sudahHitung, setSudahHitung] = useState(false);

  const kolomA = useMemo(() => labelPeriode(periodeA), [periodeA]);
  const kolomB = useMemo(() => labelPeriode(periodeB), [periodeB]);

  const cekTanggal = (p) => {
    if (!POLA_TANGGAL.test(p.startDate) || !POLA_TANGGAL.test(p.endDate)) return false;
    return p.startDate <= p.endDate;
  };

  const bolehHitung = cekTanggal(periodeA) && cekTanggal(periodeB);

  const pesanGalat = () => {
    if (!cekTanggal(periodeA)) return 'Periode 1 belum benar. Urutannya harus tanggal awal lalu tanggal akhir.';
    if (!cekTanggal(periodeB)) return 'Periode 2 belum benar. Urutannya harus tanggal awal lalu tanggal akhir.';
    return '';
  };

  const muat = async () => {
    const p = pesanGalat();
    if (p) { setGalat(p); return; }
    setSedangMuat(true);
    setGalat('');
    try {
      const hasil = await getPayslip(periodeA, periodeB, outletId);
      setData(hasil);
      setSudahHitung(true);
    } catch (e) {
      setGalat('Gagal memuat data: ' + (e.message || e));
      setData(null);
      setSudahHitung(false);
    } finally {
      setSedangMuat(false);
    }
  };

  const barisTampil = useMemo(() => {
    if (!data) return [];
    return sertakanNol ? data.rows : data.rows.filter((r) => r.totalKomisi !== 0);
  }, [data, sertakanNol]);

  const unduh = () => {
    if (!data) return;
    const headers = [
      'NAMA', `KOMISI ${kolomA}`, `KOMISI ${kolomB}`,
      'TOTAL KOMISI', 'TAB 30%', 'TOTAL', 'POTONGAN', 'KOMISI BERSIH'
    ];
    // Potongan dibiarkan kosong supaya bisa diisi sendiri di Excel; kolom TOTAL
    // dan KOMISI BERSIH sengaja tetap terisi agar angkanya tidak berubah sendiri.
    const baris = barisTampil.map((r) => [
      r.therapistName, r.komisiA, r.komisiB, r.totalKomisi,
      r.tabungan30, r.totalKomisi - r.tabungan30, 0, r.komisiBersih
    ]);
    if (baris.length) {
      baris.push([
        'TOTAL', data.total.komisiA, data.total.komisiB, data.total.totalKomisi,
        data.total.tabungan30, data.total.totalKomisi - data.total.tabungan30, 0, data.total.komisiBersih
      ]);
    }

    const namaOutlet = outletId ? (OUTLETS.find((o) => o.id === outletId)?.name || outletId) : 'Semua Outlet';
    exportExcelReport({
      filename: `Slip-Gaji-${kolomA}-${kolomB}-${outletId || 'Semua-Outlet'}`,
      title: `SLIP GAJI ${kolomA} - ${kolomB}`,
      subtitle: namaOutlet,
      headers,
      rows: baris,
      currencyColumns: [1, 2, 3, 4, 5, 6, 7],
      totalRowIndex: baris.length ? baris.length - 1 : undefined,
      sheetName: `Komisi ${kolomA}-${kolomB}`,
      note: 'Tabungan 30% dihitung otomatis. Isi kolom POTONGAN sendiri bila ada potongan lain.'
    });
  };

  const rp = (n) => 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');

return (
    <div className="kasir-page">
      <h2>Slip Gaji</h2>
      <p className="muted">
        Rekap komisi terapis untuk dua periode, lalu dipotong tabungan 30%.
        Tabungan dihitung otomatis dari total komisi. Kolom
        <strong> Potongan</strong> sengaja dikosongkan supaya bisa diisi sendiri
        di Excel.
      </p>

      <section>
        <p>Outlet</p>
        <div className="grid-2">
          <button
            className={outletId === '' ? 'active' : ''}
            onClick={() => setOutletId('')}
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
      </section>

      <section>
        <p>Periode 1</p>
        <div style={baris}>
          <input
            type="date"
            value={periodeA.startDate}
            max={periodeA.endDate || undefined}
            onChange={(e) => setPeriodeA({ ...periodeA, startDate: e.target.value })}
          />
          <span style={separator}>s/d</span>
          <input
            type="date"
            value={periodeA.endDate}
            min={periodeA.startDate || undefined}
            onChange={(e) => setPeriodeA({ ...periodeA, endDate: e.target.value })}
          />
          <span style={hint}>kolom: {kolomA}</span>
        </div>
      </section>

      <section>
        <p>Periode 2</p>
        <div style={baris}>
          <input
            type="date"
            value={periodeB.startDate}
            max={periodeB.endDate || undefined}
            onChange={(e) => setPeriodeB({ ...periodeB, startDate: e.target.value })}
          />
          <span style={separator}>s/d</span>
          <input
            type="date"
            value={periodeB.endDate}
            min={periodeB.startDate || undefined}
            onChange={(e) => setPeriodeB({ ...periodeB, endDate: e.target.value })}
          />
          <span style={hint}>kolom: {kolomB}</span>
        </div>
      </section>

      <section>
        <div style={baris}>
          <button style={tombolAksi} onClick={muat} disabled={sedangMuat || !bolehHitung}>
            {sedangMuat ? 'Menghitung...' : 'Hitung Slip'}
          </button>
          <button style={tombolAksi} onClick={unduh} disabled={!data}>
            Unduh Excel
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={sertakanNol}
              onChange={(e) => setSertakanNol(e.target.checked)}
            />
            Sertakan terapis tanpa komisi
          </label>
        </div>
      </section>

      {galat && <p className="message warn">{galat}</p>}

      {data && (
        <>
          <section className="summary-chips">
            <span className="chip">Terapis {data.total.jumlahTerapis}</span>
            <span className="chip">Total komisi {rp(data.total.totalKomisi)}</span>
            <span className="chip chip-warn">Tabungan 30% {rp(data.total.tabungan30)}</span>
            <span className="chip chip-purple">Komisi bersih {rp(data.total.komisiBersih)}</span>
          </section>

          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>NAMA</th>
                  <th>KOMISI {kolomA}</th>
                  <th>KOMISI {kolomB}</th>
                  <th>TOTAL KOMISI</th>
                  <th>TAB 30%</th>
                  <th>TOTAL</th>
                  <th>POTONGAN</th>
                  <th>KOMISI BERSIH</th>
                </tr>
              </thead>
              <tbody>
                {barisTampil.map((r) => (
                  <tr key={r.therapistId}>
                    <td>{r.therapistName}</td>
                    <td>{rp(r.komisiA)}</td>
                    <td>{rp(r.komisiB)}</td>
                    <td><strong>{rp(r.totalKomisi)}</strong></td>
                    <td>{rp(r.tabungan30)}</td>
                    <td>{rp(r.totalKomisi - r.tabungan30)}</td>
                    <td>Rp -</td>
                    <td><strong>{rp(r.komisiBersih)}</strong></td>
                  </tr>
                ))}
                {barisTampil.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">Tidak ada komisi pada periode ini.</td>
                  </tr>
                )}
              </tbody>
              {barisTampil.length > 0 && (
                <tfoot>
                  <tr>
                    <th>TOTAL</th>
                    <th>{rp(data.total.komisiA)}</th>
                    <th>{rp(data.total.komisiB)}</th>
                    <th>{rp(data.total.totalKomisi)}</th>
                    <th>{rp(data.total.tabungan30)}</th>
                    <th>{rp(data.total.totalKomisi - data.total.tabungan30)}</th>
                    <th>Rp -</th>
                    <th>{rp(data.total.komisiBersih)}</th>
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
        </>
      )}

      {sudahHitung && data && data.rows.length === 0 && (
        <p className="message warn">Tidak ada transaksi pada kedua periode.</p>
      )}
    </div>
  );
}