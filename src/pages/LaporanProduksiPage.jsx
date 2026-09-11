import { useEffect, useState } from 'react';
import ExcelJS from 'exceljs';
import { OUTLETS } from '../lib/constants';
import { getProductionBookings, buildProductionReport } from '../lib/reportService';

function todayId() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

export default function LaporanProduksiPage({ profile }) {
  const isKasir = profile?.role === 'kasir';
  const cols = isKasir ? OUTLETS.filter((o) => o.id === profile.outletId) : OUTLETS;
  const colIds = cols.map((o) => o.id);

  const [startDate, setStartDate] = useState(todayId());
  const [endDate, setEndDate] = useState(todayId());
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  const rangeLabel = startDate === endDate ? startDate : `${startDate} s/d ${endDate}`;

  async function load() {
    setLoading(true);
    try {
      const rows = await getProductionBookings(startDate, endDate);
      setReport(buildProductionReport(rows, colIds));
    } catch (e) {
      alert('Gagal memuat laporan: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <section style={{ marginTop: 18, overflow: 'auto' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <table className="summary-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
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
      </section>
    );
  }

  async function handleDownload() {
    if (!report) { alert('Tampilkan laporan dulu.'); return; }

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
  }

  return (
    <div className="kasir-page">
      <h2>Laporan Produksi</h2>

      <section>
        <p>Rentang tanggal</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        {isKasir && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Kasir hanya melihat laporan outlet sendiri.
          </p>
        )}
      </section>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={load} disabled={loading}>
          {loading ? 'Memuat...' : 'Tampilkan'}
        </button>
        <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={handleDownload}>
          ⬇ Ekspor Excel
        </button>
      </div>

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