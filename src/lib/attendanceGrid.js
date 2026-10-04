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

/** Teks yang tampil di dalam sel. */
export function cellText(rec) {
  if (!rec) return '';
  const t = TOKEN[rec.type] || '';
  if (rec.type === ATTENDANCE_TYPES.HADIR || rec.type === ATTENDANCE_TYPES.TELAT) {
    // Tampilkan menit telat kalau ada, bukan jam datang.
    if (rec.lateMinutes != null && rec.lateMinutes > 0) return `${t}${rec.lateMinutes}m`;
    return `${t}0`;
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