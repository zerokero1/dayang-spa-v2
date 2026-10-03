import { supabase } from './supabase';
import { ATTENDANCE_TYPES } from './constants';
import { lateMinutesFor, shiftEndMinutes } from './shiftService';

function todayId(date = new Date()) {
  // WIB = UTC+7: label "hari" harus pakai tanggal WIB, bukan UTC.
  return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

function mapAttendance(r) {
  return {
    id: `${r.employee_id}_${r.date}`,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    outletId: r.outlet_id,
    date: r.date,
    type: r.type,
    overtimeMinutes: r.overtime_minutes,
    checkIn: r.check_in_minutes,
    checkOut: r.check_out_minutes,
    shiftCode: r.shift_code,
    lateMinutes: r.late_minutes,
    source: r.source,
    recordedBy: r.recorded_by,
    note: r.note
  };
}

/**
 * Simpan absensi satu orang untuk satu tanggal.
 *
 * type hanya menyatakan KONDISI kerja (hadir/sakit/izin/telat/alpha).
 * Lembur TIDAK lagi memakai type='lembur' karena primary key attendance
 * (employee_id, date) hanya mengizinkan satu baris per hari — memakai
 * type='lembur' akan menimpa kehadiran. Lembur disimpan terpisah di
 * attendance_overtime lewat saveOvertime().
 *
 * Keterlambatan dihitung dari jam datang vs jam mulai shift, bukan diketik
 * manual, supaya tidak bisa lupa dan tidak bisa nebak-nebak. Kalau tidak bisa
 * dihitung (jam datang kosong atau shift belum diatur) nilainya NULL = tidak
 * diketahui, BUKAN 0 — 0 berarti "tepat waktu" dan itu akan berbohong.
 * Kasir boleh mengoreksi sendiri lewat lateMinutesOverride.
 */
export async function recordAttendance({
  outletId, employeeId, employeeName, type, note, date,
  checkIn, checkOut, shift, recordedBy, lateMinutesOverride = null
}) {
  const dayId = todayId(date ? new Date(date) : new Date());
  const checkInMin = checkIn ?? null;
  const checkOutMin = checkOut ?? null;
  const computed = lateMinutesFor(checkInMin, shift);
  const override = lateMinutesOverride === null || lateMinutesOverride === undefined
    ? null
    : Math.max(0, Number(lateMinutesOverride) || 0);
  const lateMin = override !== null ? override : computed;

  const { error } = await supabase.from('attendance').upsert({
    employee_id: employeeId,
    employee_name: employeeName,
    outlet_id: outletId || null,
    date: dayId,
    type,
    check_in_minutes: checkInMin,
    check_out_minutes: checkOutMin,
    shift_code: shift || null,
    late_minutes: lateMin,
    source: 'manual',
    recorded_by: recordedBy || null,
    overtime_minutes: 0, // kolom lama; lembur kini di attendance_overtime
    note: note || ''
  });
  if (error) throw error;
  return { lateMinutes: lateMin, lateComputed: computed, overridden: override !== null };
}

/**
 * Simpan lembur terpisah dari kehadiran, supaya "hadir + lembur" pada hari
 * yang sama sama-sama tercatat.
 */
export async function saveOvertime({
  outletId, employeeId, employeeName, minutes, date, note, recordedBy, verified = true
}) {
  const dayId = todayId(date ? new Date(date) : new Date());
  const { error } = await supabase.from('attendance_overtime').upsert({
    employee_id: employeeId,
    employee_name: employeeName,
    outlet_id: outletId || null,
    date: dayId,
    minutes: Math.max(0, Number(minutes) || 0),
    verified,
    source: 'manual',
    note: note || '',
    recorded_by: recordedBy || null
  });
  if (error) throw error;
}

/** Hapus catatan lembur (bukan kehadiran). */
export async function deleteOvertime(employeeId, date) {
  const { error } = await supabase
    .from('attendance_overtime')
    .delete()
    .eq('employee_id', employeeId)
    .eq('date', date);
  if (error) throw error;
}

/**
 * Kosongkan satu sel absensi (salah input kasir).
 * Kehadiran DAN lembur dihapus bareng - kalau hanya kehadiran yang dihapus,
 * menit lembur yatim akan tetap menempel di hari itu dan muncul lagi di
 * laporan tanpa ada kehadiran.
 */
export async function deleteAttendance(employeeId, date) {
  const [att, ot] = await Promise.all([
    supabase.from('attendance').delete().eq('employee_id', employeeId).eq('date', date),
    supabase.from('attendance_overtime').delete().eq('employee_id', employeeId).eq('date', date)
  ]);
  if (att.error) throw att.error;
  if (ot.error) throw ot.error;
}

/**
 * Ambil absensi + lembur dalam rentang tanggal.
 * Both me-return Array; lembur sudah digabung ke field overtimeMinutes
 * supaya pemanggil lama (summarizeAttendance, LaporanAbsensiPage) tetap jalan.
 */
export async function getAttendanceRange(startDate, endDate, outletId) {
  let query = supabase
    .from('attendance')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);
  if (outletId) query = query.eq('outlet_id', outletId);
  const [{ data, error }, { data: otData, error: otError }] = await Promise.all([
    query,
    (() => {
      let q = supabase
        .from('attendance_overtime')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate);
      return outletId ? q.eq('outlet_id', outletId) : q;
    })()
  ]);
  if (error) throw error;
  if (otError) throw otError;

  const otByKey = {};
  (otData || []).forEach((o) => {
    otByKey[`${o.employee_id}_${o.date}`] = o;
  });

  return (data || []).map((r) => {
    const mapped = mapAttendance(r);
    const ot = otByKey[mapped.id];
    return {
      ...mapped,
      // type 'lembur' sudah tidak dipakai, tapi data sangat lama mungkin masih ada.
      overtimeMinutes: ot ? (ot.minutes || 0) : (r.overtime_minutes || 0),
      // 'absensi' = berasal dari input manual di halaman Absensi. Kosakata ini
      // sama dengan yang dipakai therapistBoardService supaya consumer mana pun
      // yang mengecek `=== 'absensi'` tidak diam-diam dapat 0. Aslinya disimpan
      // terpisah di overtimeOrigin ('manual' atau 'lama' = warisan migrasi).
      overtimeSource: ot ? 'absensi' : null,
      overtimeOrigin: ot ? ot.source : null,
      overtimeVerified: ot ? ot.verified : null,
      overtimeNote: ot ? ot.note : ''
    };
  });
}
/** Ambil lembur saja (untuk halaman Overtime / audit). */
export async function getOvertimeRange(startDate, endDate, outletId) {
  let q = supabase
    .from('attendance_overtime')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Ringkasan per karyawan.
 * `lembur` dihitung dari menit lembur, bukan dari type (type tidak lagi
 * dipakai untuk lembur). `telat` tetap dihitung dari type supaya data lama
 * (yang tidak punya jam datang) tidak hilang.
 */
export function summarizeAttendance(records) {
  const byEmployee = {};
  records.forEach((r) => {
    if (!byEmployee[r.employeeId]) {
      byEmployee[r.employeeId] = {
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        hadir: 0, sakit: 0, izin: 0, telat: 0, alpha: 0, lembur: 0,
        overtimeMinutes: 0,
        lateMinutes: 0,
        daysWithCheckIn: 0,
        daysWithCheckOut: 0
      };
    }
    const rec = byEmployee[r.employeeId];
    if (rec[r.type] !== undefined) rec[r.type] += 1;
    if (r.type === ATTENDANCE_TYPES.TELAT || (r.lateMinutes || 0) > 0) rec.telat += 1;
    rec.lateMinutes += r.lateMinutes || 0;
    if (r.checkIn != null) rec.daysWithCheckIn += 1;
    if (r.checkOut != null) rec.daysWithCheckOut += 1;
    if ((r.overtimeMinutes || 0) > 0) {
      rec.overtimeMinutes += r.overtimeMinutes || 0;
      rec.lembur += 1;
    }
  });
  return byEmployee;
}

export { todayId, shiftEndMinutes };
