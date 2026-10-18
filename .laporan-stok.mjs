import fs from "node:fs";
import pg from "pg";

function bacaEnv(p) {
  const e = {};
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return e;
}
const env = bacaEnv(".env-pg");
const c = new pg.Client({
  host: env.PGHOST, port: 5432, user: env.PGUSER,
  password: env.PGPASSWORD, database: "postgres", ssl: false
});
await c.connect();

const DARI = "2026-09-25";
const SAMPAI = "2026-10-15";

// Batas WIB (UTC+7) supaya sama dengan tanggal yang dilihat di aplikasi.
// Tanggal dibaca dari string YYYY-MM-DD agar bulan tidak tertukar.
function batasWib(tanggal, hariTerakhir) {
  const [y, bulan, hari] = tanggal.split("-").map(Number);
  return new Date(Date.UTC(y, bulan - 1, hari + (hariTerakhir ? 1 : 0)) - 7 * 3600000 - (hariTerakhir ? 1000 : 0));
}
const mulai = batasWib(DARI, false);
const selesai = batasWib(SAMPAI, true);
const a = mulai.toISOString();
const b = selesai.toISOString();

const num = (n) => Number(n || 0);
const rp = (n) => "Rp" + Math.round(num(n)).toLocaleString("id-ID");

console.log("LAPORAN STOK  " + DARI + "  s/d  " + SAMPAI);
console.log("(batas WIB = " + a + " s/d " + b + ")");
console.log("=".repeat(66));

console.log("");
console.log("=== 1. BARANG: TOTAL MASUK DAN KELUAR ===");
const t1 = await c.query(`
  select i.outlet_id,
         count(*) filter (where l.type='in')::int  as jml_in,
         coalesce(sum(l.qty) filter (where l.type='in'), 0)::bigint  as total_in,
         count(*) filter (where l.type='out')::int as jml_out,
         coalesce(sum(l.qty) filter (where l.type='out'), 0)::bigint as total_out,
         count(distinct l.item_id)::int jumlah_item
  from inventory_logs l join inventory i on i.id = l.item_id
  where l.created_at >= $1 and l.created_at <= $2
  group by i.outlet_id order by i.outlet_id
`, [a, b]);
console.log("  outlet   item   masuk        keluar        selisih");
console.log("  " + "-".repeat(56));
let gIn = 0, gOut = 0;
t1.rows.forEach((x) => {
  gIn += num(x.total_in); gOut += num(x.total_out);
  console.log("  " + String(x.outlet_id).padEnd(8) +
    String(x.jumlah_item).padStart(4) +
    String(x.jml_in).padStart(7) + " " + String(x.total_in).padStart(9) +
    String(x.jml_out).padStart(7) + " " + String(x.total_out).padStart(9) +
    String(num(x.total_out) - num(x.total_in)).padStart(12));
});
console.log("  " + "-".repeat(56));
console.log("  " + "TOTAL".padEnd(8) + "".padStart(4) +
  "".padStart(7) + " " + String(gIn).padStart(9) +
  "".padStart(7) + " " + String(gOut).padStart(9) +
  String(gOut - gIn).padStart(12));

console.log("");
console.log("=== 2. BARANG: SELISIH STOK TAHUN INI vs LOG RENTANG INI ===");
console.log("(modal awal tidak pernah dicatat, jadi kolom 'dari log' hanya");
console.log(" menunjukkanmovement 25-09 s/d 15-10, bukan saldo sebenarnya)");
const t2 = await c.query(`
  select i.outlet_id, i.name, i.unit, i.stock,
         coalesce(sum(case when l.type='in' then l.qty else -l.qty end), 0)::int as netsih,
         coalesce(sum(l.qty) filter (where l.type='out'), 0)::int as keluar
  from inventory i
  left join inventory_logs l
    on l.item_id = i.id and l.created_at >= $1 and l.created_at <= $2
  group by i.outlet_id, i.name, i.unit, i.stock
  having count(l.id) > 0
  order by i.outlet_id, i.name
`, [a, b]);

const negatif = t2.rows.filter((x) => num(x.netsih) < 0);
console.log("  item punya mutasi di rentang ini : " + t2.rows.length);
console.log("  di antaranya netsih < 0          : " + negatif.length);
console.log("");
if (negatif.length) {
  console.log("  netsih < 0 berarti keluar lebih banyak dari masuk pada rentang ini.");
  console.log("  Stok kolom tetap >= 0 karena fungsi konsumsi mengunci di nol.");
  console.log("");
  negatif.slice(0, 18).forEach((x) => {
    console.log("    " + String(x.outlet_id).padEnd(5) + String(x.name).slice(0, 22).padEnd(22) +
      " stok " + String(x.stock).padStart(4) + "  netsih " + String(x.netsih).padStart(5) +
      "  keluar " + String(x.keluar).padStart(5) + " " + (x.unit || ""));
  });
  if (negatif.length > 18) console.log("    ... (" + (negatif.length - 18) + " lagi)");
}

console.log("");
console.log("=== 3. BARANG HABIS DI RENTANG INI (stok 0 tapi masih keluar) ===");
const t3 = await c.query(`
  select i.outlet_id, i.name, i.unit, i.stock,
         count(*)::int kali, sum(l.qty)::int total
  from inventory_logs l join inventory i on i.id = l.item_id
  where l.type='out' and l.created_at >= $1 and l.created_at <= $2
  group by i.outlet_id, i.name, i.unit, i.stock
  having i.stock = 0
  order by kali desc
`, [a, b]);
if (!t3.rowCount) console.log("  (tidak ada)");
else {
  console.log("  " + t3.rowCount + " item. Teratas:");
  t3.rows.slice(0, 15).forEach((x) => {
    console.log("    " + String(x.outlet_id).padEnd(5) + String(x.name).slice(0, 22).padEnd(22) +
      " keluar " + String(x.kali).padStart(4) + " kali = " + String(x.total).padStart(5) + " " + (x.unit || ""));
  });
}

console.log("");
console.log("=== 4. MINYAK: MASUK DAN KELUAR ===");
const t4 = await c.query(`
  select outlet_id,
         count(*) filter (where type='in')::int  as jml_in,
         coalesce(sum(qty) filter (where type='in'), 0)::bigint  as total_in,
         count(*) filter (where type='out')::int as jml_out,
         coalesce(sum(qty) filter (where type='out'), 0)::bigint as total_out
  from oil_inventory_logs
  where created_at >= $1 and created_at <= $2
  group by outlet_id order by outlet_id
`, [a, b]);
console.log("  outlet   masuk        keluar        selisih");
console.log("  " + "-".repeat(44));
let mIn = 0, mOut = 0;
t4.rows.forEach((x) => {
  mIn += num(x.total_in); mOut += num(x.total_out);
  console.log("  " + String(x.outlet_id).padEnd(8) +
    String(x.jml_in).padStart(5) + " " + String(x.total_in).padStart(9) +
    String(x.jml_out).padStart(7) + " " + String(x.total_out).padStart(9) +
    String(num(x.total_out) - num(x.total_in)).padStart(12));
});
console.log("  " + "-".repeat(44));
console.log("  " + "TOTAL".padEnd(8) + "".padStart(5) + " " + String(mIn).padStart(9) +
  "".padStart(7) + " " + String(mOut).padStart(9) + String(mOut - mIn).padStart(12));

console.log("");
console.log("=== 5. MINYAK: CEK RANTAI stock_after DALAM RENTANG INI ===");
const t5 = await c.query(`
  with dalam as (
    select * from oil_inventory_logs
    where created_at >= $1 and created_at <= $2
  ),
  urut as (
    select outlet_id, oil_type, size, type, qty, stock_after, created_at,
           lag(stock_after) over (
             partition by outlet_id, oil_type, size order by created_at
           ) as sebelum
    from dalam
  )
  select count(*) filter (where sebelum is not null)::int dicek,
         count(*) filter (
           where sebelum is not null
             and sebelum + (case when type='in' then qty else -qty end) = stock_after
         )::int konsisten,
         count(*) filter (
           where sebelum is not null
             and sebelum + (case when type='in' then qty else -qty end) <> stock_after
         )::int tidak
  from urut
`, [a, b]);
const x5 = t5.rows[0];
console.log("  log dicek     : " + x5.dicek);
console.log("  konsisten     : " + x5.konsisten);
console.log("  tidak konsisten: " + x5.tidak);

console.log("");
console.log("=== 6. MINYAK HABIS DI RENTANG INI ===");
const t6 = await c.query(`
  select l.outlet_id, l.oil_type, l.size, o.stock,
         count(*)::int kali, sum(l.qty)::int total
  from oil_inventory_logs l
  join oil_inventory o
    on o.outlet_id=l.outlet_id and o.oil_type=l.oil_type and o.size=l.size
  where l.type='out' and l.created_at >= $1 and l.created_at <= $2
  group by l.outlet_id, l.oil_type, l.size, o.stock
  having o.stock <= 0
  order by kali desc
`, [a, b]);
if (!t6.rowCount) console.log("  (tidak ada)");
else t6.rows.forEach((x) => {
  console.log("    " + String(x.outlet_id).padEnd(5) + String(x.oil_type).slice(0, 18).padEnd(18) +
    String(x.size).slice(0, 8).padEnd(8) + " stok " + String(x.stock).padStart(4) +
    "   keluar " + String(x.kali).padStart(4) + " kali");
});

await c.end();