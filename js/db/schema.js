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

export const SCHEMA_VERSION = 1;

export function newId() {
  return crypto.randomUUID();
}
