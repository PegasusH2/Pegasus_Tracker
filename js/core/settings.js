// Caché en memoria + acceso a las preferencias de usuario. Todas viven como
// filas sueltas en la tabla genérica `settings` (repository.js) — cero
// migración de esquema. Se hidrata una vez en el boot (js/app.js) y se
// mantiene en memoria porque se lee en cada render (nav, formularios...).
import * as repo from '../db/repository.js';
import { emit } from './store.js';

const DEFAULTS = {
  onboardingCompleted: false,
  userName: '',
  weightUnitsEnabled: { kg: true, lb: true },
  weightProgressUnit: 'kg',
  weightLastInputUnit: 'kg',
  progressSections: { general: true, peso: true, medidas: true, plicometro: true },
  templatesGridCollapsed: null, // "Mis rutinas" — null = automático (colapsado en cuanto ya tienes alguna rutina); true/false = el usuario lo tocó a mano
  actionsCollapsed: false, // "Acciones" — expandido por defecto
  adminSession: null, // { token, expiresAt } — sesión temporal de administrador emitida por el Worker; NUNCA la contraseña/secreto (ver js/core/ai-import.js)
  devModeUnlocked: false, // se desbloquea tocando 5 veces el icono de Ajustes de la barra inferior (ver js/app.js) — una vez desbloqueado, permanece así
  deviceId: null, // UUID estable de esta instalación (ver js/core/device.js) — se genera una sola vez, no lleva info del dispositivo real
  lastSyncedAt: null, // ISO string — marca de agua de la última sincronización completada con éxito (ver js/core/sync.js)
  localDataMigrated: false, // ya se ofreció/hizo la subida inicial de datos locales al crear/iniciar sesión por primera vez en este dispositivo
  theme: 'default', // 'default' | 'white' | 'queens' — ver js/core/theme.js (único módulo que aplica esto al DOM)
  nutricionSections: { macros: true, dieta: true, historico: true }, // única preferencia que viaja con la cuenta — ver repo.getUserPreference/setUserPreference, no usa repo.getSetting/setSetting como el resto de esta lista
  nutricionMode: 'macros', // 'macros' | 'dieta' | 'ambos' — qué sistema(s) tienen contenido real (distinto de nutricionSections, que solo oculta/muestra pestañas). También vía user_preferences.
  nutricionWeekdayTypes: { mon: 'training', tue: 'training', wed: 'training', thu: 'training', fri: 'training', sat: 'training', sun: 'training' },
};

const VALID_THEMES = ['default', 'white', 'queens'];

let cache = { ...DEFAULTS };
let loaded = false;

function clampUnits(state) {
  const enabled = (state.weightUnitsEnabled.kg || state.weightUnitsEnabled.lb)
    ? state.weightUnitsEnabled
    : DEFAULTS.weightUnitsEnabled;
  const clampUnit = (u) => (enabled[u] ? u : (enabled.kg ? 'kg' : 'lb'));
  return {
    ...state,
    weightUnitsEnabled: enabled,
    weightProgressUnit: clampUnit(state.weightProgressUnit),
    weightLastInputUnit: clampUnit(state.weightLastInputUnit),
  };
}

export async function loadSettingsCache() {
  const [onboardingCompleted, userName, weightUnitsEnabled, weightProgressUnit, weightLastInputUnit, progressSections, templatesGridCollapsed, actionsCollapsed, adminSession, devModeUnlocked, deviceId, lastSyncedAt, localDataMigrated, theme, nutricionSections, nutricionMode, nutricionWeekdayTypes] = await Promise.all([
    repo.getSetting('onboardingCompleted', DEFAULTS.onboardingCompleted),
    repo.getSetting('userName', DEFAULTS.userName),
    repo.getSetting('weightUnitsEnabled', DEFAULTS.weightUnitsEnabled),
    repo.getSetting('weightProgressUnit', DEFAULTS.weightProgressUnit),
    repo.getSetting('weightLastInputUnit', DEFAULTS.weightLastInputUnit),
    repo.getSetting('progressSections', DEFAULTS.progressSections),
    repo.getSetting('templatesGridCollapsed', DEFAULTS.templatesGridCollapsed),
    repo.getSetting('actionsCollapsed', DEFAULTS.actionsCollapsed),
    repo.getSetting('adminSession', DEFAULTS.adminSession),
    repo.getSetting('devModeUnlocked', DEFAULTS.devModeUnlocked),
    repo.getSetting('deviceId', DEFAULTS.deviceId),
    repo.getSetting('lastSyncedAt', DEFAULTS.lastSyncedAt),
    repo.getSetting('localDataMigrated', DEFAULTS.localDataMigrated),
    repo.getSetting('theme', DEFAULTS.theme),
    repo.getUserPreference('nutricionSections', DEFAULTS.nutricionSections),
    repo.getUserPreference('nutricionMode', DEFAULTS.nutricionMode),
    repo.getUserPreference('nutricionWeekdayTypes', DEFAULTS.nutricionWeekdayTypes),
  ]);
  cache = clampUnits({ onboardingCompleted, userName, weightUnitsEnabled, weightProgressUnit, weightLastInputUnit, progressSections, templatesGridCollapsed, actionsCollapsed, adminSession, devModeUnlocked, deviceId, lastSyncedAt, localDataMigrated, theme: VALID_THEMES.includes(theme) ? theme : DEFAULTS.theme, nutricionSections, nutricionMode, nutricionWeekdayTypes });
  loaded = true;
  return cache;
}

function ensureLoaded() {
  if (!loaded) throw new Error('settings.js: loadSettingsCache() no se ha llamado todavía');
}

export function isOnboardingCompleted() { ensureLoaded(); return cache.onboardingCompleted; }
export function getUserName() { ensureLoaded(); return cache.userName; }
export function getWeightUnitsEnabled() { ensureLoaded(); return cache.weightUnitsEnabled; }
export function getWeightProgressUnit() { ensureLoaded(); return cache.weightProgressUnit; }
export function getWeightLastInputUnit() { ensureLoaded(); return cache.weightLastInputUnit; }
export function getProgressSections() { ensureLoaded(); return cache.progressSections; }
export function isAnyProgressSectionEnabled() {
  ensureLoaded();
  return Object.values(cache.progressSections).some(Boolean);
}
export function getNutricionSections() { ensureLoaded(); return cache.nutricionSections; }
export function isAnyNutricionSectionEnabled() {
  ensureLoaded();
  return Object.values(cache.nutricionSections).some(Boolean);
}
export function getNutricionMode() { ensureLoaded(); return cache.nutricionMode; }
export function getNutricionWeekdayTypes() { ensureLoaded(); return cache.nutricionWeekdayTypes; }
export function getTemplatesGridCollapsed() { ensureLoaded(); return cache.templatesGridCollapsed; }
export function getActionsCollapsed() { ensureLoaded(); return cache.actionsCollapsed; }

// Sesión de administrador — { token, expiresAt } o null. El token es una
// credencial TEMPORAL emitida por el Worker (no la contraseña); caduca sola
// y se puede revocar por completo rotando ADMIN_SECRET en Cloudflare.
export function getAdminSession() { ensureLoaded(); return cache.adminSession; }
export function isAdminSessionActive() {
  ensureLoaded();
  return !!cache.adminSession && cache.adminSession.expiresAt > Date.now();
}
export async function setAdminSession(session) {
  cache.adminSession = session;
  await repo.setSetting('adminSession', session);
  emit('prefs:changed', { key: 'adminSession' });
}
export async function clearAdminSession() {
  await setAdminSession(null);
}

// Modo desarrollador — oculto por defecto; se revela tocando 5 veces el
// icono de Ajustes de la barra inferior (ver js/app.js). Una vez
// desbloqueado permanece así (no hay forma de volver a ocultarlo desde la
// UI, igual que "Opciones de desarrollador" en Android/iOS).
export function isDevModeUnlocked() { ensureLoaded(); return cache.devModeUnlocked; }
export async function unlockDevMode() {
  if (cache.devModeUnlocked) return;
  cache.devModeUnlocked = true;
  await repo.setSetting('devModeUnlocked', true);
  emit('prefs:changed', { key: 'devModeUnlocked' });
}

export async function setOnboardingCompleted(value) {
  cache.onboardingCompleted = value;
  await repo.setSetting('onboardingCompleted', value);
}

export async function setUserName(name) {
  cache.userName = name;
  await repo.setSetting('userName', name);
  emit('prefs:changed', { key: 'userName' });
}

// next: { kg: boolean, lb: boolean } — lanza si ambas quedarían desactivadas.
export async function setWeightUnitsEnabled(next) {
  if (!next.kg && !next.lb) throw new Error('Debe haber al menos una unidad de peso activa');
  cache = clampUnits({ ...cache, weightUnitsEnabled: next });
  await repo.setSetting('weightUnitsEnabled', cache.weightUnitsEnabled);
  await repo.setSetting('weightProgressUnit', cache.weightProgressUnit);
  await repo.setSetting('weightLastInputUnit', cache.weightLastInputUnit);
  emit('prefs:changed', { key: 'weightUnitsEnabled' });
}

export async function setWeightProgressUnit(unit) {
  cache = clampUnits({ ...cache, weightProgressUnit: unit });
  await repo.setSetting('weightProgressUnit', cache.weightProgressUnit);
  emit('prefs:changed', { key: 'weightProgressUnit' });
}

export async function setWeightLastInputUnit(unit) {
  cache = clampUnits({ ...cache, weightLastInputUnit: unit });
  await repo.setSetting('weightLastInputUnit', cache.weightLastInputUnit);
  emit('prefs:changed', { key: 'weightLastInputUnit' });
}

export async function setProgressSection(key, enabled) {
  cache.progressSections = { ...cache.progressSections, [key]: enabled };
  await repo.setSetting('progressSections', cache.progressSections);
  emit('prefs:changed', { key: 'progressSections' });
}

// Única preferencia que viaja con la cuenta (repo.setUserPreference, tabla
// sincronizable `userPreferences`) — no local-por-dispositivo como el resto.
export async function setNutricionSection(key, enabled) {
  cache.nutricionSections = { ...cache.nutricionSections, [key]: enabled };
  await repo.setUserPreference('nutricionSections', cache.nutricionSections);
  emit('prefs:changed', { key: 'nutricionSections' });
}

export async function setNutricionMode(mode) {
  cache.nutricionMode = mode;
  await repo.setUserPreference('nutricionMode', mode);
  emit('prefs:changed', { key: 'nutricionMode' });
}

export async function setNutricionWeekdayType(day, type) {
  cache.nutricionWeekdayTypes = { ...cache.nutricionWeekdayTypes, [day]: type };
  await repo.setUserPreference('nutricionWeekdayTypes', cache.nutricionWeekdayTypes);
  emit('prefs:changed', { key: 'nutricionWeekdayTypes' });
}

export async function setTemplatesGridCollapsed(value) {
  cache.templatesGridCollapsed = value;
  await repo.setSetting('templatesGridCollapsed', value);
}

export async function setActionsCollapsed(value) {
  cache.actionsCollapsed = value;
  await repo.setSetting('actionsCollapsed', value);
}

// Identificador estable de esta instalación (ver js/core/device.js) — se
// lee/escribe aquí porque settings.js ya es el único módulo que toca la
// tabla `settings`, pero la generación del UUID vive en device.js.
export function getDeviceId() { ensureLoaded(); return cache.deviceId; }
export async function setDeviceId(id) {
  cache.deviceId = id;
  await repo.setSetting('deviceId', id);
}

// Marca de agua de sincronización — ver js/core/sync.js. Se muestra tal cual
// en Ajustes ("Última sincronización: ..."), no necesita emitir 'prefs:changed'
// porque la propia pantalla de sync se refresca a través de 'sync:status'.
export function getLastSyncedAt() { ensureLoaded(); return cache.lastSyncedAt; }
export async function setLastSyncedAt(iso) {
  cache.lastSyncedAt = iso;
  await repo.setSetting('lastSyncedAt', iso);
}

// Tema visual — ver js/core/theme.js (aplica esto al DOM; aquí solo se
// persiste, mismo patrón que el resto de preferencias).
export function getTheme() { ensureLoaded(); return cache.theme; }
export async function setTheme(theme) {
  if (!VALID_THEMES.includes(theme)) throw new Error('Tema no válido');
  cache.theme = theme;
  await repo.setSetting('theme', theme);
  emit('prefs:changed', { key: 'theme' });
}

// "¿ya se ofreció subir los datos locales a la cuenta?" — solo evita repetir
// la pantalla de confirmación en cada inicio de sesión, no es la fuente de
// verdad de si todo está subido (eso lo indica el tamaño de syncQueue).
export function isLocalDataMigrated() { ensureLoaded(); return cache.localDataMigrated; }
export async function setLocalDataMigrated(value) {
  cache.localDataMigrated = value;
  await repo.setSetting('localDataMigrated', value);
}
