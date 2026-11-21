import { supabase } from './supabase.js';

/**
 * Treatment adalah katalog GLOBAL: tidak ada filter outlet di sini.
 *
 * Kolom `is_active` ditambahkan lewat `supabase/add_treatment_is_active.sql`.
 * Sebelum migrasi itu dijalankan, kolom belum ada; mapTreatment sengaja
 * menganggap semua treatment aktif supaya halaman kasir lama tetap normal.
 */
function mapTreatment(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price != null ? Number(row.price) : 0,
    category: row.category,
    durationMinutes: row.duration_minutes,
    commissionPercent: row.commission_percent != null ? Number(row.commission_percent) : 0,
    usesOil: row.uses_oil,
    isActive: row.is_active == null ? true : !!row.is_active
  };
}

/** Validasi form sebelum ditulis. Dipakai halaman Kelola Treatment dan bisa
 *  diuji tanpa browser. Melempar Error dengan pesan yang bisa ditampilkan. */
export function validateTreatmentInput(input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Nama treatment wajib diisi.');

  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Harga treatment harus lebih dari 0.');

  const durationMinutes = Number(input.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('Durasi harus bilangan bulat lebih dari 0 menit.');
  }

  const commissionPercent = input.commissionPercent === '' || input.commissionPercent == null
    ? 10
    : Number(input.commissionPercent);
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw new Error('Komisi harus antara 0 dan 100 persen.');
  }

  return {
    patch: {
      name,
      price,
      category: String(input.category || 'Massage'),
      duration_minutes: durationMinutes,
      commission_percent: commissionPercent,
      // null = biarkan aturan kategori yang menentukan (lihat treatmentUsesOil).
      uses_oil: input.usesOil === true ? true : input.usesOil === false ? false : null
    },
    name
  };
}

export async function createTreatment(input) {
  const { patch, name } = validateTreatmentInput(input);
  // `is_active` TIDAK dikirim: default database `true` berlaku setelah
  // migrasi, dan sebelum migrasi kolom itu memang belum ada.
  const { data, error } = await supabase.from('treatments').insert(patch).select().single();
  if (error) throw error;
  return { treatment: mapTreatment(data), name };
}

export async function updateTreatment(id, input) {
  if (!id) throw new Error('Treatment tidak ditemukan.');
  const { patch, name } = validateTreatmentInput(input);
  const { data, error } = await supabase
    .from('treatments')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return { treatment: mapTreatment(data), name };
}

/** Soft delete / restore. Tidak pernah menghapus baris: booking dan struk lama
 *  menyimpan treatment_name + treatment_price sendiri, jadi tetap terbaca. */
export async function setTreatmentActive(id, active) {
  if (!id) throw new Error('Treatment tidak ditemukan.');
  const { error } = await supabase
    .from('treatments')
    .update({ is_active: !!active })
    .eq('id', id);
  if (error) {
    if (error.code === '42703' || /is_active/i.test(error.message || '')) {
      throw new Error('Kolom is_active belum ada. Jalankan supabase/add_treatment_is_active.sql dulu.');
    }
    throw error;
  }
}

async function fetchAll() {
  const { data, error } = await supabase.from('treatments').select('*');
  if (error) throw error;
  return (data || []).map(mapTreatment);
}

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
    _callbacks.forEach((cb) => { try { cb([..._latest]); } catch (e) { console.error(e); } });
  } catch (e) {
    console.warn('treatments sync error:', e);
  } finally {
    _loading = false;
  }
}

function _start() {
  _sync();
  _unsub = supabase
    .channel('realtime-treatments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'treatments' }, () => {
      _sync();
    })
    .subscribe();
}

/**
 * @param callback menerima daftar treatment.
 * @param options.includeInactive untuk halaman kelola: ikut menampilkan yang
 *        sudah dinonaktifkan. Pemakai lama (kasir, reservasi, dll.) tidak perlu
 *        diubah sama sekali dan tetap hanya menerima treatment aktif.
 */
export function listenTreatments(callback, options = {}) {
  const includeInactive = !!options.includeInactive;
  const emit = (rows) => {
    const daftar = includeInactive ? rows : rows.filter((t) => t.isActive !== false);
    try { callback(daftar); } catch (e) { console.error(e); }
  };

  if (_refCount === 0) _start();
  _refCount++;
  _callbacks.add(emit);
  emit([..._latest]);

  return () => {
    _callbacks.delete(emit);
    _refCount = Math.max(0, _refCount - 1);
    if (_refCount === 0 && _unsub) {
      supabase.removeChannel(_unsub);
      _unsub = null;
      _latest = [];
    }
  };
}
