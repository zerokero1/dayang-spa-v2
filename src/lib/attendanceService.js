import { supabase } from './supabase';
import { ATTENDANCE_TYPES } from './constants';

function todayId(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function recordAttendance({
  outletId, employeeId, employeeName, type, overtimeMinutes, note, date
}) {
  const dayId = todayId(date ? new Date(date) : new Date());
  const { error } = await supabase.from('attendance').upsert({
    employee_id: employeeId,
    employee_name: employeeName,
    outlet_id: outletId || null,
    date: dayId,
    type,
    overtime_minutes: type === ATTENDANCE_TYPES.LEMBUR ? (overtimeMinutes || 0) : 0,
    note: note || ''
  });
  if (error) throw error;
}

export async function getAttendanceRange(startDate, endDate, outletId) {
  let query = supabase
    .from('attendance')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);
  if (outletId) query = query.eq('outlet_id', outletId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((r) => ({
    id: `${r.employee_id}_${r.date}`,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    outletId: r.outlet_id,
    date: r.date,
    type: r.type,
    overtimeMinutes: r.overtime_minutes,
    note: r.note
  }));
}

export function summarizeAttendance(records) {
  const byEmployee = {};
  records.forEach((r) => {
    if (!byEmployee[r.employeeId]) {
      byEmployee[r.employeeId] = {
        employeeName: r.employeeName,
        hadir: 0, sakit: 0, izin: 0, telat: 0, alpha: 0, lembur: 0, overtimeMinutes: 0
      };
    }
    const rec = byEmployee[r.employeeId];
    if (rec[r.type] !== undefined) rec[r.type] += 1;
    if (r.type === ATTENDANCE_TYPES.LEMBUR) rec.overtimeMinutes += (r.overtimeMinutes || 0);
  });
  return byEmployee;
}
