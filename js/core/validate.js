// Validación defensiva mínima en el borde repository.js↔Dexie — funciones
// puras, sin dependencias, sin acceso a IndexedDB ni al DOM. No es un
// framework de validación: cada función sanea o rechaza un valor concreto
// antes de que llegue a `db.table.add/update`, para que un dato imposible
// (peso negativo, fecha mal formada...) nunca quede persistido, venga de la
// UI, de un backup importado o de un valor mal calculado en cualquier vista.
//
// Dos familias de función:
//   - clean*: nunca lanza. Si el valor no es válido, devuelve `null` (para
//     campos OPCIONALES — p.ej. el peso de una serie que aún no se ha
//     rellenado). El llamador decide qué hacer con `null`.
//   - require*: lanza `Error(mensaje)` si el valor no es válido — para
//     campos sin los que el registro no tiene sentido (el peso corporal de
//     una entrada de báscula, la fecha de un entrenamiento, el nombre de un
//     ejercicio).

export function cleanNonNegativeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function cleanNonNegativeInt(v) {
  const n = cleanNonNegativeNumber(v);
  return n == null ? null : Math.round(n);
}

// 'YYYY-MM-DD' con fecha real (no solo el patrón) — se usa como índice de
// Dexie y se compara lexicográficamente en varias consultas por rango de
// fechas, así que un valor mal formado corrompe esas consultas en silencio.
// Construido con Date.UTC()/getUTC*() a propósito — parsear con el
// constructor local (`new Date("2026-01-01T00:00:00")`) es sensible a la
// zona horaria del dispositivo y puede rechazar una fecha perfectamente
// válida cuando la medianoche local cae al otro lado del día UTC.
export function isValidDateString(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [year, month, day] = v.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function requireNonEmptyString(v, fieldLabel) {
  const trimmed = typeof v === 'string' ? v.trim() : '';
  if (!trimmed) throw new Error(`${fieldLabel} es obligatorio.`);
  return trimmed;
}

export function requirePositiveNumber(v, fieldLabel) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${fieldLabel} debe ser un número mayor que 0.`);
  return n;
}

export function requireValidDate(v, fieldLabel) {
  if (!isValidDateString(v)) throw new Error(`${fieldLabel} no es una fecha válida.`);
  return v;
}
