import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateImportedProgram } from '../js/core/ai-import.js';

describe('validateImportedProgram — nunca confía a ciegas en la respuesta de Gemini', () => {
  test('respuesta que no es ni siquiera un objeto -> lanza INVALID_RESPONSE (único caso que debe lanzar)', () => {
    assert.throws(() => validateImportedProgram(null), /INVALID_RESPONSE/);
    assert.throws(() => validateImportedProgram('texto suelto'), /INVALID_RESPONSE/);
    assert.throws(() => validateImportedProgram(42), /INVALID_RESPONSE/);
  });

  test('sin "routines" ni "exercises" -> devuelve una rutina vacía, no lanza', () => {
    const result = validateImportedProgram({});
    assert.equal(result.routines.length, 1);
    assert.deepEqual(result.routines[0].exercises, []);
  });

  test('un ejercicio "plano" sin envolver en routines[] también se acepta (compatibilidad con el modo de 1 sola rutina)', () => {
    const result = validateImportedProgram({ exercises: [{ recognizedName: 'Press banca', sets: 4 }] });
    assert.equal(result.routines.length, 1);
    assert.equal(result.routines[0].exercises[0].recognizedName, 'Press banca');
  });

  test('campos con basura (strings donde va un número, arrays mal formados) se limpian a null, nunca lanzan', () => {
    const result = validateImportedProgram({
      routines: [{ exercises: [{ recognizedName: 'X', sets: 'muchas', repsMin: {}, repsSequence: 'no es array' }] }],
    });
    const ex = result.routines[0].exercises[0];
    assert.equal(ex.sets, 1); // sets inválido -> cae al mínimo (1), nunca NaN ni 'muchas'
    assert.equal(ex.repsMin, null);
    assert.equal(ex.repsSequence, null);
  });

  test('ejercicio sin nombre reconocido recibe un nombre por defecto en vez de quedar vacío', () => {
    const result = validateImportedProgram({ routines: [{ exercises: [{ sets: 3 }] }] });
    assert.equal(result.routines[0].exercises[0].recognizedName, 'Ejercicio sin nombre');
  });

  describe('cotas defensivas frente a una respuesta alucinada/desproporcionada', () => {
    test('sets se acota a un máximo razonable (nunca crea cientos de millones de series)', () => {
      const result = validateImportedProgram({ routines: [{ exercises: [{ recognizedName: 'X', sets: 999999999 }] }] });
      assert.ok(result.routines[0].exercises[0].sets <= 50);
    });

    test('repsSequence/weightSequence con miles de elementos se recortan', () => {
      const hugeSeq = Array.from({ length: 5000 }, (_, i) => i + 1);
      const result = validateImportedProgram({ routines: [{ exercises: [{ recognizedName: 'X', repsSequence: hugeSeq }] }] });
      assert.ok(result.routines[0].exercises[0].repsSequence.length <= 30);
    });

    test('un número desproporcionado de ejercicios en una rutina se recorta', () => {
      const manyExercises = Array.from({ length: 5000 }, (_, i) => ({ recognizedName: `Ejercicio ${i}` }));
      const result = validateImportedProgram({ routines: [{ exercises: manyExercises }] });
      assert.ok(result.routines[0].exercises.length <= 80);
    });

    test('un número desproporcionado de rutinas en el programa se recorta', () => {
      const manyRoutines = Array.from({ length: 5000 }, () => ({ exercises: [] }));
      const result = validateImportedProgram({ routines: manyRoutines });
      assert.ok(result.routines.length <= 30);
    });
  });

  test('valores negativos en campos de cantidad se descartan (no se guardan "−3 reps")', () => {
    const result = validateImportedProgram({
      routines: [{ exercises: [{ recognizedName: 'X', repsMin: -5, sets: -2, weightHintKg: -10 }] }],
    });
    const ex = result.routines[0].exercises[0];
    assert.equal(ex.repsMin, null);
    assert.equal(ex.sets, 1); // negativo -> cae al mínimo válido, no un número negativo
    assert.equal(ex.weightHintKg, null);
  });

  test('setType fuera del enum soportado cae a "normal" en vez de guardarse tal cual', () => {
    const result = validateImportedProgram({ routines: [{ exercises: [{ recognizedName: 'X', setType: 'algo-inventado' }] }] });
    assert.equal(result.routines[0].exercises[0].setType, 'normal');
  });

  test('structureConfidence fuera del enum se descarta a null', () => {
    const result = validateImportedProgram({ routines: [], structureConfidence: 'algo-raro' });
    assert.equal(result.structureConfidence, null);
  });

  test('"unrecognized" con elementos no-string se filtra', () => {
    const result = validateImportedProgram({ routines: [{ exercises: [], unrecognized: ['texto válido', 42, null, ''] }] });
    assert.deepEqual(result.routines[0].unrecognized, ['texto válido']);
  });
});
