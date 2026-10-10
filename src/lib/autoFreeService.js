import { supabase } from './supabase';
import { bebaskanTherapisYangSelesai } from './therapistService';

let timer = null;

// Setiap tick ada dua jalur:
//
//  1. RPC auto_free_expired_therapists di server. Dipakai karena sudah ada,
//     tapi dari pengujian dia mengembalikan 0 dan tidak membebaskan kasus
//     oncall yang sudah selesai.
//  2. Pembersihan sisi klien (bebaskanTherapisYangSelesai). Inilah yang
//     benar-benar memperbaiki kasus oncall: therapist yang statusnya masih
//     ambil_tamu padahal tidak ada treatment yang jam selesaipnya belum lewat.
//
// Keduanya dijalankan supaya satu jalur yang rusak tidak membuat therapist
// terus terkunci.
async function tick() {
  const { error } = await supabase.rpc('auto_free_expired_therapists');
  if (error) console.warn('[autoFree] rpc gagal:', error.message);

  try {
    await bebaskanTherapisYangSelesai();
  } catch (e) {
    console.warn('[autoFree] pembersihan gagal:', e?.message || e);
  }
}

export function startAutoFreeTicker(intervalMs = 60000) {
  stopAutoFreeTicker();
  // Jalankan sekali langsung saat aplikasi dibuka, supaya therapist yang
  // tertinggal terkunci dari shift sebelumnya bebas tanpa harus menunggu tick.
  tick();
  timer = setInterval(tick, intervalMs);
}

export function stopAutoFreeTicker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}