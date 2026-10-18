import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
try {
  readFileSync(new URL('./.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
} catch {}

const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const email = process.argv[2] || env.DYANG_EMAIL;
const password = process.argv[3] || env.DYANG_PASSWORD;
const dateStr = process.argv[4] || '2026-10-04';

if (!url || !anonKey) {
  console.error('GAGAL: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY tidak ada di .env');
  process.exit(1);
}
if (!email || !password) {
  console.error('Cara pakai: node cek-transaksi.mjs <email> <password> [YYYY-MM-DD]');
  console.error('Contoh   : node cek-transaksi.mjs admin@dayang.com Password123 2026-10-04');
  process.exit(1);
}

const [y, m, d] = dateStr.split('-').map(Number);
if (!y || !m || !d) {
  console.error('Tanggal tidak valid. Format: YYYY-MM-DD');
  process.exit(1);
}
const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600000);
const endUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59) - 7 * 3600000);

const supabase = createClient(url, anonKey);

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) {
  console.error('LOGIN GAGAL:', authError.message);
  process.exit(1);
}
console.log('Login berhasil:', authData.user.email);
console.log('Server        :', url);
console.log('Periode       :', dateStr, '(WIB 00:00 - 23:59)');
console.log('='.repeat(100));

const { data, error } = await supabase
  .from('bookings')
  .select('outlet_id, therapist_name, treatment_name, treatment_price, commission_percent, commission_amount, paid, payment_method, status, original_price, booking_source, hotel_commission, oil_type, oil_size, customer_name, created_at')
  .gte('created_at', startUtc.toISOString())
  .lte('created_at', endUtc.toISOString())
  .order('created_at', { ascending: false });

if (error) {
  console.error('QUERY GAGAL:', error.message);
  process.exit(1);
}

const rows = data || [];
const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const wibTime = (iso) => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(11, 16);
const OUTLETS = { DR: 'Dream', RR: 'Rere', DP: 'Dayang Putri', D1: 'Dayang 1', D2: 'Dayang 2', Y: 'Yulis' };

console.log('Total baris ditemukan (termasuk batal):', rows.length);

const batal = rows.filter((b) => b.status === 'batal');
const aktif = rows.filter((b) => b.status !== 'batal');

if (batal.length) {
  console.log('Dibatalkan:', batal.length);
  batal.forEach((b) => console.log(`  - ${wibTime(b.created_at)} ${b.outlet_id} ${b.therapist_name} ${b.treatment_name} ${rp(b.treatment_price)}`));
}

if (!aktif.length) {
  console.log('\nTIDAK ADA transaksi pada tanggal ini.');
  process.exit(0);
}

console.log('\nDAFTAR TRANSAKSI\n' + '-'.repeat(100));
aktif.forEach((b, i) => {
  const diskon = b.original_price != null && Number(b.original_price) > Number(b.treatment_price)
    ? ` | diskon ${rp(Number(b.original_price) - Number(b.treatment_price))}`
    : '';
  const metode = b.paid ? (b.payment_method === 'cardless' ? 'CARDLESS' : 'CASH') : 'BELUM BAYAR';
  const oncall = b.booking_source === 'oncall' ? ' [ONCALL]' : '';
  const minyak = b.oil_type ? ` | ${b.oil_type} ${b.oil_size || ''}` : '';
  console.log(
    `${String(i + 1).padStart(3)}. ${wibTime(b.created_at)} | ${(b.outlet_id || '-').padEnd(3)} ` +
    `| ${(b.therapist_name || '-').padEnd(18)} | ${(b.treatment_name || '-').padEnd(26)} ` +
    `| ${rp(b.treatment_price).padStart(13)} | komisi ${rp(b.commission_amount).padStart(12)} | ${metode}${diskon}${minyak}${oncall}`
  );
});

const sum = (list, fn) => list.reduce((s, b) => s + Number(fn(b) || 0), 0);
const totals = {
  charge: sum(aktif.filter((b) => b.paid && b.payment_method !== 'cardless'), (b) => b.treatment_price),
  card: sum(aktif.filter((b) => b.paid && b.payment_method === 'cardless'), (b) => b.treatment_price),
  noBill: sum(aktif.filter((b) => !b.paid), (b) => b.treatment_price),
  revenue: sum(aktif, (b) => b.treatment_price),
  komisi: sum(aktif, (b) => b.commission_amount),
  diskon: sum(aktif.filter((b) => b.original_price != null && Number(b.original_price) > Number(b.treatment_price)), (b) => Number(b.original_price) - Number(b.treatment_price)),
  hotel: sum(aktif, (b) => b.hotel_commission)
};

console.log('\n' + '='.repeat(100));
console.log('REKAP PER OUTLET\n' + '='.repeat(100));
console.log('Outlet  Jumlah  Charge(Cash)          Cardless           Belum Bayar         Total Revenue');

const perOutlet = {};
aktif.forEach((b) => {
  const o = (perOutlet[b.outlet_id] = perOutlet[b.outlet_id] || { n: 0, charge: 0, card: 0, noBill: 0, rev: 0 });
  o.n++;
  o.rev += Number(b.treatment_price || 0);
  if (!b.paid) o.noBill += Number(b.treatment_price || 0);
  else if (b.payment_method === 'cardless') o.card += Number(b.treatment_price || 0);
  else o.charge += Number(b.treatment_price || 0);
});

Object.entries(perOutlet)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .forEach(([id, o]) => {
    console.log(
      `${(OUTLETS[id] || id).padEnd(8)} ${String(o.n).padStart(4)}   ${rp(o.charge).padStart(16)} ${rp(o.card).padStart(18)} ${rp(o.noBill).padStart(18)} ${rp(o.rev).padStart(18)}`
    );
  });

console.log('\n' + '='.repeat(100));
console.log('GRAND TOTAL');
console.log('='.repeat(100));
console.log('Jumlah transaksi :', aktif.length);
console.log('Charge (Cash)    :', rp(totals.charge));
console.log('Cardless         :', rp(totals.card));
console.log('Belum bayar      :', rp(totals.noBill));
console.log('Total Revenue    :', rp(totals.revenue));
console.log('Total Komisi     :', rp(totals.komisi));
if (totals.diskon > 0) console.log('Total Diskon     :', rp(totals.diskon));
if (totals.hotel > 0) console.log('Komisi Hotel     :', rp(totals.hotel));