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

export async function createExercise({ name, muscleGroup = '', notes = '', loadMode = 'total' }) {
  const exercise = {
    id: newId(),
    name: name.trim(),
    muscleGroup,
    notes,
    loadMode,
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

// Agrupa los workouts de un mes por fecha exacta: { 'YYYY-MM-DD': [workout, ...] }.
// month: 0-11. Puede haber varias sesiones el mismo día (segundo entreno).
export async function listWorkoutsByMonth(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const all = await listWorkouts();
  const byDate = {};
  for (const w of all) {
    if (!w.date.startsWith(prefix)) continue;
    (byDate[w.date] ||= []).push(w);
  }
  return byDate;
}

// Nº total de series registradas en entrenamientos cuya fecha cae en [fromISO, toISO].
export async function countSetsInRange(fromISO, toISO) {
  const workouts = (await db.workouts.toArray()).filter((w) => w.date >= fromISO && w.date <= toISO);
  let count = 0;
  for (const w of workouts) {
    const wes = await db.workoutExercises.where('workoutId').equals(w.id).toArray();
    for (const we of wes) {
      count += await db.sets.where('workoutExerciseId').equals(we.id).count();
    }
  }
  return count;
}

// ---------- Ejercicios dentro de un entrenamiento ----------

// targets (opcional): { targetRepsMin, targetRepsMax, targetRir, targetRestSeconds }
// — copia congelada del objetivo de la plantilla en el momento de crear la
// sesión. Editar la plantilla después no cambia estos valores ya copiados.
export async function addExerciseToWorkout(workoutId, exerciseId, targets = {}) {
  const existing = await db.workoutExercises.where('workoutId').equals(workoutId).toArray();
  const order = existing.length;
  const repsMin = targets.targetRepsMin ?? targets.targetReps ?? null;
  const repsMax = targets.targetRepsMax ?? targets.targetReps ?? null;
  const we = {
    id: newId(),
    workoutId,
    exerciseId,
    order,
    notes: '',
    targetReps: repsMax ?? repsMin ?? null,
    targetRepsMin: repsMin,
    targetRepsMax: repsMax,
    targetRir: targets.targetRir ?? null,
    targetRestSeconds: targets.targetRestSeconds ?? null,
  };
  await db.workoutExercises.add(we);
  return we;
}

export async function getWorkoutExercise(id) {
  return db.workoutExercises.get(id);
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

// ---------- Plantillas de entrenamiento (Días/Rutinas) ----------
// Una plantilla define QUÉ ejercicios tiene un día y CUÁNTAS series/objetivos
// se planean. Nunca se modifica al crear o editar sesiones — startWorkoutFromTemplate
// copia sus datos a una sesión nueva e independiente.

export async function listTemplates() {
  const items = await db.templates.toArray();
  return items.sort((a, b) => a.order - b.order);
}

export async function getTemplate(id) {
  return db.templates.get(id);
}

export async function createTemplate({ name, icon }) {
  const existing = await db.templates.toArray();
  const template = {
    id: newId(),
    name: name.trim(),
    icon: icon || 'pierna',
    order: existing.length,
    createdAt: new Date().toISOString(),
  };
  await db.templates.add(template);
  return template;
}

export async function updateTemplate(id, changes) {
  await db.templates.update(id, changes);
}

export async function deleteTemplate(id) {
  const tes = await db.templateExercises.where('templateId').equals(id).toArray();
  await db.templateExercises.bulkDelete(tes.map((t) => t.id));
  await db.templates.delete(id);
}

// Ejercicios de una plantilla, ordenados, con la ficha del ejercicio incluida.
export async function getTemplateExercises(templateId) {
  const items = (await db.templateExercises.where('templateId').equals(templateId).toArray())
    .sort((a, b) => a.order - b.order);
  const result = [];
  for (const te of items) {
    const exercise = await db.exercises.get(te.exerciseId);
    result.push({ ...te, exercise });
  }
  return result;
}

export async function getTemplateSummary(templateId) {
  const items = await db.templateExercises.where('templateId').equals(templateId).toArray();
  return {
    exerciseCount: items.length,
    totalSets: items.reduce((sum, i) => sum + (i.targetSets || 0), 0),
  };
}

// targetRepsMin/targetRepsMax definen el rango objetivo ("8-10 reps"); para una
// cantidad exacta, min===max (ej. "8 reps" -> targetRepsMin=8, targetRepsMax=8).
// targetReps (legado, un solo número) se mantiene en espejo por si algún código
// antiguo lo lee todavía, pero ya no es la fuente de verdad.
export async function addTemplateExercise(templateId, exerciseId, values = {}) {
  const existing = await db.templateExercises.where('templateId').equals(templateId).toArray();
  const repsMin = values.targetRepsMin ?? values.targetReps ?? null;
  const repsMax = values.targetRepsMax ?? values.targetReps ?? null;
  const te = {
    id: newId(),
    templateId,
    exerciseId,
    order: existing.length,
    targetSets: values.targetSets ?? 3,
    targetReps: repsMax ?? repsMin ?? null,
    targetRepsMin: repsMin,
    targetRepsMax: repsMax,
    targetRir: values.targetRir ?? null,
    targetRestSeconds: values.targetRestSeconds ?? null,
    notes: values.notes ?? '',
    defaultSetType: values.defaultSetType ?? 'normal',
    defaultLastSetOnly: values.defaultLastSetOnly ?? false,
    defaultRestPauseExtra: values.defaultRestPauseExtra ?? null,
    defaultDropSteps: values.defaultDropSteps ?? null,
  };
  await db.templateExercises.add(te);
  return te;
}

export async function updateTemplateExercise(id, changes) {
  await db.templateExercises.update(id, changes);
}

export async function removeTemplateExercise(id) {
  await db.templateExercises.delete(id);
}

// direction: -1 (subir) | 1 (bajar)
export async function moveTemplateExercise(templateId, id, direction) {
  const items = await getTemplateExercises(templateId);
  const idx = items.findIndex((i) => i.id === id);
  const swapIdx = idx + direction;
  if (idx === -1 || swapIdx < 0 || swapIdx >= items.length) return;
  const a = items[idx];
  const b = items[swapIdx];
  await db.templateExercises.update(a.id, { order: b.order });
  await db.templateExercises.update(b.id, { order: a.order });
}

export async function getLastWorkoutForTemplate(templateId) {
  const workouts = await db.workouts.where('templateId').equals(templateId).toArray();
  if (!workouts.length) return null;
  return workouts.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

// Crea una sesión nueva a partir de una plantilla: copia ejercicios, orden y
// número de series previsto, y prellena peso/reps con la última sesión de cada
// ejercicio (igual que "+ Añadir serie"). El RIR nunca se prellena. La
// plantilla no se modifica; la sesión creada es completamente independiente.
export async function startWorkoutFromTemplate(templateId, { date }) {
  const template = await getTemplate(templateId);
  if (!template) throw new Error('Plantilla no encontrada');
  const templateExercises = await getTemplateExercises(templateId);

  const workout = await createWorkout({ name: template.name, date });
  await db.workouts.update(workout.id, { templateId });

  for (const te of templateExercises) {
    const we = await addExerciseToWorkout(workout.id, te.exerciseId, {
      targetRepsMin: te.targetRepsMin ?? te.targetReps,
      targetRepsMax: te.targetRepsMax ?? te.targetReps,
      targetRir: te.targetRir,
      targetRestSeconds: te.targetRestSeconds,
    });
    const lastEntry = await getLastSessionForExercise(te.exerciseId);
    const lastSets = lastEntry?.sets ?? [];
    const setCount = Math.max(1, te.targetSets || 1);
    const prefillReps = te.targetRepsMax ?? te.targetRepsMin ?? te.targetReps ?? null;
    const defaultSetType = te.defaultSetType ?? 'normal';
    for (let i = 0; i < setCount; i++) {
      const isLastSet = i === setCount - 1;
      const usesSpecialType = defaultSetType !== 'normal' && (!te.defaultLastSetOnly || isLastSet);
      await addSet(we.id, {
        weight: lastSets[i]?.weight ?? null,
        reps: lastSets[i]?.reps ?? prefillReps,
        type: usesSpecialType ? defaultSetType : 'normal',
        restPauseExtra: usesSpecialType && defaultSetType === 'restpause' ? te.defaultRestPauseExtra : null,
        dropSteps: usesSpecialType && defaultSetType === 'descendente' ? te.defaultDropSteps : null,
      });
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
    weightKgPart: values.weightKgPart ?? null,
    weightLbPart: values.weightLbPart ?? null,
    reps: values.reps ?? null,
    rir: values.rir ?? null,
    rpe: values.rpe ?? null,
    restSeconds: values.restSeconds ?? null,
    notes: values.notes ?? '',
    // Tipo de serie ('normal'|'fallo'|'restpause'|'descendente') y estructura de
    // técnicas especiales — ver core/progression.js:effectiveSetVolume para cómo
    // se interpretan al calcular volumen.
    type: values.type ?? 'normal',
    restPauseExtra: values.restPauseExtra ?? null,
    dropSteps: values.dropSteps ?? null,
    // Desglose de equipamiento (barra+discos / lastre) — aún sin UI, reservado
    // para la fase de equipamiento; weight sigue siendo siempre el total en kg.
    barWeightKg: values.barWeightKg ?? null,
    plateWeightPerSideKg: values.plateWeightPerSideKg ?? null,
    addedWeightKg: values.addedWeightKg ?? null,
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

export async function getFirstBodyWeight() {
  const all = await db.bodyWeight.orderBy('date').toArray();
  return all[0] ?? null;
}

// ---------- Medidas corporales ----------
// Cada tipo puede ser unilateral (value) o bilateral (valueLeft/valueRight).
// "enabled" permite desactivar un tipo sin perder su histórico.

export async function listMeasurementTypes({ includeDisabled = false } = {}) {
  let items = (await db.measurementTypes.toArray()).sort((a, b) => a.order - b.order);
  if (!includeDisabled) items = items.filter((t) => t.enabled !== false);
  return items;
}

export async function getMeasurementType(id) {
  return db.measurementTypes.get(id);
}

export async function createMeasurementType({ name, unit = 'cm', bilateral = false }) {
  const existing = await db.measurementTypes.toArray();
  const type = { id: newId(), name: name.trim(), unit, bilateral, enabled: true, order: existing.length };
  await db.measurementTypes.add(type);
  return type;
}

export async function updateMeasurementType(id, changes) {
  await db.measurementTypes.update(id, changes);
}

export async function setMeasurementTypeEnabled(id, enabled) {
  await db.measurementTypes.update(id, { enabled });
}

export async function deleteMeasurementType(id) {
  await db.measurements.where('typeId').equals(id).delete();
  await db.measurementTypes.delete(id);
}

export async function addMeasurement({ typeId, date, value = null, valueLeft = null, valueRight = null, notes = '' }) {
  const entry = { id: newId(), typeId, date, value, valueLeft, valueRight, notes };
  await db.measurements.add(entry);
  return entry;
}

export async function updateMeasurement(id, changes) {
  await db.measurements.update(id, changes);
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

export async function getSkinfoldSite(id) {
  return db.skinfoldSites.get(id);
}

export async function createSkinfoldSite({ name, instructions = '' }) {
  const existing = await db.skinfoldSites.toArray();
  const site = { id: newId(), name, instructions, order: existing.length };
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
  'templates', 'templateExercises',
];

export async function exportAllData() {
  const data = {};
  for (const table of TABLES) {
    data[table] = await db[table].toArray();
  }
  return {
    schemaVersion: 2,
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

// Importación ADITIVA de progreso (peso/medidas/plicómetro) desde una fuente
// externa (p.ej. una hoja de cálculo) — a diferencia de importAllData, nunca
// borra ni sustituye nada: solo añade filas nuevas, y jamás toca
// entrenamientos, ejercicios o plantillas. Los tipos de medida/puntos de
// pliegue se buscan por nombre y se crean si no existen todavía.
// data: { bodyWeight: [{date, weightKg}], measurements: [{date, type, value?, valueLeft?, valueRight?}], skinfold: [{date, site, valueMm}] }
export async function importProgressData(data) {
  const result = { bodyWeight: 0, measurements: 0, skinfold: 0 };

  for (const entry of data.bodyWeight || []) {
    await addBodyWeight({ date: entry.date, weightKg: entry.weightKg });
    result.bodyWeight++;
  }

  const types = await listMeasurementTypes({ includeDisabled: true });
  const typeByName = new Map(types.map((t) => [t.name, t]));
  for (const entry of data.measurements || []) {
    let type = typeByName.get(entry.type);
    if (!type) {
      const bilateral = entry.valueLeft !== undefined || entry.valueRight !== undefined;
      type = await createMeasurementType({ name: entry.type, unit: 'cm', bilateral });
      typeByName.set(entry.type, type);
    }
    await addMeasurement({
      typeId: type.id,
      date: entry.date,
      value: entry.value ?? null,
      valueLeft: entry.valueLeft ?? null,
      valueRight: entry.valueRight ?? null,
    });
    result.measurements++;
  }

  const sites = await listSkinfoldSites();
  const siteByName = new Map(sites.map((s) => [s.name, s]));
  for (const entry of data.skinfold || []) {
    let site = siteByName.get(entry.site);
    if (!site) {
      site = await createSkinfoldSite({ name: entry.site });
      siteByName.set(entry.site, site);
    }
    await addSkinfoldEntry({ siteId: site.id, date: entry.date, valueMm: entry.valueMm });
    result.skinfold++;
  }

  return result;
}

export async function clearAllData() {
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const table of TABLES) {
      await db[table].clear();
    }
  });
}
