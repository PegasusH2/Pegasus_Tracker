import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toKg, toUnit, roundForDisplay, formatWeightUnit, inputStep, KG_PER_LB } from '../js/core/units.js';

describe('toKg / toUnit — conversión de ida y vuelta', () => {
  test('lb -> kg usa la definición legal exacta', () => {
    assert.equal(toKg(1, 'lb'), KG_PER_LB);
  });
  test('kg -> kg es la identidad', () => {
    assert.equal(toKg(80, 'kg'), 80);
  });
  test('ida y vuelta no drifta (dentro de la precisión de coma flotante)', () => {
    const kg = toKg(220.5, 'lb');
    const backToLb = toUnit(kg, 'lb');
    assert.ok(Math.abs(backToLb - 220.5) < 1e-9);
  });
  test('valores vacíos/no numéricos -> null, nunca NaN', () => {
    assert.equal(toKg('', 'kg'), null);
    assert.equal(toKg(null, 'kg'), null);
    assert.equal(toKg('abc', 'kg'), null);
    assert.equal(toUnit(null, 'kg'), null);
  });
});

describe('roundForDisplay', () => {
  test('redondea a los decimales pedidos', () => {
    assert.equal(roundForDisplay(1.2345, 1), 1.2);
    assert.equal(roundForDisplay(1.25, 1), 1.3);
  });
  test('null pasa a través sin lanzar', () => {
    assert.equal(roundForDisplay(null), null);
  });
});

describe('formatWeightUnit', () => {
  test('formatea con la unidad y sin decimales sobrantes', () => {
    assert.equal(formatWeightUnit(80, 'kg'), '80 kg');
  });
  test('kg nulo -> guion, nunca revienta', () => {
    assert.equal(formatWeightUnit(null, 'kg'), '—');
  });
});

describe('inputStep', () => {
  test('paso más grueso en libras que en kg (0.5kg ≈ 1.1lb)', () => {
    assert.ok(inputStep('lb', 'set') > inputStep('kg', 'set'));
  });
});
