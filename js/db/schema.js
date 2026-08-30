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

// v7: tipo de serie POR DEFECTO a nivel de plantilla — permite que una rutina
// recuerde "Fondos → FALLO" (o rest-pause/descendente con sus bloques) para
// que, cada vez que se empiece esa rutina, las series se creen ya marcadas
// con esa técnica (igual que sets.type, pero como "plan" en vez de dato
// realizado). default 'normal'/null en todo lo existente = comportamiento
// actual intacto.
db.version(7).stores({
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
  await tx.table('templateExercises').toCollection().modify((te) => {
    if (te.defaultSetType === undefined) te.defaultSetType = 'normal';
    if (te.defaultLastSetOnly === undefined) te.defaultLastSetOnly = false;
    if (te.defaultRestPauseExtra === undefined) te.defaultRestPauseExtra = null;
    if (te.defaultDropSteps === undefined) te.defaultDropSteps = null;
  });
});

// v8: barras configurables (Ajustes > Pesos > Barras). Se usan en ejercicios
// marcados como equipmentType='barbell' (sentadilla, peso muerto, press
// banca...) para calcular weight = barra + 2×discos/lado. Tabla nueva; se
// siembran 3 barras por defecto solo si la tabla queda vacía, para no pisar
// nada si el usuario ya tuviera datos aquí por algún motivo.
db.version(8).stores({
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
  bars: 'id, order',
}).upgrade(async (tx) => {
  const count = await tx.table('bars').count();
  if (count === 0) {
    await tx.table('bars').bulkAdd([
      { id: newId(), name: 'Olímpica', weightKg: 20, order: 0 },
      { id: newId(), name: 'EZ', weightKg: 10, order: 1 },
      { id: newId(), name: 'Corta', weightKg: 5, order: 2 },
    ]);
  }
});

// v9: objetivo de repeticiones (y peso) POR SERIE — progresión/pirámide
// (ej. "6/8/10/12") en vez de un único rango uniforme. targetRepsSequence
// (y targetWeightSequence) son un array opcional, uno por serie; cuando
// existen, priman sobre targetRepsMin/Max al crear las series de una nueva
// sesión (ver repository.js:startWorkoutFromTemplate). null en todo lo
// existente = comportamiento actual intacto (rango uniforme).
db.version(9).stores({
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
  bars: 'id, order',
}).upgrade(async (tx) => {
  await tx.table('templateExercises').toCollection().modify((te) => {
    if (te.targetRepsSequence === undefined) te.targetRepsSequence = null;
    if (te.targetWeightSequence === undefined) te.targetWeightSequence = null;
  });
  await tx.table('workoutExercises').toCollection().modify((we) => {
    if (we.targetRepsSequence === undefined) we.targetRepsSequence = null;
    if (we.targetWeightSequence === undefined) we.targetWeightSequence = null;
  });
});

// v10: descripción opcional por rutina + ejercicios favoritos (para el
// selector de ejercicios de la rutina manual: pestañas Favoritos/Recientes).
// "Recientes" no necesita tabla nueva — se deriva de los workouts recientes
// (ver repository.js:getRecentExercises).
db.version(10).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
}).upgrade(async (tx) => {
  await tx.table('exercises').toCollection().modify((e) => {
    if (e.isFavorite === undefined) e.isFavorite = false;
  });
  await tx.table('templates').toCollection().modify((t) => {
    if (t.description === undefined) t.description = '';
  });
});

// v11: texto original de la celda cuando la importación por IA marca un
// ejercicio con confidence baja (ver docs/ai-import-v2-design.md). Permite
// revisar contra la fuente en vez de corregir "a ciegas". null en todo lo
// existente = comportamiento actual intacto.
db.version(11).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
}).upgrade(async (tx) => {
  await tx.table('templateExercises').toCollection().modify((te) => {
    if (te.rawText === undefined) te.rawText = null;
  });
});

// v12: confirmación manual de serie realizada ("done"). Antes, una serie se
// consideraba "hecha" solo por tener weight+reps — pero al empezar una
// rutina esos campos ya vienen prellenados con el histórico, así que
// aparecían como realizadas sin que el usuario hubiera hecho nada todavía.
// Ahora hace falta confirmarlo a mano (tocar el check). Para no perder el
// histórico ya registrado, las series EXISTENTES que ya tenían weight+reps
// se marcan done=true en la migración (son entrenos reales del pasado); las
// que no tenían datos quedan en false, igual que antes.
db.version(12).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
}).upgrade(async (tx) => {
  await tx.table('sets').toCollection().modify((s) => {
    if (s.done === undefined) s.done = s.weight != null && s.reps != null;
  });
});

// v13: sincronización entre dispositivos (Supabase). Dos cambios:
//   1. createdAt/updatedAt en las 11 tablas sincronizables (ver
//      docs/supabase-sync-design.md) — necesarios para poder decidir, ante
//      un conflicto entre dos dispositivos, qué versión de una fila es más
//      reciente. Las que ya tenían alguno de los dos (exercises/templates:
//      createdAt; workouts: ambos) conservan su valor real; el resto se
//      backfillea con la hora de la migración porque no hay forma de saber
//      la fecha real de creación de datos ya existentes — no afecta a nada
//      hoy, y a partir de aquí repository.js mantiene ambos campos al día.
//   2. Tabla nueva `syncQueue`: cola local (outbox) de cambios pendientes de
//      subir a Supabase. Vacía en instalaciones sin cuenta — no se escribe
//      nada aquí si el usuario no ha iniciado sesión.
db.version(13).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
  syncQueue: 'id, status, entity, entityId, [status+createdAt], [entity+entityId]',
}).upgrade(async (tx) => {
  const now = new Date().toISOString();
  const SYNCED_TABLES = [
    'exercises', 'workouts', 'workoutExercises', 'sets',
    'templates', 'templateExercises', 'bodyWeight',
    'measurementTypes', 'measurements', 'skinfoldSites', 'skinfoldEntries',
  ];
  for (const table of SYNCED_TABLES) {
    await tx.table(table).toCollection().modify((row) => {
      if (row.createdAt === undefined) row.createdAt = now;
      if (row.updatedAt === undefined) row.updatedAt = row.createdAt ?? now;
    });
  }
});

// v14: corrige workouts que quedaron apuntando (workout.templateId) a una
// plantilla ya borrada — bug encontrado al depurar por qué la sincronización
// nunca subía ningún entrenamiento: en Supabase template_id es una FK real,
// así que un solo workout con ese id colgante hacía fallar TODO el lote de
// subida de workouts (y en cascada workoutExercises/sets) en cada intento,
// para siempre. deleteTemplate() ya limpia esto de aquí en adelante (ver
// repository.js); esta migración repara los workouts que quedaron así ANTES
// de ese fix. Si el workout ya tenía una entrada pendiente en la cola de
// sync (falló repetidamente con el templateId colgante), se refresca con el
// payload corregido para que el próximo intento tenga éxito en vez de
// repetir el mismo error.
db.version(14).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
  syncQueue: 'id, status, entity, entityId, [status+createdAt], [entity+entityId]',
}).upgrade(async (tx) => {
  const templates = await tx.table('templates').toArray();
  const templateIds = new Set(templates.map((t) => t.id));
  const now = new Date().toISOString();
  const workouts = await tx.table('workouts').toArray();
  for (const w of workouts) {
    if (!w.templateId || templateIds.has(w.templateId)) continue;
    await tx.table('workouts').update(w.id, { templateId: null, updatedAt: now });
    const queued = await tx.table('syncQueue')
      .where('[entity+entityId]').equals(['workouts', w.id])
      .and((q) => q.status === 'pending' || q.status === 'failed')
      .first();
    if (queued) {
      await tx.table('syncQueue').update(queued.id, {
        payload: { ...w, templateId: null, updatedAt: now },
        status: 'pending',
        attempts: 0,
        lastError: null,
      });
    }
  }
});

// v15: mismo problema que v14 pero con exercises — borrar un ejercicio
// (repository.js:deleteExercise) deliberadamente NO borra los workouts/
// plantillas pasados que lo usaron (ver exercise-library.js), pero
// workoutExercises.exerciseId/templateExercises.exerciseId son NOT NULL con
// FK real en Supabase. Una referencia colgante a un ejercicio ya borrado
// bloqueaba para siempre el lote de subida de workoutExercises/
// templateExercises (y en cascada sets). deleteExercise() ya evita esto de
// aquí en adelante subiendo un "stub" tombstoneado en vez de un delete
// simple; esta migración repara las entradas de la cola que ya habían
// fallado así ANTES de ese fix, con el mismo stub (nombre genérico — el
// original ya no existe localmente, se perdió al borrar el ejercicio).
db.version(15).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
  syncQueue: 'id, status, entity, entityId, [status+createdAt], [entity+entityId]',
}).upgrade(async (tx) => {
  const existingIds = new Set((await tx.table('exercises').toArray()).map((e) => e.id));
  const referenced = new Set();
  for (const we of await tx.table('workoutExercises').toArray()) {
    if (we.exerciseId && !existingIds.has(we.exerciseId)) referenced.add(we.exerciseId);
  }
  for (const te of await tx.table('templateExercises').toArray()) {
    if (te.exerciseId && !existingIds.has(te.exerciseId)) referenced.add(te.exerciseId);
  }
  const now = new Date().toISOString();
  for (const id of referenced) {
    const stub = {
      id, name: 'Ejercicio eliminado', muscleGroup: '', notes: '', loadMode: 'total',
      equipmentType: 'other', defaultBarId: null, archived: true, isFavorite: false,
      createdAt: now, updatedAt: now, deletedAt: now,
    };
    const queued = await tx.table('syncQueue')
      .where('[entity+entityId]').equals(['exercises', id])
      .and((q) => q.status === 'pending' || q.status === 'failed')
      .first();
    if (queued) {
      await tx.table('syncQueue').update(queued.id, {
        operation: 'update', payload: stub, status: 'pending', attempts: 0, lastError: null,
      });
    } else {
      await tx.table('syncQueue').add({
        id: newId(), entity: 'exercises', entityId: id, operation: 'update',
        payload: stub, status: 'pending', attempts: 0, createdAt: now,
        lastAttemptAt: null, lastError: null,
      });
    }
  }
});

// v16: las v14/v15 solo resetean el backoff de las entradas de la cola con
// el payload realmente corrupto (templateId/exerciseId colgante) — pero
// TODAS las demás filas que iban en el mismo lote de subida (otros
// workouts, workoutExercises, sets) llevaban fallando junto a ellas desde
// hace tiempo, y ya acumularon reintentos con backoff exponencial (hasta 5
// minutos entre intentos, ver backoffDelayMs en sync.js). Sin esto, tras
// arreglar la causa real, esas filas seguían esperando su turno de forma
// escalonada en vez de subir todas juntas en la siguiente sincronización.
// Reset general: da a TODA la cola pendiente/fallida una oportunidad
// inmediata — no cambia ningún dato, solo el estado de reintento.
db.version(16).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
  syncQueue: 'id, status, entity, entityId, [status+createdAt], [entity+entityId]',
}).upgrade(async (tx) => {
  await tx.table('syncQueue')
    .where('status').anyOf('pending', 'failed')
    .modify((row) => {
      row.status = 'pending';
      row.attempts = 0;
      row.lastAttemptAt = null;
      row.lastError = null;
    });
});

// v17: módulo de Nutrición + relación entrenador-cliente (Pegasus Nutrition).
// dietPlans/dietMeals/dietFoods/nutritionMacroTargets son el espejo local de
// las tablas nuevas en supabase/migrations/002_nutrition_trainer_link.sql —
// una fila con assignedToClientId no nulo es de solo lectura para este
// usuario (ver repository.js#isReadOnlyForMe). userPreferences es la única
// pieza de Ajustes que viaja con la cuenta (hoy: toggles de Nutrición en
// Personalizar) — el resto de `settings` sigue siendo local por dispositivo.
// trainer_links NO se espeja aquí a propósito: vincular cuentas exige estar
// online, se consulta en vivo (ver js/core/trainer-link.js).
db.version(17).stores({
  exercises: 'id, name, muscleGroup, archived, isFavorite',
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
  bars: 'id, order',
  syncQueue: 'id, status, entity, entityId, [status+createdAt], [entity+entityId]',
  dietPlans: 'id, effectiveDate',
  dietMeals: 'id, dietPlanId, [dietPlanId+order]',
  dietFoods: 'id, mealId, [mealId+order]',
  nutritionMacroTargets: 'id, effectiveDate',
  userPreferences: 'id, key',
});

export const SCHEMA_VERSION = 17;

// Tablas cuyas filas se sincronizan con Supabase cuando hay sesión activa —
// ver docs/supabase-sync-design.md para la decisión de alcance (exercises/
// measurementTypes/skinfoldSites se incluyen aunque el prompt original no
// las mencionara explícitamente, porque templates/measurements/skinfold
// dependen de ellas por FK; bars y settings quedan fuera, son locales al
// dispositivo/gimnasio).
export const SYNCED_TABLES = [
  'exercises', 'workouts', 'workoutExercises', 'sets',
  'templates', 'templateExercises', 'bodyWeight',
  'measurementTypes', 'measurements', 'skinfoldSites', 'skinfoldEntries',
  'dietPlans', 'dietMeals', 'dietFoods', 'nutritionMacroTargets', 'userPreferences',
];

export function newId() {
  return crypto.randomUUID();
}
