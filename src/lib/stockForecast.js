/**
 * Peringatan stok produk treatment di Kasir.
 *
 * Sifatnya hanya peringatan: booking tetap diproses walau stok kurang,
 * dan database menjepit stok di 0 (kebijakan "A").
 */

/** Kunci pencocokan nama barang: lowercase + trim. */
function key(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

/**
 * Hitung produk yang akan habis bila keranjang dibayar.
 *
 * @param {Array} cartLines            isi keranjang (tiap baris punya `treatment`)
 * @param {Object} consumablesByTreatment  peta treatmentId -> [{ itemName, qty }]
 * @param {Array}  stockItems           item inventory outlet aktif
 * @returns {Array<{name, needed, stock, short}>} barang kurang, kekurangan terbesar dulu
 */
export function forecastStockAlerts(cartLines, consumablesByTreatment, stockItems) {
  const needed = {};
  (cartLines || []).forEach((line) => {
    const list = consumablesByTreatment && line.treatment
      ? consumablesByTreatment[line.treatment.id]
      : null;
    if (!list) return;
    list.forEach(({ itemName, qty }) => {
      const k = key(itemName);
      if (!k) return;
      needed[k] = (needed[k] || 0) + (Number(qty) || 0);
    });
  });

  const stockByName = {};
  (stockItems || []).forEach((i) => {
    stockByName[key(i.name)] = Number(i.stock) || 0;
  });

  return Object.keys(needed)
    // Barang yang belum terdaftar di outlet ini tidak bisa dinilai stoknya.
    .filter((k) => Object.prototype.hasOwnProperty.call(stockByName, k))
    .filter((k) => stockByName[k] < needed[k])
    .map((k) => ({
      name: k,
      needed: needed[k],
      stock: stockByName[k],
      short: needed[k] - stockByName[k]
    }))
    .sort((a, b) => b.short - a.short || b.needed - a.needed);
}

/**
 * Nama barang untuk ditampilkan. Memakai kapitalisasi aslinya bila tersedia,
 * agar "pedicure produk" tetap tampil sebagai "Pedicure Produk".
 */
export function displayStockName(keyedName, stockItems) {
  const hit = (stockItems || []).find((i) => key(i.name) === keyedName);
  return hit ? hit.name : keyedName;
}

/** Kalimat ringkas untuk banner peringatan. */
export function describeStockAlerts(alerts, stockItems) {
  return (alerts || [])
    .map((a) => `${displayStockName(a.name, stockItems)} (stok ${a.stock}, butuh ${a.needed})`)
    .join(', ');
}