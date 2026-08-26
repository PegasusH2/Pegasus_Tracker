# Sincronización cloud offline-first con Supabase

> Documento de arquitectura de la funcionalidad implementada. Ver el informe
> final entregado al usuario para el resumen ejecutivo de archivos tocados y
> pasos manuales pendientes (crear el proyecto Supabase, pegar credenciales,
> validar con dispositivos reales).

## 1. Principio general

Supabase es una **capa de sincronización añadida**, nunca un sustituto de
Dexie/IndexedDB. Ninguna escritura de usuario depende de la red: toda
operación se completa 100% en local (vía `js/db/repository.js`) antes de
devolver el control a la vista. Si hay sesión activa, esa misma escritura
además encola una entrada en `syncQueue` (outbox) para que
`js/core/sync.js` la suba en segundo plano, con debounce y sin bloquear la
UI. Si no hay sesión (modo local puro), el encolado es un no-op total — cero
overhead para quien nunca crea cuenta.

```
Views → Core → Repository ─┬─→ Dexie → IndexedDB (fuente de verdad local)
                            └─→ syncQueue (outbox) → sync.js → Supabase (Postgres + Auth + RLS)
```

## 2. Alcance sincronizable — decisión y por qué se apartó del pedido literal

El encargo original pedía sincronizar explícitamente workouts/workoutExercises/
sets, templates/templateExercises y bodyWeight/measurements/skinfoldEntries.
Auditando el esquema real (`js/db/schema.js`) se detectó un conflicto: esas
tablas tienen claves foráneas hacia `exercises`, `measurementTypes` y
`skinfoldSites`, que el pedido no mencionaba. Sin sincronizarlas también, una
rutina creada en un PC llegaría a un iPhone con un `exerciseId` que no existe
ahí — datos rotos, no solo incompletos. Se decidió incluirlas igualmente
(documentado en el propio código, `js/db/schema.js:SYNCED_TABLES`), priorizando
integridad de datos sobre seguir el pedido al pie de la letra.

**Sincronizadas (11):** `exercises`, `workouts`, `workoutExercises`, `sets`,
`templates`, `templateExercises`, `bodyWeight`, `measurementTypes`,
`measurements`, `skinfoldSites`, `skinfoldEntries`.

**Fuera de alcance (decisión explícita):** `bars` (config de barras/discos —
ligada al gimnasio físico de cada dispositivo, no mencionada en el pedido) y
`settings` (preferencias del dispositivo, salvo las claves de sync en sí:
`deviceId`, `lastSyncedAt`, `localDataMigrated`). Efecto secundario conocido:
si se borra una barra en un dispositivo, `exercises.defaultBarId` no se
limpia vía sync en los demás — cada dispositivo gestiona sus propias barras,
así que esa referencia ya era, por diseño, local a cada instalación.

## 3. IDs — por qué no hizo falta migrar nada

Antes de esta fase, **todas** las tablas ya usaban `id: crypto.randomUUID()`
generado en el cliente (`js/db/schema.js:newId`), no `++id` autoincremental
de Dexie. Esto elimina de raíz el problema clásico de sincronización offline
("iPhone crea el registro 5, PC también crea el registro 5, colisión") — dos
dispositivos independientes nunca pueden generar el mismo UUID, así que la
primera sincronización entre dispositivos con historiales distintos es
automáticamente una unión, sin lógica de merge especial.

## 4. Esquema Dexie — migración v13

`js/db/schema.js` sube de v12 a v13:

- **`createdAt`/`updatedAt`** en las 11 tablas sincronizadas (backfill para
  las que no los tenían — la mayoría no tenía ninguno de los dos; `workouts`
  ya tenía ambos, `exercises`/`templates` ya tenían `createdAt`).
- **Tabla nueva `syncQueue`** (el outbox): `{ id, entity, entityId, operation
  ('create'|'update'|'delete'), payload, createdAt, attempts, lastAttemptAt,
  lastError, syncedAt, status ('pending'|'failed') }`, indexada por
  `[entity+entityId]` (búsqueda de "¿hay ya algo pendiente para esta fila?")
  y `[status+createdAt]`.
- Los **deletes locales siguen siendo físicos** — sin cambio de
  comportamiento ni de lecturas existentes. El tombstoning cross-device vive
  del lado de Supabase (`deleted_at`), no en Dexie: no hace falta que cada
  vista filtre filas "borradas pero todavía presentes".

## 5. Cola de sincronización (outbox) — `js/db/repository.js`

Cada función de escritura de las 11 tablas llama, tras su operación normal,
a un helper interno (`enqueueChange`/`enqueueCreate`/`enqueueUpdate`/
`enqueueDelete`) que:

1. Es un no-op inmediato si `syncActive` es `false` (repository.js expone
   `setSyncActive(bool)`, que `sync.js` empuja según haya o no sesión — así
   se evita un ciclo de dependencias entre los dos módulos).
2. **Compacta** cambios repetidos sobre la misma fila: varias ediciones antes
   de sincronizar colapsan en una sola entrada con el payload más reciente;
   un `delete` sobre algo que se creó y nunca llegó a subirse borra la
   entrada de la cola sin más (no hay nada que decirle a Supabase).
3. El `payload` es siempre la **fila completa** (nunca un diff parcial), lo
   que permite tratar `create` y `update` de forma idéntica en la subida (un
   `upsert` por `id` sirve para ambos).

Las funciones que hacen **borrado en cascada** (`deleteWorkout`,
`removeExerciseFromWorkout`, `deleteTemplate`, `deleteMeasurementType`,
`deleteSkinfoldSite`) encolan un `delete` **por cada fila afectada**, no solo
la raíz — si solo se encolara el `workout`, otro dispositivo nunca se
enteraría de que sus `workoutExercises`/`sets` también desaparecieron. Todas
estas funciones ya eran transaccionales (regla del proyecto: el cuerpo de
`db.transaction('rw', [...], async () => {...})` va inline, nunca delegado a
otra función async aparte, o Dexie pierde la "zona" de la transacción y
lanza `PrematureCommitError` en navegador real) — `db.syncQueue` se añadió a
la lista de tablas de cada una de esas transacciones. Verificado en un
navegador real (no solo con `fake-indexeddb`) que esto no rompe nada.

## 6. Motor de sincronización — `js/core/sync.js`

`syncNow({ manual })` seis pasos, en este orden exacto:

1. Sale si no hay Supabase configurado, no hay sesión, o no hay conexión
   (`navigator.onLine`) — en ese último caso queda en estado `'pending'`, no
   `'error'`. Lock en memoria contra sincronizaciones solapadas.
2. **Sube** lo pendiente de `syncQueue`, agrupado por tabla en un orden de
   dependencia (`SYNC_ORDER`: tablas de referencia → padres → hijos) para no
   violar FKs en Postgres. `create`/`update` van como `upsert`; `delete`
   como `UPDATE deleted_at = now()`. Éxito → se borra la entrada de la cola
   (no se arrastra marcada "synced" para siempre). Fallo → `attempts++`,
   `lastError`, backoff exponencial (`min(2^attempts × 5s, 5min)`), y tras 6
   intentos pasa a `status:'failed'` (visible en la UI, nunca se borra sola).
3. Captura `pullStartedAt` **antes** de descargar (no después) — si algo se
   confirma en el servidor mientras la descarga está en vuelo, el próximo
   ciclo lo recoge; mejor repetir una fila de más que perder una por el
   margen de carrera.
4. **Descarga** incremental: `SELECT * WHERE updated_at > watermark`, por
   tabla, en el mismo `SYNC_ORDER`.
5. **Aplica** cada fila remota: si trae `deleted_at`, borrado físico local
   (`db[tabla].delete(id)`); si no, `db[tabla].put(fila)` directo (no pasa
   por las funciones `create*`/`update*` de repository.js, que están
   pensadas para escrituras de usuario con generación de ID — aquí el ID ya
   viene fijado).
6. **Conflictos**: si la fila que llega tiene una entrada `pending`/`failed`
   en la cola local para ese mismo `entity+entityId` (una edición sin subir
   todavía), gana quien tenga el `updated_at` más reciente — nunca "el
   último que llegó" a ciegas. Como la subida de este mismo ciclo ocurre
   *antes* que la descarga, un dispositivo no se pisa nunca a sí mismo; esto
   solo se activa de verdad cuando la subida ha fallado repetidamente.

Disparadores: al arrancar la app si hay sesión (`js/app.js` llama a
`initSync()`, sin esperar — no retrasa el primer render), al volver
`online`, con un debounce de ~3s tras cada escritura (`store.js` emite
`'sync:queued'`, que `sync.js` escucha — así `repository.js` no necesita
importar `sync.js` y no se crea un ciclo), y manualmente desde "Sincronizar
ahora" en Ajustes.

## 7. Migración de datos locales al crear/iniciar sesión

`migrateLocalDataToAccount()` (en `sync.js`) recorre las 11 tablas
sincronizadas y encola cada fila existente como si acabara de crearse —
reutiliza el mismo `enqueueCreate` exportado de `repository.js`, cero código
duplicado. Es puramente aditiva (nunca borra IndexedDB) e idempotente
(`upsert` por `id`, se puede llamar dos veces sin duplicar nada). Se ofrece
**una vez**, con una hoja de confirmación, justo después del primer inicio
de sesión en un dispositivo con datos (`js/views/settings-account.js`); si el
usuario declina, sigue disponible a mano ("Subir datos locales") en la misma
pantalla mientras tenga sesión iniciada.

## 8. Supabase (Postgres + Auth + RLS) — `supabase/schema.sql`

11 tablas espejo en `snake_case`, mismo `id` (uuid) que su fila Dexie,
`user_id` forzado por un trigger `BEFORE INSERT`/`UPDATE`
(`pegasus_set_owner_and_timestamps`) que **nunca** confía en lo que mande el
cliente, `created_at`/`updated_at` asignados por Postgres (no por el reloj
del dispositivo — evita depender ciegamente de relojes desincronizados entre
dispositivos), `deleted_at` como tombstone, FKs reflejando las relaciones de
Dexie, índice `(user_id, updated_at)` por tabla para el pull incremental.

**RLS obligatorio** en las 11 tablas: una policy `FOR ALL USING (auth.uid()
= user_id) WITH CHECK (auth.uid() = user_id)`. No hay policy de `DELETE`
porque el cliente nunca hace un `DELETE` real — solo `UPDATE deleted_at`
(limpieza física de tombstones antiguos, si se hace algún día, queda para un
job de servidor con `service_role`, fuera del alcance de esta fase).

## 9. Autenticación y claves

Email + contraseña vía Supabase Auth (`js/core/auth.js`). `supabase-js` se
vendoriza como script UMD (`js/lib/supabase.min.js`, igual que Dexie/
Chart.js) para mantener el offline-first real — una URL de CDN no es
precacheable de forma fiable por el Service Worker. La sesión se persiste vía
un adaptador de almacenamiento propio (`js/core/supabase-storage-adapter.js`)
respaldado por la tabla `settings` de IndexedDB, no por `localStorage`
(coherente con el resto de la app). La "anon key" de Supabase está diseñada
para ser pública — la protección real es RLS; nunca se usa (ni se debe usar)
la `service_role key` en el frontend. `js/core/supabase-client.js` expone
`configureSupabase(url, anonKey)` para fijar las credenciales (usado también
por los tests con un cliente simulado).

## 10. UI — Ajustes > Cuenta y sincronización

Fila nueva en `js/views/settings-hub.js` (solo visible si
`isSupabaseConfigured()`, para no mostrar una entrada "rota" antes de que el
proyecto Supabase exista), con un subtítulo de estado. Pantalla nueva
`js/views/settings-account.js` (ruta `/ajustes/cuenta`): formularios de alta/
login si no hay sesión, o tarjeta de cuenta + estado de sync (✓ Sincronizado
/ ↻ Sincronizando… / ○ Pendiente (N) / ⚠ Error) + "Sincronizar ahora" si la
hay. Cerrar sesión nunca borra datos locales por defecto — solo una acción
secundaria explícita, gateada por checkbox, igual que "Borrar todos los
datos" en Ajustes > Datos. Nada de esto toca `workout-session.js`.

## 11. Tests

Automatizados: `tests/sync.test.js` (13 casos, `node:test` + `fake-indexeddb`
+ un Supabase simulado en memoria) — compactación de la cola, cascada de
tombstones, subida/bajada básica, dispositivo nuevo recibiendo datos
existentes, tombstone aplicado en otro dispositivo, comportamiento sin
conexión, reintentos/backoff, resolución de conflictos (en ambos sentidos:
gana el cambio local pendiente más reciente; se aplica lo remoto cuando no
hay nada pendiente local), y migración de datos locales al iniciar sesión.
Suite completa: 105 tests (92 previos + 13 nuevos), todos en verde.

Verificado además en un **navegador real** (no solo `fake-indexeddb`): crear
ejercicios/plantilla/rutina completa vía `startWorkoutFromTemplate` con
`syncActive = true` (la transacción más grande del código, la que
específicamente puede disparar `PrematureCommitError` si se rompe la regla
de "cuerpo inline"), y verificar que la compactación de la cola deja
exactamente las filas esperadas tras crear+borrar todo salvo dos ejercicios.
Cero errores de consola.

**No verificado automáticamente** (requiere un proyecto Supabase real,
credenciales propias del usuario y, para el caso 4/caso de dos dispositivos
físicos, un iPhone real): RLS aplicado de verdad por Postgres (caso 10 del
pedido original), y los 10 casos de prueba manuales — ver el informe final
para el checklist exacto.
