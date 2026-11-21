import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTreatmentInput } from '../src/lib/treatmentService.js';

test('validateTreatmentInput menerima treatment lengkap', () => {
  const { patch, name } = validateTreatmentInput({
    name: '  Full Body Massage  ',
    price: '250000',
    durationMinutes: '90',
    category: 'Massage',
    commissionPercent: '10',
    usesOil: true
  });

  assert.equal(name, 'Full Body Massage');
  assert.deepEqual(patch, {
    name: 'Full Body Massage',
    price: 250000,
    category: 'Massage',
    duration_minutes: 90,
    commission_percent: 10,
    uses_oil: true
  });
});

test('validateTreatmentInput menolak nama, harga, dan durasi kosong atau tidak valid', () => {
  assert.throws(() => validateTreatmentInput({ name: '   ', price: 100, durationMinutes: 60 }), /Nama treatment wajib/);
  assert.throws(() => validateTreatmentInput({ name: 'A', price: 0, durationMinutes: 60 }), /Harga treatment/);
  assert.throws(() => validateTreatmentInput({ name: 'A', price: 100, durationMinutes: 0 }), /Durasi/);
  assert.throws(() => validateTreatmentInput({ name: 'A', price: 100, durationMinutes: 30.5 }), /Durasi/);
  assert.throws(() => validateTreatmentInput({ name: 'A', price: 100, durationMinutes: 60, commissionPercent: 101 }), /Komisi/);
});

test('validateTreatmentInput memakai default aman untuk field opsional', () => {
  const { patch } = validateTreatmentInput({
    name: 'Pedicure',
    price: 150000,
    durationMinutes: 45
  });

  assert.equal(patch.category, 'Massage');
  assert.equal(patch.commission_percent, 10);
  assert.equal(patch.uses_oil, null);
});
