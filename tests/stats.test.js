import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimate1RM, bestRecordsFromHistory, trendSeries, trendDirection,
  bodyWeightStats, measurementValue, changeSinceFirst, neutralDirection,
} from '../js/core/stats.js';

describe('estimate1RM', () => {
  test('fórmula de Epley', () => {
    assert.equal(estimate1RM(100, 5), 100 * (1 + 5 / 30));
  });
  test('null si falta peso o reps', () => {
    assert.equal(estimate1RM(null, 5), null);
    assert.equal(estimate1RM(100, null), null);
  });
});

describe('bestRecordsFromHistory', () => {
  test('encuentra el mejor peso, mejores reps y mejor 1RM sin lanzar con historial vacío', () => {
    const empty = bestRecordsFromHistory([]);
    assert.equal(empty.bestWeight, null);
    assert.equal(empty.best1RM, null);
  });

  test('detecta el peso máximo entre varias sesiones', () => {
    const history = [
      { workout: { date: '2026-01-01' }, sets: [{ weight: 80, reps: 8 }] },
      { workout: { date: '2026-01-08' }, sets: [{ weight: 90, reps: 6 }] },
    ];
    const records = bestRecordsFromHistory(history);
    assert.equal(records.bestWeight, 90);
    assert.equal(records.bestWeightEntry.date, '2026-01-08');
  });

  test('ignora series sin peso o reps registrados (no confirmadas)', () => {
    const history = [{ workout: { date: '2026-01-01' }, sets: [{ weight: null, reps: null }] }];
    const records = bestRecordsFromHistory(history);
    assert.equal(records.bestWeight, null);
  });
});

describe('trendSeries', () => {
  const history = [
    { workout: { date: '2026-01-08' }, sets: [{ weight: 90, reps: 6, rir: 1 }] },
    { workout: { date: '2026-01-01' }, sets: [{ weight: 80, reps: 8, rir: 2 }] },
  ];

  test('ordena por fecha ascendente independientemente del orden de entrada', () => {
    const series = trendSeries(history, 'topWeight');
    assert.deepEqual(series.map((p) => p.date), ['2026-01-01', '2026-01-08']);
  });

  test('totalVolume usa effectiveSetVolume (consistente con progression.js)', () => {
    const series = trendSeries(history, 'totalVolume');
    assert.equal(series[0].value, 80 * 8);
    assert.equal(series[1].value, 90 * 6);
  });

  test('métrica desconocida no lanza, da valor null', () => {
    const series = trendSeries(history, 'inexistente');
    assert.equal(series[0].value, null);
  });
});

describe('trendDirection', () => {
  test('menos de 2 valores -> flat', () => {
    assert.equal(trendDirection([5]), 'flat');
    assert.equal(trendDirection([]), 'flat');
  });
  test('subida clara -> up', () => {
    assert.equal(trendDirection([80, 90]), 'up');
  });
  test('bajada clara -> down', () => {
    assert.equal(trendDirection([90, 80]), 'down');
  });
  test('primer valor 0 no divide por cero', () => {
    assert.equal(trendDirection([0, 10]), 'up');
    assert.equal(trendDirection([0, 0]), 'flat');
  });
});

describe('bodyWeightStats', () => {
  test('lista vacía -> null, nunca lanza', () => {
    assert.equal(bodyWeightStats([]), null);
  });
  test('calcula el cambio absoluto desde el primer registro', () => {
    const entries = [
      { date: new Date().toISOString().slice(0, 10), weightKg: 78 },
      { date: '2025-01-01', weightKg: 80 },
    ];
    const stats = bodyWeightStats(entries);
    assert.equal(stats.current, 78);
    assert.equal(stats.initial, 80);
    assert.equal(stats.changeAbs, -2);
  });
});

describe('measurementValue', () => {
  test('valor único', () => assert.equal(measurementValue({ value: 40 }), 40));
  test('bilateral -> media de ambos lados', () => assert.equal(measurementValue({ valueLeft: 38, valueRight: 42 }), 40));
  test('solo un lado informado', () => assert.equal(measurementValue({ valueLeft: 38 }), 38));
  test('sin ningún valor -> null', () => assert.equal(measurementValue({}), null));
});

describe('changeSinceFirst / neutralDirection', () => {
  test('changeSinceFirst con null no lanza', () => {
    assert.deepEqual(changeSinceFirst(null, 80), { abs: null, percent: null });
  });
  test('neutralDirection respeta el umbral epsilon', () => {
    assert.equal(neutralDirection(0.01), 'flat');
    assert.equal(neutralDirection(5), 'up');
    assert.equal(neutralDirection(-5), 'down');
  });
});
