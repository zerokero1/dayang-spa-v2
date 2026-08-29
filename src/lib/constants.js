export const OUTLETS = [
  { id: 'DR', name: 'Dream' },
  { id: 'RR', name: 'Rere' },
  { id: 'DP', name: 'Dayang Putri' },
  { id: 'D1', name: 'Dayang 1' },
  { id: 'D2', name: 'Dayang 2' },
  { id: 'Y', name: 'Yulis' }
];

export const OIL_TYPES = [
  'Relaxing', 'Refreshing', 'Herbal', 'Hot Oil', 'Cem-Ceman', 'Aromatic Oil'
];
export const OIL_SIZES = ['Kecil', 'Besar']; // Kecil = 10ml, Besar = 30ml

export const TREATMENT_CATEGORIES = ['Massage', 'Nail', 'Body Care', 'Waxing', 'Hair Treatment'];

/** Apakah sebuah treatment memakai minyak? Prioritas:
 *  1. field `usesOil` di data treatment (kalau ada/terisi)
 *  2. fallback: hanya kategori Massage yang pakai minyak, TAPI Foot Massage TIDAK */
export function treatmentUsesOil(t) {
  if (!t) return false;
  if (t.usesOil !== undefined) return !!t.usesOil;
  return t.category === 'Massage' && !String(t.name || '').toLowerCase().includes('foot massage');
}

export const PAYMENT_METHODS = { CASH: 'cash', CARDLESS: 'cardless' };
export const PAYMENT_METHOD_LABEL = { cash: 'Cash', cardless: 'Cardless' };

export const SHIFTS = { SP: 'sp', MALAM: 'malam', ST: 'st' };
export const SHIFT_LABEL = { sp: 'Shift SP (Split)', malam: 'Shift Malam', st: 'Shift ST (Short Time)' };
export const SHIFT_SHORT_CODE = { sp: 'Sp', malam: '15', st: 'St' };

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
  LEMBUR: 'lembur' // overtime
};
