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
    .select('outlet_id, therapist_id, therapist_name, treatment_price, commission_amount, status, paid, payment_method, original_price')
    .gte('created_at', startUtc.toISOString())
    .lte('created_at', endUtc.toISOString());
  if (error) throw error;
  return (data || []).map(mapBooking);
}

export function summarizeDailyBookings(bookings) {
  const counted = bookings.filter((b) => b.status !== 'batal');

  const summary = {
    totalTreatment: counted.length,
    totalCommission: 0,
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

export async function getCombinedDailyReport(dateStr) {
  const perOutlet = {};
  let grandTotalTreatment = 0;
  let grandTotalCommission = 0;
  let grandTotalRevenue = 0;
  let grandTotalDiscount = 0;
  const therapistCommissions = {};

  const bookingsAll = await getAllDailyBookings(dateStr);
  for (const outlet of OUTLETS) {
    const bookings = bookingsAll.filter((b) => b.outletId === outlet.id);
    const summary = summarizeDailyBookings(bookings);
    perOutlet[outlet.id] = { outletName: outlet.name, ...summary };
    grandTotalTreatment += summary.totalTreatment;
    grandTotalCommission += summary.totalCommission;
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
    grandTotalRevenue,
    grandTotalDiscount,
    therapistCommissions
  };
}
