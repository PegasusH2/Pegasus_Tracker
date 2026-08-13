// Estadísticas, PRs y tendencias derivadas del historial. Todo local, sin IA.
import { effectiveSetVolume } from './progression.js';

export function estimate1RM(weight, reps) {
  if (weight == null || reps == null) return null;
  return weight * (1 + reps / 30); // fórmula de Epley, solo como referencia orientativa
}

// history: array de {workout, sets}, en cualquier orden.
// loadMode 'perSide' duplica el peso al calcular volumen (mancuerna/lado) —
// bestWeight/bestReps/best1RM siguen basados en el peso crudo por serie.
export function bestRecordsFromHistory(history, { loadMode = 'total' } = {}) {
  let bestWeight = null, bestWeightEntry = null;
  let bestVolumeSession = null;
  let best1RM = null, best1RMEntry = null;
  let bestReps = null, bestRepsEntry = null;

  for (const entry of history) {
    let sessionVol = 0;
    for (const s of entry.sets) {
      if (s.weight == null || s.reps == null) continue;
      sessionVol += effectiveSetVolume(s, { loadMode });

      if (bestWeight == null || s.weight > bestWeight) {
        bestWeight = s.weight;
        bestWeightEntry = { date: entry.workout.date, set: s };
      }
      if (bestReps == null || s.reps > bestReps) {
        bestReps = s.reps;
        bestRepsEntry = { date: entry.workout.date, set: s };
      }
      const rm = estimate1RM(s.weight, s.reps);
      if (rm != null && (best1RM == null || rm > best1RM)) {
        best1RM = rm;
        best1RMEntry = { date: entry.workout.date, set: s };
      }
    }
    if (sessionVol > 0 && (bestVolumeSession == null || sessionVol > bestVolumeSession)) {
      bestVolumeSession = sessionVol;
    }
  }

  return { bestWeight, bestWeightEntry, bestVolumeSession, best1RM, best1RMEntry, bestReps, bestRepsEntry };
}

const PERIOD_DAYS = {
  '4w': 28, '8w': 56, '12w': 84, '6m': 182, '1y': 365,
  '7d': 7, '30d': 30, '3m': 90,
};

export function periodToCutoffISO(periodKey) {
  if (periodKey === 'all') return null;
  const days = PERIOD_DAYS[periodKey] ?? 84;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

export function filterHistoryByPeriod(history, periodKey) {
  const cutoffISO = periodToCutoffISO(periodKey);
  if (!cutoffISO) return history;
  return history.filter((e) => e.workout.date >= cutoffISO);
}

// items: cualquier array con una fecha ISO accesible vía getDate(item)
export function filterByPeriodGeneric(items, periodKey, getDate = (i) => i.date) {
  const cutoffISO = periodToCutoffISO(periodKey);
  if (!cutoffISO) return items;
  return items.filter((i) => getDate(i) >= cutoffISO);
}

// metric: 'totalVolume' | 'topWeight' | 'topReps' | 'avgRir'
export function trendSeries(history, metric, { loadMode = 'total' } = {}) {
  const sorted = [...history].sort((a, b) => (a.workout.date < b.workout.date ? -1 : 1));
  return sorted.map((entry) => {
    const validSets = entry.sets.filter((s) => s.weight != null && s.reps != null);
    let value = null;
    if (metric === 'totalVolume') {
      value = validSets.reduce((sum, s) => sum + effectiveSetVolume(s, { loadMode }), 0);
    } else if (metric === 'topWeight') {
      value = validSets.length ? Math.max(...validSets.map((s) => s.weight)) : null;
    } else if (metric === 'topReps') {
      value = validSets.length ? Math.max(...validSets.map((s) => s.reps)) : null;
    } else if (metric === 'avgRir') {
      const withRir = entry.sets.filter((s) => s.rir != null);
      value = withRir.length ? withRir.reduce((sum, s) => sum + s.rir, 0) / withRir.length : null;
    }
    return { date: entry.workout.date, value };
  });
}

export function trendDirection(values) {
  const nums = values.filter((v) => v != null);
  if (nums.length < 2) return 'flat';
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (first === 0) return last > 0 ? 'up' : 'flat';
  if (last > first * 1.02) return 'up';
  if (last < first * 0.98) return 'down';
  return 'flat';
}

// entriesDesc: registros de peso corporal ordenados de más reciente a más antiguo.
export function bodyWeightStats(entriesDesc) {
  if (!entriesDesc.length) return null;
  const nowMs = Date.now();

  function avgInWindow(startDaysAgo, endDaysAgo) {
    const startMs = nowMs - startDaysAgo * 86400000;
    const endMs = nowMs - endDaysAgo * 86400000;
    const inRange = entriesDesc.filter((e) => {
      const t = new Date(e.date).getTime();
      return t <= startMs && t > endMs;
    });
    if (!inRange.length) return null;
    return inRange.reduce((sum, e) => sum + e.weightKg, 0) / inRange.length;
  }

  const current = entriesDesc[0].weightKg;
  const weeklyAvg = avgInWindow(7, -1) ?? current;
  const prevWeekAvg = avgInWindow(14, 7);
  const weeklyChange = prevWeekAvg != null ? weeklyAvg - prevWeekAvg : null;

  const monthAgoEntry = entriesDesc.find((e) => (nowMs - new Date(e.date).getTime()) >= 28 * 86400000);
  const monthlyChange = monthAgoEntry ? current - monthAgoEntry.weightKg : null;

  const initial = entriesDesc[entriesDesc.length - 1].weightKg;
  const initialDate = entriesDesc[entriesDesc.length - 1].date;
  const changeAbs = current - initial;
  const changePercent = initial ? (changeAbs / initial) * 100 : null;

  return { current, weeklyAvg, weeklyChange, monthlyChange, initial, initialDate, changeAbs, changePercent };
}

// Valor representativo de una medición: el valor único, o la media de ambos
// lados si es bilateral (para gráficas/tendencia agregada).
export function measurementValue(m) {
  if (m.value != null) return m.value;
  if (m.valueLeft != null && m.valueRight != null) return (m.valueLeft + m.valueRight) / 2;
  return m.valueLeft ?? m.valueRight ?? null;
}

// Estimación orientativa de % graso — fórmula de Jackson & Pollock (7 pliegues).
// NUNCA presentar como medición médica exacta.
export function estimateBodyFatJP7(sumMm) {
  if (sumMm == null) return null;
  return 3.64 + sumMm * 0.097;
}

export function changeSinceFirst(current, initial) {
  if (current == null || initial == null) return { abs: null, percent: null };
  const abs = current - initial;
  const percent = initial ? (abs / initial) * 100 : null;
  return { abs, percent };
}

// direction: 'up' | 'down' | 'flat' — SIN connotación de bueno/malo.
export function neutralDirection(value, epsilon = 0.05) {
  if (value == null || Math.abs(value) < epsilon) return 'flat';
  return value > 0 ? 'up' : 'down';
}
