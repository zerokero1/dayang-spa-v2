import { ATTENDANCE_TYPES } from './constants';

/**
 * Bagian "purnama" dari grid absensi: token status, daftar hari, dan
 * perhitungan rekap. Semua murni fungsi tanpa React, supaya bisa diuji
 * langsung tanpa merender halaman.
 *
 * Dipakai components/AbsensiGrid.jsx (halaman Absensi + Laporan Absensi).
 */

export const TOKEN = {
  [ATTENDANCE_TYPES.HADIR]: 'H',
  [ATTENDANCE_TYPES.TELAT]: 'T',
  [ATTENDANCE_TYPES.SAKIT]: 'S',
  [ATTENDANCE_TYPES.IZIN]: 'I',
  [ATTENDANCE_TYPES.ALPHA]: 'A',
  [ATTENDANCE_TYPES.LIBUR]: 'OFF'
};

export const QUICK = [
  { value: ATTENDANCE_TYPES.HADIR, label: 'Hadir', token: 'H' },
  { value: ATTENDANCE_TYPES.TELAT, label: 'Telat', token: 'T' },
  { value: ATTENDANCE_TYPES.SAKIT, label: 'Sakit', token: 'S' },
  { value: ATTENDANCE_TYPES.IZIN, label: 'Izin', token: 'I' },
  { value: ATTENDANCE_TYPES.ALPHA, label: 'Alpha', token: 'A' },
  { value: ATTENDANCE_TYPES.LIBUR, label: 'Libur', token: 'OFF' }
];

export const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

/**
 * Rekap dasar. Semuanya menerima DAFTAR record orang itu saja — tidak
 * butuhemployeeId. Kolom tambahan yang butuh data lain menulis `get`
 * sendiri dengan tanda tangan (employeeId, records, context).
 */
export const BASE_RECAP = {
  H: (list) => (list || []).filter((r) => r.type === ATTENDANCE_TYPES.HADIR || r.type === ATTENDANCE_TYPES.TELAT).length,
  S: (list) => (list || []).filter((r) => r.type === ATTENDANCE_TYPES.SAKIT).length,
  A: (list) => (list || []).filter((r) => r.type === ATTENDANCE_TYPES.ALPHA).length,
  I: (list) => (list || []).filter((r) => r.type === ATTENDANCE_TYPES.IZIN).length,
  OFF: (list) => (list || []).filter((r) => r.type === ATTENDANCE_TYPES.LIBUR).length,
  L: (list) => (list || []).reduce((sum, r) => sum + (r.overtimeMinutes || 0), 0)
};

export const DEFAULT_RECAP = [
  { key: 'S', label: 'S', title: 'Sakit' },
  { key: 'A', label: 'A', title: 'Alpha' },
  { key: 'I', label: 'I', title: 'Izin' },
  { key: 'OFF', label: 'Off', title: 'Libur' }
];

export function todayWib() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

export function thisMonthWib() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
}

/** "2026-10" -> [{ date, day, dow, isToday }, ...] sepanjang bulan itu. */
export function daysOfMonth(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return [];
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayWib();
  const out = [];
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    out.push({ date, day: d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), isToday: date === today });
  }
  return out;
}

/**
 * "2026-10-01".."2026-10-05" -> [{ date, day, dow, isToday }, ...].
 * Toleran terhadap tanggal terbalik: kedua isian tanggal sering diisi
 * tidak berurutan.
 */
export function daysOfRange(start, end) {
  if (!start || !end) return [];
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const out = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  // Pengaman: rentang 5 tahun sudah jauh lebih dari yang masih terbaca di layar.
  for (let i = 0; i < 1900 && cur <= last; i++) {
    const date = cur.toISOString().slice(0, 10);
    out.push({
      date,
      day: cur.getUTCDate(),
      dow: cur.getUTCDay(),
      isToday: date === todayWib()
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Teks yang tampil di dalam sel.
 *
 * Untuk yang hadir/telat, sel berisi ANGKA BERTANDA, bukan huruf status:
 *   0    = hadir tepat waktu
 *   -17  = telat 17 menit
 * Dahulu selnya "H0" dan "T17m". Format lama memakai huruf, jadi angka
 * menit telat tidak bisa langsung dijumlahkan — harus dibaca manual satu
 * per satu. Sekarang jadi angka: total sel = 0 - 17 + 25 (lembur) = 8,
 * dan jumlah kolom bisa dipakai untuk hitung gaji tanpa menghitung ulang.
 *
 * Status yang bukan kehadiran (Sakit/Izin/Alpha/Libur) tetap memakai huruf,
 * karena tidak ada angka yang mewakili untuk "tidak masuk".
 */
export function cellText(rec) {
  if (!rec) return '';
  const t = TOKEN[rec.type] || '';
  if (rec.type === ATTENDANCE_TYPES.HADIR || rec.type === ATTENDANCE_TYPES.TELAT) {
    const late = Number(rec.lateMinutes) || 0;
    return late > 0 ? `-${late}` : '0';
  }
  return t;
}

export function cellClass(rec) {
  if (!rec) return 'cell';
  return 'cell filled'
    + (rec.type === ATTENDANCE_TYPES.TELAT ? ' c-telat' : '')
    + (rec.type === ATTENDANCE_TYPES.LIBUR ? ' c-libur' : '')
    + (
      rec.type === ATTENDANCE_TYPES.SAKIT
      || rec.type === ATTENDANCE_TYPES.IZIN
      || rec.type === ATTENDANCE_TYPES.ALPHA
        ? ' c-other'
        : ''
    )
    + (rec.overtimeMinutes > 0 ? ' c-lembur' : '');
}

/**
 * Nilai satu sel rekap untuk satu orang.
 * Kolom `get` dapat (employeeId, records, context); kolom bawaan cukup
 * daftar record.
 */
export function recapValue(column, employeeId, recordsOfEmployee, context) {
  if (column.get) return column.get(employeeId, recordsOfEmployee || [], context);
  const fn = BASE_RECAP[column.key];
  return fn ? fn(recordsOfEmployee || []) : '';
}

// ---------------------------------------------------------------------------
// 函数 pembantu untuk menyusun grid (dipakai bersama oleh layar & Excel).
//
// Grid absensi perlu hal yang sama persis di dua tempat: di layar (AbsensiGrid)
// dan di file Excel (exportAbsensiGrid). Kalau masing-masing menghitung sendiri,
// cepat atau lambat isinya akan berbeda dan laporan jadi tidak bisa dipercaya.
// Semua perhitungan baris/kolom tanggal dan rekap dikumpulkan di sini supaya
// keduanya benar-benar membaca sumber yang sama.
// ---------------------------------------------------------------------------

/**
 * Daftar orang yang tampil sebagai baris grid: gabungan terapis aktif dengan
 * siapa pun yang punya catatan absensi di periode ini (mis. orang yang sudah
 * dihapus dari daftar tapi absensinya masih ada). Dihasilkan dengan urutan
 * nama yang stabil supaya cocok dengan yang terlihat di layar.
 */
export function buildGridRows(employees, records, outletFilter) {
  const byId = {};
  (employees || []).forEach((e) => {
    byId[e.id] = { id: e.id, name: e.name, role: e.role, outletId: e.homeOutletId, shift: e.shift || '' };
  });
  (records || []).forEach((r) => {
    if (!byId[r.employeeId]) {
      byId[r.employeeId] = { id: r.employeeId, name: r.employeeName, role: '-', outletId: r.outletId, shift: '' };
    }
  });
  return Object.values(byId)
    .filter((e) => (outletFilter ? e.outletId === outletFilter : true))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Peta akses cepat per sel: "employeeId|tanggal" -> record. */
export function buildRecMap(records) {
  const m = {};
  (records || []).forEach((r) => { m[`${r.employeeId}|${r.date}`] = r; });
  return m;
}

/**
 * Teks lengkap satu sel, sama persis dengan yang dirender layar: angka
 * kehadiran bertanda (0 / -17) lalu menit lembur "+..".
 *
 * Jam pulang sengaja TIDAK ikut. Selnya jadi "-17/22:00+25" — terlalu panjang
 * untuk kolom setipis ini dan sulit dibaca. Jam pulang masih bisa diisi dan
 * dilihat di kotak edit sel, dan tersimpan di database, hanya tidak
 * dicetak di grid.
 *
 * Layar menulis tiap bagian sebagai span terpisah supaya bisa diberi warna;
 * file Excel tidak bisa, jadi di sini digabung jadi satu teks.
 */
export function gridCellText(rec) {
  if (!rec) return '';
  let out = cellText(rec);
  if (rec.overtimeMinutes > 0) out += `+${rec.overtimeMinutes}`;
  return out;
}

/** Rekap per orang untuk sekumpulan kolom rekap. */
export function computeRecap(rows, records, recapColumns, recapContext) {
  const out = {};
  const listByEmp = {};
  (records || []).forEach((r) => {
    (listByEmp[r.employeeId] = listByEmp[r.employeeId] || []).push(r);
  });
  rows.forEach((e) => {
    const listEmp = listByEmp[e.id] || [];
    const row = {};
    recapColumns.forEach((col) => {
      row[col.key] = recapValue(col, e.id, listEmp, recapContext);
    });
    out[e.id] = row;
  });
  return out;
}

/** Total tiap kolom rekap untuk baris TOTAL di bawah grid. */
export function computeRecapTotals(rows, recap, recapColumns) {
  const out = {};
  recapColumns.forEach((col) => {
    out[col.key] = rows.reduce((sum, e) => sum + (Number(recap[e.id]?.[col.key]) || 0), 0);
  });
  return out;
}

/** Berapa orang yang hadir (hadir + telat) pada satu tanggal. */
export function presentCount(records, date) {
  return (records || []).filter(
    (r) => r.date === date
      && (r.type === ATTENDANCE_TYPES.HADIR || r.type === ATTENDANCE_TYPES.TELAT)
  ).length;
}