// Estadísticas, PRs y tendencias derivadas del historial. Todo local, sin IA.

export function estimate1RM(weight, reps) {
  if (weight == null || reps == null) return null;
  return weight * (1 + reps / 30); // fórmula de Epley, solo como referencia orientativa
}

// history: array de {workout, sets}, en cualquier orden.
export function bestRecordsFromHistory(history) {
  let bestWeight = null, bestWeightEntry = null;
  let bestVolumeSession = null;
  let best1RM = null, best1RMEntry = null;
  let bestReps = null, bestRepsEntry = null;

  for (const entry of history) {
    let sessionVol = 0;
    for (const s of entry.sets) {
      if (s.weight == null || s.reps == null) continue;
      sessionVol += s.weight * s.reps;

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

export function periodToCutoffISO(periodKey) {
  if (periodKey === 'all') return null;
  const days = { '4w': 28, '8w': 56, '12w': 84, '6m': 182, '1y': 365 }[periodKey] ?? 84;
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
export function trendSeries(history, metric) {
  const sorted = [...history].sort((a, b) => (a.workout.date < b.workout.date ? -1 : 1));
  return sorted.map((entry) => {
    const validSets = entry.sets.filter((s) => s.weight != null && s.reps != null);
    let value = null;
    if (metric === 'totalVolume') {
      value = validSets.reduce((sum, s) => sum + s.weight * s.reps, 0);
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

  return { current, weeklyAvg, weeklyChange, monthlyChange };
}
