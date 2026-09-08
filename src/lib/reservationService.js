import { supabase } from './supabase';
import { createBookingCore } from './bookingService';

export async function createReservation({
  outletId, therapistId, therapistName, category, treatmentId, treatmentName,
  treatmentPrice, commissionPercent, durationMinutes, oilType, oilSize,
  customerName, customerPhone, scheduledAt, usesOil = true
}) {
  const { error } = await supabase.from('reservations').insert({
    outlet_id: outletId,
    therapist_id: therapistId,
    therapist_name: therapistName,
    category: category || null,
    treatment_id: treatmentId || null,
    treatment_name: treatmentName || null,
    treatment_price: treatmentPrice || null,
    commission_percent: commissionPercent || null,
    duration_minutes: durationMinutes || null,
    uses_oil: usesOil,
    oil_type: usesOil ? oilType : null,
    oil_size: usesOil ? oilSize : null,
    customer_name: customerName || '',
    customer_phone: customerPhone || '',
    scheduled_at: scheduledAt,
    status: 'terjadwal'
  });
  if (error) throw error;
}

function mapReservation(row) {
  return {
    id: row.id,
    outletId: row.outlet_id,
    therapistId: row.therapist_id,
    therapistName: row.therapist_name,
    category: row.category,
    treatmentId: row.treatment_id,
    treatmentName: row.treatment_name,
    treatmentPrice: row.treatment_price != null ? Number(row.treatment_price) : 0,
    commissionPercent: row.commission_percent != null ? Number(row.commission_percent) : 0,
    durationMinutes: row.duration_minutes,
    usesOil: row.uses_oil,
    oilType: row.oil_type,
    oilSize: row.oil_size,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    scheduledAt: row.scheduled_at,
    status: row.status
  };
}

export function listenReservations(outletId, callback) {
  const channel = supabase
    .channel(`resv-${outletId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
      load();
    })
    .subscribe();

  async function load() {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('outlet_id', outletId)
      .order('scheduled_at');
    if (error) { console.warn(error); return; }
    callback((data || []).map(mapReservation));
  }
  load();

  return () => supabase.removeChannel(channel);
}

export async function checkInReservation({ outletId, reservation, treatment, oilType, oilSize, usesOil = true }) {
  await createBookingCore({
    outletId,
    therapistId: reservation.therapistId,
    therapistName: reservation.therapistName,
    treatmentId: treatment.id,
    treatmentName: treatment.name,
    treatmentPrice: treatment.price,
    commissionPercent: treatment.commissionPercent,
    durationMinutes: treatment.durationMinutes,
    usesOil,
    oilType: usesOil ? oilType : null,
    oilSize: usesOil ? oilSize : null,
    customerName: reservation.customerName
  });
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'checked_in' })
    .eq('id', reservation.id);
  if (error) throw error;
}

export async function cancelReservation(outletId, reservationId) {
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'batal' })
    .eq('id', reservationId);
  if (error) throw error;
}
