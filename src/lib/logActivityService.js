import { supabase } from './supabase';

export const OFFICE_EMAIL = 'office.op@dayang.com';

// Halaman aplikasi di-mount ulang berkali-kali (setiap pindah halaman, setiap
// token auth di-refresh), dan useEffect di App.jsx memanggil ini lagi setiap
// kali objek `user` berganti. Akibatnya satu orang yang cuma sekali buka
// aplikasi tercatat puluhan kali, dan log aktivitas jadi tertutupi.
//
// Jadi pencatatan dikunci: satu kali per jendela waktu tertentu. Kalau
// sessionStorage tidak ada (misalnya mode privasi), tetap dicatat supaya
// tidak justru hilang jejaknya.
const KUNCI = 'logOfficeLoginTerakhir';
const JENDALA_MS = 30 * 60 * 1000;

function bolehCatat() {
  try {
    const sebelum = Number(sessionStorage.getItem(KUNCI) || 0);
    if (Date.now() - sebelum < JENDALA_MS) return false;
    sessionStorage.setItem(KUNCI, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

/**
 * Catat login akun office ke audit_logs.
 *
 * Fire-and-forget: kegagalan tidak boleh mengganggu alur login, dan tidak
 * ditampilkan sebagai error. Cukup satu entri per 30 menit.
 */
export function logOfficeLogin() {
  if (!bolehCatat()) return;
  supabase.rpc('log_office_login').then(({ error }) => {
    if (error) console.warn('[logOffice] gagal mencatat login:', error.message);
  });
}

/**
 * Ambil riwayat log aktivitas (aksinya semua akun: kasir & office).
 *
 * Batas baris sengaja dibuat besar. Dulu 500 baris, padahal sistem sudah
 * mencatat sekitar 300 entri per hari, jadi log lebih dari sehari langsung
 * tidak bisa dicari padahal datannya sebenarnya ada.
 */
export async function getAllLogs(limit = 5000) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, actor, actor_name, action, table_name, record_id, outlet_id, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
