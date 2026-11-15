import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOW_ITEM,
  LOW_OIL,
  hitungPerluAttention,
  kelompokkanMinyak,
  namaMinyak,
  totalStok
} from '../src/lib/stokRingkas.js';

test('namaMinyak menyembunyikan ukuran untuk produk satu ukuran', () => {
  assert.equal(namaMinyak({ oilType: 'Lavender', size: '100' }), 'Lavender (100)');
  assert.equal(namaMinyak(null), '');
});

test('kelompokkanMinyak mengurutkan ukuran sesuai katalog', () => {
  const hasil = kelompokkanMinyak([
    { oilType: 'Lavender', size: '1000', stock: 1 },
    { oilType: 'Lavender', size: '100', stock: 2 },
    { oilType: 'Sereh', size: '100', stock: 3 }
  ]);
  assert.equal(hasil.length, 2);
  assert.deepEqual(hasil[0].list.map((x) => x.size), ['100', '1000']);
});

test('hitungPerluAttention menggabungkan minyak dan produk yang menipis', () => {
  const hasil = hitungPerluAttention(
    [{ id: 'o1', oilType: 'Lavender', size: '100', stock: LOW_OIL }],
    [{ id: 'i1', name: 'Handuk', unit: 'pcs', stock: LOW_ITEM, category: 'Laundry' }]
  );
  assert.equal(hasil.length, 2);
  assert.deepEqual(hasil.map((x) => x.key), ['o1', 'i1']);
  assert.equal(hasil[0].jenis, 'Minyak');
  assert.equal(hasil[1].jenis, 'Laundry');
});

test('hitungPerluAttention menghormati ambang kustom', () => {
  const hasil = hitungPerluAttention(
    [{ id: 'o1', oilType: 'Lavender', size: '100', stock: 4 }],
    [],
    { lowOil: 5 }
  );
  assert.equal(hasil.length, 1);
});

test('totalStok menjumlahkan angka dengan aman', () => {
  assert.equal(totalStok([{ stock: 2 }, { stock: '3' }, {}, null]), 5);
  assert.equal(totalStok(null), 0);
});
