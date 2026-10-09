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

export async function createOncallBookingMulti({
  outletId, customerName, paymentMethod, packageName, durationMinutes,
  price, commissionPercent, hotelCommission, entries
}) {
  const { data, error } = await supabase.rpc('create_oncall_booking_multi', {
    p_outlet_id: outletId,
    p_customer_name: customerName,
    p_payment_method: paymentMethod,
    p_package_name: packageName,
    p_duration_minutes: durationMinutes,
    p_treatment_price: price,
    p_commission_percent: commissionPercent,
    p_hotel_commission: hotelCommission,
    p_entries: entries
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

export async function cancelOncallBooking(bookingId) {
  const { data, error } = await supabase.rpc('cancel_oncall_booking', {
    p_booking_id: bookingId
  });
  if (error) throw error;
  return data;
}

// RPC selesai_oncall_booking_office tidak lagi dipakai: transaksinya sudah
// berstatus 'selesai' sejak dibuat sehingga menekan tombol tidak mengubah apa
// pun, dan terapis tetap terkunci. Lihat selesaiOncallDanBebaskan di bawah.

/**
 * Selesaikan oncall DAN bebaskan terapis-nya.
 *
 * RPC `selesai_oncall_booking_office` tidak dipakai lagi karena tidak
 * accomplish apa pun yang terlihat: transaksinya sudah berstatus `selesai`
 * sejak dibuat, sehingga menekan tombol tidak mengubah apa pun, dan terapis
 * tetap terkunci. RPC itu juga menolak booking yang sudah `batal`, padahal
 * justru booking batal itulah yang mengunci terapis.
 *
 * Dua perbedaan penting dari RPC lama:
 *   1. Yang dihitung sebagai "menahan" hanya booking yang masih `berjalan`.
 *      Versi lama menghitung semua oncall historis yang tidak batal, jadi
 *      tidak pernah nol dan terapis pun tidak pernah dibebaskan.
 *   2. Pencocokan terapis memakai id booking, bukan hanya `current_group_id`,
 *      sehingga tetap jalan meski grup-nya menunjuk booking lain.
 */
export async function selesaiOncallDanBebaskan(bookingId) {
  const { data: rows, error: readErr } = await supabase
    .from('bookings')
    .select('id, therapist_id, therapist_name, status, paid, cancelled_at')
    .eq('id', bookingId)
    .limit(1);
  if (readErr) throw readErr;
  const booking = (rows || [])[0];
  if (!booking) throw new Error('Transaksi oncall tidak ditemukan.');

  if (booking.status !== 'batal' && booking.status !== 'selesai') {
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'selesai', paid: true, cancelled_at: null })
      .eq('id', bookingId);
    if (error) throw error;
  }

  return bebaskanTerapisDariOncall(booking.therapist_id, bookingId);
}

/**
 * Lepaskan terapis dari sesi oncall. Dipakai terpisah karena ada kasus
 * booking-nya sudah `batal` sehingga tidak bisa diselesaikan - tapi terapis
 * tetap terkunci di papan terapis dan tidak bisa menerima tamu.
 */
export async function bebaskanTerapisDariOncall(therapistId, bookingId) {
  if (!therapistId) return { freed: false, reason: 'booking oncall tidak punya terapis' };

  const { data: thRows, error: thErr } = await supabase
    .from('therapists')
    .select('id, name, status, current_group_id, current_booking_id, current_booking_ids')
    .eq('id', therapistId)
    .limit(1);
  if (thErr) throw thErr;
  const therapist = (thRows || [])[0];
  if (!therapist) return { freed: false, reason: 'terapis tidak ditemukan' };

  // Sesi lain yang masih benar-benar berjalan = treatment yang jam SELESAINYA
  // belum lewat. Tidak bisa pakai status 'berjalan' saja: status itu jarang
  // pernah ditutup kasir, sehingga selalu terhitung "masih aktif" dan terapis
  // tidak pernah bebas.
  const { data: aktif, error: akErr } = await supabase
    .from('bookings')
    .select('id, end_at')
    .eq('therapist_id', therapistId)
    .eq('status', 'berjalan')
    .gt('end_at', Date.now());
  if (akErr) throw akErr;
  const masihAktif = (aktif || []).filter((b) => b.id !== bookingId);

  const ids = Array.isArray(therapist.current_booking_ids) ? therapist.current_booking_ids : [];
  const group = therapist.current_group_id;
  const nyambungKeOncallIni = (group === `oncall:${bookingId}`) || ids.includes(bookingId);

  if (masihAktif.length === 0) {
    const { error } = await supabase
      .from('therapists')
      .update({
        status: 'free',
        current_outlet_id: null,
        current_booking_ids: null,
        current_booking_id: null,
        current_treatment_names: null,
        current_treatment_name: null,
        current_paid: null,
        current_payment_method: null,
        current_price: null,
        current_group_id: null,
        start_at: null,
        end_at: null
      })
      .eq('id', therapistId);
    if (error) throw error;
    return { freed: true, therapistName: therapist.name, sudahBebas: therapist.status === 'free' && !nyambungKeOncallIni };
  }

  // Masih ada sesi aktif: lepaskan hanya booking oncall ini, jangan sentuh
  // status terapis karena dia masih bekerja.
  const { error } = await supabase
    .from('therapists')
    .update({
      current_booking_ids: ids.filter((id) => id !== bookingId),
      current_booking_id: therapist.current_booking_id === bookingId ? null : therapist.current_booking_id,
      current_group_id: nyambungKeOncallIni ? null : group
    })
    .eq('id', therapistId);
  if (error) throw error;
  return { freed: false, therapistName: therapist.name, reason: 'masih ada sesi lain yang berjalan' };
}

// Booking oncall outlet pada satu hari WIB (konsisten dengan reportService).
function wibDayBoundsUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600000 - 1);
  return { startUtc, endUtc };
}

/** Batas UTC untuk rentang hari WIB inklusif. */
function wibRangeBoundsUtc(startDate, endDate) {
  const s = wibDayBoundsUtc(startDate).startUtc;
  const e = wibDayBoundsUtc(endDate).endUtc;
  return { startUtc: s, endUtc: e };
}

function mapOncall(r) {
  return {
    id: r.id,
    outletId: r.outlet_id,
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
    status: r.status,
    createdAt: r.created_at
  };
}

export async function getTodayOncall(outletId, dateStr) {
  const { startUtc, endUtc } = wibDayBoundsUtc(dateStr);
  let query = supabase
    .from('bookings')
    .select('*')
    .eq('booking_source', 'oncall')
    .gte('created_at', startUtc.toISOString())
    .lte('created_at', endUtc.toISOString());
  // outletId = null -> semua outlet (dipakai office/admin pusat).
  if (outletId) query = query.eq('outlet_id', outletId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapOncall);
}

/**
 * Booking oncall pada rentang tanggal WIB (inklusif), terbaru dulu.
 * Dipakai halaman office untuk mengoreksi data oncall tanggal lalu -
 * getTodayOncall hanya bisa melihat hari ini, jadi transaksi yang
 * tercatat salah tanggal tidak bisa disentuh dari sana.
 * outletId = null -> semua outlet.
 */
export async function getOncallRange(outletId, startDate, endDate) {
  const { startUtc, endUtc } = wibRangeBoundsUtc(startDate, endDate);
  let query = supabase
    .from('bookings')
    .select('*')
    .eq('booking_source', 'oncall')
    .gte('created_at', startUtc.toISOString())
    .lte('created_at', endUtc.toISOString());
  if (outletId) query = query.eq('outlet_id', outletId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapOncall);
}

export function outletNames() {
  return Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));
}