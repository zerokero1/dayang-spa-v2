import { supabase } from './supabase';
import { OUTLETS } from './constants';

export async function createOncallBooking({
  outletId, therapistId, packageName, durationMinutes, price,
  commissionPercent, customerName, paymentMethod, hotelCommission
}) {
  const { data, error } = await supabase.rpc('create_oncall_booking', {
    p_outlet_id: outletId,
    p_therapist_id: therapistId,
    p_package_name: packageName,
    p_duration_minutes: durationMinutes,
    p_treatment_price: price,
    p_customer_name: customerName,
    p_payment_method: paymentMethod,
    p_commission_percent: commissionPercent,
    p_hotel_commission: hotelCommission
  });
  if (error) throw error;
  return data;
}

export async function editOncallBooking({
  bookingId, therapistId, therapistName, packageName, durationMinutes,
  price, commissionPercent, hotelCommission, customerName, paymentMethod
}) {
  const { data, error } = await supabase.rpc('edit_oncall_booking', {
    p_booking_id: bookingId,
    p_therapist_id: therapistId,
    p_therapist_name: therapistName,
    p_package_name: packageName,
    p_duration_minutes: durationMinutes,
    p_price: price,
    p_commission_percent: commissionPercent,
    p_hotel_commission: hotelCommission,
    p_customer_name: customerName,
    p_payment_method: paymentMethod
  });
  if (error) throw error;
  return data;
}

// Booking oncall outlet pada satu hari WIB (konsisten dengan reportService).
function wibDayBoundsUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600000 - 1);
  return { startUtc, endUtc };
}

export async function getTodayOncall(outletId, dateStr) {
  const { startUtc, endUtc } = wibDayBoundsUtc(dateStr);
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('booking_source', 'oncall')
    .gte('created_at', startUtc.toISOString())
    .lte('created_at', endUtc.toISOString());
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    therapistId: r.therapist_id,
    therapistName: r.therapist_name,
    treatmentName: r.treatment_name,
    treatmentPrice: r.treatment_price != null ? Number(r.treatment_price) : 0,
    hotelCommission: r.hotel_commission != null ? Number(r.hotel_commission) : 0,
    commissionAmount: r.commission_amount != null ? Number(r.commission_amount) : 0,
    commissionPercent: r.commission_percent != null ? Number(r.commission_percent) : 0,
    durationMinutes: r.duration_minutes,
    customerName: r.customer_name,
    paymentMethod: r.payment_method,
    createdAt: r.created_at
  }));
}

export function outletNames() {
  return Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));
}