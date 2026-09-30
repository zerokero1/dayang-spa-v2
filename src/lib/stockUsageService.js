import { supabase } from './supabase';

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

// Konversi created_at (UTC) ke tanggal LOKAL WIB (YYYY-MM-DD)
function wibDate(iso) {
  return new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

// Pemakaian MINYAK per hari = jumlah booking non-batal yang memakai minyak.
// Stok awal/akhir dihitung mundur dari stok terbaru (estimasi: pengisian stok
// minyak manual tidak tercatat secara historis).
export async function getOilStockUsage(outletId, startDate, endDate) {
  const from = dayStrUtc(startDate);
  const to = dayStrUtc(endDate) + 24 * 3600000 - 1;

  const [{ data: stockRows }, { data: bookingRows }] = await Promise.all([
    supabase.from('oil_inventory').select('oil_type, size, stock').eq('outlet_id', outletId),
    supabase
      .from('bookings')
      .select('oil_type, oil_size, created_at')
      .eq('outlet_id', outletId)
      .eq('uses_oil', true)
      .neq('status', 'batal')
      .gte('created_at', new Date(from).toISOString())
      .lte('created_at', new Date(to).toISOString())
  ]);

  const current = {};
  (stockRows || []).forEach((r) => {
    current[`${r.oil_type}_${r.size}`] = { oilType: r.oil_type, size: r.size, stock: r.stock || 0 };
  });

  const usage = {};
  (bookingRows || []).forEach((r) => {
    if (!r.oil_type) return;
    const d = wibDate(r.created_at);
    const key = `${r.oil_type}_${r.oil_size}`;
    usage[d] = usage[d] || {};
    usage[d][key] = (usage[d][key] || 0) + 1;
  });

  const days = eachDay(startDate, endDate);
  const keys = Object.keys(current);
  const rows = [];
  let closing = {};
  keys.forEach((k) => { closing[k] = current[k].stock; });

  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    const open = {};
    keys.forEach((k) => {
      open[k] = closing[k] + (usage[d]?.[k] || 0);
    });
    keys.forEach((k) => {
      rows.push({
        date: d,
        oilType: current[k].oilType,
        size: current[k].size,
        stockAwal: open[k],
        used: usage[d]?.[k] || 0,
        stockAkhir: closing[k]
      });
      closing[k] -= usage[d]?.[k] || 0;
    });
  }

  rows.sort((a, b) => (a.date === b.date ? (a.oilType + a.size).localeCompare(b.oilType + b.size) : a.date > b.date ? 1 : -1));

  return {
    rows,
    current: Object.values(current),
    estimated: true
  };
}

// Pemakaian BARANG LAIN per hari dari inventory_logs (keluar/masuk).
// Stok awal/akhir akurat karena dihitung mundur dari stok terbaru + delta log.
export async function getItemStockUsage(outletId, startDate, endDate) {
  const from = dayStrUtc(startDate);
  const to = dayStrUtc(endDate) + 24 * 3600000 - 1;

  const [{ data: itemRows }, { data: logRows }] = await Promise.all([
    supabase.from('inventory').select('id, name, unit, stock').eq('outlet_id', outletId),
    supabase
      .from('inventory_logs')
      .select('item_id, type, qty, created_at')
      .eq('outlet_id', outletId)
      .gte('created_at', new Date(from).toISOString())
      .lte('created_at', new Date(to).toISOString())
  ]);

  const items = {};
  (itemRows || []).forEach((r) => {
    items[r.id] = { id: r.id, name: r.name, unit: r.unit, stock: r.stock || 0 };
  });

  const dayLog = {}; // date -> itemId -> { out, inn }
  (logRows || []).forEach((r) => {
    if (!items[r.item_id]) return;
    const d = wibDate(r.created_at);
    dayLog[d] = dayLog[d] || {};
    dayLog[d][r.item_id] = dayLog[d][r.item_id] || { out: 0, inn: 0 };
    const qty = Number(r.qty) || 0;
    if (r.type === 'out') dayLog[d][r.item_id].out += qty;
    else dayLog[d][r.item_id].inn += qty;
  });

  const days = eachDay(startDate, endDate);
  const ids = Object.keys(items);
  const rows = [];
  let closing = {};
  ids.forEach((id) => { closing[id] = items[id].stock; });

  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    ids.forEach((id) => {
      const log = dayLog[d]?.[id] || { out: 0, inn: 0 };
      const open = closing[id] + log.out - log.inn;
      rows.push({
        date: d,
        name: items[id].name,
        unit: items[id].unit,
        stockAwal: open,
        masuk: log.inn,
        keluar: log.out,
        stockAkhir: closing[id]
      });
      closing[id] = open; // stok awal hari ini = stok akhir kemarin
    });
  }

  rows.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date > b.date ? 1 : -1));

  return { rows, current: Object.values(items) };
}

// ============================================================
// Estimasi pemakaian BARANG KONSUMABLE per treatment (Hole Sheet,
// Single Sheet, Face Cradle, dll).Aturan pemakaiannya disimpan di
// tabel treatment_consumables; tiap baris = 1 treatment pakai qty item.
//
// Dipakai untuk menghitung berapa pengeluaran full body massage
// per outlet: jumlah pemakaian x harga satuan (inventory.unit_cost).
// ============================================================
export async function getConsumableUsage(outletId, startDate, endDate) {
  const from = dayStrUtc(startDate);
  const to = dayStrUtc(endDate) + 24 * 3600000 - 1;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();

  const [rulesRes, invRes, bookingRes] = await Promise.all([
    supabase.from('treatment_consumables').select('treatment_id, item_name, qty'),
    supabase.from('inventory').select('id, name, unit, stock, unit_cost').eq('outlet_id', outletId),
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
    return { ok: false, reason: 'Aturan pemakaian treatment belum diatur.', items: [], byTreatment: [], days: [], total: 0 };
  }

  // Aturan per treatment.
  const ruleByTreatment = {};
  rules.forEach((r) => {
    (ruleByTreatment[r.treatment_id] = ruleByTreatment[r.treatment_id] || []).push({
      itemName: r.item_name,
      qty: Number(r.qty) || 0
    });
  });

  // Stok & harga satuan per barang di outlet ini.
  const invByName = {};
  (invRes.data || []).forEach((r) => { invByName[String(r.name).toLowerCase()] = r; });

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
  const byTreatment = Object.entries(cntTreatment)
    .map(([tid, count]) => {
      const first = (bookingRes.data || []).find((b) => b.treatment_id === tid);
      return {
        treatmentId: tid,
        treatmentName: first?.treatment_name || '(tanpa nama)',
        count,
        items: ruleByTreatment[tid].map((r) => ({
          itemName: r.itemName,
          qty: r.qty * count
        }))
      };
    })
    .sort((a, b) => b.count - a.count || a.treatmentName.localeCompare(b.treatmentName));

  // Agregasi per barang.
  const agg = {};
  byTreatment.forEach((t) => t.items.forEach((it) => {
    agg[it.itemName] = (agg[it.itemName] || 0) + it.qty;
  }));

  const items = Object.entries(agg)
    .map(([name, qty]) => {
      const inv = invByName[name.toLowerCase()];
      const unitCost = Number(inv?.unit_cost) || 0;
      return {
        name,
        unit: inv?.unit || 'pcs',
        stock: inv?.stock ?? null,
        unitCost,
        qty,
        estimatedCost: Math.round(unitCost * qty)
      };
    })
    .sort((a, b) => b.estimatedCost - a.estimatedCost || a.name.localeCompare(b.name));

  // Rincian per hari (total semua barang per tanggal).
  const days = eachDay(startDate, endDate).map((d) => {
    const perItem = {};
    let total = 0;
    Object.entries(cntDay[d] || {}).forEach(([tid, count]) => {
      ruleByTreatment[tid].forEach((r) => {
        perItem[r.itemName] = (perItem[r.itemName] || 0) + r.qty * count;
        const inv = invByName[r.itemName.toLowerCase()];
        total += (Number(inv?.unit_cost) || 0) * r.qty * count;
      });
    });
    return { date: d, perItem, estimatedCost: Math.round(total) };
  }).filter((d) => Object.keys(d.perItem).length > 0);

  const total = items.reduce((sum, i) => sum + i.estimatedCost, 0);
  const totalCount = byTreatment.reduce((sum, t) => sum + t.count, 0);
  const belumAdaHarga = items.some((i) => i.unitCost === 0);

  return {
    ok: true,
    items,
    byTreatment,
    days,
    total,
    totalCount,
    belumAdaHarga,
    rules: rules.length
  };
}