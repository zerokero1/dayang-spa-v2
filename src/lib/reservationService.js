import { supabase } from './supabase';
import { createBookingCore } from './bookingService';

export async function createReservation({
  outletId, therapistId, therapistName, category, treatmentId, treatmentName,
  treatmentPrice, commissionPercent, durationMinutes, oilType, oilSize,
  customerName, customerPhone, scheduledAt, usesOil = true
}) {
  let scheduledAtIso = scheduledAt;
  if (scheduledAt instanceof Date) {
    scheduledAtIso = scheduledAt.toISOString();
  } else if (typeof scheduledAt === 'number' && !Number.isNaN(scheduledAt)) {
    scheduledAtIso = new Date(scheduledAt).toISOString();
  } else if (typeof scheduledAt === 'string' && scheduledAt) {
    const d = new Date(scheduledAt);
    scheduledAtIso = Number.isNaN(d.getTime()) ? scheduledAt : d.toISOString();
  }

  const { data, error } = await supabase.from('reservations').insert({
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
    scheduled_at: scheduledAtIso,
    status: 'terjadwal'
  }).select().single();
  if (error) throw error;
  // Balikkan baris yang tersimpan supaya halaman bisa langsung mengirim
  // pengingat WA tanpa harus menunggu daftar ter-refresh.
  return mapReservation(data);
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

/**
 * Ubah satu reservasi jadi BEBERAPA booking sekaligus - dipakai kalau satu
 * pelanggan punya beberapa treatment di jam yang sama, misalnya dua massage
 * untuk pasangan yang datang barengan plus satu manicure.
 *
 * Semua booking dari satu reservasi diberi group_id yang sama supaya jelas
 * berasal dari satu tanggal & satu pelanggan, persis seperti keranjang di
 * halaman Kasir. Booking pertama memakai terapis milik reservasi; booking
 * berikutnya boleh terapis sendiri, jadi dua orang bisa menangani tamu yang
 * sama bersamaan.
 *
 * createBookingCore dipanggil satu per satu, bukan createBookingsBatch, karena
 * yang terakhir otomatis membuka WhatsApp - di halaman reservasi kirim ke grup
 * dilakukan kasir sendiri lewat tombolnya.
 *
 * @param {object} reservation - baris reservasi asal
 * @param {Array<{therapistId:string,therapistName:string,treatment:object,oilType?:string,oilSize?:string,usesOil?:boolean}>} items
 * @returns {Promise<string[]>} id booking yang dibuat
 */
export async function checkInReservationMulti({ reservation, items }) {
  if (!items || !items.length) throw new Error('Belum ada treatment yang dipilih.');

  const groupId = items.length > 1
    ? `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    : null;

  const bookingIds = [];
  for (const it of items) {
    const usesOil = it.usesOil !== false;
    const therapistId = it.therapistId || reservation.therapistId;
    const therapistName = it.therapistName || reservation.therapistName;
    // Satu grup bisa berisi banyak orang, jadi tiap baris boleh punya nama
    // sendiri. Baris yang namanya dikosongkan ikut memakai nama pelanggan
    // yang tercatat di reservasi.
    const customerName = (it.customerName || '').trim() || reservation.customerName || '';
    const id = await createBookingCore({
      outletId: reservation.outletId,
      therapistId,
      therapistName,
      treatmentId: it.treatment.id,
      treatmentName: it.treatment.name,
      treatmentPrice: it.treatment.price,
      commissionPercent: it.treatment.commissionPercent,
      durationMinutes: it.treatment.durationMinutes,
      usesOil,
      oilType: usesOil ? it.oilType : null,
      oilSize: usesOil ? it.oilSize : null,
      customerName,
      groupId
    });
    bookingIds.push(id);
  }

  const { error } = await supabase
    .from('reservations')
    .update({ status: 'checked_in' })
    .eq('id', reservation.id);
  if (error) throw error;
  return bookingIds;
}

export async function cancelReservation(outletId, reservationId) {
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'batal' })
    .eq('id', reservationId);
  if (error) throw error;
}
