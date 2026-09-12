import { supabase } from './supabase';
import { THERAPIST_STATUS } from './constants';

export async function createBookingCore({
  outletId, therapistId, therapistName, treatmentId, treatmentName,
  treatmentPrice, commissionPercent, durationMinutes, oilType, oilSize, customerName, paid, paymentMethod, groupId,
  usesOil = true, therapist = 'set', originalPrice, discountReason
}) {
  const isPaid = !!paid;
  const method = paymentMethod || 'cash';
  const commissionAmount = Math.round((commissionPercent / 100) * treatmentPrice);

  const { data: bookingId, error } = await supabase.rpc('create_booking', {
    p_outlet_id: outletId,
    p_therapist_id: therapistId,
    p_therapist_name: therapistName,
    p_treatment_id: treatmentId,
    p_treatment_name: treatmentName,
    p_treatment_price: treatmentPrice,
    p_original_price: originalPrice || null,
    p_commission_percent: commissionPercent,
    p_duration_minutes: durationMinutes,
    p_uses_oil: usesOil,
    p_oil_type: usesOil ? oilType : null,
    p_oil_size: usesOil ? oilSize : null,
    p_customer_name: customerName || '',
    p_paid: isPaid,
    p_payment_method: method,
    p_group_id: groupId || null,
    p_update_therapist: therapist !== 'suppress',
    p_discount_reason: discountReason || null
  });
  if (error) throw error;

  // RPC create_booking menolak via exception bila stok habis -> sudah tertangkap.
  return {
    bookingId,
    therapistName, treatmentName,
    oilType: usesOil ? oilType : null,
    oilSize: usesOil ? oilSize : null,
    treatmentPrice, durationMinutes, paid: isPaid, paymentMethod: method
  };
}

export async function createBooking(item) {
  const result = await createBookingCore(item);
  sendWhatsAppNotification({
    lines: [{
      therapistName: result.therapistName,
      treatmentName: result.treatmentName,
      oilType: result.oilType,
      oilSize: result.oilSize
    }],
    outletId: item.outletId,
    customerName: item.customerName
  });
  return result.bookingId;
}

export async function createBookingsBatch(items) {
  if (items.length === 0) return [];
  const groupId = items.length > 1
    ? `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    : null;

  for (const item of items) {
    if (!item.therapistId) {
      throw new Error(`Terapis tidak valid (id kosong) untuk ${item.therapistName || item.treatmentName}. Silakan muat ulang halaman.`);
    }
  }

  const payload = items.map((item) => {
    const usesOil = item.usesOil !== false;
    return {
      outlet_id: item.outletId,
      therapist_id: item.therapistId,
      therapist_name: item.therapistName,
      treatment_id: item.treatmentId,
      treatment_name: item.treatmentName,
      treatment_price: item.treatmentPrice,
      commission_percent: item.commissionPercent,
      duration_minutes: item.durationMinutes,
      uses_oil: usesOil,
      oil_type: usesOil ? item.oilType : null,
      oil_size: usesOil ? item.oilSize : null,
      customer_name: item.customerName || '',
      paid: !!item.paid,
      payment_method: item.paymentMethod || 'cash',
      original_price: item.originalPrice || null,
      discount_reason: item.discountReason || null
    };
  });

  const { data, error } = await supabase.rpc('create_booking_batch', {
    p_items: payload,
    p_group_id: groupId
  });
  if (error) throw error;

  const bookingIds = (data || []).map((r) => r.booking_id);

  const results = items.map((item, i) => ({
    bookingId: bookingIds[i],
    therapistName: item.therapistName,
    treatmentName: item.treatmentName,
    oilType: item.usesOil !== false ? item.oilType : null,
    oilSize: item.usesOil !== false ? item.oilSize : null
  }));

  sendWhatsAppNotification({
    lines: results,
    outletId: items[0]?.outletId,
    customerName: items[0]?.customerName
  });
  return bookingIds;
}

export async function continueTreatment({
  therapistId, treatmentId, treatmentName, treatmentPrice,
  commissionPercent, durationMinutes, oilType, oilSize, usesOil,
  customerName, paid, paymentMethod
}) {
  const { data: bookingId, error } = await supabase.rpc('continue_booking', {
    p_therapist_id: therapistId,
    p_treatment_id: treatmentId,
    p_treatment_name: treatmentName,
    p_treatment_price: treatmentPrice,
    p_commission_percent: commissionPercent,
    p_duration_minutes: durationMinutes,
    p_uses_oil: usesOil !== false,
    p_oil_type: usesOil !== false ? oilType : null,
    p_oil_size: usesOil !== false ? oilSize : null,
    p_customer_name: customerName || '',
    p_paid: !!paid,
    p_payment_method: paymentMethod || 'cash'
  });
  if (error) throw error;
  return bookingId;
}

export async function markBookingPaid(outletId, bookingId, therapistId, paymentMethod, discountPct, discountReason) {
  const { error } = await supabase.rpc('mark_booking_paid', {
    p_outlet_id: outletId,
    p_booking_id: bookingId,
    p_therapist_id: therapistId || null,
    p_payment_method: paymentMethod || null,
    p_discount_pct: (discountPct && discountPct > 0) ? discountPct : null,
    p_discount_reason: (discountPct && discountPct > 0) ? (discountReason || null) : null
  });
  if (error) throw error;
}

export async function editBookingDetails(outletId, bookingId, {
  treatmentId, treatmentName, treatmentPrice, commissionPercent, durationMinutes, oilType, oilSize, usesOil
}) {
  const { error } = await supabase.rpc('edit_booking_details', {
    p_outlet_id: outletId,
    p_booking_id: bookingId,
    p_treatment_id: treatmentId,
    p_treatment_name: treatmentName,
    p_treatment_price: treatmentPrice,
    p_commission_percent: commissionPercent,
    p_duration_minutes: durationMinutes,
    p_uses_oil: usesOil !== false,
    p_oil_type: usesOil !== false ? oilType : null,
    p_oil_size: usesOil !== false ? oilSize : null
  });
  if (error) throw error;
}

// Koreksi booking khusus akun office (office.op@dayang.com).
// Bisa mengubah treatment, % komisi, terapis, minyak, dan diskon.
export async function koreksiBooking(bookingId, {
  treatmentId, treatmentName, treatmentPrice,
  commissionPercent, newTherapistId, usesOil, oilType, oilSize,
  discountPct, discountReason
}) {
  const { error } = await supabase.rpc('edit_booking_correction', {
    p_booking_id: bookingId,
    p_treatment_id: treatmentId || null,
    p_treatment_name: treatmentName || null,
    p_treatment_price: treatmentPrice ?? null,
    p_commission_percent: commissionPercent ?? null,
    p_new_therapist_id: newTherapistId || null,
    p_uses_oil: usesOil ?? null,
    p_oil_type: oilType || null,
    p_oil_size: oilSize || null,
    p_discount_pct: discountPct ?? null,
    p_discount_reason: discountReason || null
  });
  if (error) throw error;
}

// Hapus treatment dari booking — khusus akun office (office.op@dayang.com).
// Menandai booking batal + catat audit + update status terapis bila berjalan.
export async function hapusBookingOffice(bookingId) {
  const { error } = await supabase.rpc('hapus_booking_office', {
    p_booking_id: bookingId
  });
  if (error) throw error;
}

// Ubah status bayar & metode pembayaran sebuah booking — khusus office.
// Dipakai di halaman Koreksi Booking untuk melunasi kasir yang lupa
// menandai bayar, atau membetulkan metode (cash/cardless).
export async function koreksiPembayaran(bookingId, { paid, paymentMethod }) {
  const { error } = await supabase.rpc('koreksi_pembayaran', {
    p_booking_id: bookingId,
    p_paid: !!paid,
    p_payment_method: paid ? (paymentMethod || null) : null
  });
  if (error) throw error;
}

function bookingIdsOf(t) {
  if (Array.isArray(t.currentBookingIds) && t.currentBookingIds.length) return t.currentBookingIds;
  return t.currentBookingId ? [t.currentBookingId] : [];
}

export async function completeBookingGroup(members) {
  for (const t of members) {
    if (t.currentOutletId) {
      for (const bId of bookingIdsOf(t)) {
        await completeBooking(t.currentOutletId, bId, t.id);
      }
    }
  }
}

export async function markGroupPaid(members, paymentMethod, discountPct, discountReason) {
  for (const t of members) {
    if (t.currentOutletId) {
      for (const bId of bookingIdsOf(t)) {
        await markBookingPaid(t.currentOutletId, bId, t.id, paymentMethod, discountPct, discountReason);
      }
    }
  }
}

export async function completeBooking(outletId, bookingId, therapistId) {
  const { error } = await supabase.rpc('complete_booking', {
    p_outlet_id: outletId,
    p_booking_id: bookingId,
    p_therapist_id: therapistId
  });
  if (error) throw error;
}

export async function cancelBookingFull(outletId, bookingId, therapistId) {
  const { error } = await supabase.rpc('cancel_booking_full', {
    p_outlet_id: outletId,
    p_booking_id: bookingId,
    p_therapist_id: therapistId
  });
  if (error) throw error;
}

export async function cancelBookingPartial(outletId, bookingId, therapistId, newPrice) {
  const { error } = await supabase.rpc('cancel_booking_partial', {
    p_outlet_id: outletId,
    p_booking_id: bookingId,
    p_therapist_id: therapistId,
    p_new_price: newPrice
  });
  if (error) throw error;
}

function sendWhatsAppNotification({ lines, outletId, customerName }) {
  const treatmentLines = lines
    .map((l) => {
      const oilInfo = l.oilType ? ` (Minyak ${l.oilType}, ${l.oilSize})` : '';
      return `- ${l.therapistName}: ${l.treatmentName}${oilInfo}`;
    })
    .join('\n');

  const message =
    `Booking baru - ${outletId}\n` +
    `Pelanggan: ${customerName || '-'}\n` +
    treatmentLines;

  openWhatsAppMessage(message);
}

// Buka WhatsApp dengan pesan terisi. Penerima dipilih manual oleh pengguna.
//
// Supaya di HP langsung membuka APLIKASI WhatsApp (bukan tinggal di browser/PWA):
//  - Android : pakai Android Intent (whatsapp://) + browser_fallback ke wa.me
//  - iPhone/iPad : pakai deep link whatsapp:// (tidak bisa auto-send pesan)
//  - Desktop : wa.me dibuka di tab baru (WA Web / app bila terpasang)
export function openWhatsAppMessage(message) {
  const text = encodeURIComponent(message || '');
  const fallback = `https://wa.me/?text=${text}`;
  const ua = navigator.userAgent;

  if (/Android/i.test(ua)) {
    const intentUrl =
      `intent://send?text=${text}#Intent;` +
      `scheme=whatsapp;package=com.whatsapp;` +
      `S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
    const a = document.createElement('a');
    a.href = intentUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  if (/iPhone|iPad|iPod/i.test(ua)) {
    const win = window.open(`whatsapp://send?text=${text}`, '_self');
    if (!win) window.location.href = fallback;
    return;
  }

  const win = window.open(fallback, '_blank');
  if (!win) window.location.href = fallback;
}
