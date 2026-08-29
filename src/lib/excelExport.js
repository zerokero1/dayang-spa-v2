import ExcelJS from 'exceljs';

/**
 * Export laporan ke file Excel (.xlsx) dengan format rapi:
 * judul di atas, header tabel tebal berwarna, border, dan format angka
 * ribuan otomatis untuk kolom yang ditandai.
 *
 * @param {string} filename - nama file (tanpa .xlsx, ditambahkan otomatis)
 * @param {string} title - judul laporan di baris paling atas
 * @param {string} subtitle - sub-judul (mis. tanggal/outlet)
 * @param {string[]} headers - nama kolom
 * @param {Array<Array>} rows - data baris (array of array, urut sesuai headers)
 * @param {number[]} currencyColumns - index kolom (0-based) yang diformat sebagai angka ribuan
 * @param {number} totalRowIndex - index baris (0-based dari rows) yang ditandai sebagai baris total (ditebalkan)
 */
export async function exportExcelReport({
  filename, title, subtitle, headers, rows, currencyColumns = [], totalRowIndex
}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Laporan');

  sheet.mergeCells(1, 1, 1, headers.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF0F6E56' } };
  titleCell.alignment = { horizontal: 'center' };

  let headerRowNum = 3;
  if (subtitle) {
    sheet.mergeCells(2, 1, 2, headers.length);
    const subCell = sheet.getCell(2, 1);
    subCell.value = subtitle;
    subCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    subCell.alignment = { horizontal: 'center' };
    headerRowNum = 4;
  }

  const headerRow = sheet.getRow(headerRowNum);
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6E56' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  headerRow.height = 20;

  rows.forEach((r, idx) => {
    const row = sheet.addRow(r);
    const isTotal = totalRowIndex !== undefined && idx === totalRowIndex;
    row.eachCell((cell, colNumber) => {
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      if (currencyColumns.includes(colNumber - 1)) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
      if (isTotal) {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F3EF' } };
      }
    });
  });

  headers.forEach((h, i) => {
    const maxContentLen = Math.max(
      h.length,
      ...rows.map((r) => String(r[i] ?? '').length)
    );
    sheet.getColumn(i + 1).width = Math.max(12, Math.min(35, maxContentLen + 4));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
