import { db, newId } from './schema.js';

// ---------- Ejercicios ----------

export async function listExercises({ includeArchived = false, search = '' } = {}) {
  let items = await db.exercises.toArray();
  if (!includeArchived) items = items.filter((e) => !e.archived);
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((e) => e.name.toLowerCase().includes(q));
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getExercise(id) {
  return db.exercises.get(id);
}

export async function createExercise({ name, muscleGroup = '', notes = '' }) {
  const exercise = {
    id: newId(),
    name: name.trim(),
    muscleGroup,
    notes,
    archived: false,
    createdAt: new Date().toISOString(),
  };
  await db.exercises.add(exercise);
  return exercise;
}

export async function updateExercise(id, changes) {
  await db.exercises.update(id, changes);
}

export async function setExerciseArchived(id, archived) {
  await db.exercises.update(id, { archived });
}

export async function deleteExercise(id) {
  await db.exercises.delete(id);
}

// ---------- Entrenamientos ----------

export async function createWorkout({ name, date }) {
  const workout = {
    id: newId(),
    name,
    date, // ISO date string (YYYY-MM-DD)
    notes: '',
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.workouts.add(workout);
  return workout;
}

export async function getWorkout(id) {
  return db.workouts.get(id);
}

export async function updateWorkout(id, changes) {
  await db.workouts.update(id, { ...changes, updatedAt: new Date().toISOString() });
}

export async function deleteWorkout(id) {
  const wes = await db.workoutExercises.where('workoutId').equals(id).toArray();
  for (const we of wes) {
    await db.sets.where('workoutExerciseId').equals(we.id).delete();
  }
  await db.workoutExercises.where('workoutId').equals(id).delete();
  await db.workouts.delete(id);
}

export async function listWorkouts({ limit } = {}) {
  let items = await db.workouts.orderBy('date').reverse().toArray();
  if (limit) items = items.slice(0, limit);
  return items;
}

export async function getWorkoutExerciseCount(workoutId) {
  return db.workoutExercises.where('workoutId').equals(workoutId).count();
}

// ---------- Ejercicios dentro de un entrenamiento ----------

export async function addExerciseToWorkout(workoutId, exerciseId) {
  const existing = await db.workoutExercises.where('workoutId').equals(workoutId).toArray();
  const order = existing.length;
  const we = { id: newId(), workoutId, exerciseId, order, notes: '' };
  await db.workoutExercises.add(we);
  return we;
}

export async function removeExerciseFromWorkout(workoutExerciseId) {
  await db.sets.where('workoutExerciseId').equals(workoutExerciseId).delete();
  await db.workoutExercises.delete(workoutExerciseId);
}

export async function reorderWorkoutExercise(workoutExerciseId, newOrder) {
  await db.workoutExercises.update(workoutExerciseId, { order: newOrder });
}

// Devuelve los ejercicios de un entrenamiento, ordenados, con sus series incluidas.
export async function getWorkoutDetail(workoutId) {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return null;
  const workoutExercises = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order');
  const result = [];
  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId);
    const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('setNumber');
    result.push({ ...we, exercise, sets });
  }
  return { workout, exercises: result };
}

// Crea un entrenamiento nuevo copiando la estructura (ejercicios, orden y número
// de series) de uno anterior. Los valores (peso/reps/RIR) NO se copian como
// realizados — cada serie nueva se crea vacía; el entrenamiento antiguo no se toca.
export async function repeatWorkout(oldWorkoutId, { name, date }) {
  const detail = await getWorkoutDetail(oldWorkoutId);
  if (!detail) throw new Error('Entrenamiento original no encontrado');

  const workout = await createWorkout({ name, date });
  for (const oldWe of detail.exercises) {
    const we = await addExerciseToWorkout(workout.id, oldWe.exerciseId);
    for (let i = 0; i < oldWe.sets.length; i++) {
      await addSet(we.id, {});
    }
  }
  return workout;
}

// ---------- Series ----------

export async function getSetsForWorkoutExercise(workoutExerciseId) {
  return db.sets.where('workoutExerciseId').equals(workoutExerciseId).sortBy('setNumber');
}

export async function addSet(workoutExerciseId, values = {}) {
  const existing = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray();
  const setNumber = existing.length + 1;
  const set = {
    id: newId(),
    workoutExerciseId,
    setNumber,
    weight: values.weight ?? null,
    reps: values.reps ?? null,
    rir: values.rir ?? null,
    rpe: values.rpe ?? null,
    restSeconds: values.restSeconds ?? null,
    notes: values.notes ?? '',
  };
  await db.sets.add(set);
  return set;
}

export async function updateSet(id, changes) {
  await db.sets.update(id, changes);
}

export async function deleteSet(id) {
  const set = await db.sets.get(id);
  if (!set) return;
  await db.sets.delete(id);
  // Renumerar las series restantes para mantener el orden 1..n
  const remaining = await db.sets.where('workoutExerciseId').equals(set.workoutExerciseId).sortBy('setNumber');
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].setNumber !== i + 1) {
      await db.sets.update(remaining[i].id, { setNumber: i + 1 });
    }
  }
}

// ---------- Consultas de historial / progresión ----------

// Todas las entradas históricas (workout + sets) de un ejercicio, más recientes primero.
// excludeWorkoutId permite ignorar el entrenamiento actual al buscar "la sesión anterior".
export async function getExerciseHistory(exerciseId, { excludeWorkoutId, since } = {}) {
  const workoutExercises = await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray();
  const entries = [];
  for (const we of workoutExercises) {
    if (excludeWorkoutId && we.workoutId === excludeWorkoutId) continue;
    const workout = await db.workouts.get(we.workoutId);
    if (!workout) continue;
    if (since && workout.date < since) continue;
    const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('setNumber');
    entries.push({ workout, workoutExercise: we, sets });
  }
  entries.sort((a, b) => (a.workout.date < b.workout.date ? 1 : -1));
  return entries;
}

export async function getLastSessionForExercise(exerciseId, { excludeWorkoutId } = {}) {
  const history = await getExerciseHistory(exerciseId, { excludeWorkoutId });
  return history[0] ?? null;
}

// ---------- Peso corporal ----------

export async function addBodyWeight({ date, weightKg, notes = '' }) {
  const entry = { id: newId(), date, weightKg, notes };
  await db.bodyWeight.add(entry);
  return entry;
}

export async function updateBodyWeight(id, changes) {
  await db.bodyWeight.update(id, changes);
}

export async function deleteBodyWeight(id) {
  await db.bodyWeight.delete(id);
}

export async function listBodyWeight() {
  return (await db.bodyWeight.orderBy('date').toArray()).reverse();
}

// ---------- Medidas corporales ----------

export async function listMeasurementTypes() {
  return (await db.measurementTypes.toArray()).sort((a, b) => a.order - b.order);
}

export async function createMeasurementType(name) {
  const existing = await db.measurementTypes.toArray();
  const type = { id: newId(), name, order: existing.length };
  await db.measurementTypes.add(type);
  return type;
}

export async function deleteMeasurementType(id) {
  await db.measurements.where('typeId').equals(id).delete();
  await db.measurementTypes.delete(id);
}

export async function addMeasurement({ typeId, date, valueCm, notes = '' }) {
  const entry = { id: newId(), typeId, date, valueCm, notes };
  await db.measurements.add(entry);
  return entry;
}

export async function deleteMeasurement(id) {
  await db.measurements.delete(id);
}

export async function listMeasurementsByType(typeId) {
  return (await db.measurements.where('typeId').equals(typeId).sortBy('date')).reverse();
}

// ---------- Plicómetro ----------

export async function listSkinfoldSites() {
  return (await db.skinfoldSites.toArray()).sort((a, b) => a.order - b.order);
}

export async function createSkinfoldSite(name) {
  const existing = await db.skinfoldSites.toArray();
  const site = { id: newId(), name, order: existing.length };
  await db.skinfoldSites.add(site);
  return site;
}

export async function deleteSkinfoldSite(id) {
  await db.skinfoldEntries.where('siteId').equals(id).delete();
  await db.skinfoldSites.delete(id);
}

export async function addSkinfoldEntry({ siteId, date, valueMm }) {
  const entry = { id: newId(), siteId, date, valueMm };
  await db.skinfoldEntries.add(entry);
  return entry;
}

export async function deleteSkinfoldEntry(id) {
  await db.skinfoldEntries.delete(id);
}

export async function listSkinfoldEntriesBySite(siteId) {
  return db.skinfoldEntries.where('siteId').equals(siteId).sortBy('date');
}

export async function listSkinfoldEntriesByDate() {
  const entries = await db.skinfoldEntries.toArray();
  const byDate = {};
  for (const e of entries) {
    byDate[e.date] = byDate[e.date] || [];
    byDate[e.date].push(e);
  }
  return byDate;
}

// ---------- Configuración ----------

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// ---------- Backup ----------

const TABLES = [
  'exercises', 'workouts', 'workoutExercises', 'sets',
  'bodyWeight', 'measurementTypes', 'measurements',
  'skinfoldSites', 'skinfoldEntries', 'settings',
];

export async function exportAllData() {
  const data = {};
  for (const table of TABLES) {
    data[table] = await db[table].toArray();
  }
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function importAllData(backup) {
  if (!backup || !backup.data) throw new Error('Archivo de backup no válido');
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const table of TABLES) {
      await db[table].clear();
      const rows = backup.data[table];
      if (Array.isArray(rows) && rows.length) {
        await db[table].bulkAdd(rows);
      }
    }
  });
}

export async function clearAllData() {
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const table of TABLES) {
      await db[table].clear();
    }
  });
}
