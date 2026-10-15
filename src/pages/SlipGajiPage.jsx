import { useMemo, useState } from 'react';
import { getPayslip } from '../lib/reportService';
import { OUTLETS } from '../lib/constants';
import { exportExcelReport } from '../lib/excelExport';

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

const baris = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const tombolAksi = { width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' };
const separator = { fontSize: 12, color: 'var(--text-secondary)' };
const hint = { fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' };

// Nama kolom mengikuti format slip gaji: total komisi, tabungan 30%, bersih.
function labelPeriode(p) {
  if (!POLA_TANGGAL.test(p.startDate) || !POLA_TANGGAL.test(p.endDate)) return 'PERIODE';
  const hari = (d) => d.slice(8, 10);
  if (p.startDate === p.endDate) return hari(p.startDate);
  return `${hari(p.startDate)}-${hari(p.endDate)}`;
}

export default function SlipGajiPage() {
  const [periode, setPeriode] = useState({ startDate: '', endDate: '' });
  const [outletId, setOutletId] = useState('');
  const [sertakanNol, setSertakanNol] = useState(false);

  const [data, setData] = useState(null);
  const [sedangMuat, setSedangMuat] = useState(false);
  const [galat, setGalat] = useState('');
  const [sudahHitung, setSudahHitung] = useState(false);

  const kolomPeriode = useMemo(() => labelPeriode(periode), [periode]);

  const cekTanggal = (p) => {
    if (!POLA_TANGGAL.test(p.startDate) || !POLA_TANGGAL.test(p.endDate)) return false;
    return p.startDate <= p.endDate;
  };

  const bolehHitung = cekTanggal(periode);

  const muat = async () => {
    if (!bolehHitung) {
      setGalat('Tanggal belum benar. Isi tanggal awal lalu tanggal akhir.');
      return;
    }
    setSedangMuat(true);
    setGalat('');
    try {
      const hasil = await getPayslip(periode, outletId);
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
    const headers = ['NAMA', 'TOTAL KOMISI', 'TAB 30%', 'TOTAL', 'POTONGAN', 'KOMISI BERSIH'];

    // Potongan dibiarkan kosong supaya bisa diisi sendiri di Excel; kolom TOTAL
    // dan KOMISI BERSIH sengaja tetap terisi agar angkanya tidak berubah sendiri.
    const isi = barisTampil.map((r) => [
      r.therapistName,
      r.totalKomisi,
      r.tabungan30,
      r.totalKomisi - r.tabungan30,
      0,
      r.komisiBersih
    ]);
    if (isi.length) {
      isi.push([
        'TOTAL',
        data.total.totalKomisi,
        data.total.tabungan30,
        data.total.totalKomisi - data.total.tabungan30,
        0,
        data.total.komisiBersih
      ]);
    }

    const namaOutlet = outletId ? (OUTLETS.find((o) => o.id === outletId)?.name || outletId) : 'Semua Outlet';
    exportExcelReport({
      filename: `Slip-Gaji-${kolomPeriode}-${outletId || 'Semua-Outlet'}`,
      title: `SLIP GAJI ${kolomPeriode}`,
      subtitle: namaOutlet,
      headers,
      rows: isi,
      currencyColumns: [1, 2, 3, 4, 5],
      totalRowIndex: isi.length ? isi.length - 1 : undefined,
      sheetName: `Komisi ${kolomPeriode}`,
      note: 'Tabungan 30% dihitung otomatis. Isi kolom POTONGAN sendiri bila ada potongan lain.'
    });
  };

  const rp = (n) => 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');

  return (
    <div className="kasir-page">
      <h2>Slip Gaji</h2>
      <p className="muted">
        Rekap komisi terapis pada satu periode, lalu dipotong tabungan 30%.
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
        <p>Periode</p>
        <div style={baris}>
          <input
            type="date"
            value={periode.startDate}
            max={periode.endDate || undefined}
            onChange={(e) => setPeriode({ ...periode, startDate: e.target.value })}
          />
          <span style={separator}>s/d</span>
          <input
            type="date"
            value={periode.endDate}
            min={periode.startDate || undefined}
            onChange={(e) => setPeriode({ ...periode, endDate: e.target.value })}
          />
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
          <span style={hint}>periode: {kolomPeriode}</span>
        </div>
      </section>

      {galat && <p className="message warn">{galat}</p>}

      {data && (
        <>
          <section className="summary-chips">
            <span className="chip">Terapis {data.total.jumlahTerapis}</span>
            <span className="chip">Treatment {data.total.jumlahTreatment}</span>
            <span className="chip">Total komisi {rp(data.total.totalKomisi)}</span>
            <span className="chip chip-warn">Tabungan 30% {rp(data.total.tabungan30)}</span>
            <span className="chip chip-purple">Komisi bersih {rp(data.total.komisiBersih)}</span>
          </section>

          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>NAMA</th>
                  <th>TREATMENT</th>
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
                    <td>{r.jumlahTreatment}</td>
                    <td><strong>{rp(r.totalKomisi)}</strong></td>
                    <td>{rp(r.tabungan30)}</td>
                    <td>{rp(r.totalKomisi - r.tabungan30)}</td>
                    <td>Rp -</td>
                    <td><strong>{rp(r.komisiBersih)}</strong></td>
                  </tr>
                ))}
                {barisTampil.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">Tidak ada komisi pada periode ini.</td>
                  </tr>
                )}
              </tbody>
              {barisTampil.length > 0 && (
                <tfoot>
                  <tr>
                    <th>TOTAL</th>
                    <th>{data.total.jumlahTreatment}</th>
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
        <p className="message warn">Tidak ada transaksi pada periode ini.</p>
      )}
    </div>
  );
}