// Importar entrenamiento desde foto — llamada al Worker propio (nunca
// directamente a la API de IA, la clave nunca vive en la PWA) + validación
// defensiva del JSON antes de que toque IndexedDB.
//
// TODO tras desplegar tu Worker (ver worker/README.md): pega aquí la URL real
// y el mismo token que configuraste con `wrangler secret put APP_SHARED_TOKEN`.
// Mientras estén vacíos, la app usa una respuesta simulada para poder probar
// todo el flujo sin depender de ningún despliegue (ver mockAnalyzeProgramPhoto).
export const WORKER_URL = 'https://fitness-tracker-import.pegasush2.workers.dev';
export const APP_SHARED_TOKEN = 'ec5ce8f09593adbab9aa8f70deda1b330ae58a91531ffa44';

const SET_TYPES = ['normal', 'fallo', 'restpause', 'descendente', 'amrap'];

// Cotas defensivas frente a una respuesta de Gemini mal formada/alucinada —
// sin límite, un "sets: 999999999" sobreviviría la limpieza de tipos y
// colgaría la pestaña al crear cientos de millones de filas en
// startWorkoutFromTemplate. Los máximos son generosos (muy por encima de
// cualquier rutina real) para no recortar nunca un caso legítimo.
const MAX_SETS_PER_EXERCISE = 50;
const MAX_SEQUENCE_LENGTH = 30;
const MAX_EXTRA_REPS_LENGTH = 30;
const MAX_DROP_STEPS_LENGTH = 20;
const MAX_EXERCISES_PER_ROUTINE = 80;
const MAX_ROUTINES = 30;
const MAX_UNRECOGNIZED = 100;

// Number(null) === 0 y Number('') === 0 — hay que descartar "ausente" ANTES
// de convertir, o un campo que la IA dejó en null (a propósito, por no
// inventar) se convertiría en un 0 inventado por nosotros.
function cleanInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function cleanNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function cleanStr(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Une fragmentos de nota no vacíos con " · ", sin duplicar separadores.
function joinNotes(...parts) {
  const clean = parts.map((p) => cleanStr(p)).filter(Boolean);
  return clean.length ? clean.join(' · ') : null;
}

// "2'" -> 120, "1'30" -> 90, "20\"" -> 20, "2-3'" (rango) -> promedio (150),
// "SIN DESCANSO" -> 0. Si el texto no encaja con ningún patrón conocido,
// devuelve null (no inventa) — el texto original queda en notes de todos
// modos, vía la nota de descanso incluida en las notas del ejercicio.
function parseRestSecondsRaw(raw) {
  const text = cleanStr(raw);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper.includes('SIN DESCANSO')) return 0;

  // Rango tipo "2-3'" o "2' a 3'" -> promedio de los dos extremos.
  const range = text.match(/(\d+(?:[.,]\d+)?)\s*(?:'|MIN|MINUTOS?)?\s*(?:-|A)\s*(\d+(?:[.,]\d+)?)\s*(?:'|MIN|MINUTOS?)?/i);
  if (range) {
    const a = parseFloat(range[1].replace(',', '.'));
    const b = parseFloat(range[2].replace(',', '.'));
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.round(((a + b) / 2) * 60);
  }
  // "1'30" / "1'30''" -> minutos'segundos.
  const minSec = text.match(/(\d+)\s*'\s*(\d+)/);
  if (minSec) {
    const min = parseInt(minSec[1], 10);
    const sec = parseInt(minSec[2], 10);
    if (Number.isFinite(min) && Number.isFinite(sec)) return min * 60 + sec;
  }
  // "2'" / "3 min" -> solo minutos.
  const minOnly = text.match(/(\d+(?:[.,]\d+)?)\s*(?:'|MIN\b|MINUTOS?\b)/i);
  if (minOnly) {
    const min = parseFloat(minOnly[1].replace(',', '.'));
    if (Number.isFinite(min)) return Math.round(min * 60);
  }
  // "20\"" / "20 seg" -> solo segundos.
  const secOnly = text.match(/(\d+)\s*(?:"|SEG\b|SEGUNDOS?\b)/i);
  if (secOnly) {
    const sec = parseInt(secOnly[1], 10);
    if (Number.isFinite(sec)) return sec;
  }
  return null;
}

// "RIR 0" / "RIR 1" -> número limpio. "RIR 2-0" / "1-0" (progresión) -> se
// deja como instrucción de texto, NUNCA se reparte en números por serie.
function parseRirRaw(raw) {
  const text = cleanStr(raw);
  if (!text) return { rir: null, note: null };
  const progression = text.match(/^(?:RIR\s*)?(\d+)\s*-\s*(\d+)$/i);
  if (progression) {
    return { rir: null, note: `RIR progresivo ${progression[1]}→${progression[2]} a lo largo de las series` };
  }
  const simple = text.match(/^(?:RIR\s*)?(\d+)$/i);
  if (simple) return { rir: parseInt(simple[1], 10), note: null };
  return { rir: null, note: text };
}

// Núcleo de campos de "forma de la serie", compartido entre un ejercicio
// plano y cada entrada de weekValues[] (misma limpieza en ambos casos).
function cleanExerciseCore(e) {
  const setsRaw = cleanInt(e?.sets);
  const sets = Math.min(MAX_SETS_PER_EXERCISE, Math.max(1, setsRaw ?? 1));
  // Si la IA no pudo leer el número de series, "1" es una cifra fabricada
  // por nosotros (no un dato real) — se marca como señal de incertidumbre
  // para que validateExercises lo refleje en confidence, en vez de colarse
  // como si fuera una lectura segura.
  const setsWasMissing = setsRaw == null;
  const repsMinRaw = cleanInt(e?.repsMin);
  const repsMin = repsMinRaw != null && repsMinRaw >= 0 ? repsMinRaw : null;
  const repsMaxRaw = cleanInt(e?.repsMax);
  const repsMax = (repsMaxRaw != null && repsMaxRaw >= 0 ? repsMaxRaw : null) ?? repsMin;
  // Progresión/pirámide por serie (ej. "6/8/10/12") — distinta de un rango
  // uniforme. Una "secuencia" de un único valor no tiene sentido, se
  // descarta (deja el rango como fuente de verdad en ese caso).
  const repsSequenceRaw = Array.isArray(e?.repsSequence)
    ? e.repsSequence.slice(0, MAX_SEQUENCE_LENGTH).map((r) => cleanInt(r)).filter((r) => r != null && r >= 0)
    : null;
  const repsSequence = repsSequenceRaw && repsSequenceRaw.length > 1 ? repsSequenceRaw : null;
  const weightSequenceRaw = Array.isArray(e?.weightSequence)
    ? e.weightSequence.slice(0, MAX_SEQUENCE_LENGTH).map((w) => cleanNum(w)).filter((w) => w != null && w >= 0)
    : null;
  const weightSequence = repsSequence && weightSequenceRaw && weightSequenceRaw.length === repsSequence.length ? weightSequenceRaw : null;
  const setType = SET_TYPES.includes(e?.setType) ? e.setType : 'normal';
  const extraReps = Array.isArray(e?.extraReps)
    ? e.extraReps.slice(0, MAX_EXTRA_REPS_LENGTH).map((r) => cleanInt(r)).filter((r) => r != null && r >= 0)
    : null;
  const steps = Array.isArray(e?.steps)
    ? e.steps.slice(0, MAX_DROP_STEPS_LENGTH).map((s) => ({ weight: cleanNum(s?.weight), reps: cleanInt(s?.reps) })).filter((s) => (s.weight == null || s.weight >= 0) && (s.reps == null || s.reps >= 0) && (s.weight != null || s.reps != null))
    : null;
  const weightHintRaw = cleanNum(e?.weightHintKg);
  return {
    sets, setsWasMissing, repsMin, repsMax, repsSequence, weightSequence, setType,
    lastSetOnly: e?.lastSetOnly === true,
    extraReps: extraReps?.length ? extraReps : null,
    steps: steps?.length ? steps : null,
    weightHintKg: weightHintRaw != null && weightHintRaw >= 0 ? weightHintRaw : null,
  };
}

// ¿Esta entrada de weekValues[] trae algo real, o está vacía/es solo un
// hueco de fecha para rellenar a mano? (ver Caso "cuaderno de registro").
function weekValueHasData(wv) {
  return wv?.sets > 0 || wv?.repsMin > 0 || wv?.repsMax > 0
    || (Array.isArray(wv?.repsSequence) && wv.repsSequence.length > 0)
    || wv?.setType === 'amrap' || !!cleanStr(wv?.rawText);
}

function weekValueScore(core) {
  const reps = core.repsMax ?? core.repsMin ?? (core.repsSequence ? Math.max(...core.repsSequence) : 0) ?? 0;
  return core.sets * reps;
}

// Regla de §2 de docs/ai-import-v2-design.md: por defecto la ÚLTIMA semana;
// si esa celda está vacía/incompleta para este ejercicio, respaldo en la
// semana con más volumen (series × reps) de las que sí tengan datos.
function resolveWeekValues(weekValuesRaw) {
  const list = Array.isArray(weekValuesRaw) ? weekValuesRaw.filter((wv) => wv && typeof wv === 'object') : [];
  if (!list.length) return null;
  const last = list[list.length - 1];
  if (weekValueHasData(last)) return { chosen: last, usedFallback: false };
  const withData = list.filter(weekValueHasData);
  if (!withData.length) return { chosen: last, usedFallback: false };
  const scored = withData.map((wv) => ({ wv, score: weekValueScore(cleanExerciseCore(wv)) }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a)).wv;
  return { chosen: best, usedFallback: true };
}

// Nunca lanza sobre datos "basura" de un campo suelto — cada campo se limpia
// o se descarta por separado. Solo lanza si la respuesta ni siquiera es un
// objeto reconocible (eso sí debe mostrarse como fallo del análisis).
function validateExercises(exercisesRaw) {
  const list = (Array.isArray(exercisesRaw) ? exercisesRaw : []).slice(0, MAX_EXERCISES_PER_ROUTINE);
  return list.map((e) => {
    const resolved = resolveWeekValues(e?.weekValues);
    // Fuente de los campos "de forma de la serie": la semana elegida si el
    // documento tenía columnas de semana, o el propio ejercicio si no.
    const source = resolved ? resolved.chosen : e;
    const core = cleanExerciseCore(source);

    // La IA puede poner un RIR simple directamente en "rir" (regla original),
    // o un texto en "rirRaw" cuando es una progresión ("RIR 2-0") — "rir"
    // directo siempre gana si ambos vinieran informados.
    const { rir: rirFromRaw, note: rirNote } = parseRirRaw(source?.rirRaw);
    const rir = cleanInt(source?.rir) ?? rirFromRaw;
    const restSeconds = parseRestSecondsRaw(source?.restSecondsRaw);
    const restNote = source?.restSecondsRaw && restSeconds == null ? `Descanso: ${cleanStr(source.restSecondsRaw)}` : null;
    const tutNote = cleanStr(source?.tut) ? `TUT: ${cleanStr(source.tut)}` : null;
    const equipmentNote = cleanStr(source?.equipmentHint) ? `Material: ${cleanStr(source.equipmentHint)}` : null;
    const fallbackNote = resolved?.usedFallback && resolved.chosen?.weekLabel
      ? `Semana final sin datos para este ejercicio — se usó ${cleanStr(resolved.chosen.weekLabel) ?? 'otra semana'} por tener más series/reps`
      : null;

    const rawText = cleanStr(source?.rawText);
    const hasUncertainSignal = !!rawText || !!fallbackNote || (source?.confidence === 'low') || core.setsWasMissing;

    return {
      recognizedName: cleanStr(e?.recognizedName) ?? 'Ejercicio sin nombre',
      sets: core.sets,
      repsMin: core.repsMin,
      repsMax: core.repsMax,
      repsSequence: core.repsSequence,
      weightSequence: core.weightSequence,
      rir,
      targetRestSeconds: restSeconds,
      setType: core.setType,
      lastSetOnly: core.lastSetOnly,
      extraReps: core.extraReps,
      steps: core.steps,
      supersetGroup: cleanStr(e?.supersetGroup),
      supersetOrder: cleanInt(e?.supersetOrder),
      weightHintKg: core.weightHintKg,
      notes: joinNotes(source?.notes, tutNote, equipmentNote, rirNote, restNote, fallbackNote),
      confidence: hasUncertainSignal ? 'low' : 'high',
      rawText,
    };
  });
}

const STRUCTURE_CONFIDENCES = ['high', 'low', 'none'];

// La IA siempre devuelve una lista de rutinas ("routines") — 1 elemento
// cuando solo hay una, N cuando ha separado un programa completo — más
// structureConfidence, que indica cuánto se fía de esa separación (el
// cliente decide qué hacer con eso, la IA nunca decide sola).
export function validateImportedProgram(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_RESPONSE');
  const routinesRaw = (Array.isArray(raw.routines) ? raw.routines : (raw.exercises ? [raw] : [])).slice(0, MAX_ROUTINES);
  const routines = routinesRaw.map((r) => ({
    workoutName: cleanStr(r?.workoutName ?? r?.name) ?? 'Entrenamiento importado',
    description: cleanStr(r?.routineDescription) ?? '',
    exercises: validateExercises(r?.exercises),
    unrecognized: Array.isArray(r?.unrecognized) ? r.unrecognized.filter((s) => typeof s === 'string' && s.trim()).slice(0, MAX_UNRECOGNIZED) : [],
  }));
  const structureConfidence = STRUCTURE_CONFIDENCES.includes(raw.structureConfidence) ? raw.structureConfidence : null;
  return {
    structureConfidence,
    routines: routines.length ? routines : [{ workoutName: 'Entrenamiento importado', description: '', exercises: [], unrecognized: [] }],
  };
}

// Redimensiona en el cliente antes de subir — más rápido, más barato, y bien
// dentro de los límites de payload de Gemini/Workers. Sin librerías (Canvas).
export function resizeImageForUpload(file, { maxSide = 2200, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('DECODE_FAILED'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          if (width >= height) { height = Math.round(height * (maxSide / width)); width = maxSide; }
          else { width = Math.round(width * (maxSide / height)); height = maxSide; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const MOCK_CHEST_ROUTINE = {
  workoutName: 'Pecho',
  exercises: [
    { recognizedName: 'Press banca', sets: 4, repsSequence: [6, 8, 10, 12], weightSequence: [60, 55, 50, 45], rir: 2, setType: 'normal', confidence: 'high' },
    { recognizedName: 'Press inclinado mancuernas', sets: 3, repsMin: 8, repsMax: 10, rir: null, setType: 'normal', confidence: 'high' },
    { recognizedName: 'Aperturas', sets: 3, repsMin: 12, repsMax: 12, rir: null, setType: 'normal', confidence: 'high' },
    { recognizedName: 'Fondos', sets: 3, repsMin: null, repsMax: null, rir: null, setType: 'fallo', confidence: 'high' },
  ],
  unrecognized: [],
};

const MOCK_PROGRAM_ROUTINES = [
  { workoutName: 'Lunes · Push', exercises: [
    { recognizedName: 'Press banca', sets: 4, repsMin: 8, repsMax: 10, rir: 2, setType: 'normal', confidence: 'high' },
    { recognizedName: 'Press militar', sets: 3, repsMin: 8, repsMax: 10, rir: 2, setType: 'normal', confidence: 'high' },
    { recognizedName: 'Fondos', sets: 3, repsMin: null, repsMax: null, rir: null, setType: 'fallo', confidence: 'high' },
  ], unrecognized: [] },
  { workoutName: 'Martes · Pull', exercises: [
    { recognizedName: 'Dominadas', sets: 4, repsMin: 6, repsMax: 8, rir: 1, setType: 'normal', confidence: 'high' },
    { recognizedName: 'Remo con barra', sets: 3, repsMin: 8, repsMax: 10, rir: 2, setType: 'normal', confidence: 'high' },
  ], unrecognized: [] },
  { workoutName: 'Jueves · Legs', exercises: [
    { recognizedName: 'Sentadilla', sets: 4, repsMin: 6, repsMax: 8, rir: 2, setType: 'normal', confidence: 'high' },
    { recognizedName: 'Prensa', sets: 3, repsMin: 10, repsMax: 12, rir: 1, setType: 'normal', confidence: 'high' },
  ], unrecognized: [] },
];

// Fixture de REGRESIÓN — caso real: tabla de 4 días (rangos "Nx a-b", rangos
// con la palabra "a", progresiones sin "x" delante como "12-10-8-6", rest-pause
// con duración pero sin desglose de reps, y un comentario general de rutina
// que se repite en varios días). Codifica la interpretación CORRECTA esperada
// para poder volver a probar el parser/la UI sin depender de la IA real.
// Uso: mockRegressionFixture4Day() desde la consola o temporalmente en el
// switch de abajo — no se usa por defecto para no tocar los mocks simples.
const REGRESSION_NOTE_GENERAL = 'Recuerda que en todos los ejercicios (especialmente en la sentadilla con banco, el press plano y el press militar) debes soltar el aire por la boca (exhalar) siempre en el momento en que haces la fuerza para subir el peso. ¡Cero apneas!';

const REGRESSION_FIXTURE_4DAY = [
  {
    workoutName: 'Día 1',
    routineDescription: REGRESSION_NOTE_GENERAL,
    exercises: [
      { recognizedName: 'Remo unilateral apoyado con mancuerna', sets: 4, repsSequence: [12, 10, 8, 6], notes: 'Intenta que a medida que bajamos repeticiones subimos un poquito el peso', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Jalón al pecho', sets: 4, repsMin: 12, repsMax: 12, setType: 'restpause', lastSetOnly: true, notes: 'Poco peso buena técnica. Rest-pause: 20s de descanso interno, en ese descanso intentamos hacer 12.', confidence: 'high' },
      { recognizedName: 'Press militar sentado', sets: 4, repsSequence: [12, 10, 8, 6], notes: 'Intenta que a medida que bajamos repeticiones subimos un poquito el peso', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Elevaciones laterales mancuerna', sets: 3, repsMin: 10, repsMax: 10, notes: 'Poco peso buena técnica.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Triceps polea alta apoyando codo', sets: 3, repsMin: 10, repsMax: 10, notes: 'Polea arriba y brazo apoyado, debes estar tu cuerpo mirando al lado opuesto de la polea.', setType: 'normal', confidence: 'high' },
    ],
    unrecognized: [],
  },
  {
    workoutName: 'Día 2',
    routineDescription: REGRESSION_NOTE_GENERAL,
    exercises: [
      { recognizedName: 'Abductor', sets: 3, repsMin: 10, repsMax: 10, notes: 'Poco peso buena técnica.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Sentadilla con banco', sets: 4, repsMin: 12, repsMax: 12, setType: 'normal', confidence: 'high' },
      { recognizedName: 'Extensión de quadriceps', sets: 3, repsSequence: [10, 10, 8], notes: 'Aprovecha el máximo al no involucrar el core.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Femoral de pie', sets: 3, repsMin: 10, repsMax: 10, notes: 'Aprovecha el máximo al no involucrar el core.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Gemelo sentado', sets: 3, repsMin: 15, repsMax: 15, notes: 'Aprovecha el máximo al no involucrar el core.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Adductor', sets: 2, repsMin: 10, repsMax: 10, notes: 'Poco peso buena técnica.', setType: 'normal', confidence: 'high' },
    ],
    unrecognized: [],
  },
  {
    workoutName: 'Día 3',
    routineDescription: REGRESSION_NOTE_GENERAL,
    exercises: [
      { recognizedName: 'Elevaciones laterales', sets: 3, repsMin: 10, repsMax: 10, notes: 'Poco peso buena técnica.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Pajaros en maquina / Reverse Pec Deck', sets: 2, repsMin: 10, repsMax: 10, setType: 'normal', confidence: 'high' },
      { recognizedName: 'Press plano', sets: 3, repsMin: 12, repsMax: 12, notes: 'Banco o Multipower lo que te sientas más cómoda.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Press inclinado', sets: 4, repsMin: 10, repsMax: 10, notes: 'Banco o Multipower lo que te sientas más cómoda.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Triceps polea alta barra Z', sets: 3, repsMin: 10, repsMax: 10, notes: 'Codos atrás y a darle duro al tríceps', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Curl de biceps apoyando el codo', sets: 3, repsSequence: [15, 12, 10], notes: 'Busca un punto donde apoyar el codo evitamos balanceos.', setType: 'normal', confidence: 'high' },
    ],
    unrecognized: [],
  },
  {
    workoutName: 'Día 4',
    routineDescription: REGRESSION_NOTE_GENERAL,
    exercises: [
      { recognizedName: 'Abductor', sets: 3, repsMin: 10, repsMax: 10, notes: 'Poco peso buena técnica.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Femoral sentado', sets: 3, repsSequence: [10, 10, 8], notes: 'Aprovecha el máximo al no involucrar el core.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Extensión de quadriceps unilateral', sets: 4, repsMin: 8, repsMax: 10, notes: 'Aprovecha el máximo al no involucrar el core.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Patada de glúteo en polea baja', sets: 3, repsMin: 10, repsMax: 12, setType: 'normal', confidence: 'high' },
      { recognizedName: 'Gemelo de pie', sets: 3, repsMin: 15, repsMax: 15, notes: 'Poco peso buena técnica.', setType: 'normal', confidence: 'high' },
      { recognizedName: 'Adductor', sets: 2, repsMin: 10, repsMax: 10, notes: 'Poco peso buena técnica.', setType: 'normal', confidence: 'high' },
    ],
    unrecognized: [],
  },
];

export function mockRegressionFixture4Day() {
  return validateImportedProgram({ routines: REGRESSION_FIXTURE_4DAY, structureConfidence: 'high' });
}

// Respuestas simuladas — permiten construir y probar todo el flujo (incluida
// la rama de confianza media/baja) sin depender de que el Worker ya esté
// desplegado con el prompt nuevo.
async function mockAnalyzeProgramPhoto(mode) {
  await new Promise((r) => setTimeout(r, 900)); // simula la latencia real del análisis
  if (mode === 'multi') {
    return validateImportedProgram({ routines: MOCK_PROGRAM_ROUTINES, structureConfidence: 'high' });
  }
  if (mode === 'single') {
    return validateImportedProgram({ routines: [MOCK_CHEST_ROUTINE], structureConfidence: null });
  }
  // auto: se simula un caso de confianza media/baja para poder probar la
  // pantalla intermedia "¿cómo quieres importarla?".
  return validateImportedProgram({ routines: MOCK_PROGRAM_ROUTINES.slice(0, 2), structureConfidence: 'low' });
}

export async function analyzeWorkoutPhoto(file, mode = 'auto', { adminToken } = {}) {
  if (!WORKER_URL) return mockAnalyzeProgramPhoto(mode);

  const { base64, mimeType } = await resizeImageForUpload(file);
  const headers = { 'Content-Type': 'application/json', 'X-App-Token': APP_SHARED_TOKEN };
  if (adminToken) headers['X-Admin-Session'] = adminToken;

  let res;
  try {
    res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: base64, mimeType, mode }),
    });
  } catch {
    throw new Error('NETWORK_ERROR');
  }
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error('ANALYSIS_FAILED');

  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new Error('INVALID_RESPONSE');
  }
  return validateImportedProgram(raw);
}

// Modo administrador — inicia sesión contra el Worker con la contraseña que
// SOLO tú conoces (nunca se guarda: ni aquí, ni en localStorage, ni en
// IndexedDB). Lo único que persiste localmente es la sesión temporal que
// devuelve el Worker, que caduca sola y puede revocarse por completo
// rotando/borrando ADMIN_SECRET en Cloudflare sin tocar la PWA.
export async function adminLogin(password) {
  if (!WORKER_URL) throw new Error('WORKER_NOT_CONFIGURED');

  let res;
  try {
    res = await fetch(`${WORKER_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new Error('NETWORK_ERROR');
  }
  if (res.status === 401) throw new Error('INVALID_PASSWORD');
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error('LOGIN_FAILED');

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('INVALID_RESPONSE');
  }
  if (!data?.token || !data?.expiresAt) throw new Error('INVALID_RESPONSE');
  return { token: data.token, expiresAt: data.expiresAt };
}
