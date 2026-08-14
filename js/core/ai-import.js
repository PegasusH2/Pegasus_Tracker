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

const SET_TYPES = ['normal', 'fallo', 'restpause', 'descendente'];

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

// Nunca lanza sobre datos "basura" de un campo suelto — cada campo se limpia
// o se descarta por separado. Solo lanza si la respuesta ni siquiera es un
// objeto reconocible (eso sí debe mostrarse como fallo del análisis).
function validateExercises(exercisesRaw) {
  const list = Array.isArray(exercisesRaw) ? exercisesRaw : [];
  return list.map((e) => {
    const sets = Math.max(1, cleanInt(e?.sets) ?? 1);
    const repsMin = cleanInt(e?.repsMin);
    const repsMax = cleanInt(e?.repsMax) ?? repsMin;
    // Progresión/pirámide por serie (ej. "6/8/10/12") — distinta de un rango
    // uniforme. Una "secuencia" de un único valor no tiene sentido, se
    // descarta (deja el rango como fuente de verdad en ese caso).
    const repsSequenceRaw = Array.isArray(e?.repsSequence)
      ? e.repsSequence.map((r) => cleanInt(r)).filter((r) => r != null)
      : null;
    const repsSequence = repsSequenceRaw && repsSequenceRaw.length > 1 ? repsSequenceRaw : null;
    const weightSequenceRaw = Array.isArray(e?.weightSequence)
      ? e.weightSequence.map((w) => cleanNum(w)).filter((w) => w != null)
      : null;
    const weightSequence = repsSequence && weightSequenceRaw && weightSequenceRaw.length === repsSequence.length ? weightSequenceRaw : null;
    const setType = SET_TYPES.includes(e?.setType) ? e.setType : 'normal';
    const extraReps = Array.isArray(e?.extraReps)
      ? e.extraReps.map((r) => cleanInt(r)).filter((r) => r != null)
      : null;
    const steps = Array.isArray(e?.steps)
      ? e.steps.map((s) => ({ weight: cleanNum(s?.weight), reps: cleanInt(s?.reps) })).filter((s) => s.weight != null || s.reps != null)
      : null;
    return {
      recognizedName: cleanStr(e?.recognizedName) ?? 'Ejercicio sin nombre',
      sets,
      repsMin,
      repsMax,
      repsSequence,
      weightSequence,
      rir: cleanInt(e?.rir),
      setType,
      lastSetOnly: e?.lastSetOnly === true,
      extraReps: extraReps?.length ? extraReps : null,
      steps: steps?.length ? steps : null,
      supersetGroup: cleanStr(e?.supersetGroup),
      supersetOrder: cleanInt(e?.supersetOrder),
      weightHintKg: cleanNum(e?.weightHintKg),
      notes: cleanStr(e?.notes),
      confidence: e?.confidence === 'low' ? 'low' : 'high',
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
  const routinesRaw = Array.isArray(raw.routines) ? raw.routines : (raw.exercises ? [raw] : []);
  const routines = routinesRaw.map((r) => ({
    workoutName: cleanStr(r?.workoutName ?? r?.name) ?? 'Entrenamiento importado',
    exercises: validateExercises(r?.exercises),
    unrecognized: Array.isArray(r?.unrecognized) ? r.unrecognized.filter((s) => typeof s === 'string' && s.trim()) : [],
  }));
  const structureConfidence = STRUCTURE_CONFIDENCES.includes(raw.structureConfidence) ? raw.structureConfidence : null;
  return {
    structureConfidence,
    routines: routines.length ? routines : [{ workoutName: 'Entrenamiento importado', exercises: [], unrecognized: [] }],
  };
}

// Redimensiona en el cliente antes de subir — más rápido, más barato, y bien
// dentro de los límites de payload de Gemini/Workers. Sin librerías (Canvas).
export function resizeImageForUpload(file, { maxSide = 1600, quality = 0.85 } = {}) {
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

export async function analyzeWorkoutPhoto(file, mode = 'auto') {
  if (!WORKER_URL) return mockAnalyzeProgramPhoto(mode);

  const { base64, mimeType } = await resizeImageForUpload(file);
  let res;
  try {
    res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Token': APP_SHARED_TOKEN },
      body: JSON.stringify({ image: base64, mimeType, mode }),
    });
  } catch {
    throw new Error('NETWORK_ERROR');
  }
  if (!res.ok) throw new Error('ANALYSIS_FAILED');

  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new Error('INVALID_RESPONSE');
  }
  return validateImportedProgram(raw);
}
