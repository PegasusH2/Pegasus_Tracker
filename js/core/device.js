// Identificador estable de ESTA instalación de Pegasus Tracker (no del
// hardware — no usa nada del dispositivo real, solo un UUID aleatorio
// generado una vez y persistido en IndexedDB). Sirve para que el motor de
// sincronización (js/core/sync.js) pueda etiquetar de dónde viene cada
// cambio, útil para depuración; la resolución de conflictos en sí se basa en
// updatedAt, no en qué dispositivo escribió.
import * as settings from './settings.js';

let cached = null;

export function getDeviceId() {
  if (cached) return cached;
  const existing = settings.getDeviceId();
  if (existing) {
    cached = existing;
    return cached;
  }
  cached = crypto.randomUUID();
  // Fire-and-forget: el ID ya está disponible en memoria para el resto de
  // este arranque; la persistencia solo importa para la próxima vez.
  settings.setDeviceId(cached);
  return cached;
}
