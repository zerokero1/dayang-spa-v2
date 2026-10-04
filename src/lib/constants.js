export const OUTLETS = [
  { id: 'DR', name: 'Dream' },
  { id: 'RR', name: 'Rere' },
  { id: 'DP', name: 'Dayang Putri' },
  { id: 'D1', name: 'Dayang 1' },
  { id: 'D2', name: 'Dayang 2' },
  { id: 'Y', name: 'Yulis' }
];

export const OIL_TYPES = [
  'Relaxing', 'Refreshing', 'Herbal', 'Hot Oil', 'Cem-Ceman', 'Aromatic Oil', 'Aloevera Cream'
];
export const OIL_SIZES = ['Kecil', 'Besar']; // Kecil = 10ml, Besar = 30ml

export const FOOT_PRODUCTS = ['Foot Cream', 'FM'];

// Kategori barang inventory. 'Produk' = produk treatment yang terpakai otomatis
// ( Facial, Pedicure Produk, ... ). 'Laundry' = barang linen/equipment (Face Cradle, Hole Sheet, ...).
export const INVENTORY_CATEGORIES = ['Produk', 'Laundry'];
export const DEFAULT_INVENTORY_CATEGORY = 'Produk';

// Happy Hour bukan kategori. Lihat blok aturan Happy Hour di bawah.
export const TREATMENT_CATEGORIES = ['Massage', 'Nail', 'Body Care', 'Waxing', 'Hair Treatment'];

/** Apakah treatment ini Foot Massage (pakai produk Foot Cream / FM)? */
export function isFootMassage(t) {
  if (!t) return false;
  return String(t.name || '').toLowerCase().includes('foot massage');
}

// ---------------------------------------------------------------------------
// Happy Hour
//
// Happy Hour itu DAFTAR KUTUK, bukan aturan umum. Hanya enam menu di bawah
// yang boleh jadi Happy Hour, tidak ada treatment lain:
//
//   1. Lombok Massage (90 Min)
//   2. Balinese Massage (90 Min)
//   3. Deep Tissue Massage (90 Min)
//   4. Thai Massage (90 Min)
//   5. Stress Relieving Massage (90 Min)
//   6. Aloevera Massage (90 Min)
//
// Dahulu aturannya "Massage + 90 menit + Rp 300.000". Itu SALAH karena
// ikut-treatment "After Surf Massage (90 Min)" yang harganya juga Rp 300.000
// padahal tidak ada di daftar. Karena itu aturan sekarang murni berbasis nama
// menu, bukan kategori/durasi/harga — sehingga perubahan harga atau kategori di
// katalog tidak diam-diam mengubah siapa yang boleh Happy Hour.
//
// Treatment 90 menit yang TIDAK ikut, dan tidak boleh ikut:
//   - After Surf Massage (90 Min)  Rp 300.000  <- sengaja dikeluarkan
//   - Hot Stone (90 Min)           Rp 400.000
//   - Herbal Compress (90 Min)     Rp 400.000
//   - Fake Nail (Full) / Dinfill BIAB (Full)   Rp 280.000 (kategori Nail)
//   - semua treatment 30 / 45 / 60 menit
//   - semua treatment Waxing / Body Care / Hair Treatment / Nail
//
// Harga Happy Hour: jam 11:00 - 14:59 -> Rp 250.000 (flat, bukan persen).
// Di luar jam itu keenam menu itu kembali ke harga daftar Rp 300.000.
//
// TIDAK ADA diskon otomatis untuk treatment lain di jam yang sama. Diskon lain
// tetap harus dipilih kasir secara manual dengan alasan (chip 5/10/15/20% atau
// menu diskon di Koreksi Booking).
//
// Jam memakai WITA (UTC+8) = jam lokal Lombok, sesuai yang diminta owner.
// PENTING: ini berbeda dari zona waktu yang dipakai sebagian besar laporan
// (laporan masih WIB/UTC+7). Owner sudah ditanya dan memilih jam lokal Lombok
// untuk Happy Hour.
// Kalau memakai jam perangkat, tablet yang zona waktunya keliru akan
// membuka/menutup Happy Hour di jam yang salah.
// ---------------------------------------------------------------------------
export const HAPPY_HOUR_START_MIN = 11 * 60;
export const HAPPY_HOUR_END_MIN = 15 * 60; // exclusive: 14:59 masih Happy Hour
export const HAPPY_HOUR_PRICE = 250000;
export const HAPPY_HOUR_TIMEZONE = 'Asia/Makassar'; // WITA (UTC+8) = jam lokal Lombok
export const HAPPY_HOUR_UTC_OFFSET_MIN = 8 * 60;
export const HAPPY_HOUR_REASON = 'Happy Hour (11:00 - 14:59)';

// Nama treatment yang boleh Happy Hour, harga jadi Rp 250.000. Sengaja ditulis
// sebagai nama yang ditulisi persis seperti di katalog supaya mudah dicek/diubah.
//
// Daftar ini = 7 dari 11 treatment 90 menit yang ada di katalog, yaitu semua
// Massage 90 menit berharga Rp 300.000. Yang 4 di luar sengaja TIDAK ikut:
//   - Dinfill BIAB (Full)          Nail     Rp 280.000
//   - Fake Nail (Full)             Nail     Rp 280.000
//   - Herbal Compress (90 Min)     Massage  Rp 400.000
//   - Hot Stone (90 Min)           Massage  Rp 400.000
export const HAPPY_HOUR_TREATMENTS = [
  'Lombok Massage (90 Min)',
  'Balinese Massage (90 Min)',
  'Deep Tissue Massage (90 Min)',
  'Thai Massage (90 Min)',
  'Stress Relieving Massage (90 Min)',
  'Aloevera Massage (90 Min)',
  'After Surf Massage (90 Min)'
];

/**
 * Kunci pembanding nama treatment: huruf kecil dan spasi dirapatkan. Jadi
 * "Lombok Massage (90 Min)" cocok dengan "  lombok   massage (90 min) ".
 *
 * PENTING: sufiks durasi TIDAK dibuang di sini. Kalau dibuang, "Lombok Massage
 * (60 Min)" akan ikut cocok dengan "Lombok Massage (90 Min)" dan treatment 60
 * menit ikut Happy Hour. Durasi justru pembeda yang paling penting.
 */
export function happyHourKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Buang sufiks durasi di akhir nama, mis. "(90 Min)". lowercase dulu. */
function happyHourKeyTanDurasi(name) {
  return happyHourKey(name).replace(/\((?:[^()]*)\)\s*$/, '').trim();
}

const HAPPY_HOUR_KEYS = HAPPY_HOUR_TREATMENTS.map(happyHourKey);
const HAPPY_HOUR_KEYS_TAN_DURASI = HAPPY_HOUR_TREATMENTS.map(happyHourKeyTanDurasi);

/**
 * Apakah `date` sudah masuk jam Happy Hour (11:00 - 14:59) menurut WITA
 * (UTC+8) = jam lokal Lombok? `date` boleh Date atau angka epoch ms.
 *
 * Sengaja tidak memakai jam perangkat: tablet kasir bisa salah zona waktu,
 * sehingga Happy Hour akan buka/tutup di jam yang keliru.
 */
export function isHappyHourTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  // Geser ke WITA lalu ambil jam-menitnya.
  const wita = new Date(d.getTime() + (HAPPY_HOUR_UTC_OFFSET_MIN + d.getTimezoneOffset()) * 60000);
  const t = wita.getHours() * 60 + wita.getMinutes();
  return t >= HAPPY_HOUR_START_MIN && t < HAPPY_HOUR_END_MIN;
}

/**
 * Apakah treatment ini salah satu dari enam menu Happy Hour?
 *
 * Dua jalur:
 *  1. nama persis sama dengan salah satu daftar (huruf kecil/spasi diabaikan);
 *  2. nama sama tapi sufiks durasinya ditulis lain ("(90 Menit)"), asal
 *     durationMinutes-nya benar-benar 90.
 *
 * Jalur (2) tetap wajib memeriksa durationMinutes supaya treatment 30/45/60
 * menit dengan nama serupa tidak ikut. Kalau durationMinutes tidak ada, tidak
 * ikut — lebih baik misses daripada memberi diskon yang tidak berhak.
 */
export function isHappyHourTreatment(t) {
  if (!t) return false;
  const key = happyHourKey(t.name);
  if (key === '') return false;
  if (HAPPY_HOUR_KEYS.includes(key)) return true;
  return Number(t.durationMinutes) === 90
    && HAPPY_HOUR_KEYS_TAN_DURASI.includes(happyHourKeyTanDurasi(key));
}

/** Harga Happy Hour untuk treatment ini, atau null kalau tidak berlaku. */
export function happyHourPriceFor(t, date = new Date()) {
  return isHappyHourTime(date) && isHappyHourTreatment(t) ? HAPPY_HOUR_PRICE : null;
}

/** Pilihan produk/minyak yang muncul saat memilih sebuah treatment.
 *  Foot Massage difokuskan pada Foot Cream / FM, yang lain pakai body oil biasa. */
export function oilChoicesFor(t) {
  return isFootMassage(t) ? FOOT_PRODUCTS : OIL_TYPES;
}

/** Apakah sebuah treatment memakai minyak/produk? Prioritas:
 *  1. Foot Massage -> true (pakai Foot Cream / FM)
 *  2. field `usesOil` di data treatment (kalau ada/terisi)
 *  3. fallback: kategori Massage yang pakai minyak */
export function treatmentUsesOil(t) {
  if (!t) return false;
  if (isFootMassage(t)) return true;
  if (t.usesOil !== undefined) return !!t.usesOil;
  return t.category === 'Massage';
}

export const PAYMENT_METHODS = { CASH: 'cash', CARDLESS: 'cardless' };
export const PAYMENT_METHOD_LABEL = { cash: 'Cash', cardless: 'Cardless' };

export const ONCALL_PACKAGES = [
  {
    id: 'MAMBO',
    name: 'Mambo',
    hotelCommission: 100000,
    durations: [
      { minutes: 60, price: 350000 },
      { minutes: 90, price: 500000 }
    ]
  },
  {
    id: 'NIYAMA',
    name: 'Niyama & Racotage',
    hotelCommission: 50000,
    durations: [
      { minutes: 60, price: 300000 },
      { minutes: 90, price: 450000 }
    ]
  },
  {
    id: 'LAIN',
    name: 'Lainnya (harga baru)',
    hotelCommission: 50000,
    durations: [
      { minutes: 60, price: 400000 },
      { minutes: 90, price: 600000 }
    ]
  }
];

export const DEFAULT_ONCALL_COMMISSION_PCT = 30;

export const SHIFTS = { SP: 'sp', SP1: 'sp1', SP2: 'sp2', MALAM: 'malam', ST: 'st', AD: 'AD', T11: '11' };
export const SHIFT_LABEL = {
  sp: 'Shift SP (Split)',
  sp1: 'Shift SP1 (11-14, 17-22)',
  sp2: 'Shift SP2 (12-15, 18-23)',
  malam: 'Shift Malam',
  AD: 'Shift AD (15-23)',
  '11': 'Shift 11 (11-23)',
  st: 'Shift ST (Short Time)'
};
export const SHIFT_SHORT_CODE = { sp: 'Sp', sp1: 'Sp¹', sp2: 'Sp²', malam: '15', AD: 'AD', '11': '11', st: 'St' };

export const STAFF_ROLES = {
  SENIOR_TERAPIS: 'senior_terapis',
  KASIR: 'kasir_staff',
  TERAPIS: 'terapis',
  TRAINING_TERAPIS: 'training_terapis',
  TRAINING_BARU: 'training_baru'
};

export const THERAPIST_STATUS = {
  FREE: 'free',
  LIBUR: 'libur',
  AMBIL_TAMU: 'ambil_tamu',
  BREAK: 'break'
};

export const ATTENDANCE_TYPES = {
  HADIR: 'hadir',
  SAKIT: 'sakit',
  IZIN: 'izin',
  TELAT: 'telat',
  ALPHA: 'alpha',
  LIBUR: 'libur',
  LEMBUR: 'lembur' // overtime
};
