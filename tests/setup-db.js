// Prepara un IndexedDB simulado en Node para poder testear schema.js/
// repository.js SIN un navegador real. Es la ÚNICA pieza de infraestructura
// añadida solo para tests (fake-indexeddb + dexie de npm) — la app en sí
// sigue cargando Dexie como script global vendorizado (js/lib/dexie.min.js),
// esto no cambia nada de lo que se despliega a GitHub Pages.
//
// Debe importarse ANTES que cualquier archivo que importe schema.js/
// repository.js, para que `Dexie` exista como global cuando schema.js hace
// `new Dexie(...)` (igual que en el navegador, donde lo pone el <script>).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

globalThis.Dexie = Dexie;

// Vacía todas las tablas entre tests para que no se contaminen entre sí —
// los tests de un mismo archivo comparten la misma base de datos simulada
// (igual que el singleton `db` real de schema.js).
export async function resetDb(db) {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}
