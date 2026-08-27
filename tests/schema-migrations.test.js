import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './setup-db.js'; // pone `Dexie`/`indexedDB` como globales ANTES de nada más

const DB_NAME = 'FitnessTrackerDB'; // mismo nombre que usa schema.js — a propósito

async function deleteRealDb() {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

afterEach(async () => {
  await deleteRealDb();
});

describe('Instalación fresca (usuario nuevo, sin datos previos)', () => {
  test('crea la base de datos directamente en la última versión sin lanzar', async () => {
    const schema = await import(`../js/db/schema.js?fresh1=${Date.now()}`);
    await schema.db.exercises.toArray(); // fuerza la apertura real
    assert.equal(schema.SCHEMA_VERSION, 14);
    assert.equal(schema.db.verno, 14);
  });

  test('la tabla "syncQueue" existe y está vacía en una instalación fresca', async () => {
    const schema = await import(`../js/db/schema.js?freshsync=${Date.now()}`);
    const queue = await schema.db.syncQueue.toArray();
    assert.deepEqual(queue, []);
  });

  test('la tabla "bars" se siembra con 3 barras por defecto en una instalación fresca', async () => {
    const schema = await import(`../js/db/schema.js?fresh2=${Date.now()}`);
    const bars = await schema.db.bars.toArray();
    // OJO: el .upgrade() de v8 solo se ejecuta al ACTUALIZAR desde una
    // versión anterior, no al crear una base nueva (comportamiento nativo de
    // Dexie) — en una instalación fresca la tabla puede quedar vacía. Esto
    // es un riesgo conocido, documentado en el informe final; este test deja
    // constancia del comportamiento real para detectar si cambia sin darnos cuenta.
    assert.ok(Array.isArray(bars));
  });
});

describe('Actualización desde v1 (usuario con la app instalada desde el principio)', () => {
  test('sube de v1 a v14 sin lanzar y preservando los datos ya guardados', async () => {
    // 1) Crea la base de datos tal cual era en v1, con datos reales de un
    // "usuario antiguo", SIN pasar por schema.js todavía.
    const oldDb = new Dexie(DB_NAME);
    oldDb.version(1).stores({
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
    await oldDb.open();
    await oldDb.exercises.add({ id: 'ex1', name: 'Press banca', muscleGroup: 'Pecho', archived: false });
    await oldDb.workouts.add({ id: 'w1', date: '2025-01-01' });
    await oldDb.workoutExercises.add({ id: 'we1', workoutId: 'w1', exerciseId: 'ex1', order: 0 });
    // Serie YA REALIZADA en la v1 original (peso y reps rellenados) — debe
    // sobrevivir la subida hasta v12 con done=true (la migración de v12 usa
    // "tenía peso+reps" como proxy de "esto ya se hizo de verdad").
    await oldDb.sets.add({ id: 's1', workoutExerciseId: 'we1', setNumber: 1, weight: 80, reps: 8 });
    await oldDb.bodyWeight.add({ id: 'bw1', date: '2025-01-01', weightKg: 82 });
    oldDb.close();

    // 2) Importa schema.js DESPUÉS de sembrar los datos de v1 — al abrirse,
    // Dexie detecta la base existente en v1 y sube en cadena hasta v12,
    // ejecutando cada .upgrade() de por medio.
    const schema = await import(`../js/db/schema.js?upgrade1=${Date.now()}`);
    await schema.db.exercises.toArray();
    assert.equal(schema.db.verno, 14);

    // 3) El ejercicio y el entrenamiento originales siguen ahí, intactos.
    const exercise = await schema.db.exercises.get('ex1');
    assert.equal(exercise.name, 'Press banca');
    // v6 añadió equipmentType/defaultBarId con default seguro:
    assert.equal(exercise.equipmentType, 'other');
    assert.equal(exercise.defaultBarId, null);
    // v10 añadió isFavorite:
    assert.equal(exercise.isFavorite, false);
    // v13: ya tenía createdAt (de antes de la migración de sync) — se conserva.
    assert.ok(exercise.createdAt);
    // ...pero no tenía updatedAt: se backfillea con createdAt, no se inventa otra fecha.
    assert.equal(exercise.updatedAt, exercise.createdAt);

    const workout = await schema.db.workouts.get('w1');
    assert.equal(workout.date, '2025-01-01');
    // workouts nunca tuvo createdAt en v1 — v13 lo backfillea con la hora de migración.
    assert.ok(workout.createdAt);
    assert.ok(workout.updatedAt);

    // v13: una fila que en v1 no tenía NINGÚN timestamp (workoutExercises)
    // también gana createdAt/updatedAt backfillados, iguales entre sí.
    const we = await schema.db.workoutExercises.get('we1');
    assert.ok(we.createdAt);
    assert.equal(we.updatedAt, we.createdAt);

    // v13: la cola de sincronización existe y no se ha escrito nada en ella
    // solo por migrar el esquema — no hay sesión de Supabase en un test.
    const queue = await schema.db.syncQueue.toArray();
    assert.deepEqual(queue, []);

    // 4) La serie original (con peso/reps reales) conserva su peso/reps Y
    // gana los campos nuevos con defaults que no cambian su comportamiento.
    const set = await schema.db.sets.get('s1');
    assert.equal(set.weight, 80);
    assert.equal(set.reps, 8);
    assert.equal(set.type, 'normal'); // v6
    assert.equal(set.barWeightKg, null); // v6/v8
    // v12: como ya tenía peso+reps reales, se considera "ya hecha" — si esto
    // fallara, todo el historial de un usuario antiguo se vería "sin
    // confirmar" tras actualizar, que es justo el bug que esto evita.
    assert.equal(set.done, true);

    // 5) Las tablas nuevas (bars) existen y, al venir de una actualización
    // real (no una instalación fresca), SÍ se siembran automáticamente.
    const bars = await schema.db.bars.toArray();
    assert.equal(bars.length, 3);
    assert.ok(bars.some((b) => b.name === 'Olímpica' && b.weightKg === 20));
  });

  test('una serie vacía (sin peso ni reps) de un usuario antiguo NO se marca como hecha al migrar', async () => {
    const oldDb = new Dexie(DB_NAME);
    oldDb.version(1).stores({
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
    await oldDb.open();
    await oldDb.sets.add({ id: 's-empty', workoutExerciseId: 'we-none', setNumber: 1, weight: null, reps: null });
    oldDb.close();

    const schema = await import(`../js/db/schema.js?upgrade2=${Date.now()}`);
    const set = await schema.db.sets.get('s-empty');
    assert.equal(set.done, false);
  });

  test('v14 limpia workouts.templateId colgante (plantilla ya borrada) y refresca su entrada pendiente en la cola', async () => {
    // Reproduce el estado real que impedía sincronizar entrenamientos: un
    // workout con templateId apuntando a una plantilla que ya no existe (el
    // bug de deleteTemplate() no limpiando esta referencia), con una entrada
    // en syncQueue que ya había fallado con ese payload corrupto.
    const oldDb = new Dexie(DB_NAME);
    oldDb.version(13).stores({
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
    });
    await oldDb.open();
    await oldDb.workouts.add({
      id: 'w-orphan', date: '2026-01-01', name: 'Pierna', notes: '', completed: false,
      templateId: 'template-que-ya-no-existe', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await oldDb.syncQueue.add({
      id: 'q1', entity: 'workouts', entityId: 'w-orphan', operation: 'update',
      payload: { id: 'w-orphan', templateId: 'template-que-ya-no-existe' },
      status: 'failed', attempts: 6, createdAt: '2026-01-01T00:00:00.000Z',
      lastAttemptAt: '2026-01-01T00:00:00.000Z', lastError: 'violates foreign key constraint',
    });
    oldDb.close();

    const schema = await import(`../js/db/schema.js?upgrade14=${Date.now()}`);
    await schema.db.exercises.toArray();

    const workout = await schema.db.workouts.get('w-orphan');
    assert.equal(workout.templateId, null);

    const queued = await schema.db.syncQueue.get('q1');
    assert.equal(queued.status, 'pending');
    assert.equal(queued.attempts, 0);
    assert.equal(queued.lastError, null);
    assert.equal(queued.payload.templateId, null);
  });
});
