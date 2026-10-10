import { supabase } from './supabase';
import { THERAPIST_STATUS } from './constants';

function mapTherapist(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    homeOutletId: row.home_outlet_id,
    shift: row.shift,
    status: row.status,
    currentOutletId: row.current_outlet_id,
    currentBookingIds: row.current_booking_ids || null,
    currentBookingId: row.current_booking_id || null,
    currentTreatmentNames: row.current_treatment_names || null,
    currentTreatmentName: row.current_treatment_name || null,
    currentPaid: row.current_paid,
    currentPaymentMethod: row.current_payment_method,
    currentPrice: row.current_price != null ? Number(row.current_price) : null,
    currentGroupId: row.current_group_id || null,
    startAt: row.start_at,
    endAt: row.end_at
  };
}

async function fetchAll() {
  const { data, error } = await supabase
    .from('therapists')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data || []).map(mapTherapist);
}

// ---- Singleton realtime listener (dibagikan semua halaman, 1 koneksi) ----
let _refCount = 0;
let _unsub = null;
let _latest = [];
let _loading = false;
const _callbacks = new Set();

async function _sync() {
  if (_loading) return;
  _loading = true;
  try {
    _latest = await fetchAll();
    _callbacks.forEach((cb) => {
      try { cb([..._latest]); } catch (e) { console.error(e); }
    });
  } catch (e) {
    console.warn('therapists sync error:', e);
  } finally {
    _loading = false;
  }
}

function _start() {
  _sync();
  // Debounce (trailing 800ms) supaya meledakan update cepat dari batch booking /
  // aksi grup tdk memicu beberapa fetch berturut-turut (penghemat kuota request).
  let syncTimer = null;
  _unsub = supabase
    .channel('realtime-therapists')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'therapists' }, () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => _sync(), 800);
    })
    .subscribe();
}

export function listenAllTherapists(callback) {
  if (_refCount === 0) _start();
  _refCount++;
  _callbacks.add(callback);
  callback([..._latest]);
  return () => {
    _callbacks.delete(callback);
    _refCount = Math.max(0, _refCount - 1);
    if (_refCount === 0 && _unsub) {
      supabase.removeChannel(_unsub);
      _unsub = null;
      _latest = [];
    }
  };
}

export function listenFreeTherapists(callback) {
  return listenAllTherapists((all) => {
    callback(all.filter((t) => (t.status || THERAPIST_STATUS.FREE) === THERAPIST_STATUS.FREE));
  });
}

export async function addTherapist({ name, role, homeOutletId }) {
  const bersih = String(name || '').trim().replace(/\s+/g, ' ');
  if (!bersih) throw new Error('Nama terapis wajib diisi.');

  // Tanpa unique index di database, cek dulu di sini. Tanpa ini orang yang
  // sama bisa terdaftar dua kali lalu namanya muncul dua di daftar - dan
  // komisinya ikut terpecah jadi dua baris di laporan.
  const { data: ada, error: cekErr } = await supabase
    .from('therapists')
    .select('id, name')
    .ilike('name', bersih);
  if (cekErr) throw cekErr;
  const kembar = (ada || []).find((t) => t.name.trim().toLowerCase() === bersih.toLowerCase());
  if (kembar) throw new Error(`Terapis "${kembar.name}" sudah terdaftar. Jangan didaftarkan dua kali.`);

  const { data, error } = await supabase.from('therapists').insert({
    name: bersih,
    role: role || 'terapis',
    home_outlet_id: homeOutletId || null,
    status: 'free'
  }).select().single();
  if (error) throw error;
  return data.id;
}

export async function setTherapistHomeOutlet(therapistId, homeOutletId) {
  const { error } = await supabase
    .from('therapists')
    .update({ home_outlet_id: homeOutletId || null })
    .eq('id', therapistId);
  if (error) throw error;
}

export async function updateTherapistInfo(therapistId, { name, role }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (role !== undefined) patch.role = role;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('therapists').update(patch).eq('id', therapistId);
  if (error) throw error;
}

export async function setTherapistShift(therapistId, shift) {
  const { error } = await supabase.from('therapists').update({ shift: shift || null }).eq('id', therapistId);
  if (error) throw error;
}

export async function setTherapistStatusManual(therapistId, status) {
  const { error } = await supabase.from('therapists').update({
    status,
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
  }).eq('id', therapistId);
  if (error) throw error;
}

/**
 * Lepaskan therapist yang statusnya masih `ambil_tamu` padahal tidak ada satu
 * pun treatment yang sedang berjalan.
 *
 * Kasus yang sering terjadi: order oncall selesai, tapi therapist tidak pernah
 * dilepas. Akibatnya therapist tetap terblokir di halaman kasir (tombolnya
 * nonaktif) padahal tidak bekerja. RPC `auto_free_expired_therapists` yang ada
 * di server mengembalikan 0 dan tidak menyentuh kasus oncall, jadi pensionsnya
 * dilakukan dari sini.
 *
 * Yang menentukan "sedang bekerja" adalah `end_at` treatment yang belum lewat,
 * BUKAN status booking 'berjalan'. Status 'berjalan' sendiri jarang ditutup
 * kasir - ratusan transaksi menganggur begitu - jadi kalau dipakai, hampir
 * semua therapist akan terbaca masih bekerja dan tidak ada yang pernah lepas.
 *
 * @returns {Promise<string[]>} nama-nama therapist yang dibebaskan
 */
export async function bebaskanTherapisYangSelesai() {
  const nowMs = Date.now();
  const { data: sibuk, error: readErr } = await supabase
    .from('therapists')
    .select('id, name')
    .eq('status', THERAPIST_STATUS.AMBIL_TAMU);
  if (readErr) { console.warn('bebaskanTherapisYangSelesai: baca gagal', readErr); return []; }
  if (!sibuk || !sibuk.length) return [];

  const ids = sibuk.map((t) => t.id);
  const { data: jalan, error: bookErr } = await supabase
    .from('bookings')
    .select('therapist_id')
    .in('therapist_id', ids)
    .eq('status', 'berjalan')
    .gt('end_at', nowMs);
  if (bookErr) { console.warn('bebaskanTherapisYangSelesai: baca booking gagal', bookErr); return []; }

  const masihKerja = new Set((jalan || []).map((b) => b.therapist_id));
  const macet = sibuk.filter((t) => !masihKerja.has(t.id));
  if (!macet.length) return [];

  const { error } = await supabase
    .from('therapists')
    .update({
      status: THERAPIST_STATUS.FREE,
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
    .in('id', macet.map((t) => t.id));
  if (error) { console.warn('bebaskanTherapisYangSelesai: update gagal', error); return []; }

  const nama = macet.map((t) => t.name);
  console.info('therapis dilepas otomatis:', nama.join(', '));
  return nama;
}

export async function removeTherapist(therapistId) {
  const { error } = await supabase.from('therapists').delete().eq('id', therapistId);
  if (error) throw error;
}

export const THERAPIST_STATUS_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'libur', label: 'Off / Libur' },
  { value: 'break', label: 'Break' }
];
