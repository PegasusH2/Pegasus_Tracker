// Empareja el nombre de ejercicio que la IA leyó en la foto contra la
// biblioteca ya existente — la IA NUNCA decide el ejercicio final, solo
// propone el nombre reconocido; esto decide si hay una coincidencia razonable
// o si hace falta preguntarle al usuario (ver workout-import.js).

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '') // quita acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// 1 = idéntico, 0 = nada que ver. Substring cuenta como muy similar (ej.
// "Press banca" vs "Press banca con barra").
function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// Devuelve { exercise, score } de la mejor coincidencia por encima del
// umbral, o null si no hay ninguna razonable (el llamador debe entonces
// ofrecer crear un ejercicio nuevo o elegir uno manualmente).
export function matchExerciseName(name, existingExercises, threshold = 0.6) {
  let best = null;
  let bestScore = 0;
  for (const ex of existingExercises) {
    const score = similarity(name, ex.name);
    if (score > bestScore) {
      bestScore = score;
      best = ex;
    }
  }
  return bestScore >= threshold ? { exercise: best, score: bestScore } : null;
}
