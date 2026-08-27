// Motor de sincronización (js/core/sync.js) — probado contra un Supabase
// simulado en memoria (sin red real), siguiendo el mismo patrón de
// fake-indexeddb que el resto de la suite. No prueba Row Level Security en
// sí (eso solo se puede verificar contra un proyecto Supabase real, ver
// docs/supabase-sync-design.md "Tests"), pero sí toda la lógica del cliente:
// cola/compactación, subida, bajada, cascada de borrados, reintentos y
// resolución de conflictos.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './setup-db.js';
import { db } from '../js/db/schema.js';
import * as repo from '../js/db/repository.js';
import * as clientMod from '../js/core/supabase-client.js';
import * as settings from '../js/core/settings.js';
import * as sync from '../js/core/sync.js';

// ---------- Supabase simulado ----------
// Un Map por tabla en memoria; upsert/select/update.in con la misma forma que
// supabase-js. `failNextUpsertFor(table)` permite simular un fallo de red
// puntual para probar reintentos/backoff sin depender de tiempos reales.
function makeFakeSupabase() {
  const tables = {};
  // Basado en el reloj real (no en una fecha fija) para que sea comparable
  // con los watermarks que sync.js captura con `new Date().toISOString()`.
  let counter = 0;
  const tick = () => new Date(Date.now() + (counter++) * 1000).toISOString();
  const failingOnce = new Set();
  const failingAlways = new Set();

  function from(table) {
    tables[table] ||= new Map();
    const store = tables[table];
    return {
      upsert(rows) {
        if (failingAlways.has(table)) {
          return Promise.resolve({ error: new Error('fallo simulado de red (persistente)') });
        }
        if (failingOnce.has(table)) {
          failingOnce.delete(table);
          return Promise.resolve({ error: new Error('fallo simulado de red') });
        }
        for (const r of rows) {
          const existing = store.get(r.id);
          store.set(r.id, { ...existing, ...r, created_at: existing?.created_at || tick(), updated_at: tick() });
        }
        return Promise.resolve({ error: null });
      },
      select() {
        let filtered = [...store.values()];
        const api = {
          order() { return api; },
          gt(col, val) {
            filtered = filtered.filter((r) => r[col] > val);
            return Promise.resolve({ data: filtered, error: null });
          },
          then(resolve) { resolve({ data: filtered, error: null }); },
        };
        return api;
      },
      update(patch) {
        return {
          in(col, ids) {
            for (const id of ids) {
              const row = store.get(id);
              if (row) store.set(id, { ...row, ...patch, updated_at: tick() });
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }

  return {
    from,
    tables,
    failNextUpsertFor: (table) => failingOnce.add(table),
    failAllUpsertsFor: (table) => failingAlways.add(table),
    allowUpsertsFor: (table) => failingAlways.delete(table),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'a@b.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}

let fakeSupabase;

beforeEach(async () => {
  await db.exercises.toArray();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await settings.loadSettingsCache();
  repo.setSyncActive(false);

  fakeSupabase = makeFakeSupabase();
  globalThis.window = { supabase: { createClient: () => fakeSupabase } };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, writable: true, configurable: true });
  clientMod.configureSupabase('https://fake.supabase.co', 'fake-anon-key');
});

describe('Cola de sincronización (outbox) — compactación', () => {
  test('varias ediciones antes de sincronizar colapsan en una sola entrada', async () => {
    repo.setSyncActive(true);
    const ex = await repo.createExercise({ name: 'Sentadilla' });
    await repo.updateExercise(ex.id, { notes: 'a' });
    await repo.updateExercise(ex.id, { notes: 'b' });

    const queue = await db.syncQueue.toArray();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].operation, 'create'); // nunca subió -> sigue siendo un "create"
    assert.equal(queue[0].payload.notes, 'b');
  });

  test('crear y borrar algo que nunca llegó a subirse no deja rastro en la cola', async () => {
    repo.setSyncActive(true);
    const ex = await repo.createExercise({ name: 'Temporal' });
    await repo.deleteExercise(ex.id);
    assert.equal((await db.syncQueue.toArray()).length, 0);
  });

  test('en modo local (sin sesión) no se escribe nada en la cola', async () => {
    repo.setSyncActive(false);
    await repo.createExercise({ name: 'Local' });
    assert.equal((await db.syncQueue.toArray()).length, 0);
  });
});

describe('Borrado en cascada — cada fila afectada recibe su propio tombstone', () => {
  test('borrar un workout encola el delete del workout, sus workoutExercises y sus sets', async () => {
    repo.setSyncActive(true);
    const ex = await repo.createExercise({ name: 'Press banca' });
    const w = await repo.createWorkout({ date: '2026-01-01' });
    const we = await repo.addExerciseToWorkout(w.id, ex.id);
    await repo.addSet(we.id, { weight: 100, reps: 5 });

    await sync.syncNow({ manual: true }); // sube todo, vacía la cola
    await repo.deleteWorkout(w.id);

    const queue = await db.syncQueue.toArray();
    const byEntity = Object.fromEntries(queue.map((q) => [q.entity, q.operation]));
    assert.equal(byEntity.workouts, 'delete');
    assert.equal(byEntity.workoutExercises, 'delete');
    assert.equal(byEntity.sets, 'delete');
  });

  test('borrar un ejercicio todavía usado por un workout pasado se sube tombstoneado (upsert), no como delete simple', async () => {
    repo.setSyncActive(true);
    const ex = await repo.createExercise({ name: 'Sentadilla' });
    const w = await repo.createWorkout({ date: '2026-01-01' });
    await repo.addExerciseToWorkout(w.id, ex.id);
    await sync.syncNow({ manual: true }); // sube todo, vacía la cola

    await repo.deleteExercise(ex.id);

    const queue = await db.syncQueue.toArray();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].entity, 'exercises');
    assert.equal(queue[0].operation, 'update'); // no 'delete': hace falta que la fila EXISTA en remoto para el FK
    assert.ok(queue[0].payload.deletedAt);

    await sync.syncNow({ manual: true });
    const remote = fakeSupabase.tables.exercises.get(ex.id);
    assert.ok(remote.deleted_at); // la fila remota existe, tombstoneada — el FK de workoutExercises sigue satisfecho
  });

  test('borrar un ejercicio que ya no usa ningún workout se sube como delete simple', async () => {
    repo.setSyncActive(true);
    const ex = await repo.createExercise({ name: 'Ejercicio sin usar' });
    await sync.syncNow({ manual: true });

    await repo.deleteExercise(ex.id);

    const queue = await db.syncQueue.toArray();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].operation, 'delete');
  });
});

describe('syncNow — subida y bajada contra el Supabase simulado', () => {
  test('sube lo pendiente y vacía la cola local', async () => {
    repo.setSyncActive(true);
    await repo.createExercise({ name: 'Dominadas' });
    await sync.syncNow({ manual: true });

    assert.equal((await db.syncQueue.toArray()).length, 0);
    assert.equal(fakeSupabase.tables.exercises.size, 1);
    assert.equal(sync.getSyncStatus().state, 'idle');
  });

  test('un dispositivo nuevo (IndexedDB vacía) recibe los datos ya subidos por otro', async () => {
    repo.setSyncActive(true);
    await repo.createExercise({ name: 'Peso muerto' });
    await sync.syncNow({ manual: true });

    // "Dispositivo B": misma cuenta/remoto, IndexedDB local vacía de nuevo.
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear();
    });
    await settings.loadSettingsCache();
    repo.setSyncActive(true);
    await sync.syncNow({ manual: true });

    const local = await db.exercises.toArray();
    assert.equal(local.length, 1);
    assert.equal(local[0].name, 'Peso muerto');
  });

  test('un borrado ya sincronizado en el remoto se aplica localmente en otro dispositivo (tombstone)', async () => {
    repo.setSyncActive(true);
    const w = await repo.createWorkout({ date: '2026-02-01' });
    await sync.syncNow({ manual: true });
    await repo.deleteWorkout(w.id);
    await sync.syncNow({ manual: true });

    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear();
    });
    await settings.loadSettingsCache();
    repo.setSyncActive(true);
    await sync.syncNow({ manual: true });

    assert.equal((await db.workouts.toArray()).length, 0);
  });

  test('sin conexión no intenta subir nada y deja el estado en "pending"', async () => {
    repo.setSyncActive(true);
    await repo.createExercise({ name: 'Offline' });
    globalThis.navigator.onLine = false;
    await sync.syncNow({ manual: true });
    globalThis.navigator.onLine = true;

    assert.equal(sync.getSyncStatus().state, 'pending');
    assert.equal((await db.syncQueue.toArray()).length, 1); // sigue pendiente, no se pierde
  });
});

describe('Reintentos / backoff', () => {
  test('un fallo de subida incrementa attempts y guarda lastError sin borrar la fila de la cola', async () => {
    repo.setSyncActive(true);
    await repo.createExercise({ name: 'Falla la primera vez' });
    fakeSupabase.failNextUpsertFor('exercises');

    await sync.syncNow({ manual: true });

    const queue = await db.syncQueue.toArray();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].attempts, 1);
    assert.ok(queue[0].lastError);
    assert.equal(queue[0].status, 'pending'); // por debajo del máximo de intentos, se reintenta más tarde
  });

  test('una fila con backoff activo no se reintenta antes de tiempo', async () => {
    repo.setSyncActive(true);
    await repo.createExercise({ name: 'Con backoff' });
    fakeSupabase.failNextUpsertFor('exercises');
    await sync.syncNow({ manual: true }); // 1er intento, falla -> backoff programado

    await sync.syncNow({ manual: true }); // inmediatamente después: todavía en backoff
    assert.equal(fakeSupabase.tables.exercises?.size ?? 0, 0); // no se reintentó de verdad
  });
});

describe('Resolución de conflictos', () => {
  test('un cambio local pendiente sin subir, más reciente que lo que llega del remoto, no se pisa', async () => {
    repo.setSyncActive(true);
    const ex = await repo.createExercise({ name: 'Original' });
    await sync.syncNow({ manual: true }); // sube el create con éxito
    const watermark = Date.parse(sync.getSyncStatus().lastSyncedAt);

    // La subida de esta edición fallará SIEMPRE (simula que este dispositivo
    // no ha podido conectar), así que el cambio se queda pendiente en la cola.
    fakeSupabase.failAllUpsertsFor('exercises');
    await repo.updateExercise(ex.id, { name: 'Editado local (pendiente, más reciente)' });

    // Mientras tanto, "otro dispositivo" ya subió una versión — más nueva que
    // el watermark (así que este ciclo la descargará) pero más VIEJA que el
    // cambio local todavía pendiente.
    const remoteRow = fakeSupabase.tables.exercises.get(ex.id);
    remoteRow.name = 'Versión de otro dispositivo (más vieja que el pendiente local)';
    remoteRow.updated_at = new Date(watermark + 1000).toISOString();
    await db.syncQueue.toCollection().modify((q) => {
      q.payload.updatedAt = new Date(watermark + 5000).toISOString();
    });

    await sync.syncNow({ manual: true }); // sube (falla) y baja (encuentra la fila "de otro dispositivo")

    const local = await db.exercises.get(ex.id);
    assert.equal(local.name, 'Editado local (pendiente, más reciente)');
    // El cambio local sigue en la cola, listo para subir en cuanto la red vuelva.
    assert.equal((await db.syncQueue.toArray()).length, 1);

    fakeSupabase.allowUpsertsFor('exercises');
  });

  test('sin ningún cambio local pendiente, sí se aplica lo que llega del remoto', async () => {
    repo.setSyncActive(true);
    const ex = await repo.createExercise({ name: 'Original' });
    await sync.syncNow({ manual: true });

    const remoteRow = fakeSupabase.tables.exercises.get(ex.id);
    remoteRow.name = 'Editado en otro dispositivo';
    remoteRow.updated_at = new Date(Date.now() + 60_000).toISOString();

    await sync.syncNow({ manual: true });

    const local = await db.exercises.get(ex.id);
    assert.equal(local.name, 'Editado en otro dispositivo');
  });
});

describe('Migración de datos locales al crear/iniciar sesión', () => {
  test('migrateLocalDataToAccount encola y sube TODAS las filas existentes sin borrar IndexedDB', async () => {
    // Datos creados ANTES de tener sesión (modo local puro).
    const ex = await repo.createExercise({ name: 'Ya existía antes de la cuenta' });
    const w = await repo.createWorkout({ date: '2026-03-01' });

    await sync.migrateLocalDataToAccount();

    assert.equal((await db.syncQueue.toArray()).length, 0); // ya se subió todo
    assert.ok(fakeSupabase.tables.exercises.has(ex.id));
    assert.ok(fakeSupabase.tables.workouts.has(w.id));
    // Los datos locales siguen intactos — la migración es aditiva, nunca destructiva.
    assert.ok(await db.exercises.get(ex.id));
    assert.ok(await db.workouts.get(w.id));
    assert.equal(settings.isLocalDataMigrated(), true);
  });

  test('migrateLocalDataToAccount sube un stub tombstoneado para ejercicios ya borrados pero aún referenciados', async () => {
    // Un ejercicio borrado (deleteExercise) deliberadamente no borra los
    // workoutExercises/templateExercises pasados que lo usaron — simula ese
    // estado directamente, sin pasar por deleteExercise.
    const w = await repo.createWorkout({ date: '2026-03-01' });
    await db.workoutExercises.add({ id: 'we-orphan', workoutId: w.id, exerciseId: 'ex-ya-borrado', order: 0 });

    await sync.migrateLocalDataToAccount();

    const stub = fakeSupabase.tables.exercises.get('ex-ya-borrado');
    assert.ok(stub, 'debe subirse un stub para satisfacer la FK remota de exercise_id');
    assert.ok(stub.deleted_at);
    assert.equal(await db.exercises.get('ex-ya-borrado'), undefined); // sigue sin existir localmente
    assert.ok(fakeSupabase.tables.workout_exercises.has('we-orphan')); // y ahora SÍ pudo subir
  });
});
