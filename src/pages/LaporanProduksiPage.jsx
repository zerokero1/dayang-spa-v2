import { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { OUTLETS } from '../lib/constants';
import { getProductionBookings, buildProductionReport } from '../lib/reportService';
import { businessDate } from '../lib/businessDate';
import { notifyError, notifySuccess } from '../lib/notifications';
import RentangTanggal from '../components/RentangTanggal';

export default function LaporanProduksiPage({ profile }) {
  const isKasir = profile?.role === 'kasir';
  const cols = isKasir ? OUTLETS.filter((o) => o.id === profile.outletId) : OUTLETS;
  const colIds = cols.map((o) => o.id);

  const [startDate, setStartDate] = useState(businessDate());
  const [endDate, setEndDate] = useState(businessDate());
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const rangeLabel = startDate === endDate ? startDate : `${startDate} s/d ${endDate}`;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const rows = await getProductionBookings(startDate, endDate);
      setReport(buildProductionReport(rows, colIds));
    } catch (e) {
      console.error('gagal memuat laporan produksi', e);
      setError('Gagal memuat laporan produksi. Periksa koneksi lalu coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  // Interval 60 detik harus memakai rentang yang sedang dipilih, bukan rentang
  // saat halaman pertama dibuka.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
  }, [startDate, endDate]);

  useEffect(() => {
    const timer = setInterval(() => loadRef.current(), 60000);
    return () => clearInterval(timer);
  }, []);

  const headers = ['Ket.', ...cols.map((o) => o.name), 'TOTAL'];

  const treatmentRows = (report?.byTreatment || []).map((r) => [
    r.label,
    ...cols.map((o) => r.perOutlet[o.id] || 0),
    r.total
  ]);
  const oilRows = (report?.byOil || []).map((r) => [
    r.label,
    ...cols.map((o) => r.perOutlet[o.id] || 0),
    r.total
  ]);
  const dateTreatmentRows = (report?.dateRows || []).map((d) => [
    d.date,
    ...cols.map((o) => d.treatmentPerOutlet[o.id] || 0),
    d.treatmentTotal
  ]);
  const dateOilRows = (report?.dateRows || []).map((d) => [
    d.date,
    ...cols.map((o) => d.oilPerOutlet[o.id] || 0),
    d.oilTotal
  ]);

  function renderTable(title, h, rows, totalIdx) {
    return (
      <section style={{ marginTop: 18 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="table-wrap table-wrap--report" style={{ marginTop: 8 }}>
          <table className="summary-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {h.map((c, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: 8, whiteSpace: 'nowrap' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={h.length} style={{ padding: 10, color: 'var(--text-secondary)' }}>Tidak ada data untuk rentang ini.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} style={totalIdx === i ? { fontWeight: 800 } : {}}>
                  {r.map((c, j) => (
                    <td key={j} style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  async function handleDownload() {
    if (!report) {
      setError('Tampilkan laporan dulu sebelum mengunduh.');
      return;
    }

    try {
      const wb = new ExcelJS.Workbook();
      const addSheet = (name, title, rows, numericCols) => {
        const sh = wb.addWorksheet(name);
        sh.mergeCells(1, 1, 1, headers.length);
        const t = sh.getCell(1, 1);
        t.value = title;
        t.font = { bold: true, size: 14, color: { argb: 'FF0F6E56' } };
        sh.mergeCells(2, 1, 2, headers.length);
        const s = sh.getCell(2, 1);
        s.value = rangeLabel;
        s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
        const hr = sh.getRow(4);
        headers.forEach((h, i) => { hr.getCell(i + 1).value = h; });
        hr.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6E56' } };
        });
        rows.forEach((r) => {
          const row = sh.addRow(r);
          row.eachCell((cell, colNumber) => {
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (numericCols.includes(colNumber - 1)) {
              cell.numFmt = '#,##0';
              cell.alignment = { horizontal: 'right' };
            }
          });
        });
      };

      const cleanNum = (s) => (s == null ? 0 : Number(String(s).replace(/[^\d]/g, '')));
      const numCols = cols.map((_, i) => i + 1); // semua kolom outlet + TOTAL

      addSheet('Treatment', 'Jumlah Treatment per Jenis', treatmentRows.map((r) => [r[0], ...r.slice(1).map(cleanNum)]), numCols);
      addSheet('Minyak', 'Pemakaian Minyak (botol)', oilRows.map((r) => [r[0], ...r.slice(1).map(cleanNum)]), numCols);
      addSheet('perTanggal', 'Treatment per Tanggal', dateTreatmentRows.map((r) => [r[0], ...r.slice(1).map(cleanNum)]), numCols);
      addSheet('perTanggalMinyak', 'Minyak per Tanggal (botol)', dateOilRows.map((r) => [r[0], ...r.slice(1).map(cleanNum)]), numCols);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Laporan-Produksi-${startDate}_${endDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      notifySuccess('Laporan produksi berhasil diunduh.');
    } catch {
      notifyError('Gagal mengunduh laporan produksi.');
    }
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Produksi</h2>

      <RentangTanggal
        startDate={startDate}
        endDate={endDate}
        onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
        hint={`Periode ${rangeLabel}${isKasir ? ' · kasir hanya melihat outlet sendiri' : ''}`}
      >
        <div className="rentang-actions">
          <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat ulang'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={handleDownload}>
            ⬇ Ekspor Excel
          </button>
        </div>
      </RentangTanggal>

      {error && <p className="message warn">{error}</p>}

      {report && (
        <>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary-dark)' }}>{report.totalTreatment}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Treatment</div>
            </div>
            <div className="oil-card" style={{ textAlign: 'center', padding: 14 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--busy)' }}>{report.totalOilBottles} botol</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Minyak Terpakai</div>
            </div>
          </div>

          {renderTable('Jumlah Treatment per Jenis', headers, treatmentRows, -1)}
          {renderTable('Pemakaian Minyak per Jenis (botol)', headers, oilRows, -1)}
          {renderTable('Rincian per Tanggal — Jumlah Treatment', headers, dateTreatmentRows, -1)}
          {renderTable('Rincian per Tanggal — Minyak (botol)', headers, dateOilRows, -1)}
        </>
      )}
    </div>
  );
}