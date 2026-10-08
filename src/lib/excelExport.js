import ExcelJS from 'exceljs';
import { DOW } from './attendanceGrid';

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

// Warna isi sel mengikuti warna sel di layar: telat, libur, dan status lain
// punya warna berbeda supayafile bisa dibaca tanpa melihat aplikasinya.
const CELL_FILL = {
  hadir: null,
  telat: 'FFFDE8E8',
  libur: 'FFEFF6FF',
  sakit: 'FFF5F5F5',
  izin: 'FFF5F5F5',
  alpha: 'FFF5F5F5'
};
const CELL_FONT = {
  telat: 'FFB91C1C',
  libur: 'FF1D4ED8'
};

/**
 * Export GRID ABSENSI — bentuknya meniru tabel di halaman Absensi:
 * baris = orang, kolom = tanggal. Bedanya dengan `exportExcelReport` ada di
 * header-nya yang DUA baris (nama hari di atas, angka tanggal di bawah) dan
 * kolom rekap yang menyatu dua baris itu, jadi writer-nya terpisah supaya
 * laporan lain tidak ikut berubah.
 *
 * Nilai setiap sel sudah dikirim dari halaman sebagai teks jadi (lihat
 * `gridCellText`), sehingga angka di file dijamin sama dengan yang tampil di
 * layar — bukan dihitung ulang di sini dan risking berbeda.
 *
 * @param {string} filename - nama file (tanpa .xlsx)
 * @param {string} title - judul di baris paling atas
 * @param {string} subtitle - sub-judul (outlet + periode)
 * @param {Array<{dow:string, day:number, date:string}>} days - satu entri per kolom tanggal
 * @param {Array<{name:string, shift:string, shiftLabel:string, cells:Array<{text:string,type:string}>}>} rows
 * @param {Array<{label:string, title?:string}>} recapColumns - kolom rekap di kanan
 * @param {Array<{label:string, title?:string}>} recapTotals - nilai baris TOTAL per kolom rekap
 * @param {number[]} presentByDay - jumlah orang hadir per tanggal (baris TOTAL)
 * @param {string} note - catatan kaki di bawah tabel
 */
export async function exportAbsensiGrid({
  filename, title, subtitle, days = [], rows = [], recapColumns = [],
  recapTotals = [], presentByDay = [], sheetName, note
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dayang Spa';

  const sheet = workbook.addWorksheet(safeSheetName(sheetName, 'Absensi'));
  // kolom 1 = nama, kolom 2 = shift, lalu 1 kolom per tanggal, lalu rekap.
  const nameCol = 1;
  const shiftCol = 2;
  const firstDayCol = 3;
  const firstRecapCol = firstDayCol + days.length;
  const colCount = firstRecapCol + recapColumns.length - 1;
  const cur = () => sheet.rowCount + 1;

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

  // --- Header baris 1: nama hari + judul kolom yang menyatu dua baris -------
  const h1 = cur();
  sheet.getCell(h1, nameCol).value = 'Nama';
  sheet.getCell(h1, shiftCol).value = 'Shift';
  days.forEach((d, i) => {
    const c = sheet.getCell(h1, firstDayCol + i);
    c.value = DOW[d.dow] || '';
  });
  recapColumns.forEach((rc, i) => {
    sheet.getCell(h1, firstRecapCol + i).value = rc.label;
  });

  // --- Header baris 2: angka tanggal ----------------------------------------
  const h2 = cur();
  days.forEach((d, i) => { sheet.getCell(h2, firstDayCol + i).value = d.day; });

  // Nama, shift, dan tiap kolom rekap menyatu dua baris header.
  sheet.mergeCells(h1, nameCol, h2, nameCol);
  sheet.mergeCells(h1, shiftCol, h2, shiftCol);
  recapColumns.forEach((rc, i) => {
    sheet.mergeCells(h1, firstRecapCol + i, h2, firstRecapCol + i);
  });

  [h1, h2].forEach((r) => {
    const row = sheet.getRow(r);
    row.height = 18;
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder;
    }
  });
  // Judul kolom rekap dibuat tooltips, karena labelnya singkat (H/S/A/…).
  recapColumns.forEach((rc, i) => {
    const cell = sheet.getCell(h1, firstRecapCol + i);
    cell.note = rc.title || rc.label;
  });

  // --- Baris data -----------------------------------------------------------
  rows.forEach((r) => {
    const values = [r.name, r.shift || '', ...r.cells.map((c) => c.text)];
    const row = sheet.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = thinBorder;
    });

    sheet.getCell(row.number, nameCol).alignment = { horizontal: 'left' };
    sheet.getCell(row.number, shiftCol).alignment = { horizontal: 'center' };

    // Warna sel mengikuti status, sama seperti di layar.
    r.cells.forEach((c, i) => {
      const cell = sheet.getCell(row.number, firstDayCol + i);
      cell.alignment = { horizontal: 'center' };
      const fill = CELL_FILL[c.type];
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      const fontColor = CELL_FONT[c.type];
      if (fontColor) cell.font = { color: { argb: fontColor } };
    });
  });

  // --- Baris TOTAL ----------------------------------------------------------
  if (rows.length) {
    const totalValues = [`TOTAL (${rows.length} orang)`, '', ...presentByDay];
    recapTotals.forEach((v) => totalValues.push(v));
    const totalRow = sheet.addRow(totalValues);
    for (let c = 1; c <= colCount; c++) {
      const cell = totalRow.getCell(c);
      cell.border = thinBorder;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
      cell.alignment = { horizontal: c === nameCol ? 'left' : 'center' };
    }
  }

  // --- Catatan kaki ---------------------------------------------------------
  if (note) {
    sheet.getRow(cur());
    putMerged(cur(), note, {
      font: { italic: true, size: 9, color: { argb: MUTED } },
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true }
    });
  }

  // --- Lebar kolom & freeze -------------------------------------------------
  sheet.getColumn(nameCol).width = 22;
  sheet.getColumn(shiftCol).width = 8;
  for (let c = firstDayCol; c < firstRecapCol; c++) sheet.getColumn(c).width = 6.5;
  recapColumns.forEach((_, i) => { sheet.getColumn(firstRecapCol + i).width = 7; });

  // Nama + shift dan dua baris header dikunci, jadi saat scroll ke kanan
  // orangnya tetap kelihatan.
  sheet.views = [{ state: 'frozen', xSplit: shiftCol, ySplit: h2 }];

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer, filename);
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
/**
 * Export LAPORAN REVENUE + KOMISI PER HARI — mengikuti format buku laporan
 * yang biasa dipakai kasir, bukan `exportExcelReport`.
 *
 * Bentuknya: satu blok per tanggal, di dalam blok ada
 *   - tabel kiri  : Tanggal | Treatment | Minyak | Qty | Therapist | Charge |
 *                   Komisi | Gran Total   (satu baris per treatment)
 *   - total harian di bawah tabel kiri
 *   - tabel kanan : TERAPIS | BANYAK TREATMENT | TOTAL PENDAPATAN
 *                   (= komisi), ditulis di baris yang sama dengan tabel kiri
 * lalu satu baris TOTAL untuk seluruh periode di akhir sheet.
 *
 * Kolom "KET" pada buku manual sengaja tidak dibuat: isinya sama persis
 * dengan kolom Komisi (persentase dari Charge), jadi mengulangnya hanya menambah
 * satu kolom lagi yang harus dicocokkan.
 *
 * Angka dikirim sebagai number asli (bukan teks) supaya kolom Charge, Komisi,
 * dan Gran Total bisa dijumlahkan sendiri di Excel.
 *
 * @param {string} filename - nama file (tanpa .xlsx)
 * @param {string} title - judul di baris paling atas
 * @param {string} subtitle - sub-judul (mis. periode)
 * @param {Array<{date:string, items:Array<{treatmentName:string,oilType:string,qty:number,therapistName:string,charge:number,commission:number}>, charge:number, commission:number, net:number, therapists:Array<{name:string,treatmentCount:number,commission:number}>}>} days
 * @param {string} sheetName - nama tab (opsional)
 * @param {string} note - catatan kaki di bawah seluruh tabel (opsional)
 */
export async function exportDailyRevenueCommission({
  filename, title, subtitle, days = [], sheetName, note
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dayang Spa';

  const ITEM_HEADERS = ['Tanggal', 'Treatment', 'Minyak', 'Qty', 'Therapist', 'Charge', 'Komisi', 'Gran Total'];
  const RECAP_HEADERS = ['TERAPIS', 'BANYAK TREATMENT', 'TOTAL PENDAPATAN'];
  const ITEM_CURRENCY = [5, 6, 7];           // 0-based: Charge, Komisi, Gran Total
  const recapStartCol = ITEM_HEADERS.length + 1;
  const colCount = ITEM_HEADERS.length + RECAP_HEADERS.length;

  const sheet = workbook.addWorksheet(safeSheetName(sheetName, 'Revenue & Komisi'));
  const cur = () => sheet.rowCount + 1;
  const putMerged = (row, value, style) => {
    sheet.mergeCells(row, 1, row, colCount);
    const c = sheet.getCell(row, 1);
    c.value = value;
    Object.assign(c, style);
    return c;
  };
  const styleHeader = (r) => {
    const row = sheet.getRow(r);
    row.height = 20;
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder;
    }
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

  days.forEach((day, dayIdx) => {
    if (dayIdx > 0) sheet.getRow(cur()).height = 8;   // baris kosong pemisah

    // Judul blok = tanggal, supaya saat di-scroll tahu sedang di hari mana.
    const titleRow = cur();
    putMerged(titleRow, day.date, {
      font: { bold: true, size: 11, color: { argb: BRAND } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } },
      alignment: { horizontal: 'left', vertical: 'middle' }
    });
    sheet.getRow(titleRow).height = 18;

    const headerRowNum = cur();
    if (firstHeaderRow === null) firstHeaderRow = headerRowNum;
    const headerRow = sheet.getRow(headerRowNum);
    ITEM_HEADERS.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    RECAP_HEADERS.forEach((h, i) => { headerRow.getCell(recapStartCol + i).value = h; });
    styleHeader(headerRowNum);

    // Baris treatment. Tanggal hanya ditulis di baris pertama blok supaya
    // tidak berulang di setiap baris — mengikuti buku manual.
    const firstItemRow = cur();
    day.items.forEach((it, idx) => {
      const values = [
        idx === 0 ? day.date : '',
        it.treatmentName,
        it.oilType,
        it.qty,
        it.therapistName,
        it.charge,
        it.commission,
        it.charge - it.commission
      ];
      const row = sheet.addRow(values);
      for (let c = 1; c <= ITEM_HEADERS.length; c++) {
        const cell = row.getCell(c);
        cell.border = thinBorder;
        if (ITEM_CURRENCY.includes(c - 1)) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        } else if (c === 4) {
          cell.alignment = { horizontal: 'center' };
        }
      }
    });

    // Rekap terapis ditulis di kolom kanan, baris yang sama dengan tabel kiri.
    day.therapists.forEach((t, idx) => {
      const rowNum = firstItemRow + idx;
      if (rowNum > sheet.rowCount) return;             // item lebih sedikit dari terapis
      const row = sheet.getRow(rowNum);
      row.getCell(recapStartCol).value = t.name;
      row.getCell(recapStartCol + 1).value = t.treatmentCount;
      row.getCell(recapStartCol + 2).value = t.commission;
      for (let c = recapStartCol; c <= colCount; c++) {
        const cell = row.getCell(c);
        cell.border = thinBorder;
        if (c === recapStartCol + 2) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        } else if (c === recapStartCol + 1) {
          cell.alignment = { horizontal: 'center' };
        }
      }
    });

    // Total harian, melintasi kedua tabel.
    const totalRowNum = cur();
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.getCell(1).value = `TOTAL ${day.date} (${day.items.length} treatment)`;
    totalRow.getCell(ITEM_HEADERS.length).value = day.charge;
    totalRow.getCell(ITEM_HEADERS.length + 1).value = day.commission;
    totalRow.getCell(ITEM_HEADERS.length + 2).value = day.net;
    totalRow.getCell(recapStartCol).value = 'TOTAL';
    totalRow.getCell(recapStartCol + 1).value = day.items.length;
    totalRow.getCell(recapStartCol + 2).value = day.commission;
    for (let c = 1; c <= colCount; c++) {
      const cell = totalRow.getCell(c);
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
      cell.border = thinBorder;
      if (ITEM_CURRENCY.includes(c - 1) || c === recapStartCol + 2) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      } else if (c === recapStartCol + 1) {
        cell.alignment = { horizontal: 'center' };
      }
    }
  });

  // Total seluruh periode.
  if (days.length) {
    sheet.getRow(cur()).height = 8;
    const g = days.reduce((a, d) => ({
      treatmentCount: a.treatmentCount + d.items.length,
      charge: a.charge + d.charge,
      commission: a.commission + d.commission,
      net: a.net + d.net
    }), { treatmentCount: 0, charge: 0, commission: 0, net: 0 });

    const gRow = sheet.getRow(cur());
    gRow.getCell(1).value = `GRAND TOTAL (${days.length} hari)`;
    gRow.getCell(ITEM_HEADERS.length).value = g.charge;
    gRow.getCell(ITEM_HEADERS.length + 1).value = g.commission;
    gRow.getCell(ITEM_HEADERS.length + 2).value = g.net;
    gRow.getCell(recapStartCol + 1).value = g.treatmentCount;
    gRow.getCell(recapStartCol + 2).value = g.commission;
    for (let c = 1; c <= colCount; c++) {
      const cell = gRow.getCell(c);
      cell.font = { bold: true, size: 12, color: { argb: BRAND } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
      cell.border = thinBorder;
      if (ITEM_CURRENCY.includes(c - 1) || c === recapStartCol + 2) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      } else if (c === recapStartCol + 1) {
        cell.alignment = { horizontal: 'center' };
      }
    }
  }

  if (note) {
    sheet.getRow(cur());
    putMerged(cur(), note, {
      font: { italic: true, size: 9, color: { argb: MUTED } },
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true }
    });
  }

  [14, 30, 16, 6, 14, 13, 12, 14].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  sheet.getColumn(recapStartCol).width = 14;
  sheet.getColumn(recapStartCol + 1).width = 19;
  sheet.getColumn(recapStartCol + 2).width = 19;
  if (firstHeaderRow !== null) {
    sheet.views = [{ state: 'frozen', ySplit: firstHeaderRow }];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer, filename);
}

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
