// Definición del esquema de IndexedDB usando Dexie.
// Dexie se carga como script global (js/lib/dexie.min.js), de ahí el uso de `Dexie` sin import.

export const db = new Dexie('FitnessTrackerDB');

db.version(1).stores({
  exercises: 'id, name, muscleGroup, archived',
  workouts: 'id, date',
  workoutExercises: 'id, workoutId, exerciseId, [workoutId+order]',
  sets: 'id, workoutExerciseId, setNumber',
  bodyWeight: 'id, date',
  measurementTypes: 'id, order',
  measurements: 'id, typeId, [typeId+date]',
  skinfoldSites: 'id, order',
  skinfoldEntries: 'id, siteId, [siteId+date]',
  settings: 'key',
});

// v2: plantillas de entrenamiento (Días/Rutinas) reutilizables. Migración
// aditiva — no borra ni recrea nada; los workouts existentes simplemente
// quedan sin templateId (entrenamientos libres).
db.version(2).stores({
  exercises: 'id, name, muscleGroup, archived',
  workouts: 'id, date, templateId',
  workoutExercises: 'id, workoutId, exerciseId, [workoutId+order]',
  sets: 'id, workoutExerciseId, setNumber',
  bodyWeight: 'id, date',
  measurementTypes: 'id, order',
  measurements: 'id, typeId, [typeId+date]',
  skinfoldSites: 'id, order',
  skinfoldEntries: 'id, siteId, [siteId+date]',
  settings: 'key',
  templates: 'id, order',
  templateExercises: 'id, templateId, [templateId+order]',
});

// v3: medidas configurables/bilaterales. Mismos stores e índices que v2 —
// solo transforma datos existentes (upgrade), nunca los borra:
//   measurementTypes: añade unit ('cm' por defecto), bilateral, enabled.
//   measurements: renombra valueCm -> value; añade valueLeft/valueRight.
db.version(3).stores({
  exercises: 'id, name, muscleGroup, archived',
  workouts: 'id, date, templateId',
  workoutExercises: 'id, workoutId, exerciseId, [workoutId+order]',
  sets: 'id, workoutExerciseId, setNumber',
  bodyWeight: 'id, date',
  measurementTypes: 'id, order',
  measurements: 'id, typeId, [typeId+date]',
  skinfoldSites: 'id, order',
  skinfoldEntries: 'id, siteId, [siteId+date]',
  settings: 'key',
  templates: 'id, order',
  templateExercises: 'id, templateId, [templateId+order]',
}).upgrade(async (tx) => {
  await tx.table('measurementTypes').toCollection().modify((t) => {
    if (t.unit === undefined) t.unit = 'cm';
    if (t.bilateral === undefined) t.bilateral = false;
    if (t.enabled === undefined) t.enabled = true;
  });
  await tx.table('measurements').toCollection().modify((m) => {
    if (m.value === undefined) m.value = m.valueCm ?? null;
    delete m.valueCm;
    if (m.valueLeft === undefined) m.valueLeft = null;
    if (m.valueRight === undefined) m.valueRight = null;
  });
});

// v4: modo de carga por ejercicio ('total' | 'perSide'), para diferenciar
// peso total de peso por lado/mancuerna en el cálculo de volumen. Mismos
// stores e índices que v3 — solo añade el campo, con 'total' como valor por
// defecto para preservar el comportamiento actual de todos los ejercicios
// existentes (equivalente a "no era por lado").
db.version(4).stores({
  exercises: 'id, name, muscleGroup, archived',
  workouts: 'id, date, templateId',
  workoutExercises: 'id, workoutId, exerciseId, [workoutId+order]',
  sets: 'id, workoutExerciseId, setNumber',
  bodyWeight: 'id, date',
  measurementTypes: 'id, order',
  measurements: 'id, typeId, [typeId+date]',
  skinfoldSites: 'id, order',
  skinfoldEntries: 'id, siteId, [siteId+date]',
  settings: 'key',
  templates: 'id, order',
  templateExercises: 'id, templateId, [templateId+order]',
}).upgrade(async (tx) => {
  await tx.table('exercises').toCollection().modify((e) => {
    if (e.loadMode === undefined) e.loadMode = 'total';
  });
});

// v5: composición kg+lb por serie. kg y lb pueden ser DATOS DISTINTOS que se
// suman (ej. 10kg + 2,5lb de discos combinados), no una conversión del mismo
// número. weight sigue siendo el total canónico en kg (nada que ya lea
// s.weight necesita cambiar); weightKgPart/weightLbPart son los dos
// componentes que el usuario introdujo, solo para poder mostrarlos y
// editarlos por separado. Series existentes se tratan como "todo en kg".
db.version(5).stores({
  exercises: 'id, name, muscleGroup, archived',
  workouts: 'id, date, templateId',
  workoutExercises: 'id, workoutId, exerciseId, [workoutId+order]',
  sets: 'id, workoutExerciseId, setNumber',
  bodyWeight: 'id, date',
  measurementTypes: 'id, order',
  measurements: 'id, typeId, [typeId+date]',
  skinfoldSites: 'id, order',
  skinfoldEntries: 'id, siteId, [siteId+date]',
  settings: 'key',
  templates: 'id, order',
  templateExercises: 'id, templateId, [templateId+order]',
}).upgrade(async (tx) => {
  await tx.table('sets').toCollection().modify((s) => {
    if (s.weightKgPart === undefined) s.weightKgPart = s.weight ?? null;
    if (s.weightLbPart === undefined) s.weightLbPart = null;
  });
});

// v6: rangos de reps objetivo + tipos de serie especiales (fallo, rest-pause,
// descendente). targetReps (un solo número) se conserva sin tocar; se deriva
// targetRepsMin = targetRepsMax = targetReps para que un objetivo antiguo
// "10 reps" siga siendo exactamente eso, ahora expresado como rango 10-10.
// sets.type='normal' en todo lo existente preserva el comportamiento actual
// byte a byte — el resto de campos nuevos son desgloses opcionales, nunca
// sustituyen weight/reps.
db.version(6).stores({
  exercises: 'id, name, muscleGroup, archived',
  workouts: 'id, date, templateId',
  workoutExercises: 'id, workoutId, exerciseId, [workoutId+order]',
  sets: 'id, workoutExerciseId, setNumber',
  bodyWeight: 'id, date',
  measurementTypes: 'id, order',
  measurements: 'id, typeId, [typeId+date]',
  skinfoldSites: 'id, order',
  skinfoldEntries: 'id, siteId, [siteId+date]',
  settings: 'key',
  templates: 'id, order',
  templateExercises: 'id, templateId, [templateId+order]',
}).upgrade(async (tx) => {
  await tx.table('sets').toCollection().modify((s) => {
    if (s.type === undefined) s.type = 'normal';
    if (s.restPauseExtra === undefined) s.restPauseExtra = null;
    if (s.dropSteps === undefined) s.dropSteps = null;
    if (s.barWeightKg === undefined) s.barWeightKg = null;
    if (s.plateWeightPerSideKg === undefined) s.plateWeightPerSideKg = null;
    if (s.addedWeightKg === undefined) s.addedWeightKg = null;
  });
  await tx.table('workoutExercises').toCollection().modify((we) => {
    if (we.targetRepsMin === undefined) we.targetRepsMin = we.targetReps ?? null;
    if (we.targetRepsMax === undefined) we.targetRepsMax = we.targetReps ?? null;
    if (we.supersetGroupId === undefined) we.supersetGroupId = null;
    if (we.supersetOrder === undefined) we.supersetOrder = null;
  });
  await tx.table('templateExercises').toCollection().modify((te) => {
    if (te.targetRepsMin === undefined) te.targetRepsMin = te.targetReps ?? null;
    if (te.targetRepsMax === undefined) te.targetRepsMax = te.targetReps ?? null;
    if (te.supersetGroupId === undefined) te.supersetGroupId = null;
    if (te.supersetOrder === undefined) te.supersetOrder = null;
  });
  await tx.table('exercises').toCollection().modify((e) => {
    if (e.equipmentType === undefined) e.equipmentType = 'other';
    if (e.defaultBarId === undefined) e.defaultBarId = null;
  });
});

export const SCHEMA_VERSION = 6;

export function newId() {
  return crypto.randomUUID();
}
