import { supabase } from './supabase';
import { OUTLETS, SHIFTS } from './constants';

// Jam selesai shift normal (menit sejak 00:00) — patokan overtime.
//  - Shift SP / Split    : 11:00-15:00 & 18:00-23:00 -> selesai 23:00
//  - Shift Malam         : 15:00-23:00               -> selesai 23:00
//  - Shift ST / Short    : 11:00-17:00               -> selesai 17:00
const SHIFT_END_MINUTES = {
  [SHIFTS.SP]: 23 * 60,
  [SHIFTS.MALAM]: 23 * 60,
  [SHIFTS.ST]: 17 * 60
};

function toMinutes(ms) {
  return Math.max(0, Math.floor(ms / 60000));
}

// Batas UTC untuk satu hari LOKAL (WIB = UTC+7)
function wibDayBoundsUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600000 - 1);
  return { startUtc, endUtc };
}

/**
 * Hitung overtime per terapis pada rentang tanggal, bersumber dari DATA BOOKING.
 *
 * Definisi overtime:
 *   - Waktu kerja aktual terapis per hari = akhir treatment TERAKHIR (max end_at)
 *     dari booking non-batal (berjalan/lunas/selesai) pada hari itu.
 *   - Patokan = jam selesai shift normal terapis (lihat SHIFT_END_MINUTES).
 *   - Overtime (menit) = kelebihan waktu kerja aktual di atas jam selesai shift.
 *     Kalau terapis tidak punya shift -> overtime tidak bisa dihitung (dibuat 0
 *     dan ditandai shift = null).
 */
export async function getOvertimeReport(startDate, endDate) {
  const { data: therapists, error: terr } = await supabase
    .from('therapists')
    .select('id, name, shift');
  if (terr) throw terr;
  const therapistById = Object.fromEntries((therapists || []).map((t) => [t.id, t]));

  // Ambil semua booking dalam rentang (semua outlet) — sekali query per hari.
  const allBookings = [];
  for (let d = new Date(startDate + 'T00:00:00'); d <= new Date(endDate + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const { startUtc, endUtc } = wibDayBoundsUtc(dateStr);
      const { data, error } = await supabase
        .from('bookings')
        .select('id, outlet_id, therapist_id, therapist_name, treatment_name, treatment_price, commission_percent, start_at, end_at, status')
        .gte('start_at', startUtc.getTime())
        .lte('start_at', endUtc.getTime());
      if (error) throw error;
      allBookings.push(...(data || []).map((r) => ({ ...r, date: dateStr })));
    } catch (e) {
      // lewati hari error, lanjut hari berikutnya
      console.warn('overtime fetch error', dateStr, e);
    }
  }

  // Kunci: therapist_id + date
  const rows = {};
  allBookings.forEach((b) => {
    // Hanya booking yang berlaku (bukan batal)
    if (b.status === 'batal' || b.status === 'batal_sebagian') return;
    if (!b.therapist_id || !b.date) return;
    const key = `${b.therapist_id}|${b.date}`;
    if (!rows[key]) {
      rows[key] = {
        therapistId: b.therapist_id,
        therapistName: b.therapist_name,
        date: b.date,
        outletId: b.outlet_id,
        treatmentCount: 0,
        maxEndAt: null
      };
    }
    rows[key].treatmentCount += 1;
    if (b.end_at != null && (rows[key].maxEndAt == null || Number(b.end_at) > rows[key].maxEndAt)) {
      rows[key].maxEndAt = Number(b.end_at);
    }
  });

  const result = Object.values(rows).map((row) => {
    const therapist = therapistById[row.therapistId] || null;
    const shift = therapist ? therapist.shift : null;
    const shiftEndMin = shift ? SHIFT_END_MINUTES[shift] : null;

    let overtimeMinutes = 0;
    if (shiftEndMin != null && row.maxEndAt != null) {
      const shiftEndMs = wibDayShiftEndMs(row.date, shiftEndMin);
      overtimeMinutes = Math.max(0, toMinutes(row.maxEndAt - shiftEndMs));
    }

    return {
      therapistId: row.therapistId,
      therapistName: row.therapistName,
      date: row.date,
      outletId: row.outletId,
      outletName: OUTLETS.find((o) => o.id === row.outletId)?.name || row.outletId || '-',
      treatmentCount: row.treatmentCount,
      shift,
      overtimeMinutes,
      maxEndAt: row.maxEndAt
    };
  });

  result.sort((a, b) => (a.date === b.date ? a.therapistName.localeCompare(b.therapistName) : a.date.localeCompare(b.date)));
  return result;
}

// Jam selesai shift pada tanggal tertentu (WIB) dalam epoch ms.
function wibDayShiftEndMs(dateStr, shiftEndMin) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // jam selesai shift dalam WIB -> konversi ke UTC ms, lalu tambah offset WIB
  const endLocal = new Date(Date.UTC(y, m - 1, d, Math.floor(shiftEndMin / 60), shiftEndMin % 60, 0));
  return endLocal.getTime() - 7 * 3600000;
}

/**
 * Agregasi overtime otomatis (dari data booking) per karyawan pada rentang tanggal.
 * Return: { [employeeId]: { employeeName, totalOvertimeMinutes, daysCount } }
 */
export async function getOvertimeByEmployee(startDate, endDate) {
  const rows = await getOvertimeReport(startDate, endDate);
  const byEmployee = {};
  rows.forEach((r) => {
    if (!byEmployee[r.therapistId]) {
      byEmployee[r.therapistId] = { employeeName: r.therapistName, totalOvertimeMinutes: 0, daysCount: 0 };
    }
    byEmployee[r.therapistId].totalOvertimeMinutes += r.overtimeMinutes;
    if (r.overtimeMinutes > 0) byEmployee[r.therapistId].daysCount += 1;
  });
  return byEmployee;
}
