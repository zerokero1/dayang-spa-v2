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

export async function getDailyBookings(outletId, dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(dateStr + 'T23:59:59');
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('outlet_id', outletId)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  if (error) throw error;
  return (data || []).map(mapBooking);
}

export function summarizeDailyBookings(bookings) {
  const counted = bookings.filter((b) => b.status !== 'batal');

  const summary = {
    totalTreatment: counted.length,
    totalCommission: 0,
    totalRevenue: 0,
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
  const totals = {};
  for (const outlet of OUTLETS) {
    const bookings = await getDailyBookings(outlet.id, dateStr);
    bookings.forEach((b) => {
      if (b.status === 'batal') return;
      totals[b.therapistId] = (totals[b.therapistId] || 0) + (b.treatmentPrice || 0);
    });
  }
  return totals;
}

export async function getTherapistDailyCommissions(dateStr) {
  const totals = {};
  for (const outlet of OUTLETS) {
    const bookings = await getDailyBookings(outlet.id, dateStr);
    bookings.forEach((b) => {
      if (b.status === 'batal') return;
      totals[b.therapistId] = (totals[b.therapistId] || 0) + (b.commissionAmount || 0);
    });
  }
  return totals;
}

export async function getCombinedDailyReport(dateStr) {
  const perOutlet = {};
  let grandTotalTreatment = 0;
  let grandTotalCommission = 0;
  let grandTotalRevenue = 0;

  for (const outlet of OUTLETS) {
    const bookings = await getDailyBookings(outlet.id, dateStr);
    const summary = summarizeDailyBookings(bookings);
    perOutlet[outlet.id] = { outletName: outlet.name, ...summary };
    grandTotalTreatment += summary.totalTreatment;
    grandTotalCommission += summary.totalCommission;
    grandTotalRevenue += summary.totalRevenue;
  }

  return { perOutlet, grandTotalTreatment, grandTotalCommission, grandTotalRevenue };
}
