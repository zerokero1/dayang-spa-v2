import { SHIFTS } from './constants';

/**
 * Hitung status jadwal shift terapis berdasarkan jam saat ini (waktu lokal).
 * - Shift SP: aktif 11:00-15:00 dan 18:00-23:00, jeda (break otomatis) 15:00-18:00
 * - Shift Malam: aktif 15:00-23:00, tidak ada jeda di tengah
 * Di luar rentang itu (sebelum 11:00 / setelah 23:00) dianggap "di luar jam kerja".
 * Return: 'aktif' | 'jeda' | 'diluar_jam' | null (kalau tidak ada shift di-set)
 */
export function getShiftWindowStatus(shift, now = new Date()) {
  if (!shift) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const t = (h, m = 0) => h * 60 + m;

  if (shift === SHIFTS.SP) {
    if (minutes >= t(11) && minutes < t(15)) return 'aktif';
    if (minutes >= t(15) && minutes < t(18)) return 'jeda';
    if (minutes >= t(18) && minutes < t(23)) return 'aktif';
    return 'diluar_jam';
  }

  if (shift === SHIFTS.MALAM) {
    if (minutes >= t(15) && minutes < t(23)) return 'aktif';
    return 'diluar_jam';
  }

  if (shift === SHIFTS.ST) {
    if (minutes >= t(11) && minutes < t(16)) return 'aktif';
    return 'diluar_jam';
  }

  return null;
}

export const SHIFT_WINDOW_LABEL = {
  aktif: 'Jam kerja',
  jeda: 'Jeda shift (break)',
  diluar_jam: 'Di luar jam kerja'
};
