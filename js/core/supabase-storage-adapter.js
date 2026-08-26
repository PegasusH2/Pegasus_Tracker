// Adaptador de almacenamiento para la sesión de supabase-js. Por defecto
// supabase-js usa localStorage — aquí lo respaldamos con la tabla `settings`
// de IndexedDB (vía repository.js) para ser coherentes con el resto de la
// app, que no usa localStorage en ningún sitio (ver adminSession en
// core/settings.js, con el mismo motivo). El JWT de sesión de un usuario
// normal no es un secreto de aplicación, pero igualmente no hay razón para
// romper la convención existente.
//
// supabase-js exige que getItem/setItem/removeItem puedan ser síncronas O
// devolver una Promise — usamos la tabla genérica `settings` (repo.getSetting/
// setSetting), namespacing las claves para no colisionar con ninguna
// preferencia propia de Pegasus.
import * as repo from '../db/repository.js';

const PREFIX = 'supabaseAuth:';

export const supabaseStorageAdapter = {
  async getItem(key) {
    return repo.getSetting(PREFIX + key, null);
  },
  async setItem(key, value) {
    await repo.setSetting(PREFIX + key, value);
  },
  async removeItem(key) {
    await repo.setSetting(PREFIX + key, null);
  },
};
