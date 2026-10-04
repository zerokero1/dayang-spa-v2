// ============================================================
// MATEMATIKA BUKU STOK — murni, tanpa database / tanpa React
// ------------------------------------------------------------
// Dipakai Laporan Produk. Format mengikuti template: 2 blok (Minyak,
// Produk+Laundry), tiap blok beberapa grup tanggal, tiap grup 4 kolom
// Stock / In / Out / Sisa.
//
// Aturan angka:
//   Sisa  = Stock - Out + In
//   Stock = Sisa hari sebelumnya
//
// Rantai diturunkan MUNDUR dari stok terkini karena titik jangkarnya
// selalu pasti dan cocok dengan yang tampil di halaman Inventori:
//
//   Sisa hari terakhir = stok saat ini
//   Stock hari ini     = Sisa - In + Out
//
// Rantai ini boleh dipercaya karena log perubahan stok dihitung lengkap:
// trigger AFTER INSERT OR UPDATE OF stock mencatat SETIAP perubahan, dan
// yang tidak mengubah stok di-skip (jadi bukan pergerakan). Sumber:
//   - minyak : oil_inventory_logs
//   - barang : inventory_logs
//
// `coverageFrom` = hari pertama pencatatan di outlet itu. Hari-hari
// sebelumnya tidak bisa diverifikasi, jadi angkanya dikosongkan (null)
// supaya tidak terbaca sebagai "tidak ada barang keluar". Kalau belum
// ada log sama sekali (coverageFrom null), tidak ada yang dikosongkan.
//
// Modul ini sengaja dipisah dari stockUsageService.js supaya bisa
// diuji tanpa browser (tanpa import.meta.env / Supabase).
// ============================================================

/** Konversi created_at (UTC) ke tanggal LOKAL WIB (YYYY-MM-DD). */
export function wibDate(iso) {
  return new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

/** Tanggal-tanggal berurutan mulai startDate, sebanyak count hari. */
export function eachDayCount(startDate, count) {
  const days = [];
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  for (let i = 0; i < count; i++) {
    days.push(new Date(start + i * 24 * 3600000).toISOString().slice(0, 10));
  }
  return days;
}

/** Awal (WIB) dan akhir (WIB) rentang tanggal, sebagai ISO UTC untuk query. */
export function rangeIso(startDate, days) {
  const from = new Date(`${startDate}T00:00:00+07:00`);
  const to = new Date(from.getTime() + days.length * 24 * 3600000 - 1);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/** Kunci item. Pemisah '|' supaya nama yg mengandung spasi tetap aman. */
export function keyOf(a, b) {
  return `${a}|${b}`;
}

/** Susun movements[key][date] = { in, out } dari daftar log. */
function movementsByDay(logs) {
  const move = {};
  logs.forEach((r) => {
    const k = keyOf(r.key, r.sub);
    const day = wibDate(r.created_at);
    const bucket = move[k] || (move[k] = {});
    const cell = bucket[day] || (bucket[day] = { in: 0, out: 0 });
    const q = Number(r.qty) || 0;
    if (r.type === 'in') cell.in += q;
    else cell.out += q;
  });
  return move;
}

/** Tanggal log paling awal — dipakai untuk catatan cakupan di laporan. */
export function firstLogDay(logs) {
  if (!logs.length) return null;
  return logs.reduce((m, r) => {
    const d = wibDate(r.created_at);
    return d < m ? d : m;
  }, '9999-99-99');
}

/**
 * Rantai stok untuk satu item, diturunkan mundur dari stok terkini.
 *
 * `entry`  = { key, sub, stock, ... } — `stock` wajib, itu titik jangkar.
 * `extra`  = field tambahan yang ikut disalin ke tiap baris
 *            (mis. oilType/size untuk minyak, name/unit untuk barang).
 */
function chainBackwards({ days, entry, move, coverageFrom, extra }) {
  const k = keyOf(entry.key, entry.sub);
  let close = Number(entry.stock) || 0;
  const rows = [];

  // Berjalan dari hari terakhir ke awal; nanti dibalik supaya kronologis.
  for (let i = days.length - 1; i >= 0; i--) {
    const date = days[i];
    const m = (move[k] && move[k][date]) || { in: 0, out: 0 };
    const stock = close - m.in + m.out;
    const belumTercover = coverageFrom !== null && date < coverageFrom;
    rows.push({
      date,
      ...extra,
      stock: belumTercover ? null : stock,
      in: belumTercover ? null : m.in,
      out: belumTercover ? null : m.out,
      sisa: belumTercover ? null : close
    });
    close = stock;
  }

  rows.reverse();
  return rows;
}

/**
 * Buku stok MINYAK per hari.
 *
 * `variants`   = [{ oilType, size, stock }] dari oil_inventory
 * `logs`       = [{ key, sub, type, qty, created_at }] dari oil_inventory_logs
 * `coverageFrom` = tanggal log pertama, atau null
 */
export function buildOilLedgerDays({ days, variants, coverageFrom = null, logs = [] }) {
  const move = movementsByDay(logs);
  const rows = [];
  variants.forEach((v) => {
    rows.push(...chainBackwards({
      days,
      entry: { key: v.oilType, sub: v.size, stock: v.stock },
      move,
      coverageFrom,
      extra: { oilType: v.oilType, size: v.size }
    }));
  });
  return rows;
}

/**
 * Buku stok BARANG (Produk + Laundry) per hari.
 *
 * `items` = [{ id, name, unit, stock, category }] dari inventory
 * `logs`  = [{ key, sub, type, qty, created_at }] dari inventory_logs
 */
export function buildItemLedgerDays({ days, items, coverageFrom = null, logs = [] }) {
  const move = movementsByDay(logs);
  const rows = [];
  items.forEach((v) => {
    rows.push(...chainBackwards({
      days,
      entry: { key: v.name, sub: v.unit, stock: v.stock },
      move,
      coverageFrom,
      extra: { itemId: v.id, name: v.name, unit: v.unit, category: v.category }
    }));
  });
  return rows;
}