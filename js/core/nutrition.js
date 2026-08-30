// Helpers de dominio puros para el módulo de Nutrición — sin acceso a
// IndexedDB ni al DOM. Entrenamiento y descanso son dos configuraciones
// completamente independientes (ver repository.js#listMacroTargets/
// listDietPlans): esto solo resuelve etiquetas y "qué día es hoy".

export const DAY_TYPE_LABELS = { training: 'Entrenamiento', rest: 'Descanso' };
export const DAY_TYPE_ICONS = { training: '🏋️', rest: '💤' };

// Lunes primero, igual que WEEKDAY_LABELS en workout-calendar.js.
export const WEEKDAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABELS = { mon: 'L', tue: 'M', wed: 'X', thu: 'J', fri: 'V', sat: 'S', sun: 'D' };

// Date.getDay(): 0 = domingo ... 6 = sábado.
const JS_WEEKDAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function resolveTodayDayType(weekdayTypes) {
  const key = JS_WEEKDAY_TO_KEY[new Date().getDay()];
  return weekdayTypes?.[key] ?? 'training';
}
