import { supabase } from './supabase';
import {
  buildItemLedgerDays,
  buildOilLedgerDays,
  eachDayCount,
  firstLogDay,
  rangeIso,
  wibDate
} from './stokLedger';

function dayStrUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600000; // 00:00 WIB = UTC-7 jam
}

function eachDay(startDate, endDate) {
  const days = [];
  const start = dayStrUtc(startDate);
  const end = dayStrUtc(endDate);
  for (let t = start; t <= end; t += 24 * 3600000) {
    // label hari harus WIB (instant 00:00 WIB + 7 jam = tanggal WIB yang benar),
    // bukan tanggal UTC dari instant tsb (yang mundur sehari).
    days.push(new Date(t + 7 * 3600000).toISOString().slice(0, 10));
  }
  return days;
}

// ============================================================
// BUKU STOK PER HARI — dipakai Laporan Produk
// ------------------------------------------------------------
// Matematika rantainya ada di stokLedger.js (murni, bisa diuji).
// File ini hanya ambil datanya lalu meneruskannya.
// ============================================================

/**
 * Buku stok MINYAK per hari.
 *
 * Rantainya diturunkan mundur dari oil_inventory.stock, jadi Sisa hari
 * terakhir selalu sama dengan angka stok yang tampil di halaman Inventori.
 * oil_inventory_logs dipakai untuk In/Out tiap hari; trigger
 * trg_oil_inventory_logs mencatat setiap perubahan stok, jadi rantai ini
 * lengkap. Hari sebelum pencatatan pertama dikosongkan.
 */
export async function getOilLedger(outletId, startDate, dayCount = 7) {
  const days = eachDayCount(startDate, dayCount);
  const { fromIso, toIso } = rangeIso(startDate, days);

  const [stockRes, logRes] = await Promise.all([
    supabase.from('oil_inventory').select('oil_type, size, stock').eq('outlet_id', outletId),
    supabase
      .from('oil_inventory_logs')
      .select('oil_type, size, type, qty, created_at')
      .eq('outlet_id', outletId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
  ]);

  const variants = (stockRes.data || []).map((r) => ({
    oilType: r.oil_type,
    size: r.size,
    stock: Number(r.stock) || 0
  }));

  const logs = (logRes.data || []).map((r) => ({
    key: r.oil_type, sub: r.size, type: r.type, qty: r.qty, created_at: r.created_at
  }));
  const coverageFrom = firstLogDay(logs);

  return {
    days,
    rows: buildOilLedgerDays({ days, variants, coverageFrom, logs }),
    variants: variants.sort(
      (a, b) => a.oilType.localeCompare(b.oilType) || a.size.localeCompare(b.size)
    ),
    coverageFrom
  };
}

/**
 * Buku stok BARANG (Produk + Laundry) per hari.
 *
 * inventory_logs tidak menyimpan stock_after, jadi rantainya diturunkan
 * MUNDUR dari inventory.stock: sisa hari ini = stok sekarang, lalu
 * stok awal = sisa - In + Out, dan seterusnya ke belakang.
 */
export async function getItemLedger(outletId, startDate, dayCount = 7) {
  const days = eachDayCount(startDate, dayCount);
  const { fromIso, toIso } = rangeIso(startDate, days);

  const [itemRes, logRes] = await Promise.all([
    supabase.from('inventory').select('id, name, unit, stock, category').eq('outlet_id', outletId),
    supabase
      .from('inventory_logs')
      .select('item_id, type, qty, created_at')
      .eq('outlet_id', outletId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
  ]);

  const items = (itemRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    stock: Number(r.stock) || 0,
    category: r.category || 'Produk'
  }));
  const byId = {};
  items.forEach((it) => { byId[it.id] = it; });

  const logs = (logRes.data || [])
    .filter((r) => byId[r.item_id])
    .map((r) => {
      const it = byId[r.item_id];
      return { key: it.name, sub: it.unit, type: r.type, qty: r.qty, created_at: r.created_at };
    });
  const coverageFrom = firstLogDay(logs);

  return {
    days,
    rows: buildItemLedgerDays({ days, items, coverageFrom, logs }),
    items: items.sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    ),
    coverageFrom
  };
}

// ============================================================
// BUKU STOK GABUNGAN SEMUA OUTLET
// ------------------------------------------------------------
// Memakai helper yang sama dengan Laporan Produk, tapi dirangkai ulang dengan
// outlet sebagai bagian dari nama item. Tujuannya satu angka stok untuk rekap
// gabungan — bukan dijumlahkan setelah tabel selesai, karena itu akan salah
// kalau ada nama barang sama di dua outlet.
// ============================================================

/** Awalan nama supaya baris dari tiap outlet tidak tertukar. */
function prefixOutlet(outletId, label) {
  return `[${outletId}] ${label}`;
}

/**
 * Buku stok gabungan 6 outlet untuk rentang tanggal bebas.
 *
 * `startDate`/`endDate` inklusif batas hari WIB. Setiap outlet punya rantai
 * mundur sendiri yang diturunkan dari stok terkini outlet itu, lalu digabung
 * setelah itu — jadi angka akhirnya tetap sama dengan penjumlahan stok
 * outlet-outlet tersebut, dan untuk periode yang tidak ada pergerakannya
 * nilainya sama persis dengan stok hari ini.
 */
export async function getAllOutletLedger(outletIds, startDate, endDate) {
  const days = eachDay(startDate, endDate);
  if (!days.length) {
    return { days: [], oil: { rows: [], variants: [], coverageFrom: null }, item: { rows: [], items: [], coverageFrom: null } };
  }

  const perOutlet = await Promise.all(
    outletIds.map(async (id) => {
      const [oil, item] = await Promise.all([
        getOilLedgerRange(id, startDate, endDate),
        getItemLedgerRange(id, startDate, endDate)
      ]);
      return { id, oil, item };
    })
  );

  // oil_inventory_logs dipakai untuk In/Out tiap hari; trigger
  // oil_inventory per outlet terpisah, lalu digabung di sini. Cakupan
  // (coverageFrom) diambil yang paling awal — kalau satu outlet punya log lebih
  // awal dari yang lain, hari-hari sebelum itu tidak bisa diverifikasi untuk
  // outlet itu, jadi angka paling awal di seluruh laporan ikut dikosongkan.
  const oilCoverage = perOutlet
    .map((o) => o.oil.coverageFrom)
    .filter(Boolean)
    .sort()[0] || null;
  const itemCoverage = perOutlet
    .map((o) => o.item.coverageFrom)
    .filter(Boolean)
    .sort()[0] || null;

  const oilVariants = [];
  const oilRows = [];
  perOutlet.forEach(({ id, oil }) => {
    oil.variants.forEach((v) => {
      oilVariants.push({ oilType: v.oilType, size: v.size, outletId: id, label: prefixOutlet(id, `${v.oilType} (${v.size})`) });
    });
    oil.rows.forEach((r) => {
      oilRows.push({
        ...r,
        outletId: id,
        label: prefixOutlet(id, `${r.oilType} (${r.size})`)
      });
    });
  });

  const items = [];
  const itemRows = [];
  perOutlet.forEach(({ id, item }) => {
    item.items.forEach((it) => {
      items.push({
        ...it,
        outletId: id,
        label: prefixOutlet(id, it.unit ? `${it.name} (${it.unit})` : it.name)
      });
    });
    item.rows.forEach((r) => {
      itemRows.push({
        ...r,
        outletId: id,
        label: prefixOutlet(id, it.unit ? `${r.name} (${r.unit})` : r.name)
      });
    });
  });

  return {
    days,
    oil: {
      rows: oilRows,
      variants: oilVariants.sort((a, b) => a.label.localeCompare(b.label)),
      coverageFrom: oilCoverage
    },
    item: {
      rows: itemRows,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
      coverageFrom: itemCoverage
    }
  };
}

export async function getOilLedgerRange(outletId, startDate, endDate) {
  const days = eachDay(startDate, endDate);
  const from = dayStrUtc(startDate);
  const to = dayStrUtc(endDate) + 24 * 3600000 - 1;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();

  const [stockRes, logRes] = await Promise.all([
    supabase.from('oil_inventory').select('oil_type, size, stock').eq('outlet_id', outletId),
    supabase
      .from('oil_inventory_logs')
      .select('oil_type, size, type, qty, created_at')
      .eq('outlet_id', outletId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
  ]);

  const variants = (stockRes.data || []).map((r) => ({
    oilType: r.oil_type,
    size: r.size,
    stock: Number(r.stock) || 0
  }));
  const logs = (logRes.data || []).map((r) => ({
    key: r.oil_type, sub: r.size, type: r.type, qty: r.qty, created_at: r.created_at
  }));
  const coverageFrom = firstLogDay(logs);

  return {
    days,
    rows: buildOilLedgerDays({ days, variants, coverageFrom, logs }),
    variants: variants.sort((a, b) => a.oilType.localeCompare(b.oilType) || a.size.localeCompare(b.size)),
    coverageFrom
  };
}

export async function getItemLedgerRange(outletId, startDate, endDate) {
  const days = eachDay(startDate, endDate);
  const from = dayStrUtc(startDate);
  const to = dayStrUtc(endDate) + 24 * 3600000 - 1;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();

  const [itemRes, logRes] = await Promise.all([
    supabase.from('inventory').select('id, name, unit, stock, category').eq('outlet_id', outletId),
    supabase
      .from('inventory_logs')
      .select('item_id, type, qty, created_at')
      .eq('outlet_id', outletId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
  ]);

  const items = (itemRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    stock: Number(r.stock) || 0,
    category: r.category || 'Produk'
  }));
  const byId = {};
  items.forEach((it) => { byId[it.id] = it; });

  const logs = (logRes.data || [])
    .filter((r) => byId[r.item_id])
    .map((r) => {
      const it = byId[r.item_id];
      return { key: it.name, sub: it.unit, type: r.type, qty: r.qty, created_at: r.created_at };
    });
  const coverageFrom = firstLogDay(logs);

  return {
    days,
    rows: buildItemLedgerDays({ days, items, coverageFrom, logs }),
    items: items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    coverageFrom
  };
}

// ============================================================
// Pemakaian BARANG KONSUMABLE per treatment (Hole Sheet, Single
// Sheet, Face Cradle, dll). Aturan pemakaiannya disimpan di tabel
// treatment_consumables; tiap baris = 1 treatment memakai qty item.
//
// Menghitung BERAPA ITEM YANG KELUAR (jumlah barang, bukan rupiah)
// per outlet per hari, dihitung otomatis dari booking yang tidak batal.
// Contoh: 1 full body massage = 1 Hole Sheet + 1 Single Sheet + 1 Face Cradle
// ============================================================
export async function getConsumableUsage(outletId, startDate, endDate) {
  const from = dayStrUtc(startDate);
  const to = dayStrUtc(endDate) + 24 * 3600000 - 1;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();

  const [rulesRes, invRes, bookingRes] = await Promise.all([
    supabase.from('treatment_consumables').select('treatment_id, item_name, qty'),
    supabase.from('inventory').select('id, name, unit, stock').eq('outlet_id', outletId),
    supabase
      .from('bookings')
      .select('treatment_id, treatment_name, created_at')
      .eq('outlet_id', outletId)
      .neq('status', 'batal')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
  ]);

  const rules = rulesRes.data || [];
  if (rules.length === 0) {
    return { ok: false, reason: 'Aturan pemakaian treatment belum diatur.', itemNames: [], items: [], byTreatment: [], days: [], totalItem: 0 };
  }

  // Aturan per treatment.
  const ruleByTreatment = {};
  rules.forEach((r) => {
    (ruleByTreatment[r.treatment_id] = ruleByTreatment[r.treatment_id] || []).push({
      itemName: r.item_name,
      qty: Number(r.qty) || 0
    });
  });

  // Nama item yang dipakai aturan + info stok di outlet ini.
  const invByName = {};
  (invRes.data || []).forEach((r) => { invByName[String(r.name).toLowerCase()] = r; });
  const itemNames = [...new Set(rules.map((r) => r.item_name))].sort();

  // Jumlah booking per treatment per hari.
  const cntTreatment = {};
  const cntDay = {};
  (bookingRes.data || []).forEach((b) => {
    if (!b.treatment_id || !ruleByTreatment[b.treatment_id]) return;
    const d = wibDate(b.created_at);
    const t = b.treatment_id;
    cntTreatment[t] = (cntTreatment[t] || 0) + 1;
    cntDay[d] = cntDay[d] || {};
    cntDay[d][t] = (cntDay[d][t] || 0) + 1;
  });

  // Agregasi per treatment.
  const nameOfTreatment = {};
  (bookingRes.data || []).forEach((b) => { if (b.treatment_id) nameOfTreatment[b.treatment_id] = b.treatment_name; });

  const byTreatment = Object.entries(cntTreatment)
    .map(([tid, count]) => ({
      treatmentId: tid,
      treatmentName: nameOfTreatment[tid] || '(tanpa nama)',
      count,
      items: ruleByTreatment[tid].map((r) => ({ itemName: r.itemName, qty: r.qty * count }))
    }))
    .sort((a, b) => b.count - a.count || a.treatmentName.localeCompare(b.treatmentName));

  // Agregasi per barang (seluruh rentang).
  const agg = {};
  byTreatment.forEach((t) => t.items.forEach((it) => {
    agg[it.itemName] = (agg[it.itemName] || 0) + it.qty;
  }));

  const items = itemNames.map((name) => {
    const inv = invByName[name.toLowerCase()];
    return {
      name,
      unit: inv?.unit || 'pcs',
      stock: inv?.stock ?? null,
      keluar: agg[name] || 0,
      sisa: inv?.stock != null ? inv.stock - (agg[name] || 0) : null
    };
  }).sort((a, b) => b.keluar - a.keluar || a.name.localeCompare(b.name));

  // Rincian per tanggal.
  const days = eachDay(startDate, endDate).map((d) => {
    const perItem = {};
    let treatmentCount = 0;
    Object.entries(cntDay[d] || {}).forEach(([tid, count]) => {
      treatmentCount += count;
      ruleByTreatment[tid].forEach((r) => {
        perItem[r.itemName] = (perItem[r.itemName] || 0) + r.qty * count;
      });
    });
    const totalItem = Object.values(perItem).reduce((s, n) => s + n, 0);
    return { date: d, treatmentCount, perItem, totalItem };
  }).filter((d) => d.totalItem > 0);

  const totalItem = items.reduce((sum, i) => sum + i.keluar, 0);
  const totalCount = byTreatment.reduce((sum, t) => sum + t.count, 0);

  return {
    ok: true,
    itemNames,
    items,
    byTreatment,
    days,
    totalItem,
    totalCount
  };
}