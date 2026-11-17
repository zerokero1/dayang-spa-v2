import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDate,
  businessDateFromTimestamp,
  businessMinutesOfDay,
  businessMonth,
  businessRangeBoundsUtc,
  businessRangeIso,
  businessTimeParts,
  businessTimeStr,
  businessDayMinutesToMs,
  shiftBusinessDate
} from '../src/lib/businessDate.js';

test('businessDate memakai WITA (UTC+8), bukan UTC', () => {
  // 17:00 UTC tanggal 1 = 01:00 WITA tanggal 2.
  assert.equal(businessDate(new Date('2026-10-01T17:00:00Z')), '2026-10-02');
  // 15:59 UTC masih hari yang sama di WITA (23:59).
  assert.equal(businessDate(new Date('2026-10-01T15:59:00Z')), '2026-10-01');
});

test('businessDateFromTimestamp dan businessMonth', () => {
  assert.equal(businessDateFromTimestamp('2026-10-01T17:00:00Z'), '2026-10-02');
  assert.equal(businessDateFromTimestamp(null), '');
  assert.equal(businessMonth(new Date('2026-10-31T17:00:00Z')), '2026-11');
});

test('shiftBusinessDate menggeser tanggal kalender dengan aman', () => {
  assert.equal(shiftBusinessDate('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftBusinessDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftBusinessDate('2026-01-01', 0), '2026-01-01');
});

test('batas hari bisnis adalah 16:00 UTC hari sebelumnya sampai 15:59:59.999 UTC', () => {
  const { startUtc, endUtc } = businessRangeBoundsUtc('2026-10-15', '2026-10-15');
  assert.equal(startUtc.toISOString(), '2026-10-14T16:00:00.000Z');
  assert.equal(endUtc.toISOString(), '2026-10-15T15:59:59.999Z');
});

test('rentang beberapa hari memakai batas hari pertama dan terakhir', () => {
  const { startIso, endIso } = businessRangeIso('2026-10-15', '2026-10-17');
  assert.equal(startIso, '2026-10-14T16:00:00.000Z');
  assert.equal(endIso, '2026-10-17T15:59:59.999Z');
});

test('businessTimeParts dan businessMinutesOfDay memakai jam Lombok', () => {
  const date = new Date('2026-10-15T03:30:00Z');
  assert.deepEqual(businessTimeParts(date), { hour: 11, minute: 30 });
  assert.equal(businessMinutesOfDay(date), 11 * 60 + 30);
  // 16:00 UTC = 00:00 WITA tanggal berikutnya.
  assert.deepEqual(businessTimeParts(new Date('2026-10-15T16:00:00Z')), { hour: 0, minute: 0 });
  assert.equal(businessTimeStr(date), '11:30');
  assert.equal(businessTimeStr(new Date('2026-10-15T16:00:00Z')), '00:00');
  assert.equal(businessTimeStr(new Date('2026-10-15T01:05:00Z')), '09:05');
});

test('businessDayMinutesToMs mengembalikan jam lokal yang benar', () => {
  const ms = businessDayMinutesToMs('2026-10-15', 23 * 60);
  assert.equal(new Date(ms).toISOString(), '2026-10-15T15:00:00.000Z');
});
