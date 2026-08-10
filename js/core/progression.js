// Motor de progresión y análisis de RIR — 100% local, sin IA, sin red.
//
// Regla central (ver especificación): la progresión no depende solo del peso.
// Se considera progresión cualquiera de:
//   - mismo peso + más reps
//   - más peso + mismas reps
//   - más peso + más reps (progresión destacada)
//   - mismo peso + mismas reps + RIR mayor (mismo trabajo, menos esfuerzo)
// Y se avisa (sin penalizar) cuando:
//   - mismo peso + mismas reps + RIR menor (mismo trabajo, más esfuerzo)

export function sessionVolume(sets) {
  return sets.reduce((sum, s) => sum + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
}

function sign(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

export function compareSetPair(curr, prev) {
  if (curr == null || prev == null) return { type: 'no_data' };
  if (curr.weight == null || curr.reps == null || prev.weight == null || prev.reps == null) {
    return { type: 'incomplete' };
  }
  const cmpW = sign(Number(curr.weight) - Number(prev.weight));
  const cmpR = sign(Number(curr.reps) - Number(prev.reps));
  const hasRir = curr.rir != null && prev.rir != null;
  const cmpRIR = hasRir ? sign(Number(curr.rir) - Number(prev.rir)) : null;

  let type;
  if (cmpW > 0 && cmpR > 0) type = 'big_progress';
  else if (cmpW === 0 && cmpR > 0) type = 'more_reps';
  else if (cmpW > 0 && cmpR === 0) type = 'more_weight';
  else if (cmpW === 0 && cmpR === 0 && cmpRIR > 0) type = 'rir_improved';
  else if (cmpW === 0 && cmpR === 0 && cmpRIR < 0) type = 'rir_worse';
  else if (cmpW === 0 && cmpR === 0 && cmpRIR === 0) type = 'identical';
  else if (cmpW < 0 && cmpR < 0) type = 'regression';
  else type = 'mixed';

  return { type, cmpW, cmpR, cmpRIR, curr, prev };
}

// Compara la sesión actual con la última sesión del mismo ejercicio, serie a serie
// (Serie 1 vs Serie 1, Serie 2 vs Serie 2...). Si el número de series difiere,
// se compara además la mejor serie de cada sesión como respaldo.
// compareVolume=false omite el aviso de volumen — útil mientras una sesión todavía
// se está registrando (menos series que la vez anterior), para no mostrar un
// "tu volumen ha bajado" que solo refleja que aún no has terminado de anotar series.
export function compareSessions(currentSets, previousSets, { compareVolume = true } = {}) {
  const perSet = currentSets.map((curr, i) => ({
    setNumber: curr.setNumber ?? i + 1,
    ...compareSetPair(curr, previousSets[i]),
  }));

  const volCurrent = sessionVolume(currentSets);
  const volPrevious = sessionVolume(previousSets);
  const volumeChangePercent = volPrevious > 0 ? ((volCurrent - volPrevious) / volPrevious) * 100 : null;

  let bestSetComparison = null;
  if (currentSets.length !== previousSets.length && currentSets.length && previousSets.length) {
    const bestOf = (sets) => sets.reduce((best, s) => {
      if (s.weight == null || s.reps == null) return best;
      const vol = s.weight * s.reps;
      if (!best || vol > best.vol) return { ...s, vol };
      return best;
    }, null);
    const bestCurr = bestOf(currentSets);
    const bestPrev = bestOf(previousSets);
    if (bestCurr && bestPrev) bestSetComparison = compareSetPair(bestCurr, bestPrev);
  }

  return {
    perSet,
    volumeCurrent: volCurrent,
    volumePrevious: volPrevious,
    volumeChangePercent,
    bestSetComparison,
    insights: buildInsights(perSet, compareVolume ? volumeChangePercent : null, bestSetComparison),
  };
}

function buildInsights(perSet, volumeChangePercent, bestSetComparison) {
  const insights = [];
  const comparable = perSet.filter((r) => r.type !== 'incomplete' && r.type !== 'no_data');

  const sameWeightAndReps = comparable.length > 0 && comparable.every((r) =>
    r.curr.weight === comparable[0].curr.weight && r.curr.reps === comparable[0].curr.reps);

  if (comparable.length === 0 && bestSetComparison) {
    insights.push(...insightsForType(bestSetComparison, { wholeSession: false, isBestSetFallback: true }));
  } else if (comparable.length > 0 && sameWeightAndReps && comparable.every((r) => r.type === comparable[0].type)) {
    // Todas las series comparten peso, reps y patrón de cambio: un único mensaje consolidado.
    insights.push(...insightsForType(comparable[0], {
      wholeSession: true,
      first: comparable[0],
      last: comparable[comparable.length - 1],
    }));
  } else {
    for (const r of comparable) {
      const setInsights = insightsForType(r, { wholeSession: false });
      insights.push(...setInsights);
    }
  }

  if (volumeChangePercent != null && Math.abs(volumeChangePercent) >= 5) {
    const pct = Math.round(volumeChangePercent);
    if (pct > 0) {
      insights.push({ level: 'good', text: `🟢 Tu volumen ha aumentado un ${pct}% respecto a la sesión anterior.` });
    } else {
      insights.push({ level: 'neutral', text: `Tu volumen ha bajado un ${Math.abs(pct)}% respecto a la sesión anterior.` });
    }
  }

  return insights;
}

function insightsForType(r, ctx) {
  const w = r.curr?.weight;
  const reps = r.curr?.reps;
  const setLabel = ctx.wholeSession ? '' : ` (Serie ${r.setNumber})`;

  switch (r.type) {
    case 'big_progress':
      return [{ level: 'good', text: `🟢 Más peso y más repeticiones${setLabel}: ${w}kg × ${reps}. Progresión destacada.` }];
    case 'more_reps':
      return [{ level: 'good', text: `🟢 Has hecho ${reps - r.prev.reps} repetición(es) más con el mismo peso (${w}kg)${setLabel}.` }];
    case 'more_weight':
      return [{ level: 'good', text: `🟢 Has subido el peso manteniendo las repeticiones (${r.prev.weight}kg → ${w}kg)${setLabel}.` }];
    case 'rir_improved': {
      if (ctx.wholeSession) {
        return [{ level: 'good', text: `🟢 Has mantenido ${w}kg × ${reps} y tu RIR ha aumentado de ${ctx.first.prev.rir} a ${ctx.last.curr.rir}. Mismo trabajo, menor esfuerzo.` }];
      }
      return [{ level: 'good', text: `🟢 Mismo peso y repeticiones con mejor RIR (${r.prev.rir} → ${r.curr.rir})${setLabel}.` }];
    }
    case 'rir_worse': {
      if (ctx.wholeSession) {
        return [{ level: 'warn', text: `🟠 Mismo peso y repeticiones (${w}kg × ${reps}), pero tu RIR ha bajado de ${ctx.first.prev.rir} a ${ctx.last.curr.rir}. Mismo trabajo, más esfuerzo.` }];
      }
      return [{ level: 'warn', text: `🟠 Mismo peso y repeticiones, pero tu RIR ha bajado (${r.prev.rir} → ${r.curr.rir})${setLabel}.` }];
    }
    default:
      return [];
  }
}
