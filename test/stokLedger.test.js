import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItemLedgerDays,
  buildOilLedgerDays,
  eachDayCount,
  firstLogDay,
  labelHari,
  rangeIso,
  shiftDate,
  startOfWeek
} from '../src/lib/stokLedger.js';

test('eachDayCount dan shiftDate bekerja lintas bulan', () => {
  assert.deepEqual(eachDayCount('2026-10-30', 3), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});

test('startOfWeek selalu kembali ke Senin', () => {
  // 2026-10-15 adalah Kamis.
  assert.equal(startOfWeek('2026-10-15'), '2026-10-12');
  assert.equal(startOfWeek('2026-10-12'), '2026-10-12');
  assert.equal(startOfWeek('2026-10-18'), '2026-10-12');
});

test('rangeIso memakai batas hari WITA', () => {
  const { fromIso, toIso } = rangeIso('2026-10-15', ['2026-10-15', '2026-10-16']);
  assert.equal(fromIso, '2026-10-14T16:00:00.000Z');
  assert.equal(toIso, '2026-10-16T15:59:59.999Z');
  assert.deepEqual(rangeIso('2026-10-15', []), { fromIso: '', toIso: '' });
});

test('labelHari dan firstLogDay', () => {
  assert.equal(labelHari('2026-10-04'), '04/10');
  assert.equal(labelHari('2026-10-04', true), 'Min 04/10');
  assert.equal(firstLogDay([]), null);
  assert.equal(
    firstLogDay([
      { created_at: '2026-10-02T10:00:00Z' },
      { created_at: '2026-10-01T10:00:00Z' }
    ]),
    '2026-10-01'
  );
});

test('buildOilLedgerDays menurunkan rantai stok mundur dari stok terkini', () => {
  const rows = buildOilLedgerDays({
    days: ['2026-10-01', '2026-10-02'],
    variants: [{ oilType: 'Lavender', size: '100', stock: 10 }],
    logs: [
      { key: 'Lavender', sub: '100', type: 'in', qty: 5, created_at: '2026-10-01T10:00:00Z' },
      { key: 'Lavender', sub: '100', type: 'out', qty: 2, created_at: '2026-10-02T10:00:00Z' }
    ]
  });
  assert.deepEqual(rows, [
    { date: '2026-10-01', oilType: 'Lavender', size: '100', stock: 7, in: 5, out: 0, sisa: 12 },
    { date: '2026-10-02', oilType: 'Lavender', size: '100', stock: 12, in: 0, out: 2, sisa: 10 }
  ]);
});

test('hari sebelum coverageFrom dikosongkan, bukan dianggap nol', () => {
  const rows = buildOilLedgerDays({
    days: ['2026-10-01', '2026-10-02'],
    variants: [{ oilType: 'Lavender', size: '100', stock: 10 }],
    coverageFrom: '2026-10-02',
    logs: [{ key: 'Lavender', sub: '100', type: 'out', qty: 2, created_at: '2026-10-02T10:00:00Z' }]
  });
  assert.deepEqual(rows[0], {
    date: '2026-10-01', oilType: 'Lavender', size: '100',
    stock: null, in: null, out: null, sisa: null
  });
  assert.equal(rows[1].stock, 12);
});

test('buildItemLedgerDays memakai nama dan unit sebagai kunci', () => {
  const rows = buildItemLedgerDays({
    days: ['2026-10-01'],
    items: [{ id: 'i1', name: 'Handuk', unit: 'pcs', stock: 4, category: 'Laundry' }],
    logs: [{ key: 'Handuk', sub: 'pcs', type: 'out', qty: 1, created_at: '2026-10-01T10:00:00Z' }]
  });
  assert.deepEqual(rows, [{
    date: '2026-10-01', itemId: 'i1', name: 'Handuk', unit: 'pcs', category: 'Laundry',
    stock: 5, in: 0, out: 1, sisa: 4
  }]);
});
