import { supabase } from './supabase';

// Urutan kolom di grid: Senin lebih dulu karena itu yang dipikirkan kasir,
// Minggu di akhir.
export const HARI = [
  { dow: 1, short: 'Sen', long: 'Senin' },
  { dow: 2, short: 'Sel', long: 'Selasa' },
  { dow: 3, short: 'Rab', long: 'Rabu' },
  { dow: 4, short: 'Kam', long: 'Kamis' },
  { dow: 5, short: 'Jum', long: 'Jumat' },
  { dow: 6, short: 'Sab', long: 'Sabtu' },
  { dow: 0, short: 'Min', long: 'Minggu' }
];

export const OFF = 'off';

// Shift yang boleh dipilih di grid. Isinya memakai kode yang sama dengan
// therapists.shift dan attendance.shift_code supaya tidak ada dua daftar.
export const PILIHAN_SHIFT = [
  { code: 'sp', label: 'SP', jam: '11-15, 18-23' },
  { code: 'sp1', label: 'SP1', jam: '11-14, 17-22' },
  { code: 'sp2', label: 'SP2', jam: '12-15, 18-23' },
  { code: 'AD', label: 'AD', jam: '15-23' },
  { code: 'malam', label: 'MALAM', jam: '15-23' },
  { code: '11', label: '11', jam: '11-23' },
  { code: 'st', label: 'ST', jam: '11-16' },
  { code: OFF, label: 'OFF', jam: '-' },
  { code: 'libur', label: 'LIBUR', jam: '-' }
];

export function labelShift(code) {
  const found = PILIHAN_SHIFT.find((x) => x.code === code);
  if (found) return found.label;
  // Shift yang tidak dikenal (mis. kode lama di therapists.shift) tetap
  // ditampilkan apa adanya supaya tidak hilang tanpa jejak.
  return code || PILIHAN_SHIFT.find((x) => x.code === OFF).label;
}

export function jamShift(code) {
  const found = PILIHAN_SHIFT.find((x) => x.code === code);
  return found ? found.jam : '';
}

/**
 * Tabel jadwal mingguan belum tentu ada — baru dibuat lewat
 * supabase/jadwal_mingguan.sql. Error "relation does not exist" ditangkap di
 * sini supaya halaman bisa menampilkan sql-nya ke user, bukan "gagal memuat".
 */
export function isTabelBelumAda(error) {
  const msg = String(error?.message || '');
  return /does not exist|schema cache|42P01|relation/i.test(msg);
}

/** Jadwal semua terapis, dikembalikan sebagai { therapistId: { dow: shift } }. */
export async function getWeeklySchedules() {
  const { data, error } = await supabase
    .from('therapist_weekly_schedules')
    .select('therapist_id, day_of_week, shift_code, note');
  if (error) throw error;
  const out = {};
  (data || []).forEach((r) => {
    if (!out[r.therapist_id]) out[r.therapist_id] = {};
    out[r.therapist_id][r.day_of_week] = r.shift_code || OFF;
  });
  return out;
}

/**
 * Simpan satu sel (satu terapis, satu hari).
 *
 * Upsert dipakai karena ada UNIQUE (therapist_id, day_of_week), jadi sel yang
 * sama tidak akan menumpuk jadi dua baris.
 */
export async function setWeeklySchedule(therapistId, dayOfWeek, shiftCode) {
  const { error } = await supabase
    .from('therapist_weekly_schedules')
    .upsert(
      { therapist_id: therapistId, day_of_week: dayOfWeek, shift_code: shiftCode || OFF },
      { onConflict: 'therapist_id,day_of_week' }
    );
  if (error) throw error;
}

/**
 * Isi jadwal mingguan dari shift tetap yang ada di therapists.shift — dipakai
 * saat pertama kali halaman dibuka supaya grid tidak kosong semua, lalu owner
 * bisa mengubah peritely yang berbeda.
 */
export async function seedFromTherapistShift(therapists) {
  const rows = [];
  therapists.forEach((t) => {
    HARI.forEach((h) => {
      rows.push({
        therapist_id: t.id,
        day_of_week: h.dow,
        shift_code: t.shift || OFF
      });
    });
  });
  const { error } = await supabase
    .from('therapist_weekly_schedules')
    .upsert(rows, { onConflict: 'therapist_id,day_of_week' });
  if (error) throw error;
  return rows.length;
}

/** Salin satu hari ke semua hari (mis. "Jumat = OFF" untuk semua orang). */
export async function applyToAllDays(therapists, dayOfWeek, shiftCode) {
  const rows = therapists.map((t) => ({
    therapist_id: t.id, day_of_week: dayOfWeek, shift_code: shiftCode || OFF
  }));
  const { error } = await supabase
    .from('therapist_weekly_schedules')
    .upsert(rows, { onConflict: 'therapist_id,day_of_week' });
  if (error) throw error;
  return rows.length;
}