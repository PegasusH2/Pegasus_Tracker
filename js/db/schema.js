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

export const SCHEMA_VERSION = 2;

export function newId() {
  return crypto.randomUUID();
}
