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

/**
 * Export LAPORAN PRODUK — mengikuti template tabel (bukan format laporan
 * standar): dua blok tabel dalam satu worksheet, dan header DUA BARIS
 * yang di-merge per grup tanggal.
 *
 * Bentuk header di sini:
 *   - kolom pertama menara dua baris (mis. "No" dan "Produk Treatment")
 *   - setiap grup tanggal = satu baris tanggal ter-merge sepanjang 4 kolom,
 *     dengan baris kedua berisi Stock / In / Out / Sisa
 *
 * Format `exportExcelReport` sengaja tidak diubah sama sekali supaya
 * laporan lain (dan test-nya) tidak terpengaruh.
 *
 * @param {string} filename - nama file (tanpa .xlsx)
 * @param {string} title - judul laporan di baris paling atas
 * @param {string} subtitle - sub-judul (mis. outlet + rentang tanggal)
 * @param {string[]} dates - label grup tanggal, mis. ['02 Okt', ...]
 * @param {Array<{title:string, note?:string, rows:Array<Array>}>} blocks
 *        `rows` sudah termasuk kolom No + nama di depan, lalu 4 angka
 *        per tanggal. Nilai null ditulis sebagai teks "–".
 * @param {string} note - catatan kaki di bawah seluruh tabel (opsional)
 */
export async function exportStockLedger({
  filename, title, subtitle, dates, blocks = [], sheetName, note
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dayang Spa';

  const sheet = workbook.addWorksheet(safeSheetName(sheetName, 'Laporan Produk'));
  const subHeaders = ['Stock', 'In', 'Out', 'Sisa'];
  // kolom 1 = No, kolom 2 = nama produk, lalu 4 kolom per tanggal
  const colCount = 2 + dates.length * subHeaders.length;
  const cur = () => sheet.rowCount + 1;

  const putMerged = (row, from, to, value, style) => {
    sheet.mergeCells(row, from, row, to);
    const c = sheet.getCell(row, from);
    c.value = value;
    if (style) Object.assign(c, style);
    return c;
  };

  const putMergedTitle = (value, style) =>
    putMerged(cur(), 1, colCount, value, style);

  putMergedTitle(title || '', {
    font: { bold: true, size: 14, color: { argb: BRAND } },
    alignment: { horizontal: 'center' }
  });

  if (subtitle) {
    putMergedTitle(subtitle, {
      font: { italic: true, size: 10, color: { argb: MUTED } },
      alignment: { horizontal: 'center' }
    });
  }

  let firstHeaderRow = null;

  blocks.forEach((block, blockIdx) => {
    if (blockIdx > 0) sheet.getRow(cur()).height = 8; // baris kosong pemisah

    if (block.title) {
      putMergedTitle(block.title, {
        font: { bold: true, size: 11, color: { argb: BRAND } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } },
        alignment: { horizontal: 'left', vertical: 'middle' }
      });
    }

    // Baris 1 header: kolom menara dua baris + grup tanggal ter-merge.
    const h1 = cur();
    if (firstHeaderRow === null) firstHeaderRow = h1;
    dates.forEach((d, i) => {
      putMerged(h1, 3 + i * 4, 6 + i * 4, d, {
        alignment: { horizontal: 'center', vertical: 'middle' }
      });
    });

    // Baris 2 header: Stock / In / Out / Sisa per tanggal.
    const h2 = cur();
    dates.forEach((_, i) => {
      subHeaders.forEach((s, j) => {
        sheet.getCell(h2, 3 + i * 4 + j).value = s;
      });
    });

    // No + Produk Treatment diturunkan sampai baris sub-judul (rowSpan 2).
    // Baris 2 harus dibuat dulu, baru di-merge — jangan mergeCells(a, a)
    // karena itu bikin ExcelJS menolak merge yang sebenarnya.
    sheet.getCell(h1, 1).value = 'No';
    sheet.getCell(h1, 2).value = 'Produk Treatment';
    sheet.mergeCells(h1, 1, h2, 1);
    sheet.mergeCells(h1, 2, h2, 2);

    [h1, h2].forEach((r) => {
      const row = sheet.getRow(r);
      row.height = 20;
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
      }
    });

    block.rows.forEach((values) => {
      // null = belum ada catatan, bukan nol. Di Excel ditulis "–" supaya
      // tidak salah dibaca sebagai "tidak ada barang keluar".
      const row = sheet.addRow(values.map((v, i) => (
        i >= 2 && (v === null || v === undefined) ? '–' : v
      )));
      row.eachCell((cell, colNumber) => {
        cell.border = thinBorder;
        if (colNumber <= 2) {
          cell.alignment = { horizontal: colNumber === 1 ? 'center' : 'left' };
          return;
        }
        cell.alignment = { horizontal: 'right' };
        if (typeof cell.value === 'number') cell.numFmt = '#,##0';
      });
    });

    if (block.note) {
      sheet.getRow(cur()); // baris kosong pemisah
      putMergedTitle(block.note, {
        font: { italic: true, size: 9, color: { argb: MUTED } },
        alignment: { horizontal: 'left', vertical: 'top', wrapText: true }
      });
    }
  });

  if (note) {
    sheet.getRow(cur());
    putMergedTitle(note, {
      font: { italic: true, size: 9, color: { argb: MUTED } },
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true }
    });
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 30;
  for (let c = 3; c <= colCount; c++) sheet.getColumn(c).width = 9;
  if (firstHeaderRow !== null) {
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: firstHeaderRow }];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer, filename);
}
