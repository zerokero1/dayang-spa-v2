import { supabase } from './supabase';
import { OUTLETS } from './constants';
import { getShiftWindowStatus } from './shiftService';
import {
  wibDayBoundsUtc,
  fmtLocalDate,
  overtimeMinutesFor,
  shiftEndMsForDate,
  getOvertimeAdjustments
} from './overtimeService';

// ============================================================
// DASHBOARD TERAPIS (live board)
//
// Satu panggilan mengambil semua yang dibutuhkan layar ini:
//   1. Terapis siapa yang sedang "Ambil Tamu" -> di outlet mana,
//      tamu siapa, treatment apa, selesai jam berapa.
//   2. Siapa yang statusnya Break / Libur.
//   3. Siapa yang sudah lewat jam selesai shift (lembur) dan
//      total menit lemburnya hari ini.
// ============================================================

export const todayWib = () => fmtLocalDate(new Date());

// Epoch ms "sekarang" pada tanggal WIB tertentu (untuk=status jeda shift).
function nowMsOnWib(dateStr) {
  const { startUtc } = wibDayBoundsUtc(dateStr);
  const now = Date.now();
// Kalau tanggal yang diminta = hari ini, pakai waktu sungguhan.
  if (now >= startUtc.getTime() && now < startUtc.getTime() + 24 * 3600000) return now;
  // Tanggal lain: pakai tengah hari WIB agar tidak jadi jam tengah malam
  // yang menyesatkan.
  return startUtc.getTime() + 12 * 3600000;
}

function fmtTime(ms) {
  if (ms == null) return '-';
  const d = new Date(Number(ms) + 7 * 3600000);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function fmtMin(min) {
  const n = Math.max(0, Math.round(Number(min) || 0));
  if (n < 60) return `${n} mnt`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}j ${m}m` : `${h} jam`;
}

const outletName = (id) => OUTLETS.find((o) => o.id === id)?.name || id || '-';

/**
 * Muat data dashboard terapis.
 * @param {object} opts
 * @param {string} opts.date        tanggal WIB (YYYY-MM-DD), default hari ini
 * @param {string[]} opts.outletIds daftar outlet yang ditampilkan; null/[] = semua
 * @param {number}  opts.nowMs      waktu referensi (default Date.now())
 */
export async function getTherapistBoard({ date = todayWib(), outletIds = null, nowMs = Date.now() } = {}) {
  const { startUtc, endUtc } = wibDayBoundsUtc(date);
  const todayRef = nowMsOnWib(date);
  const isToday = date === todayWib();

  const therapistQuery = supabase
    .from('therapists')
    .select('id, name, role, home_outlet_id, shift, status, current_outlet_id, current_booking_id, current_booking_ids, current_treatment_name, current_treatment_names, start_at, end_at');

  const bookingQuery = supabase
    .from('bookings')
    .select('id, outlet_id, therapist_id, therapist_name, treatment_name, customer_name, status, start_at, end_at, booking_source')
    .gte('start_at', startUtc.getTime())
    .lte('start_at', endUtc.getTime());

  const [thRes, bkRes, adjustments] = await Promise.all([
    therapistQuery,
    bookingQuery,
    getOvertimeAdjustments(date, date).catch(() => ({}))
  ]);

  if (thRes.error) throw thRes.error;
  if (bkRes.error) throw bkRes.error;

  let therapists = thRes.data || [];
  const scope = outletIds && outletIds.length ? outletIds : null;

  // Batasi ke outlet yang diminta. Basisnya home outlet, BUKAN lokasi
  // saat ini — supaya kasir tetap melihat staff-nya sendiri walau sedang
  // diperbantukan ke outlet lain (lokasi sebenarnya ditampilkan di kartu).
  if (scope) therapists = therapists.filter((t) => scope.includes(t.home_outlet_id));

  // Booking milik terapis yang tampil (bisa di outlet lain / oncall).
  const shownIds = new Set(therapists.map((t) => t.id));
  const bookings = (bkRes.data || []).filter(
    (b) => b.therapist_id && shownIds.has(b.therapist_id) && b.status !== 'batal' && b.status !== 'batal_sebagian'
  );

  const bookingById = Object.fromEntries(bookings.map((b) => [b.id, b]));

  // Booking yang SEDANG berjalan per terapis.
  // Penting: hanya dihitung bila jam berakhirnya belum lewat. Di produksi
  // banyak booking berstatus 'berjalan' yang end_at-nya sudah lama berlalu
  // (terapis sudah otomatis Free), jadi memfilter tanpa cek waktu akan
  // membuat hampir semua terapis terlihat "Ambil Tamu".
  const isReallyRunning = (b) =>
    b.status === 'berjalan' && (b.end_at == null || Number(b.end_at) > todayRef);

  const liveByTherapist = {};
  bookings.forEach((b) => {
    if (isReallyRunning(b)) {
      (liveByTherapist[b.therapist_id] = liveByTherapist[b.therapist_id] || []).push(b);
    }
  });

  const rows = therapists.map((t) => {
    const mine = bookings.filter((b) => b.therapist_id === t.id).sort((a, b) => (a.start_at || 0) - (b.start_at || 0));
    const live = (liveByTherapist[t.id] || [])
      .sort((a, b) => (a.end_at || 0) - (b.end_at || 0));

    // Sesi yang sedang jalan. current_booking_ids bertipe jsonb (array of id).
    // Kalau kolom terisi, pakai itu (source of truth untuk status), kalau
    // tidak, turunkan dari booking berstatus 'berjalan'.
    const curIds = Array.isArray(t.current_booking_ids)
      ? t.current_booking_ids.filter(Boolean)
      : [];
    let current = [];
    if (curIds.length) {
      current = curIds.map((id) => bookingById[id]).filter(Boolean);
      if (!current.length) current = live;
    } else if (t.current_booking_id && bookingById[t.current_booking_id]) {
      current = [bookingById[t.current_booking_id]];
    } else {
      current = live;
    }

    const currentOutletId = t.current_outlet_id || (current[0] ? current[0].outlet_id : null);
    const currentEndAt = current.length
      ? Math.max(...current.map((b) => Number(b.end_at) || 0))
      : null;

    // Tamu berikutnya setelah waktu sekarang (untuk "berikutnya").
    const upcoming = isToday
      ? mine.filter((b) => Number(b.start_at || 0) > nowRef && b.status !== 'selesai')[0] || null
      : null;

    // Hari kerja: treatment TERAKHIR hari ini (untuk total lembur).
    const worked = mine.filter((b) => b.booking_source !== 'oncall');
    const lastEndAt = worked.length
      ? Math.max(...worked.map((b) => Number(b.end_at) || Number(b.start_at) || 0))
      : null;

    const shiftEndMs = shiftEndMsForDate(t.shift, date);
    // Total lembur hari ini (dari treatment terakhir), hormati koreksi manual.
    const adj = adjustments[`${t.id}|${date}`];
    let overtimeMinutes = adj
      ? Number(adj.adjustedMinutes) || 0
      : overtimeMinutesFor(t.shift, date, lastEndAt);
    // "Sedang lembur" = sudah lewat jam selesai shift DAN masih ada kerja
    // (treatment belum selesai, atau baru saja selesai di luar jam shift).
    const workingNow = (current.length > 0 && currentEndAt != null && currentEndAt > nowRef)
      || (live.length > 0);
    const isOvertimeNow = !adj && shiftEndMs != null && nowRef > shiftEndMs
      && (workingNow || (lastEndAt != null && lastEndAt > shiftEndMs));

    const shiftWindow = getShiftWindowStatus(t.shift, new Date(todayRef));

    return {
      id: t.id,
      name: t.name,
      role: t.role,
      shift: t.shift,
      homeOutletId: t.home_outlet_id,
      homeOutletName: outletName(t.home_outlet_id),
      status: t.status || 'free',
      isBusy: (t.status || 'free') === 'ambil_tamu' || current.length > 0,
      isBreak: t.status === 'break',
      isLibur: t.status === 'libur',
      shiftWindow,
      currentOutletId,
      currentOutletName: currentOutletId ? outletName(currentOutletId) : '-',
      movedOutlet: !!currentOutletId && currentOutletId !== t.home_outlet_id,
      guests: current.map((b) => ({
        bookingId: b.id,
        // Hampir semua booking in-house tidak menyimpan nama tamu (hanya
        // oncall yang mengisi). Jangan tampilkan "(tanpa nama)" yang noisy.
        customerName: String(b.customer_name || '').trim(),
        treatmentName: b.treatment_name || '-',
        outletId: b.outlet_id,
        outletName: outletName(b.outlet_id),
        startAt: Number(b.start_at) || null,
        endAt: Number(b.end_at) || null,
        minutesLeft: b.end_at != null ? Math.round((Number(b.end_at) - nowRef) / 60000) : null,
        progress: b.start_at != null && b.end_at != null && Number(b.end_at) > Number(b.start_at)
          ? Math.min(100, Math.max(0, ((nowRef - Number(b.start_at)) / (Number(b.end_at) - Number(b.start_at))) * 100))
          : null,
        isOncall: b.booking_source === 'oncall'
      })),
      currentEndAt,
      currentEndTime: fmtTime(currentEndAt),
      next: upcoming ? {
        bookingId: upcoming.id,
        customerName: String(upcoming.customer_name || '').trim(),
        treatmentName: upcoming.treatment_name || '-',
        outletName: outletName(upcoming.outlet_id),
        startTime: fmtTime(upcoming.start_at),
        inMinutes: Math.round((Number(upcoming.start_at) - nowRef) / 60000)
      } : null,
      todayCount: mine.length,
      lastEndTime: fmtTime(lastEndAt),
      overtimeMinutes,
      overtimeText: fmtMin(overtimeMinutes),
      isOvertimeNow,
      shiftEndTime: shiftEndMs != null ? fmtTime(shiftEndMs) : null,
      adjusted: !!adj
    };
  });

  // Urutan operational: yang sedang kerja dulu, lalu break, lembur, free, libur.
  const rank = (r) => {
    if (r.isOvertimeNow) return 0;
    if (r.isBusy) return 1;
    if (r.isBreak) return 2;
    if (r.shiftWindow === 'jeda') return 3;
    if (r.isLibur) return 5;
    return 4;
  };
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const summary = {
    total: rows.length,
    busy: rows.filter((r) => r.isBusy).length,
    break: rows.filter((r) => r.isBreak).length,
    libur: rows.filter((r) => r.isLibur).length,
    free: rows.filter((r) => !r.isBusy && !r.isBreak && !r.isLibur).length,
    overtime: rows.filter((r) => r.isOvertimeNow).length,
    jeda: rows.filter((r) => !r.isBusy && !r.isBreak && !r.isLibur && r.shiftWindow === 'jeda').length,
    totalOvertimeMinutes: rows.reduce((s, r) => s + r.overtimeMinutes, 0)
  };

  return { date, isToday, rows, summary, nowMs };
}

// Kelompokkan baris per outlet (untuk tampilan "di outlet mana").
export function groupByCurrentOutlet(rows) {
  const g = {};
  rows.forEach((r) => {
    const key = r.currentOutletId || (r.status === 'free' ? 'free' : r.homeOutletId) || 'unknown';
    (g[key] = g[key] || []).push(r);
  });
  return g;
}