import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveSetVolume, sessionVolume, describeRepsTarget,
  checkRangeCompletion, compareSetPair, compareSessions,
} from '../js/core/progression.js';

describe('effectiveSetVolume', () => {
  test('serie normal: peso × reps', () => {
    assert.equal(effectiveSetVolume({ weight: 80, reps: 10 }), 800);
  });

  test('nunca lanza ni da NaN con campos vacíos/null', () => {
    assert.equal(effectiveSetVolume({ weight: null, reps: null }), 0);
    assert.equal(effectiveSetVolume({}), 0);
  });

  test('perSide duplica el volumen sin tocar el peso guardado', () => {
    assert.equal(effectiveSetVolume({ weight: 20, reps: 10 }, { loadMode: 'perSide' }), 400);
  });

  test('descendente: suma el bloque principal + cada escalón', () => {
    const set = { type: 'descendente', weight: 80, reps: 8, dropSteps: [{ weight: 60, reps: 6 }, { weight: 40, reps: 8 }] };
    assert.equal(effectiveSetVolume(set), 80 * 8 + 60 * 6 + 40 * 8);
  });

  test('rest-pause: mismo peso en el bloque principal y en los extra', () => {
    const set = { type: 'restpause', weight: 50, reps: 10, restPauseExtra: [{ reps: 3 }, { reps: 2 }] };
    assert.equal(effectiveSetVolume(set), 50 * 10 + 50 * (3 + 2));
  });

  test('descendente sin dropSteps cae al cálculo normal (no revienta)', () => {
    assert.equal(effectiveSetVolume({ type: 'descendente', weight: 80, reps: 8 }), 640);
  });
});

describe('sessionVolume', () => {
  test('suma el volumen de varias series', () => {
    const sets = [{ weight: 80, reps: 10 }, { weight: 80, reps: 8 }];
    assert.equal(sessionVolume(sets), 800 + 640);
  });

  test('array vacío -> 0, nunca lanza', () => {
    assert.equal(sessionVolume([]), 0);
  });
});

describe('describeRepsTarget', () => {
  test('rango normal', () => {
    assert.equal(describeRepsTarget({ targetRepsMin: 8, targetRepsMax: 10 }), '8–10 reps');
  });
  test('cantidad exacta (min === max)', () => {
    assert.equal(describeRepsTarget({ targetRepsMin: 8, targetRepsMax: 8 }), '8 reps');
  });
  test('objetivo antiguo migrado (solo un campo informado)', () => {
    assert.equal(describeRepsTarget({ targetRepsMin: null, targetRepsMax: 10 }), '10 reps');
  });
  test('secuencia/progresión por serie', () => {
    assert.equal(describeRepsTarget({ targetRepsSequence: [12, 10, 8, 6] }), '12/10/8/6 reps');
  });
  test('sin objetivo -> cadena vacía, nunca lanza con we=null', () => {
    assert.equal(describeRepsTarget(null), '');
    assert.equal(describeRepsTarget({}), '');
  });
});

describe('checkRangeCompletion — requiere confirmación manual (done)', () => {
  const we = { targetRepsMax: 10, targetRir: 2 };

  test('serie con datos pero SIN confirmar (done=false) nunca cuenta como completada', () => {
    // Este es exactamente el bug real corregido: una serie recién creada al
    // empezar una rutina viene con peso/reps prellenados del histórico, pero
    // el usuario todavía no ha confirmado que la hizo.
    const set = { type: 'normal', reps: 12, rir: 1, done: false, setNumber: 1 };
    assert.equal(checkRangeCompletion(set, we), false);
  });

  test('serie confirmada que alcanza el objetivo -> true', () => {
    const set = { type: 'normal', reps: 12, rir: 1, done: true, setNumber: 1 };
    assert.equal(checkRangeCompletion(set, we), true);
  });

  test('serie confirmada por debajo del objetivo -> false', () => {
    const set = { type: 'normal', reps: 8, rir: 1, done: true, setNumber: 1 };
    assert.equal(checkRangeCompletion(set, we), false);
  });

  test('serie confirmada con RIR por encima del objetivo -> false', () => {
    const set = { type: 'normal', reps: 12, rir: 4, done: true, setNumber: 1 };
    assert.equal(checkRangeCompletion(set, we), false);
  });

  test('nunca se aplica a tipos especiales (fallo/restpause/descendente/amrap)', () => {
    const set = { type: 'fallo', reps: 20, done: true, setNumber: 1 };
    assert.equal(checkRangeCompletion(set, we), false);
  });

  test('we/set nulos no lanzan', () => {
    assert.equal(checkRangeCompletion(null, we), false);
    assert.equal(checkRangeCompletion({ done: true }, null), false);
  });
});

describe('compareSetPair', () => {
  test('más peso y más reps -> big_progress', () => {
    const r = compareSetPair({ weight: 85, reps: 11 }, { weight: 80, reps: 10 });
    assert.equal(r.type, 'big_progress');
  });
  test('mismo peso/reps con mejor RIR -> rir_improved', () => {
    const r = compareSetPair({ weight: 80, reps: 10, rir: 3 }, { weight: 80, reps: 10, rir: 1 });
    assert.equal(r.type, 'rir_improved');
  });
  test('faltan datos en cualquiera de las dos -> incomplete, nunca lanza', () => {
    assert.equal(compareSetPair({ weight: null, reps: 10 }, { weight: 80, reps: 10 }).type, 'incomplete');
    assert.equal(compareSetPair(null, { weight: 80, reps: 10 }).type, 'no_data');
  });
});

describe('compareSessions', () => {
  test('genera insights cuando hay progreso claro', () => {
    const current = [{ setNumber: 1, weight: 85, reps: 10, done: true }];
    const previous = [{ setNumber: 1, weight: 80, reps: 10 }];
    const result = compareSessions(current, previous);
    assert.ok(result.insights.length > 0);
    assert.equal(result.perSet[0].type, 'more_weight');
  });

  test('array vacío no lanza y no genera insights', () => {
    const result = compareSessions([], []);
    assert.deepEqual(result.insights, []);
  });
});
