// Motor de sincronización cloud (Supabase) — capa ENCIMA de Dexie/
// IndexedDB, nunca un sustituto. Ninguna escritura de usuario depende de
// esto: repository.js ya completa cada operación 100% en local antes de
// devolver el control (ver js/db/repository.js). Este módulo solo drena la
// cola local (`syncQueue`, el "outbox") hacia Supabase y aplica cambios
// remotos entrantes, en segundo plano, sin bloquear la UI.
//
// Ver docs/supabase-sync-design.md para el diseño completo.
import { db, SYNCED_TABLES } from '../db/schema.js';
import * as repo from '../db/repository.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client.js';
import { getSession, onAuthStateChange } from './auth.js';
import * as settings from './settings.js';
import { getDeviceId } from './device.js';
import { on, emit } from './store.js';

export { isSupabaseConfigured };

// Orden de dependencia (FK) para subir/bajar: las tablas "de referencia" van
// primero, luego lo que depende de ellas. Necesario porque Supabase rechaza
// un INSERT cuya fila padre todavía no existe, y al aplicar una descarga
// remota localmente queremos que un workoutExercise nunca llegue antes que
// su workout.
const SYNC_ORDER = [
  'exercises', 'measurementTypes', 'skinfoldSites', 'templates', 'bodyWeight',
  'workouts', 'templateExercises', 'workoutExercises', 'measurements',
  'skinfoldEntries', 'sets',
];

const TABLE_TO_SQL = {
  exercises: 'exercises',
  workouts: 'workouts',
  workoutExercises: 'workout_exercises',
  sets: 'sets',
  templates: 'templates',
  templateExercises: 'template_exercises',
  bodyWeight: 'body_weight',
  measurementTypes: 'measurement_types',
  measurements: 'measurements',
  skinfoldSites: 'skinfold_sites',
  skinfoldEntries: 'skinfold_entries',
};

// Solo hace falta listar los campos que NO son "una palabra" (donde
// camelCase y snake_case coinciden, ej. name/date/weight/reps/archived) —
// ver camelToSnake/snakeToCamel más abajo para el resto.
const FIELD_MAPS = {
  exercises: { muscleGroup: 'muscle_group', loadMode: 'load_mode', equipmentType: 'equipment_type', defaultBarId: 'default_bar_id', isFavorite: 'is_favorite' },
  workouts: { templateId: 'template_id' },
  workoutExercises: {
    workoutId: 'workout_id', exerciseId: 'exercise_id', order: 'sort_order',
    targetReps: 'target_reps', targetRepsMin: 'target_reps_min', targetRepsMax: 'target_reps_max',
    targetRir: 'target_rir', targetRestSeconds: 'target_rest_seconds',
    targetRepsSequence: 'target_reps_sequence', targetWeightSequence: 'target_weight_sequence',
  },
  sets: {
    workoutExerciseId: 'workout_exercise_id', setNumber: 'set_number',
    weightKgPart: 'weight_kg_part', weightLbPart: 'weight_lb_part', restSeconds: 'rest_seconds',
    restPauseExtra: 'rest_pause_extra', dropSteps: 'drop_steps', barWeightKg: 'bar_weight_kg',
    plateWeightPerSideKg: 'plate_weight_per_side_kg', addedWeightKg: 'added_weight_kg',
  },
  templates: { order: 'sort_order' },
  templateExercises: {
    templateId: 'template_id', exerciseId: 'exercise_id', order: 'sort_order',
    targetSets: 'target_sets', targetReps: 'target_reps', targetRepsMin: 'target_reps_min',
    targetRepsMax: 'target_reps_max', targetRir: 'target_rir', targetRestSeconds: 'target_rest_seconds',
    targetRepsSequence: 'target_reps_sequence', targetWeightSequence: 'target_weight_sequence',
    defaultSetType: 'default_set_type', defaultLastSetOnly: 'default_last_set_only',
    defaultRestPauseExtra: 'default_rest_pause_extra', defaultDropSteps: 'default_drop_steps',
    rawText: 'raw_text',
  },
  bodyWeight: { weightKg: 'weight_kg' },
  measurementTypes: { order: 'sort_order' },
  measurements: { typeId: 'type_id', valueLeft: 'value_left', valueRight: 'value_right' },
  skinfoldSites: { order: 'sort_order' },
  skinfoldEntries: { siteId: 'site_id', valueMm: 'value_mm' },
};

function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}
function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// createdAt/updatedAt NUNCA se envían — los asigna el trigger de Postgres
// (ver supabase/schema.sql), no el reloj del cliente.
function toRemoteRow(table, row) {
  const map = FIELD_MAPS[table] || {};
  const out = { device_id: getDeviceId() };
  for (const [key, value] of Object.entries(row)) {
    if (key === 'createdAt' || key === 'updatedAt') continue;
    out[map[key] || camelToSnake(key)] = value;
  }
  return out;
}

function fromRemoteRow(table, row) {
  const map = FIELD_MAPS[table] || {};
  const reverse = {};
  for (const [k, v] of Object.entries(map)) reverse[v] = k;
  const out = {};
  for (const [col, value] of Object.entries(row)) {
    if (col === 'user_id' || col === 'device_id' || col === 'deleted_at') continue;
    out[reverse[col] || snakeToCamel(col)] = value;
  }
  return out;
}

// ---------- Estado / estado observable ----------

const MAX_ATTEMPTS = 6;

let status = { state: 'idle', lastSyncedAt: null, pendingCount: 0, lastError: null };
function setStatus(patch) {
  status = { ...status, ...patch };
  emit('sync:status', status);
}
export function getSyncStatus() {
  return status;
}

async function refreshPendingCount() {
  const pendingCount = await db.syncQueue.where('status').anyOf('pending', 'failed').count();
  setStatus({ pendingCount });
  return pendingCount;
}

function backoffDelayMs(attempts) {
  return Math.min(2 ** attempts * 5000, 5 * 60 * 1000);
}

function isEligibleNow(row, now) {
  if (!row.lastAttemptAt) return true;
  return now - new Date(row.lastAttemptAt).getTime() >= backoffDelayMs(row.attempts);
}

// ---------- Subida ----------

async function markUploadResult(rows, error) {
  if (!error) {
    // Una vez subida con éxito, la entrada no aporta nada más — se borra en
    // vez de arrastrarla marcada "synced" para siempre (menos ruido en la cola).
    await db.syncQueue.bulkDelete(rows.map((r) => r.id));
    return;
  }
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    const attempts = row.attempts + 1;
    await db.syncQueue.update(row.id, {
      attempts,
      lastAttemptAt: nowIso,
      lastError: String(error.message ?? error),
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    });
  }
}

async function uploadPending() {
  const supabase = getSupabaseClient();
  const all = await db.syncQueue.where('status').anyOf('pending', 'failed').toArray();
  const now = Date.now();
  const eligible = all.filter((row) => isEligibleNow(row, now));

  const byEntity = {};
  for (const row of eligible) (byEntity[row.entity] ||= []).push(row);

  for (const entity of SYNC_ORDER) {
    const rows = byEntity[entity];
    if (!rows?.length) continue;
    const sqlTable = TABLE_TO_SQL[entity];

    // create+update se tratan igual: el payload SIEMPRE es la fila completa,
    // así que un upsert por id sirve para ambos casos sin distinguirlos.
    const upserts = rows.filter((r) => r.operation !== 'delete');
    if (upserts.length) {
      const payload = upserts.map((r) => toRemoteRow(entity, r.payload));
      const { error } = await supabase.from(sqlTable).upsert(payload);
      await markUploadResult(upserts, error);
    }

    const deletes = rows.filter((r) => r.operation === 'delete');
    if (deletes.length) {
      const ids = deletes.map((r) => r.entityId);
      const { error } = await supabase.from(sqlTable).update({ deleted_at: new Date().toISOString() }).in('id', ids);
      await markUploadResult(deletes, error);
    }
  }
}

// ---------- Descarga ----------

// Si esta fila tiene un cambio local todavía sin subir (falló repetidamente,
// por ejemplo), gana quien tenga el updatedAt más reciente — nunca "el
// último que llegó" a ciegas. En el caso normal (sin fallos) esto no se
// activa nunca: la subida de este mismo ciclo ya ocurrió ANTES que esta
// descarga, así que un dispositivo no se pisa nunca a sí mismo.
async function shouldSkipForLocalConflict(entity, remoteRow, remoteUpdatedAt) {
  const pending = await db.syncQueue
    .where('[entity+entityId]').equals([entity, remoteRow.id])
    .and((q) => q.status === 'pending' || q.status === 'failed')
    .first();
  if (!pending?.payload?.updatedAt) return false;
  return pending.payload.updatedAt > remoteUpdatedAt;
}

async function applyRemoteRow(entity, remoteRow) {
  if (remoteRow.deleted_at) {
    if (await shouldSkipForLocalConflict(entity, remoteRow, remoteRow.deleted_at)) return;
    await db[entity].delete(remoteRow.id);
    emit('sync:dataChanged', { entity, id: remoteRow.id, deleted: true });
    return;
  }
  if (await shouldSkipForLocalConflict(entity, remoteRow, remoteRow.updated_at)) return;
  const local = fromRemoteRow(entity, remoteRow);
  await db[entity].put(local);
  emit('sync:dataChanged', { entity, id: remoteRow.id, deleted: false });
}

async function downloadRemote(watermark) {
  const supabase = getSupabaseClient();
  for (const entity of SYNC_ORDER) {
    const sqlTable = TABLE_TO_SQL[entity];
    let query = supabase.from(sqlTable).select('*').order('updated_at', { ascending: true });
    if (watermark) query = query.gt('updated_at', watermark);
    const { data, error } = await query;
    if (error) throw error;
    for (const remoteRow of data || []) {
      await applyRemoteRow(entity, remoteRow);
    }
  }
}

// ---------- Orquestación ----------

let syncing = false;

export async function syncNow({ manual = false } = {}) {
  if (!isSupabaseConfigured()) return;
  const session = await getSession();
  if (!session) return;
  if (!navigator.onLine) {
    await refreshPendingCount();
    setStatus({ state: 'pending' });
    return;
  }
  if (syncing) return;
  syncing = true;
  setStatus({ state: 'syncing', lastError: null });
  try {
    await uploadPending();
    // Capturado ANTES de descargar: si algo se confirma en el servidor
    // mientras esta descarga está en vuelo, el próximo ciclo lo recoge —
    // mejor repetir una fila de más que perder una por el margen de carrera.
    const pullStartedAt = new Date().toISOString();
    await downloadRemote(settings.getLastSyncedAt());
    await settings.setLastSyncedAt(pullStartedAt);
    const pendingCount = await refreshPendingCount();
    setStatus({ state: 'idle', lastSyncedAt: pullStartedAt, pendingCount, lastError: null });
  } catch (err) {
    setStatus({ state: 'error', lastError: String(err?.message ?? err) });
  } finally {
    syncing = false;
  }
}

// Sube TODOS los datos locales existentes como si acabaran de crearse — se
// ofrece una única vez al iniciar sesión por primera vez en un dispositivo
// con datos (ver js/views/settings-account.js). Nunca borra IndexedDB; es
// puramente aditivo, e idempotente si se llama dos veces (upsert por id).
export async function migrateLocalDataToAccount() {
  if (!isSupabaseConfigured()) throw new Error('SYNC_NOT_CONFIGURED');
  const session = await getSession();
  if (!session) throw new Error('NO_SESSION');
  repo.setSyncActive(true);
  for (const table of SYNCED_TABLES) {
    const rows = await db[table].toArray();
    for (const row of rows) {
      await repo.enqueueCreate(table, row);
    }
  }
  await settings.setLocalDataMigrated(true);
  await syncNow({ manual: true });
}

let debounceTimer = null;
let unsubscribeQueued = null;
let unsubscribeAuth = null;

// Se llama una vez al arrancar la app (ver js/app.js). Si no hay Supabase
// configurado o no hay sesión, todo esto queda inerte — modo local puro,
// coste cero.
export async function initSync() {
  if (!isSupabaseConfigured()) return;

  const session = await getSession();
  repo.setSyncActive(!!session);
  await refreshPendingCount();
  if (session && navigator.onLine) syncNow();

  if (!unsubscribeAuth) {
    unsubscribeAuth = onAuthStateChange((newSession) => {
      repo.setSyncActive(!!newSession);
      if (newSession) syncNow();
    });
  }

  if (!unsubscribeQueued) {
    // Debounce corto tras cada escritura local — nunca se sincroniza de
    // forma síncrona con el guardado (eso bloquearía la UI, ver principio
    // offline-first), solo se agenda un intento en segundo plano.
    unsubscribeQueued = on('sync:queued', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (repo.isSyncActive() && navigator.onLine) syncNow();
      }, 3000);
    });
  }

  window.addEventListener('online', () => {
    if (repo.isSyncActive()) syncNow();
  });
}
