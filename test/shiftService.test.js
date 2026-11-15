import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIFT_DEFS,
  getShiftWindowStatus,
  lateMinutesFor,
  minutesToClock,
  minutesToDuration,
  shiftEndMinutes,
  shiftJamLabel,
  shiftStartMinutes
} from '../src/lib/shiftService.js';
import { SHIFTS } from '../src/lib/constants.js';

test('definisi shift kanonik sesuai jadwal operasional', () => {
  assert.deepEqual(SHIFT_DEFS[SHIFTS.SP].segments, [[11 * 60, 15 * 60], [18 * 60, 23 * 60]]);
  assert.deepEqual(SHIFT_DEFS[SHIFTS.SP1].segments, [[5 * 60, 10 * 60], [11 * 60, 14 * 60]]);
  assert.deepEqual(SHIFT_DEFS[SHIFTS.SP2].segments, [[13 * 60, 17 * 60], [19 * 60, 23 * 60]]);
  assert.deepEqual(SHIFT_DEFS[SHIFTS.ST].segments, [[11 * 60, 17 * 60]]);
});

test('shiftEndMinutes dan shiftStartMinutes', () => {
  assert.equal(shiftEndMinutes(SHIFTS.SP), 23 * 60);
  assert.equal(shiftEndMinutes(SHIFTS.SP1), 23 * 60 + 59);
  assert.equal(shiftEndMinutes(SHIFTS.SP2), 23 * 60);
  assert.equal(shiftEndMinutes(SHIFTS.ST), 17 * 60);
  assert.equal(shiftStartMinutes(SHIFTS.SP1), 11 * 60);
  assert.equal(shiftEndMinutes('tidak-ada'), null);
});

test('label jam shift diturunkan dari definisi kanonik', () => {
  assert.equal(shiftJamLabel(SHIFTS.SP), '11-15, 18-23');
  assert.equal(shiftJamLabel(SHIFTS.SP1), '05-10, 11-14');
  assert.equal(shiftJamLabel(SHIFTS.SP2), '13-17, 19-23');
  assert.equal(shiftJamLabel(SHIFTS.ST), '11-17');
  assert.equal(shiftJamLabel('tidak-ada'), '');
});

test('lateMinutesFor memakai jam mulai shift', () => {
  assert.equal(lateMinutesFor(11 * 60 + 15, SHIFTS.SP), 15);
  assert.equal(lateMinutesFor(10 * 60, SHIFTS.SP), 0);
  assert.equal(lateMinutesFor(null, SHIFTS.SP), null);
  assert.equal(lateMinutesFor(11 * 60, 'tidak-ada'), null);
});

test('getShiftWindowStatus membaca jam WITA, bukan zona waktu perangkat', () => {
  // 05:30 WITA = 21:30 UTC hari sebelumnya.
  assert.equal(getShiftWindowStatus(SHIFTS.SP1, new Date('2026-10-14T21:30:00Z')), 'aktif');
  // 10:30 WITA = jeda antara segmen SP1.
  assert.equal(getShiftWindowStatus(SHIFTS.SP1, new Date('2026-10-15T02:30:00Z')), 'jeda');
  // 16:30 WITA = jeda SP (15:00-18:00).
  assert.equal(getShiftWindowStatus(SHIFTS.SP, new Date('2026-10-15T08:30:00Z')), 'jeda');
  // 23:30 WITA = di luar jam semua shift.
  assert.equal(getShiftWindowStatus(SHIFTS.SP, new Date('2026-10-15T15:30:00Z')), 'diluar_jam');
  assert.equal(getShiftWindowStatus(null), null);
  assert.equal(getShiftWindowStatus('tidak-ada'), null);
});

test('format menit ke jam dan durasi', () => {
  assert.equal(minutesToClock(8 * 60 + 5), '08:05');
  assert.equal(minutesToClock(null), '');
  assert.equal(minutesToDuration(0), '0m');
  assert.equal(minutesToDuration(60), '1j');
  assert.equal(minutesToDuration(135), '2j 15m');
});
