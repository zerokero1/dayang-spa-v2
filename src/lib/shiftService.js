import { SHIFTS } from './constants';

/**
 * SATU SUMBER KEBENARAN definisi shift.
 *
 * Sebelumnya definisi shift tersebar di 3 tempat dan saling berbeda:
 * shiftService.js (ST aktif sampai 17:00), overtimeService.js (ST selesai
 * 16:00), dan label di constants.js (ST "11-16"). Akibatnya telat, lembur,
 * dan status "di luar jam" bisa saling bertentangan untuk shift yang sama.
 * Semua angka di bawah memakai menit sejak 00:00 WIB.
 *
 * segments: [['mulai', 'selesai'], ...] — jeda di antara segmen = break.
 * startMin  : mulai shift -> dipakai menghitung KETERLAMBATAN.
 * endMin    : selesai shift terakhir -> dipakai menghitung LEMBUR.
 */
export const SHIFT_DEFS = {
  [SHIFTS.SP]: {
    segments: [[11 * 60, 15 * 60], [18 * 60, 23 * 60]],
    startMin: 11 * 60,
    endMin: 23 * 60
  },
  [SHIFTS.SP1]: {
    segments: [[11 * 60, 14 * 60], [17 * 60, 22 * 60]],
    startMin: 11 * 60,
    endMin: 22 * 60
  },
  [SHIFTS.SP2]: {
    segments: [[12 * 60, 15 * 60], [18 * 60, 23 * 60]],
    startMin: 12 * 60,
    endMin: 23 * 60
  },
  [SHIFTS.MALAM]: {
    segments: [[15 * 60, 23 * 60]],
    startMin: 15 * 60,
    endMin: 23 * 60
  },
  [SHIFTS.AD]: {
    segments: [[15 * 60, 23 * 60]],
    startMin: 15 * 60,
    endMin: 23 * 60
  },
  [SHIFTS.T11]: {
    segments: [[11 * 60, 23 * 60]],
    startMin: 11 * 60,
    endMin: 23 * 60
  },
  // Short time: 11:00-16:00. Dahulunya 17:00 di shiftService.js.
  [SHIFTS.ST]: {
    segments: [[11 * 60, 16 * 60]],
    startMin: 11 * 60,
    endMin: 16 * 60
  }
};

/** Jam selesai shift dalam menit, atau null kalau shift tidak dikenal. */
export function shiftEndMinutes(shift) {
  return SHIFT_DEFS[shift]?.endMin ?? null;
}

/** Jam mulai shift dalam menit (patokan keterlambatan), atau null. */
export function shiftStartMinutes(shift) {
  return SHIFT_DEFS[shift]?.startMin ?? null;
}

/**
 * Hitung keterlambatan (menit) dari jam datang.
 *
 * - Datang sebelum shift mulai -> 0 (tidak telat, lebih awal).
 * - Datang tepat di atau setelah shift mulai -> selisihnya.
 * - Datang di luar shift / shift tidak dikenal -> null (tidak bisa dinilai),
 *   supaya laporan tidak mengarang angka.
 *
 * @param {number|null} checkInMinutes jam datang (menit sejak 00:00), null = belum absen
 * @param {string|null} shift kode shift
 */
export function lateMinutesFor(checkInMinutes, shift) {
  if (checkInMinutes == null) return null;
  const startMin = shiftStartMinutes(shift);
  if (startMin == null) return null;
  return Math.max(0, checkInMinutes - startMin);
}

/**
 * Hitung status jadwal shift berdasarkan jam saat ini (waktu lokal).
 * - SP1: aktif 11:00-14:00 dan 17:00-22:00, jeda 14:00-17:00
 * - SP2: aktif 12:00-15:00 dan 18:00-23:00, jeda 15:00-18:00
 * - SP : aktif 11:00-15:00 dan 18:00-23:00, jeda 15:00-18:00
 * - Malam / AD: aktif 15:00-23:00, tidak ada jeda di tengah
 * - 11 : aktif 11:00-23:00
 * - ST : aktif 11:00-16:00
 * Di luar rentang itu dianggap "di luar jam kerja".
 * Return: 'aktif' | 'jeda' | 'diluar_jam' | null (kalau tidak ada shift di-set)
 */
export function getShiftWindowStatus(shift, now = new Date()) {
  if (!shift) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const def = SHIFT_DEFS[shift];
  if (!def) return null;

  const segs = def.segments;
  for (let i = 0; i < segs.length; i++) {
    const [from, to] = segs[i];
    if (minutes >= from && minutes < to) return 'aktif';
    // Jeda =celah antara segmen ini dan segmen berikutnya.
    const next = segs[i + 1];
    if (next && minutes >= to && minutes < next[0]) return 'jeda';
  }
  return 'diluar_jam';
}

export const SHIFT_WINDOW_LABEL = {
  aktif: 'Jam kerja',
  jeda: 'Jeda shift (break)',
  diluar_jam: 'Di luar jam kerja'
};

/** "08:15" dari menit sejak 00:00. */
export function minutesToClock(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return '';
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Menit sejak 00:00 dari "08:15". Null bila format tidak valid. */
export function clockToMinutes(clock) {
  if (clock == null || clock === '') return null;
  const m = String(clock).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 47 || mm > 59) return null;
  return h * 60 + mm;
}

/** Menit -> "2j 15m" untuk tampilan ringkas. */
export function minutesToDuration(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return '';
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return '0m';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}j` : `${h ? `${h}j ` : ''}${mm}m`;
}
