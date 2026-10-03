import ExcelJS from 'exceljs';

// Warna brand — satu-satunya palet yang dipakai semua laporan.
const BRAND = 'FF0F6E56';
const BRAND_LIGHT = 'FFE6F3EF';
const MUTED = 'FF6B7280';

// Nama sheet Excel maksimal 31 karakter dan tidak boleh mengandung
// : \ / ? * [ ]. Sanitize supaya laporan tidak gagal di-download.
function safeSheetName(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[:\\/?*[\]]/g, '-')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

const thinBorder = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' }
};

/**
 * Normalisasi spec jadi daftar tabel. Format lama (headers/rows di level atas)
 * tetap didukung supaya exportExcelReport tidak berubah sama sekali; format
 * baru pakai `sections` untuk menyatukan beberapa tabel ke satu worksheet.
 */
function normalizeSections(spec) {
  const pick = (s) => ({
    title: s.title || '',
    headers: s.headers || [],
    rows: s.rows || [],
    currencyColumns: s.currencyColumns || [],
    totalRowIndex: s.totalRowIndex,
    note: s.note || ''
  });
  if (Array.isArray(spec.sections) && spec.sections.length) {
    return spec.sections.map(pick);
  }
  // Format lama: judul sheet sudah ditulis di baris 1 dan catatan kaki ditulis
  // di akhir sheet, jadi tabelnya tidak boleh membawa judul/catatan sendiri
  // (kalau tidak keduanya tampil dua kali).
  const one = pick(spec);
  return [{ ...one, title: '', note: '' }];
}

/**
 * Tulis satu worksheet dengan format standar laporan:
 * judul, sub-judul, header tebal berwarna hijau, border, baris total ditebalkan.
 *
 * Dua mode, keduanya lewat fungsi ini supaya format tidak pernah berbeda:
 *  - satu tabel  : headers/rows di level atas (dipakai exportExcelReport)
 *  - banyak tabel: `sections`, tiap tabel punya judul sendiri di sheet yang sama
 *                  (dipakai Buku Laporan: 1 sheet = 1 kelompok laporan)
 */
function writeSheet(workbook, spec, index) {
  const { title, subtitle, sheetName } = spec;
  const sections = normalizeSections(spec);

  const sheet = workbook.addWorksheet(safeSheetName(sheetName, `Sheet${index + 1}`));
  const colCount = Math.max(1, ...sections.map((s) => s.headers.length || 1));
  const cur = () => sheet.rowCount + 1;
  // mergeCells ikut membuat sel sehingga rowCount bertambah. Nomor baris harus
  // dikunci SEBELUM merge, kalau tidak setiap penulisan meleset satu baris ke bawah.
  const putMerged = (row, value, style) => {
    sheet.mergeCells(row, 1, row, colCount);
    const c = sheet.getCell(row, 1);
    c.value = value;
    Object.assign(c, style);
    return c;
  };

  putMerged(cur(), title || '', {
    font: { bold: true, size: 14, color: { argb: BRAND } },
    alignment: { horizontal: 'center' }
  });

  if (subtitle) {
    putMerged(cur(), subtitle, {
      font: { italic: true, size: 10, color: { argb: MUTED } },
      alignment: { horizontal: 'center' }
    });
  }

  let firstHeaderRow = null;

  sections.forEach((sec, secIdx) => {
    if (secIdx > 0) {
      const spacer = sheet.getRow(cur());
      spacer.height = 8;
    }

    if (sec.title) {
      const r = cur();
      putMerged(r, sec.title, {
        font: { bold: true, size: 11, color: { argb: BRAND } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } },
        alignment: { horizontal: 'left', vertical: 'middle' }
      });
      sheet.getRow(r).height = 18;
    }

    const headerRowNum = cur();
    if (firstHeaderRow === null) firstHeaderRow = headerRowNum;
    const headerRow = sheet.getRow(headerRowNum);
    sec.headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder;
    });
    headerRow.height = 20;

    sec.rows.forEach((r, idx) => {
      const row = sheet.addRow(r);
      const isTotal = sec.totalRowIndex !== undefined && idx === sec.totalRowIndex;
      row.eachCell((cell, colNumber) => {
        cell.border = thinBorder;
        if (sec.currencyColumns.includes(colNumber - 1)) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
        if (isTotal) {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
        }
      });
    });

    if (sec.note) {
      sheet.getRow(cur());            // baris kosong pemisah
      putMerged(cur(), sec.note, {
        font: { italic: true, size: 9, color: { argb: MUTED } },
        alignment: { horizontal: 'left', vertical: 'top', wrapText: true }
      });
    }
  });

  // Catatan kaki tingkat sheet (setelah semua tabel).
  if (spec.note) {
    sheet.getRow(cur());
    putMerged(cur(), spec.note, {
      font: { italic: true, size: 9, color: { argb: MUTED } },
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true }
    });
  }

  // Lebar kolom = konten terpanjang di semua tabel pada kolom yang sama.
  const widthByCol = [];
  sections.forEach((sec) => {
    sec.headers.forEach((hd, i) => {
      let max = String(hd ?? '').length;
      sec.rows.forEach((r) => {
        const len = String(r[i] ?? '').length;
        if (len > max) max = len;
      });
      if (max > (widthByCol[i] || 0)) widthByCol[i] = max;
    });
  });
  widthByCol.forEach((max, i) => {
    sheet.getColumn(i + 1).width = Math.max(12, Math.min(35, max + 4));
  });

  // Baris judul & header ikut ter-freeze supaya saat scroll tabel tetap terlihat.
  if (firstHeaderRow !== null) {
    sheet.views = [{ state: 'frozen', ySplit: firstHeaderRow }];
  }
  // Excel hanya mengizinkan satu AutoFilter per worksheet, jadi hanya untuk
  // sheet yang benar-benar punya satu tabel.
  if (sections.length === 1 && sections[0].headers.length) {
    sheet.autoFilter = {
      from: { row: firstHeaderRow, column: 1 },
      to: { row: firstHeaderRow, column: colCount }
    };
  }

  return sheet;
}

function triggerDownload(buffer, filename) {
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
 * @param {string} sheetName - nama tab (opsional, default "Laporan")
 * @param {string} note - catatan kaki di bawah tabel (opsional)
 */
export async function exportExcelReport({
  filename, title, subtitle, headers, rows, currencyColumns = [], totalRowIndex,
  sheetName, note
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dayang Spa';
  writeSheet(workbook, { title, subtitle, headers, rows, currencyColumns, totalRowIndex, note, sheetName }, 0);
  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer, filename);
}

/**
 * Export BUKU LAPORAN: satu file .xlsx berisi banyak sheet.
 * Dipakai Laporan Keseluruhan supaya Inventory, Absensi, Komisi, dan Revenue
 * terkirim dalam satu file dengan format yang sama persis.
 *
 * @param {string} filename - nama file (tanpa .xlsx)
 * @param {Array<{name?:string,title?:string,subtitle?:string,headers:string[],rows:Array<Array>,currencyColumns?:number[],totalRowIndex?:number,note?:string}>} sheets
 */
export async function exportExcelWorkbook({ filename, sheets = [] }) {
  if (!sheets.length) throw new Error('exportExcelWorkbook: tidak ada sheet');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dayang Spa';
  sheets.forEach((spec, i) => writeSheet(workbook, spec, i));
  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer, filename);
}
