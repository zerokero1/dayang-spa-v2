import test from 'node:test';
import assert from 'node:assert/strict';
import { isCustomPriceTreatment, parseRupiah, sanitizeNominal } from '../src/lib/constants.js';

test('isCustomPriceTreatment mengenali ejaan Hair Breading dan Hair Braiding', () => {
  assert.equal(isCustomPriceTreatment({ name: 'Hair Breading' }), true);
  assert.equal(isCustomPriceTreatment({ name: 'hair braiding' }), true);
  assert.equal(isCustomPriceTreatment({ name: 'HAIR-BREADING' }), true);
  assert.equal(isCustomPriceTreatment({ name: 'Hair Breading (Start From)' }), true);
});

test('isCustomPriceTreatment tidak menandai treatment harga katalog', () => {
  assert.equal(isCustomPriceTreatment({ name: 'Hair Spa Treatment' }), false);
  assert.equal(isCustomPriceTreatment({ name: 'Wash & Blow Dry' }), false);
  assert.equal(isCustomPriceTreatment(null), false);
});

test('input harga kasir menerima format rupiah yang lazim', () => {
  assert.equal(sanitizeNominal('350.000'), '350000');
  assert.equal(parseRupiah('350.000'), 350000);
  assert.equal(parseRupiah('Rp 1.250,000'), 1250000);
  assert.equal(parseRupiah(''), 0);
});
