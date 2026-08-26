import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchExerciseName } from '../js/core/exercise-match.js';

const LIBRARY = [
  { id: '1', name: 'Press banca' },
  { id: '2', name: 'Press militar' },
  { id: '3', name: 'Sentadilla' },
];

describe('matchExerciseName — la IA nunca decide el ejercicio, solo propone', () => {
  test('coincidencia exacta', () => {
    const result = matchExerciseName('Press banca', LIBRARY);
    assert.equal(result.exercise.id, '1');
    assert.equal(result.score, 1);
  });

  test('ignora mayúsculas y acentos', () => {
    const result = matchExerciseName('SENTADILLA', LIBRARY);
    assert.equal(result.exercise.id, '3');
  });

  test('substring cuenta como coincidencia fuerte ("Press banca" vs "Press banca con barra")', () => {
    const result = matchExerciseName('Press banca con barra', LIBRARY);
    assert.equal(result.exercise.id, '1');
  });

  test('nombre sin relación real -> null (no inventa una coincidencia)', () => {
    const result = matchExerciseName('Curl femoral tumbado', LIBRARY);
    assert.equal(result, null);
  });

  test('biblioteca vacía -> null, nunca lanza', () => {
    assert.equal(matchExerciseName('Press banca', []), null);
  });

  test('nombre vacío/null no lanza', () => {
    assert.equal(matchExerciseName('', LIBRARY), null);
    assert.equal(matchExerciseName(null, LIBRARY), null);
  });

  test('respeta un umbral más estricto', () => {
    // "Press militar" vs "Press banca" no deberían pasar un umbral del 0.95
    const result = matchExerciseName('Press banca', LIBRARY.filter((e) => e.id === '2'), 0.95);
    assert.equal(result, null);
  });
});
