import { supabase } from './supabase';
import { OUTLETS, SHIFT_LABEL } from './constants';
import { lateMinutesFor } from './shiftService';
import { getConsumableUsage } from './stockUsageService';

/**
 * ==========================================================================
 * BUKU LAPORAN — satu file Excel berisi 4 sheet:
 *   1. Inventory  : sisa stock, barang masuk/keluar, pemakaian harian
 *   2. Absensi    : data telat, jam masuk, jam pulang
 *   3. Komisi     : komisi 10%
 *   4. Revenue    : income per hari + grand total per outlet
 *
 * DASAR TANGGAL: created_at (WIB) — tanggal saat transaksi dicatat. Dipakai
 * supaya konsisten dengan Laporan Keuangan yang sudah ada. Kolom completed_at
 * TIDAK dipakai: isinya rusak (ribuan booking hasil backfill massal satu
 * timestamp), sehingga tidak bisa jadi dasar pengelompokan harian.
 * ==========================================================================
 */

// ---------------------------------------------------------------- utils

const WIB_OFFSET_MS = 7 * 3600000;

/** Tanggal WIB (YYYY-MM-DD) dari kolom timestamptz. */
export function wibDateOf(iso) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Batas UTC untuk satu hari WIB. */
function wibDayUtc(dateStr, endOfDay = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d, 0, 0, 0) - WIB_OFFSET_MS;
  return new Date(endOfDay ? start + 24 * 3600000 - 1 : start).toISOString();
}

export function eachDay(startDate, endDate) {
  const days = [];
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  let t = Date.UTC(y1, m1 - 1, d1);
  const end = Date.UTC(y2, m2 - 1, d2);
  while (t <= end) {
    days.push(new Date(t + WIB_OFFSET_MS).toISOString().slice(0, 10));
    t += 24 * 3600000;
  }
  return days;
}

export function todayWib() {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function outletName(id) {
  return OUTLETS.find((o) => o.id === id)?.name || id || '-';
}

// payment_method di produksi pernah menyimpan JSON objek therapist utuh
// (salah bug input), jadi nilai yang tidak dikenal dikelompokkan sebagai Lainnya
// alih-alih ikut jadi header tabel.
const KNOWN_PAYMENTS = new Set(['cash', 'cardless', 'qris', 'transfer', 'debit', 'kredit', 'edc', 'ovo', 'dana', 'gopay', 'shopeepay']);

function paymentLabel(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return KNOWN_PAYMENTS.has(v) ? v : 'lainnya';
}

/** Bangun query bookings terfilter (dipakai 3 sheet sekaligus). */
function bookingQuery({ startDate, endDate, outletId, extraSelect }) {
  let q = supabase
    .from('bookings')
    .select(extraSelect)
    .gte('created_at', wibDayUtc(startDate))
    .lte('created_at', wibDayUtc(endDate, true))
    .neq('status', 'batal');
  if (outletId) q = q.eq('outlet_id', outletId);
  return q;
}

// =====================================================================
// 1. INVENTORY
// =====================================================================

/**
 * Sisa stock + riwayat masuk/keluar + pemakaian harian.
 *
 * MINYAK: sekarang punya oil_inventory_logs (isi otomatis oleh trigger),
 * jadi "In Out" minyak bisa ditelusuri mulai pencatatan dimulai.
 * BARANG: inventory_logs sudah ada tapi pemakaiannya dari.opsi app; kalau
 * masih kosong, pemakaian nonin-minyak dihitung dari ATURAN treatment
 * (treatment_consumables x booking). Angka itu ESTIMASI, bukan hasil
 * pencatatan fisik, jadi laporan melabelinya berbeda agar tidak dikira
 * persis.
 */
export async function getInventoryBook({ startDate, endDate, outletId }) {
  const [oilRes, itemRes, oilLogRes, itemLogRes, bookingRes] = await Promise.all([
    supabase.from('oil_inventory').select('outlet_id, oil_type, size, stock, unit'),
    supabase.from('inventory').select('id, outlet_id, name, unit, stock, unit_cost'),
    supabase
      .from('oil_inventory_logs')
      .select('outlet_id, oil_type, size, type, qty, stock_after, note, created_at')
      .gte('created_at', wibDayUtc(startDate))
      .lte('created_at', wibDayUtc(endDate, true)),
    supabase
      .from('inventory_logs')
      .select('outlet_id, item_id, type, qty, note, created_at')
      .gte('created_at', wibDayUtc(startDate))
      .lte('created_at', wibDayUtc(endDate, true)),
    supabase
      .from('bookings')
      .select('outlet_id, oil_type, oil_size, uses_oil, created_at')
      .neq('status', 'batal')
      .eq('uses_oil', true)
      .gte('created_at', wibDayUtc(startDate))
      .lte('created_at', wibDayUtc(endDate, true))
  ]);

  const inScope = (row) => !outletId || row.outlet_id === outletId;

  // --- Sisa stock sekarang (angka pasti, bukan estimasi)
  const stockRows = [];
  (oilRes.data || []).filter(inScope).forEach((r) => {
    stockRows.push({
      outlet: outletName(r.outlet_id),
      kategori: 'Minyak',
      nama: r.oil_type,
      ukuran: r.size,
      satuan: r.unit || 'botol',
      stok: r.stock ?? 0
    });
  });
  (itemRes.data || []).filter(inScope).forEach((r) => {
    stockRows.push({
      outlet: outletName(r.outlet_id),
      kategori: 'Barang',
      nama: r.name,
      ukuran: '-',
      satuan: r.unit || 'pcs',
      stok: r.stock ?? 0
    });
  });
  stockRows.sort((a, b) => a.outlet.localeCompare(b.outlet) || a.kategori.localeCompare(b.kategori) || a.nama.localeCompare(b.nama));

  // --- Barang masuk / keluar
  const itemNameById = {};
  (itemRes.data || []).forEach((r) => { itemNameById[r.id] = r.name; });
  const unitByItemId = {};
  (itemRes.data || []).forEach((r) => { unitByItemId[r.id] = r.unit || 'pcs'; });

  const movementRows = [];
  (oilLogRes.data || []).filter(inScope).forEach((r) => {
    movementRows.push({
      tanggal: wibDateOf(r.created_at),
      outlet: outletName(r.outlet_id),
      kategori: 'Minyak',
      nama: r.oil_type,
      ukuran: r.size,
      masuk: r.type === 'in' ? r.qty : 0,
      keluar: r.type === 'out' ? r.qty : 0,
      sisa: r.stock_after,
      catatan: r.note || ''
    });
  });
  (itemLogRes.data || []).filter(inScope).forEach((r) => {
    const nm = itemNameById[r.item_id] || '(item terhapus)';
    movementRows.push({
      tanggal: wibDateOf(r.created_at),
      outlet: outletName(r.outlet_id),
      kategori: 'Barang',
      nama: nm,
      ukuran: unitByItemId[r.item_id] || '-',
      masuk: r.type === 'in' ? r.qty : 0,
      keluar: r.type === 'out' ? r.qty : 0,
      sisa: null,
      catatan: r.note || ''
    });
  });
  movementRows.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.outlet.localeCompare(b.outlet));

  // --- Pemakaian harian
  const oilUsage = {};   // date -> outlet -> "type|size" -> qty
  (bookingRes.data || []).forEach((r) => {
    if (!r.oil_type) return;
    const d = wibDateOf(r.created_at);
    oilUsage[d] = oilUsage[d] || {};
    oilUsage[d][r.outlet_id] = oilUsage[d][r.outlet_id] || {};
    const k = `${r.oil_type}|${r.oil_size}`;
    oilUsage[d][r.outlet_id][k] = (oilUsage[d][r.outlet_id][k] || 0) + 1;
  });
  const itemUsage = {};  // date -> outlet -> itemId -> qty (barang keluar)
  (itemLogRes.data || []).filter((r) => r.type === 'out').forEach((r) => {
    const d = wibDateOf(r.created_at);
    itemUsage[d] = itemUsage[d] || {};
    itemUsage[d][r.outlet_id] = itemUsage[d][r.outlet_id] || {};
    itemUsage[d][r.outlet_id][r.item_id] = (itemUsage[d][r.outlet_id][r.item_id] || 0) + (r.qty || 0);
  });

  // --- Pemakaian barang konsumable dari ATURAN treatment
  //
  // treatment_consumables bilang "1 full body massage = 1 hole sheet".
  // Jadi pemakaiannya bisa dihitung sendiri dari booking, walau tidak ada
  // satu pun pencatatan stok manual. PENTING: ini ESTIMASI sesuai aturan,
  // bukan hasil hitung fisika di gudang. Kalau treatment Consumable punya
  // Treatment yang nyata memakai lebih sedikit, laporan ini akan
  // over-count — makanya kolomnya dilabeli "Estimasi", tidak "Tercatat".
  const scopeOutlets = outletId ? [outletId] : OUTLETS.map((o) => o.id);
  const unitByName = {};
  (itemRes.data || []).forEach((r) => { unitByName[String(r.name).toLowerCase()] = r.unit || 'pcs'; });
  const consumableByDay = {};   // date -> outlet -> { itemName: qty }
  let consumableEstimated = false;
  const consumableResults = await Promise.all(scopeOutlets.map((oid) =>
    getConsumableUsage(oid, startDate, endDate).catch(() => null)
  ));
  consumableResults.forEach((res, i) => {
    if (!res || !res.ok) return;
    consumableEstimated = true;
    const oid = scopeOutlets[i];
    res.days.forEach((d) => {
      consumableByDay[d.date] = consumableByDay[d.date] || {};
      consumableByDay[d.date][oid] = d.perItem;
    });
  });

  const usageRows = [];
  eachDay(startDate, endDate).forEach((d) => {
    const outlets = outletId ? [outletId] : OUTLETS.map((o) => o.id);
    outlets.forEach((oid) => {
      const oil = oilUsage[d]?.[oid] || {};
      Object.entries(oil).forEach(([k, qty]) => {
        const [nm, size] = k.split('|');
        usageRows.push({
          tanggal: d, outlet: outletName(oid), kategori: 'Minyak',
          nama: nm, ukuran: size, satuan: 'botol', dipakai: qty, sumber: 'Terhitung otomatis'
        });
      });
      const items = itemUsage[d]?.[oid] || {};
      Object.entries(items).forEach(([itemId, qty]) => {
        usageRows.push({
          tanggal: d, outlet: outletName(oid), kategori: 'Barang',
          nama: itemNameById[itemId] || '(item terhapus)',
          ukuran: unitByItemId[itemId] || 'pcs', satuan: unitByItemId[itemId] || 'pcs',
          dipakai: qty, sumber: 'Tercatat'
        });
      });
      const cons = consumableByDay[d]?.[oid] || {};
      Object.entries(cons).forEach(([nm, qty]) => {
        const unit = unitByName[String(nm).toLowerCase()] || 'pcs';
        usageRows.push({
          tanggal: d, outlet: outletName(oid), kategori: 'Barang',
          nama: nm, ukuran: unit, satuan: unit, dipakai: qty, sumber: 'Estimasi (aturan treatment)'
        });
      });
    });
  });

  return {
    stockRows,
    movementRows,
    usageRows,
    // empezio Honest: dari mana angka ini berasal dan apa yang tidak ada.
    caveats: [
      (oilLogRes.data || []).length === 0
        ? 'Riwayat masuk/keluar minyak baru mulai tercatat setelah pencatatan diaktifkan (2 Okt 2026).'
        : null,
      (itemLogRes.data || []).length === 0
        ? 'Barang non-minyak belum pernah mencatat movements masuk/keluar, jadi kolom In/Out kosong untuk periode ini.'
        : null,
      consumableEstimated
        ? 'Pemakaian nonin-minyak di tabel "Pemakaian Harian" dihitung dari aturan treatment (treatment_consumables x booking), bukan dari pencatatan stok fisik. Kalau ada treatment yang memakai lebih sedikit dari aturan, angka ini terlalu besar.'
        : null
    ].filter(Boolean)
  };
}

// =====================================================================
// 2. ABSENSI — data telat, jam masuk, jam pulang
// =====================================================================

export async function getAttendanceBook({ startDate, endDate, outletId }) {
  const [attRes, otRes, therapistRes] = await Promise.all([
    supabase
      .from('attendance')
      .select('employee_id, employee_name, outlet_id, date, type, check_in_minutes, check_out_minutes, shift_code, late_minutes, source, note')
      .gte('date', startDate)
      .lte('date', endDate),
    supabase
      .from('attendance_overtime')
      .select('employee_id, date, minutes, verified, source, note')
      .gte('date', startDate)
      .lte('date', endDate),
    supabase.from('therapists').select('id, name, shift, home_outlet_id')
  ]);

  const shiftById = {};
  const therapistNameById = {};
  const therapistOutletById = {};
  (therapistRes.data || []).forEach((t) => {
    shiftById[t.id] = t.shift;
    therapistNameById[t.id] = t.name;
    therapistOutletById[t.id] = t.home_outlet_id;
  });
  const otByKey = {};
  (otRes.data || []).forEach((o) => { otByKey[`${o.employee_id}_${o.date}`] = o; });

  const detail = [];
  (attRes.data || []).forEach((r) => {
    if (outletId && r.outlet_id !== outletId) return;
    const shift = r.shift_code || shiftById[r.employee_id] || null;
    // Tanpa jam datang, keterlambatan TIDAK bisa dinilai. Nilai null
    // (tidak diketahui) dipilih, bukan 0, supaya laporan tidak
    // menyiratkan orang datang tepat waktu padahal tidak ada jamnya.
    const computed = lateMinutesFor(r.check_in_minutes, shift);
    // Sama berlaku kalau jam datang ada tapi shift-nya belum diatur:
    // telat = null (tidak diketahui), bukan 0.
    const late = (r.check_in_minutes == null || computed == null) ? null : computed;
    const ot = otByKey[`${r.employee_id}_${r.date}`];
    detail.push({
      employeeId: r.employee_id,
      tanggal: r.date,
      nama: r.employee_name,
      outlet: outletName(r.outlet_id),
      shift: shift ? (SHIFT_LABEL[shift] || shift) : '-',
      status: r.type,
      jamMasuk: r.check_in_minutes,
      jamPulang: r.check_out_minutes,
      telat: late,
      lembur: ot ? ot.minutes : null,
      lemburTerverifikasi: ot ? ot.verified : null,
      catatan: r.note || ''
    });
  });
  detail.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.nama.localeCompare(b.nama));

  // Baris "telat" saja — ini yang paling sering ditanyakan atasan.
  const lateOnly = detail.filter((d) => (d.telat ?? 0) > 0 || d.status === 'telat');

  // Ringkasan per orang.
  const byPerson = {};
  detail.forEach((d) => {
    if (!byPerson[d.nama]) {
      byPerson[d.nama] = {
        nama: d.nama, hariMasuk: 0, hariTelat: 0, totalTelat: 0, totalLembur: 0,
        sickness: 0, izin: 0, alpha: 0
      };
    }
    const p = byPerson[d.nama];
    if (d.jamMasuk != null) p.hariMasuk++;
    if ((d.telat ?? 0) > 0 || d.status === 'telat') p.hariTelat++;
    p.totalTelat += d.telat ?? 0;
    p.totalLembur += d.lembur ?? 0;
    if (d.status === 'sakit') p.sickness++;
    if (d.status === 'izin') p.izin++;
    if (d.status === 'alpha') p.alpha++;
  });
  const summary = Object.values(byPerson).sort((a, b) => b.totalTelat - a.totalTelat || a.nama.localeCompare(b.nama));

  // Lembur lama yang tidak punya booking pendukung -> perlu ditinjau.
  // Diturunkan dari `detail` (bukan langsung dari attendance_overtime)
  // supaya filter outlet di laporan ini benar-benar berlaku: baris overtime
  // hasil migrasi lama bisa punya outlet_id NULL, jadi memfilter kolom itu
  // langsung akan diam-diam membuang lembur. Outlet diambil dari baris
  // absensi hari yang sama. Baris overtime tanpa baris absensi_same-day
  // tetap dihitung agar tidak hilang diam-diam.
  const needReview = [];
  const reviewKeys = new Set();
  detail.forEach((d) => {
    if (d.lemburTerverifikasi !== false) return;
    needReview.push({
      tanggal: d.tanggal, nama: d.nama, outlet: d.outlet, menit: d.lembur, catatan: d.catatan
    });
    reviewKeys.add(`${d.employeeId}_${d.tanggal}`);
  });
  const orphans = (otRes.data || []).filter(
    (o) => o.verified === false && !reviewKeys.has(`${o.employee_id}_${o.date}`)
  );
  orphans.forEach((o) => {
    const home = therapistOutletById[o.employee_id];
    if (outletId && home && home !== outletId) return;
    needReview.push({
      tanggal: o.date,
      nama: therapistNameById[o.employee_id] || '(nama tidak tersimpan)',
      outlet: home ? outletName(home) : '-',
      menit: o.minutes,
      catatan: o.note || ''
    });
  });
  needReview.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.nama.localeCompare(b.nama));

  const withClock = detail.filter((d) => d.jamMasuk != null || d.jamPulang != null).length;

  return {
    detail,
    lateOnly,
    summary,
    needReview,
    caveats: [
      withClock === 0
        ? 'Belum ada jam masuk/pulang sama sekali. Sistem ini mulai diisi 2026-10-03.'
        : `Jam masuk/pulang terisi pada ${withClock} dari ${detail.length} baris. Data sebelum 2026-10-03 belum punya jam datang.`,
      needReview.length
        ? `${needReview.length} catatan lembur lama tidak punya booking pendukung dan perlu ditinjau.`
        : null
    ].filter(Boolean)
  };
}

// =====================================================================
// 3. + 4. KOMISI & REVENUE
// Satu query bookings dipakai keduanya supaya angka di sheet 3 dan 4
// tidak mungkin berbeda.
// =====================================================================

const BOOKING_FIELDS =
  'outlet_id, therapist_id, therapist_name, treatment_name, treatment_price, ' +
  'commission_percent, commission_amount, discount_pct, booking_source, ' +
  'hotel_commission, paid, payment_method, created_at';

export async function getRevenueCommissionBook({ startDate, endDate, outletId }) {
  const { data, error } = await bookingQuery({ startDate, endDate, outletId, extraSelect: BOOKING_FIELDS });
  if (error) throw error;
  const rows = data || [];
  const paid = rows.filter((r) => r.paid);

  // ---------------------------------------------------------- REVENUE
  const dayOutlet = {};   // date -> outlet -> { trx, omzet, cash, nonCash }
  paid.forEach((r) => {
    const d = wibDateOf(r.created_at);
    dayOutlet[d] = dayOutlet[d] || {};
    const cell = dayOutlet[d][r.outlet_id] = dayOutlet[d][r.outlet_id] || {
      trx: 0, omzet: 0, cash: 0, nonCash: 0, diskon: 0
    };
    const price = Number(r.treatment_price) || 0;
    cell.trx++;
    cell.omzet += price;
    if (Number(r.discount_pct) > 0) cell.diskon += price * (Number(r.discount_pct) / 100);
    if (paymentLabel(r.payment_method) === 'cash') cell.cash += price;
    else cell.nonCash += price;
  });

  const dailyRows = [];
  const outletTotal = {};
  Object.keys(dayOutlet).sort().forEach((d) => {
    let dTrx = 0, dOmzet = 0, dCash = 0, dNon = 0, dDiskon = 0;
    (outletId ? [outletId] : OUTLETS.map((o) => o.id)).forEach((oid) => {
      const c = dayOutlet[d]?.[oid];
      if (!c) return;
      dailyRows.push({
        tanggal: d,
        outlet: outletName(oid),
        trx: c.trx,
        omzet: c.omzet,
        cash: c.cash,
        nonCash: c.nonCash,
        diskon: Math.round(c.diskon)
      });
      dTrx += c.trx; dOmzet += c.omzet; dCash += c.cash; dNon += c.nonCash; dDiskon += c.diskon;
      const t = outletTotal[oid] = outletTotal[oid] || { trx: 0, omzet: 0, cash: 0, nonCash: 0, diskon: 0 };
      t.trx += c.trx; t.omzet += c.omzet; t.cash += c.cash; t.nonCash += c.nonCash; t.diskon += c.diskon;
    });
    // Baris total per tanggal.
    dailyRows.push({
      tanggal: d,
      outlet: 'TOTAL',
      trx: dTrx, omzet: dOmzet, cash: dCash, nonCash: dNon, diskon: Math.round(dDiskon)
    });
  });

  const grandByOutlet = (outletId ? [outletId] : OUTLETS.map((o) => o.id))
    .filter((oid) => outletTotal[oid])
    .map((oid) => ({ outlet: outletName(oid), ...outletTotal[oid], diskon: Math.round(outletTotal[oid].diskon) }));

  const grandTotal = grandByOutlet.reduce(
    (s, o) => ({ trx: s.trx + o.trx, omzet: s.omzet + o.omzet, cash: s.cash + o.cash, nonCash: s.nonCash + o.nonCash }),
    { trx: 0, omzet: 0, cash: 0, nonCash: 0 }
  );

  // ---------------------------------------------------------- KOMISI
  // Semua transaksi yang sudah dibayar dihitung memakai komisi yang TERCATAT
  // di booking (commission_amount). Booking oncall hotel ikut dihitung karena
  // datanya juga mencatat komisi 10% — mengecualikannya diam-diam akan
  // membuat total komisi terapis di laporan ini lebih kecil dari yang
  // sebenarnya. Rincian per sumber booking ada di `commissionBySource`
  // supaya tidak ada angka yang disembunyikan.
  const byTherapistDay = {};
  paid.forEach((r) => {
    const d = wibDateOf(r.created_at);
    const key = `${r.therapist_name}|${d}|${r.outlet_id}`;
    const c = byTherapistDay[key] = byTherapistDay[key] || {
      nama: r.therapist_name, tanggal: d, outlet: outletName(r.outlet_id),
      trx: 0, omzet: 0, komisi: 0, persen: new Set()
    };
    c.trx++;
    c.omzet += Number(r.treatment_price) || 0;
    c.komisi += Number(r.commission_amount) || 0;
    c.persen.add(Number(r.commission_percent) || 0);
  });

  const commissionDaily = Object.values(byTherapistDay).map((c) => ({
    nama: c.nama,
    tanggal: c.tanggal,
    outlet: c.outlet,
    trx: c.trx,
    omzet: c.omzet,
    persen: [...c.persen].join('/'),
    komisi: c.komisi
  })).sort((a, b) => a.tanggal.localeCompare(b.tanggal) || b.komisi - a.komisi);

  // Per terapis + per outlet + total keseluruhan.
  const perTherapist = {};
  commissionDaily.forEach((c) => {
    const p = perTherapist[c.nama] = perTherapist[c.nama] || { nama: c.nama, trx: 0, omzet: 0, komisi: 0 };
    p.trx += c.trx; p.omzet += c.omzet; p.komisi += c.komisi;
  });
  const commissionByTherapist = Object.values(perTherapist).sort((a, b) => b.komisi - a.komisi);

  const commissionByOutlet = {};
  commissionDaily.forEach((c) => {
    const o = commissionByOutlet[c.outlet] = commissionByOutlet[c.outlet] || { outlet: c.outlet, trx: 0, omzet: 0, komisi: 0 };
    o.trx += c.trx; o.omzet += c.omzet; o.komisi += c.komisi;
  });
  const commissionOutlets = Object.values(commissionByOutlet).sort((a, b) => b.komisi - a.komisi);

  const commissionTotal = commissionByTherapist.reduce((s, t) => s + t.komisi, 0);
  const omzetTotal = commissionByTherapist.reduce((s, t) => s + t.omzet, 0);

  // Cek%: kalau tarif tidak seragam, mis. ada treatment 10 dan 20, ini terlihat.
  const rateSet = new Set(paid.map((r) => Number(r.commission_percent) || 0));

  // Rincian per sumber booking supaya oncall terlihat eksplisit, bukan tersembunyi.
  const bySource = {};
  paid.forEach((r) => {
    const sumber = r.booking_source === 'oncall' ? 'oncall' : 'in_house';
    const s = bySource[sumber] = bySource[sumber] || { sumber, trx: 0, omzet: 0, komisi: 0 };
    s.trx++;
    s.omzet += Number(r.treatment_price) || 0;
    s.komisi += Number(r.commission_amount) || 0;
  });
  const commissionBySource = Object.values(bySource).sort((a, b) => b.komisi - a.komisi);
  const oncallCommission = (bySource.oncall?.komisi) || 0;

  return {
    dailyRows,
    grandByOutlet,
    grandTotal,
    commissionDaily,
    commissionByTherapist,
    commissionOutlets,
    commissionBySource,
    oncallCommission,
    commissionTotal,
    omzetTotal,
    ratesUsed: [...rateSet].sort((a, b) => a - b),
    caveats: [
      rateSet.size > 1
        ? `Tarif komisi tidak seragam (${[...rateSet].join('%, ')}%).`
        : null,
      oncallCommission > 0
        ? `Oncall hotel ikut dihitung memakai komisi yang tercatat pada booking (total ${MONEY(oncallCommission).toLocaleString('id-ID')}). Kolom hotel_commission tidak dipakai sebagai komisi terapis.`
        : null
    ].filter(Boolean)
  };
}

// =====================================================================
// BUILD SHEETS
// =====================================================================

const MONEY = (n) => Number(n) || 0;

/**
 * Rakit buku laporan menjadi SATU workbook dengan TEPAT 4 sheet — sesuai
 * permintaan: Inventory, Absensi, Komisi, Revenue. Semua sub-tabel (sisa
 * stock, In/Out, pemakaian harian, dst.) diletakkan sebagai tabel terpisah
 * di dalam sheetnya, bukan sebagai sheet tambahan.
 *
 * Baris total diberi label 'TOTAL'/'GRAND TOTAL' supaya mudah difilter.
 */
export function buildBookSheets({ range, outletLabel, inventory, attendance, revenueCommission }) {
  const subtitle = `${range} · ${outletLabel}`;
  const rc = revenueCommission;
  const hhmm = (m) => (m == null ? '-' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);

  // ---------------- Sheet 1: Inventory
  const invStockRows = inventory.stockRows.map((r) => [r.outlet, r.kategori, r.nama, r.ukuran, r.satuan, r.stok]);
  const invMoveRows = inventory.movementRows.map((r) => [
    r.tanggal, r.outlet, r.kategori, r.nama, r.ukuran, r.masuk, r.keluar,
    r.sisa == null ? '-' : r.sisa, r.catatan
  ]);
  const invUsageRows = inventory.usageRows.map((r) => [
    r.tanggal, r.outlet, r.kategori, r.nama, r.ukuran, r.satuan, r.dipakai, r.sumber
  ]);

  // ---------------- Sheet 2: Absensi
  const attDetailRows = attendance.detail.map((d) => [
    d.tanggal, d.nama, d.outlet, d.shift, d.status,
    hhmm(d.jamMasuk), hhmm(d.jamPulang),
    d.telat == null ? '-' : d.telat,
    d.lembur == null ? '-' : d.lembur,
    d.lemburTerverifikasi === false ? 'perlu ditinjau' : (d.catatan || '')
  ]);
  const attLateRows = attendance.lateOnly.map((d) => [
    d.tanggal, d.nama, d.outlet, d.shift, hhmm(d.jamMasuk),
    d.telat == null ? '-' : d.telat, d.catatan || ''
  ]);
  const attSummaryRows = attendance.summary.map((p) => [
    p.nama, p.hariMasuk, p.hariTelat, p.totalTelat, p.totalLembur, p.sakit, p.izin, p.alpha
  ]);

  // ---------------- Sheet 3: Komisi
  const comTherapistRows = rc.commissionByTherapist.map((t) => [
    t.nama, t.trx, MONEY(t.omzet), MONEY(t.komisi),
    t.omzet ? `${((t.komisi / t.omzet) * 100).toFixed(2)}%` : '-'
  ]);
  if (rc.commissionByTherapist.length) {
    comTherapistRows.push([
      'TOTAL', rc.commissionByTherapist.reduce((s, t) => s + t.trx, 0),
      rc.omzetTotal, rc.commissionTotal,
      rc.omzetTotal ? `${((rc.commissionTotal / rc.omzetTotal) * 100).toFixed(2)}%` : '-'
    ]);
  }
  const comDailyRows = rc.commissionDaily.map((c) => [
    c.tanggal, c.nama, c.outlet, c.trx, MONEY(c.omzet), `${c.persen}%`, MONEY(c.komisi)
  ]);
  const comOutletRows = rc.commissionOutlets.map((o) => [
    o.outlet, o.trx, MONEY(o.omzet), MONEY(o.komisi),
    o.omzet ? `${((o.komisi / o.omzet) * 100).toFixed(2)}%` : '-'
  ]);
  const comSourceRows = (rc.commissionBySource || []).map((s) => [
    s.sumber === 'oncall' ? 'Oncall hotel' : 'In-house',
    s.trx, MONEY(s.omzet), MONEY(s.komisi),
    s.omzet ? `${((s.komisi / s.omzet) * 100).toFixed(2)}%` : '-'
  ]);

  // ---------------- Sheet 4: Revenue
  const revGrandRows = rc.grandByOutlet.map((g) => [
    g.outlet, g.trx, MONEY(g.omzet), MONEY(g.cash), MONEY(g.nonCash),
    g.trx ? Math.round(g.omzet / g.trx) : 0
  ]);
  if (rc.grandByOutlet.length) {
    revGrandRows.push([
      'GRAND TOTAL',
      rc.grandTotal.trx,
      rc.grandTotal.omzet,
      rc.grandTotal.cash,
      rc.grandTotal.nonCash,
      rc.grandTotal.trx ? Math.round(rc.grandTotal.omzet / rc.grandTotal.trx) : 0
    ]);
  }
  const revDailyRows = rc.dailyRows.map((r) => [
    r.tanggal, r.outlet, r.trx, MONEY(r.omzet), MONEY(r.cash), MONEY(r.nonCash), MONEY(r.diskon)
  ]);

  const joinNotes = (...lists) => lists.flat().filter(Boolean).join(' · ');

  return [
    {
      name: 'Inventory',
      sheetName: 'Inventory',
      title: 'INVENTORY PER OUTLET',
      subtitle,
      sections: [
        {
          title: '1. Sisa Stock (posisi saat laporan dibuat)',
          headers: ['Outlet', 'Kategori', 'Nama', 'Ukuran', 'Satuan', 'Sisa Stock'],
          rows: invStockRows,
          currencyColumns: [5],
          note: 'Sisa stock pasti (langsung dari tabel stok). Riwayat masuk/keluar dan pemakaian harian ada di bawah.'
        },
        {
          title: '2. Barang Masuk / Keluar',
          headers: ['Tanggal', 'Outlet', 'Kategori', 'Nama', 'Ukuran', 'Masuk', 'Keluar', 'Sisa Setelah', 'Catatan'],
          rows: invMoveRows,
          currencyColumns: [5, 6],
          note: 'Minyak mulai tercatat otomatis sejak 2 Okt 2026. Barang non-minyak belum ada movements tercatat.'
        },
        {
          title: '3. Pemakaian Harian',
          headers: ['Tanggal', 'Outlet', 'Kategori', 'Nama', 'Ukuran', 'Satuan', 'Dipakai', 'Sumber Angka'],
          rows: invUsageRows,
          currencyColumns: [6],
          note: 'Minyak = jumlah treatment yang memakai minyak. Barang "Tercatat" = keluar dari catatan stok. Barang "Estimasi (aturan treatment)" = dihitung dari aturan pemakaian treatment, bukan pencatatan fisik — bisa lebih besar dari kenyataan.'
        }
      ],
      note: joinNotes(inventory.caveats)
    },
    {
      name: 'Absensi',
      sheetName: 'Absensi',
      title: 'ABSENSI — MASUK, PULANG, TELAT, LEMBUR',
      subtitle,
      sections: [
        {
          title: '1. Data Telat',
          headers: ['Tanggal', 'Nama', 'Outlet', 'Shift', 'Jam Masuk', 'Telat (menit)', 'Catatan'],
          rows: attLateRows,
          currencyColumns: [5],
          note: 'Telat = jam datang dikurangi jam mulai shift. Data sebelum 3 Okt 2026 belum punya jam datang.'
        },
        {
          title: '2. Seluruh Absensi',
          headers: ['Tanggal', 'Nama', 'Outlet', 'Shift', 'Status', 'Jam Masuk', 'Jam Pulang', 'Telat (menit)', 'Lembur (menit)', 'Catatan'],
          rows: attDetailRows,
          currencyColumns: [7, 8]
        },
        {
          title: '3. Ringkasan per Orang',
          headers: ['Nama', 'Hari isi jam', 'Hari telat', 'Total telat (menit)', 'Total lembur (menit)', 'Sakit', 'Izin', 'Alpha'],
          rows: attSummaryRows,
          currencyColumns: [3, 4]
        }
      ],
      note: joinNotes(attendance.caveats)
    },
    {
      name: 'Komisi',
      sheetName: 'Komisi',
      title: 'KOMISI 10%',
      subtitle,
      sections: [
        {
          title: '1. Per Terapis',
          headers: ['Nama', 'Transaksi', 'Omzet', 'Komisi', 'Persentase'],
          rows: comTherapistRows,
          currencyColumns: [2, 3],
          totalRowIndex: rc.commissionByTherapist.length
            ? comTherapistRows.length - 1
            : undefined
        },
        {
          title: '2. Per Hari',
          headers: ['Tanggal', 'Nama', 'Outlet', 'Transaksi', 'Omzet', 'Tarif', 'Komisi'],
          rows: comDailyRows,
          currencyColumns: [4, 6]
        },
        {
          title: '3. Per Outlet',
          headers: ['Outlet', 'Transaksi', 'Omzet', 'Komisi', 'Persentase'],
          rows: comOutletRows,
          currencyColumns: [2, 3]
        },
        {
          title: '4. Per Sumber Booking',
          headers: ['Sumber', 'Transaksi', 'Omzet', 'Komisi', 'Persentase'],
          rows: comSourceRows,
          currencyColumns: [2, 3],
          note: 'Oncall hotel ikut dihitung memakai komisi yang tercatat pada booking.'
        }
      ],
      note: joinNotes(rc.caveats)
    },
    {
      name: 'Revenue',
      sheetName: 'Revenue',
      title: 'REVENUE',
      subtitle,
      sections: [
        {
          title: '1. Grand Total per Outlet',
          headers: ['Outlet', 'Transaksi', 'Omzet', 'Cash', 'Non-Cash', 'Rata-rata per transaksi'],
          rows: revGrandRows,
          currencyColumns: [2, 3, 4, 5],
          totalRowIndex: rc.grandByOutlet.length ? revGrandRows.length - 1 : undefined
        },
        {
          title: '2. Income per Hari',
          headers: ['Tanggal', 'Outlet', 'Transaksi', 'Omzet', 'Cash', 'Non-Cash', 'Diskon'],
          rows: revDailyRows,
          currencyColumns: [3, 4, 5, 6],
          note: 'Tanggal = tanggal transaksi dicatat (WIB). Baris TOTAL = total per hari.'
        }
      ],
      note: `GRAND TOTAL = seluruh outlet yang difilter · ${subtitle}`
    }
  ];
}

/** Ambil semua data buku laporan sekaligus. */
export async function getReportBook({ startDate, endDate, outletId }) {
  const [inventory, attendance, revenueCommission] = await Promise.all([
    getInventoryBook({ startDate, endDate, outletId }),
    getAttendanceBook({ startDate, endDate, outletId }),
    getRevenueCommissionBook({ startDate, endDate, outletId })
  ]);
  return { inventory, attendance, revenueCommission };
}
