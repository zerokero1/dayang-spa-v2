import { isSingleSizeProduct, OIL_SIZES } from './constants';

/**
 * Perhitungan murni untuk halaman Stok.
 *
 * Dipisah dari komponen supaya bisa diuji tanpa browser. Semua fungsi di sini
 * tidak menyentuh database maupun React.
 */

// Batas stok menipis. Nilainya sama dengan OrderStockPage supaya angka yang
// muncul di kedua halaman tidak berbeda.
export const LOW_OIL = 1;
export const LOW_ITEM = 2;

/** Nama minyak yang tampil di layar: produk satu ukuran tidak perlu ditulis ukuran. */
export function namaMinyak(oil) {
  if (!oil) return '';
  return oil.oilType + (isSingleSizeProduct(oil.oilType) ? '' : ` (${oil.size})`);
}

/**
 * Kelompokkan minyak per jenis, ukuran diurutkan sesuai urutan di katalog
 * (Kecil dulu baru Besar) supaya sama dengan urutan tombolnya di halaman kasir.
 * Ukuran yang tidak ada di OIL_SIZES diletakkan paling akhir, tetap berurut
 * abjad supaya hasilnya konsisten.
 */
export function kelompokkanMinyak(oils) {
  const peta = new Map();
  (oils || []).forEach((o) => {
    if (!o || !o.oilType) return;
    if (!peta.has(o.oilType)) peta.set(o.oilType, []);
    peta.get(o.oilType).push(o);
  });
  const urutanUkuran = (size) => {
    const i = OIL_SIZES.indexOf(size);
    return i === -1 ? OIL_SIZES.length : i;
  };
  return [...peta.entries()].map(([jenis, list]) => ({
    jenis,
    list: list.slice().sort((a, b) => {
      const sa = urutanUkuran(a.size);
      const sb = urutanUkuran(b.size);
      if (sa !== sb) return sa - sb;
      return String(a.size).localeCompare(String(b.size));
    })
  }));
}

/**
 * Gabungan minyak dan produk yang perlu diisi ulang, diurutkan dari yang paling
 * kosong. Inilah gunanya kedua tabel digabung: kasir tak perlu pindah tab untuk
 * tahu semua yang akan habis.
 */
export function hitungPerluAttention(oils, items, options = {}) {
  const lowOil = options.lowOil != null ? options.lowOil : LOW_OIL;
  const lowItem = options.lowItem != null ? options.lowItem : LOW_ITEM;
  const kategoriDefault = options.kategoriDefault || 'Produk';
  const out = [];

  (oils || []).forEach((o) => {
    if (!o) return;
    const stok = Number(o.stock) || 0;
    if (stok <= lowOil) {
      out.push({
        key: o.id,
        nama: namaMinyak(o),
        stok,
        satuan: o.unit || 'botol',
        jenis: 'Minyak',
        dariMinyak: true
      });
    }
  });

  (items || []).forEach((it) => {
    if (!it) return;
    const stok = Number(it.stock) || 0;
    if (stok <= lowItem) {
      out.push({
        key: it.id,
        nama: it.name,
        stok,
        satuan: it.unit,
        jenis: it.category || kategoriDefault,
        dariMinyak: false
      });
    }
  });

  return out.sort((a, b) => (a.stok - b.stok) || String(a.nama).localeCompare(String(b.nama)));
}

/** Total jumlah stok, dipakai untuk kartu ringkasan di atas halaman. */
export function totalStok(rows) {
  return (rows || []).reduce((s, r) => s + (Number(r && r.stock) || 0), 0);
}