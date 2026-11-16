import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRows, PAGE_SIZE } from '../src/lib/supabasePaging.js';

/**
 * Query palsu: meniru perilaku PostgREST yang memotong respons di
 * `serverCap` baris, berapa pun `to` yang diminta `.range()`.
 */
function fakeRows(total, { serverCap = PAGE_SIZE } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls = [];
  const build = () => ({
    range(from, to) {
      calls.push([from, to]);
      const size = Math.min(to - from + 1, serverCap);
      return Promise.resolve({ data: rows.slice(from, from + size), error: null });
    }
  });
  return { rows, calls, build };
}

test('mengambil semua baris, bukan hanya halaman pertama', async () => {
  const { rows, calls, build } = fakeRows(2500);
  const hasil = await fetchAllRows(build);
  assert.equal(hasil.length, 2500);
  assert.deepEqual(hasil.map((r) => r.id), rows.map((r) => r.id));
  assert.ok(calls.length >= 3);
});

test('tetap lengkap walau server memotong lebih kecil dari ukuran halaman', async () => {
  const { rows, build } = fakeRows(1200, { serverCap: 400 });
  const hasil = await fetchAllRows(build);
  assert.equal(hasil.length, 1200);
  assert.deepEqual(hasil.map((r) => r.id), rows.map((r) => r.id));
});

test('rentang kosong menghasilkan array kosong', async () => {
  const { build } = fakeRows(0);
  assert.deepEqual(await fetchAllRows(build), []);
});

test('jumlah pas kelipatan halaman tidak menggandakan baris', async () => {
  const { build } = fakeRows(2000);
  const hasil = await fetchAllRows(build);
  assert.equal(hasil.length, 2000);
  assert.equal(new Set(hasil.map((r) => r.id)).size, 2000);
});

test('error dari Supabase diteruskan, tidak ditelan', async () => {
  const build = () => ({
    range: () => Promise.resolve({ data: null, error: { message: 'gagal' } })
  });
  await assert.rejects(
    () => fetchAllRows(build),
    (err) => err.message === 'gagal'
  );
});

test('berhenti di batas pengaman dan memberi peringatan', async () => {
  const { build } = fakeRows(5000);
  const warnings = [];
  const asli = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    const hasil = await fetchAllRows(build, { maxRows: 2000, label: 'uji' });
    assert.equal(hasil.length, 2000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /batas pengaman 2000/);
  } finally {
    console.warn = asli;
  }
});
