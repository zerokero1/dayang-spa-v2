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
// Happy Hour BUKAN kategori treatment. Sebuah treatment hanya ikut Happy Hour
// kalau TIGA syarat ini sama-sama terpenuhi:
//
//   1. kategorinya Massage,
//   2. durasinya 90 menit, dan
//   3. harga dafarnya Rp 300.000
//
// Syarat kategori itu penting: Manicure / Pedicure / Fake Nail / Dinfill BIAB
// (semua kategori Nail) TIDAK BOLEH ikut Happy Hour dalam keadaan apa pun,
// walau suatu saat ada treatment 90 menit berharga Rp 300.000 di kategori
// Nail. Enjoy hour juga tidak berlaku di Waxing / Body Care / Hair Treatment.
//
//   - treatment 90 menit yang harganya beda (Hot Stone & Herbal Compress
//     Rp 400.000, Fake Nail & Dinfill BIAB Rp 280.000)
//   - semua treatment non-Massage (Nail, Waxing, Body Care, Hair Treatment)
//   - semua treatment 30 / 45 / 60 menit
//
// Harga Happy Hour: jam 11:00 - 14:59 -> Rp 250.000 (flat, bukan persen).
// Di luar jam itu semua treatment kembali ke harga daftar.
// Treatment yang tidak ikut Happy Hour tetap dapat "harga spesial" 10% di jam
// yang sama — itu diskon lain, bukan Happy Hour.
// ---------------------------------------------------------------------------
export const HAPPY_HOUR_START_MIN = 11 * 60;
export const HAPPY_HOUR_END_MIN = 15 * 60; // exclusive: 14:59 masih Happy Hour
export const HAPPY_HOUR_MINUTES = 90;
export const HAPPY_HOUR_BASE_PRICE = 300000;
export const HAPPY_HOUR_PRICE = 250000;
export const HAPPY_HOUR_CATEGORIES = ['Massage'];
export const SPECIAL_TIME_DISCOUNT_PCT = 10;
export const HAPPY_HOUR_REASON = 'Happy Hour - 90 Menit Rp 250.000 (11:00 - 14:59)';

/** Apakah `date` sudah masuk jam Happy Hour (11:00 - 14:59)? */
export function isHappyHourTime(date = new Date()) {
  const t = date.getHours() * 60 + date.getMinutes();
  return t >= HAPPY_HOUR_START_MIN && t < HAPPY_HOUR_END_MIN;
}

/** Tiga syarat Happy Hour: kategori Massage + 90 menit + harga Rp 300.000. */
export function isHappyHourTreatment(t) {
  if (!t) return false;
  return HAPPY_HOUR_CATEGORIES.includes(t.category)
    && Number(t.durationMinutes) === HAPPY_HOUR_MINUTES
    && Number(t.price) === HAPPY_HOUR_BASE_PRICE;
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
