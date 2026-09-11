import { supabase } from './supabase';
import { OUTLETS } from './constants';

function mapBooking(row) {
  return {
    id: row.id,
    outletId: row.outlet_id,
    therapistId: row.therapist_id,
    therapistName: row.therapist_name,
    treatmentId: row.treatment_id,
    treatmentName: row.treatment_name,
    treatmentPrice: row.treatment_price != null ? Number(row.treatment_price) : 0,
    commissionPercent: row.commission_percent != null ? Number(row.commission_percent) : 0,
    commissionAmount: row.commission_amount != null ? Number(row.commission_amount) : 0,
    durationMinutes: row.duration_minutes,
    usesOil: row.uses_oil,
    oilType: row.oil_type,
    oilSize: row.oil_size,
    customerName: row.customer_name,
    status: row.status,
    paid: row.paid,
    paymentMethod: row.payment_method,
    groupId: row.group_id,
    startAt: row.start_at,
    endAt: row.end_at,
    originalPrice: row.original_price != null ? Number(row.original_price) : null,
    discountPct: row.discount_pct != null ? Number(row.discount_pct) : null,
    discountReason: row.discount_reason,
    bookingSource: row.booking_source,
    hotelCommission: row.hotel_commission != null ? Number(row.hotel_commission) : 0,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at
  };
}

// Batas UTC untuk satu hari LOKAL (WIB = UTC+7) agar konsisten,
// tidak bergantung zona waktu mesin/browser.
function wibDayBoundsUtc(dateStr) {
  // dateStr format "YYYY-MM-DD". 00:00 WIB = 17:00 UTC hari sebelumnya.
  const startLocal = new Date(dateStr + 'T00:00:00Z'); // bailout parse
  const [y, m, d] = dateStr.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600000); // 00:00 WIB
  const endUtc = new Date(startUtc.getTime() + 24 * 3600000 - 1); // sampai 23:59:59 WIB
  return { startUtc, endUtc };
}

export async function getDailyBookings(outletId, dateStr) {
  const { startUtc, endUtc } = wibDayBoundsUtc(dateStr);
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('outlet_id', outletId)
    .gte('created_at', startUtc.toISOString())
    .lte('created_at', endUtc.toISOString());
  if (error) throw error;
  return (data || []).map(mapBooking);
}

// Optimasi: ambil semua booking hari itu dalam SATU query (semua outlet),
// hanya kolom yang dibutuhkan konsumen. Mengurangi request ke Supabase.
async function getAllDailyBookings(dateStr) {
  const { startUtc, endUtc } = wibDayBoundsUtc(dateStr);
  const { data, error } = await supabase
    .from('bookings')
    .select('outlet_id, therapist_id, therapist_name, treatment_price, commission_amount, status, paid, payment_method, original_price, booking_source, hotel_commission')
    .gte('created_at', startUtc.toISOString())
    .lte('created_at', endUtc.toISOString());
  if (error) throw error;
  return (data || []).map(mapBooking);
}

// Format tanggal dari komponen LOKAL (WIB) — bukan toISOString (UTC),
// agar rentang "hari ini" tidak tergeser 1 hari mundur.
function fmtLocalDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Ambil semua booking dalam rentang tanggal (semua outlet) — di-loop per hari
// supaya agregat per minggu/bulan konsisten dengan batas WIB per hari.
export async function getAllBookingsRange(startDate, endDate) {
  const all = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = fmtLocalDate(d);
    try {
      const rows = await getAllDailyBookings(dateStr);
      all.push(...rows);
    } catch (e) {
      console.warn('getAllBookingsRange error', dateStr, e);
    }
  }
  return all;
}

// Booking satu outlet dalam rentang tanggal (untuk mode "Outlet ini saja").
export async function getDailyBookingsRange(outletId, startDate, endDate) {
  const all = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = fmtLocalDate(d);
    try {
      const rows = await getDailyBookings(outletId, dateStr);
      all.push(...rows);
    } catch (e) {
      console.warn('getDailyBookingsRange error', dateStr, e);
    }
  }
  return all;
}

export function summarizeDailyBookings(bookings) {
  const counted = bookings.filter((b) => b.status !== 'batal');

  const summary = {
    totalTreatment: counted.length,
    totalCommission: 0,
    totalHotelCommission: 0,
    totalRevenue: 0,
    totalDiscount: 0,
    totalBatal: bookings.length - counted.length,
    cashRevenue: 0,
    cardlessRevenue: 0,
    unpaidRevenue: 0,
    unpaidCount: 0,
    byTherapist: {}
  };

  counted.forEach((b) => {
    summary.totalCommission += b.commissionAmount || 0;
    summary.totalHotelCommission += b.bookingSource === 'oncall' ? (b.hotelCommission || 0) : 0;
    summary.totalRevenue += b.treatmentPrice || 0;

    if (b.originalPrice != null && Number(b.originalPrice) > Number(b.treatmentPrice)) {
      summary.totalDiscount += Number(b.originalPrice) - Number(b.treatmentPrice);
    }

    if (b.paid) {
      if (b.paymentMethod === 'cardless') summary.cardlessRevenue += b.treatmentPrice || 0;
      else summary.cashRevenue += b.treatmentPrice || 0;
    } else {
      summary.unpaidRevenue += b.treatmentPrice || 0;
      summary.unpaidCount += 1;
    }

    if (!summary.byTherapist[b.therapistId]) {
      summary.byTherapist[b.therapistId] = {
        therapistName: b.therapistName,
        treatmentCount: 0,
        commissionTotal: 0
      };
    }
    const t = summary.byTherapist[b.therapistId];
    t.treatmentCount += 1;
    t.commissionTotal += b.commissionAmount || 0;
  });

  return summary;
}

export async function getTherapistDailyTotals(dateStr) {
  const { totals } = await getTherapistDailyReport(dateStr);
  return totals;
}

export async function getTherapistDailyCommissions(dateStr) {
  const { commissions } = await getTherapistDailyReport(dateStr);
  return commissions;
}

// Total harga & komisi per terapis dihitung dari SATU query yang sama
// (sebelumnya dipanggil 2x → 2 query identik untuk 2 fungsi).
export async function getTherapistDailyReport(dateStr) {
  const totals = {};
  const commissions = {};
  const bookings = await getAllDailyBookings(dateStr);
  bookings.forEach((b) => {
    if (b.status === 'batal') return;
    totals[b.therapistId] = (totals[b.therapistId] || 0) + (b.treatmentPrice || 0);
    commissions[b.therapistId] = (commissions[b.therapistId] || 0) + (b.commissionAmount || 0);
  });
  return { totals, commissions };
}

export async function getCombinedDailyReport(startDate, endDate) {
  const perOutlet = {};
  let grandTotalTreatment = 0;
  let grandTotalCommission = 0;
  let grandTotalHotelCommission = 0;
  let grandTotalRevenue = 0;
  let grandTotalDiscount = 0;
  const therapistCommissions = {};

  const bookingsAll = endDate ? await getAllBookingsRange(startDate, endDate) : await getAllDailyBookings(startDate);
  for (const outlet of OUTLETS) {
    const bookings = bookingsAll.filter((b) => b.outletId === outlet.id);
    const summary = summarizeDailyBookings(bookings);
    perOutlet[outlet.id] = { outletName: outlet.name, ...summary };
    grandTotalTreatment += summary.totalTreatment;
    grandTotalCommission += summary.totalCommission;
    grandTotalHotelCommission += summary.totalHotelCommission;
    grandTotalRevenue += summary.totalRevenue;
    grandTotalDiscount += summary.totalDiscount;

    // Gabungkan komisi per terapis lintas outlet (nama terapis + jumlah)
    for (const oId of Object.keys(summary.byTherapist)) {
      const t = summary.byTherapist[oId];
      if (!therapistCommissions[oId]) {
        therapistCommissions[oId] = { therapistName: t.therapistName || oId, commissionTotal: 0, treatmentCount: 0 };
      }
      therapistCommissions[oId].commissionTotal += t.commissionTotal;
      therapistCommissions[oId].treatmentCount += t.treatmentCount;
    }
  }

  return {
    perOutlet,
    grandTotalTreatment,
    grandTotalCommission,
    grandTotalHotelCommission,
    grandTotalRevenue,
    grandTotalDiscount,
    therapistCommissions
  };
}

export async function getCommissionStaffReport(startDate, endDate) {
  const bookingsAll = endDate ? await getAllBookingsRange(startDate, endDate) : await getAllDailyBookings(startDate);
  const staff = {};
  bookingsAll.forEach((b) => {
    if (b.status === 'batal') return;
    const key = b.therapistName || String(b.therapistId);
    if (!staff[key]) {
      staff[key] = { therapistName: key, treatmentCount: 0, commissionTotal: 0, outlets: {} };
    }
    const s = staff[key];
    s.treatmentCount += 1;
    s.commissionTotal += b.commissionAmount || 0;
    s.outlets[b.outletId] = true;
  });
  return Object.values(staff)
    .map((s) => ({
      therapistName: s.therapistName,
      treatmentCount: s.treatmentCount,
      commissionTotal: s.commissionTotal,
      outlets: Object.keys(s.outlets)
        .map((oid) => OUTLETS.find((o) => o.id === oid)?.name || oid)
        .sort()
    }))
    .sort((a, b) => b.commissionTotal - a.commissionTotal);
}

// Ukuran botol: Kecil = 10ml, Besar = 30ml (keterangan saja; dipakai laporan produksi).
export const OIL_BOTTLE_ML = { Kecil: 10, Besar: 30 };

// Ambil semua booking non-batal dalam rentang tanggal (semua outlet),
// cukup untuk laporan produksi: nama treatment + pemakaian minyak per hari.
export async function getProductionBookings(startDate, endDate) {
  const [y0, m0, d0] = startDate.split('-').map(Number);
  const [y1, m1, d1] = endDate.split('-').map(Number);
  // 00:00 WIB = 17:00 UTC tanggal yang sama (WIB = UTC+7).
  const startUtc = new Date(Date.UTC(y0, m0 - 1, d0, 17, 0, 0)).toISOString();
  const endUtc = new Date(Date.UTC(y1, m1 - 1, d1 + 1, 16, 59, 59)).toISOString();

  const { data, error } = await supabase
    .from('bookings')
    .select('outlet_id, treatment_name, oil_type, oil_size, uses_oil, status, created_at')
    .gte('created_at', startUtc)
    .lte('created_at', endUtc);
  if (error) throw error;

  return (data || [])
    .filter((b) => b.status !== 'batal')
    .map((b) => ({
      outletId: b.outlet_id,
      treatmentName: b.treatment_name || '-',
      oilType: b.uses_oil ? b.oil_type || null : null,
      oilSize: b.uses_oil ? b.oil_size || null : null,
      date: wibDateStr(b.created_at)
    }));
}

// Tanggal LOKAL WIB dari timestamp DB, tak bergantung zona waktu perangkat.
function wibDateStr(iso) {
  const wib = new Date(new Date(iso).getTime() + 7 * 3600000);
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${m}-${d}`;
}

// Agregasi laporan produksi: jumlah treatment & pemakaian minyak (ml)
// per jenis, per tanggal, per outlet — sekaligus total gabungan.
export function buildProductionReport(rows, outletIds) {
  const byTreatment = {};
  const byOil = {};
  const byDateTreatment = {};
  const byDateOil = {};

  const bump = (map, key, outletId, amount) => {
    if (!map[key]) map[key] = {};
    map[key][outletId] = (map[key][outletId] || 0) + amount;
  };

  rows.forEach((b) => {
    bump(byTreatment, b.treatmentName, b.outletId, 1);
    bump(byDateTreatment, b.date, b.outletId, 1);

    if (b.oilType) {
      const key = b.oilSize ? `${b.oilType} (${b.oilSize})` : b.oilType;
      // 1 treatment memakai minyak = 1 botol (Kecil 10ml / Besar 30ml).
      bump(byOil, key, b.outletId, 1);
      bump(byDateOil, b.date, b.outletId, 1);
    }
  });

  const rowsOf = (map) =>
    Object.entries(map)
      .map(([label, perOutlet]) => ({
        label,
        perOutlet,
        total: outletIds.reduce((s, oid) => s + (perOutlet[oid] || 0), 0)
      }))
      .sort((a, b) => b.total - a.total);

  const dates = Object.keys(byDateTreatment).sort();

  return {
    byTreatment: rowsOf(byTreatment),
    byOil: rowsOf(byOil),
    dateRows: dates.map((date) => ({
      date,
      treatmentTotal: outletIds.reduce((s, oid) => s + (byDateTreatment[date][oid] || 0), 0),
      oilTotal: outletIds.reduce((s, oid) => s + (byDateOil[date][oid] || 0), 0),
      treatmentPerOutlet: byDateTreatment[date] || {},
      oilPerOutlet: byDateOil[date] || {}
    })),
    totalTreatment: rows.length,
    totalOilBottles: outletIds.reduce((s, oid) => {
      let sum = 0;
      for (const o of Object.values(byOil)) sum += o[oid] || 0;
      return s + sum;
    }, 0)
  };
}
