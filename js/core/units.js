// Conversión pura kg <-> lb. El almacenamiento interno SIEMPRE es kg — estas
// funciones solo sirven para la capa de presentación/entrada.
//
// Contrato importante para evitar drift de redondeo: toda conversión debe
// partir siempre del valor canónico en kg (o del valor recién tecleado),
// nunca de un valor ya redondeado-para-mostrar. Ej. al alternar el toggle
// kg/lb en un formulario, la nueva cifra se recalcula con toUnit(kgCanonico,
// nuevaUnidad) — nunca con toKg(valorMostradoRedondeado, unidadAnterior).

export const KG_PER_LB = 0.45359237; // definición legal exacta de la libra avoirdupois

// value: número tal cual lo escribió el usuario en `unit`. Devuelve kg.
export function toKg(value, unit) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return unit === 'lb' ? n * KG_PER_LB : n;
}

// kg: valor canónico almacenado. Devuelve el número en `unit`, sin redondear.
export function toUnit(kg, unit) {
  if (kg === null || kg === undefined) return null;
  const n = Number(kg);
  if (Number.isNaN(n)) return null;
  return unit === 'lb' ? n / KG_PER_LB : n;
}

// Redondeo SOLO para mostrar/prellenar inputs — nunca se aplica antes de guardar.
export function roundForDisplay(value, decimals = 1) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatWeightUnit(kg, unit, decimals = 1) {
  if (kg === null || kg === undefined || kg === '') return '—';
  const v = roundForDisplay(toUnit(kg, unit), decimals);
  const n = Number.isInteger(v) ? v : v.toFixed(decimals).replace(/\.0$/, '');
  return `${n} ${unit}`;
}

// Granularidad de los <input step="...">: lb usa un paso algo más grueso
// porque 0.5kg ≈ 1.1lb.
export function inputStep(unit, context = 'set') {
  if (context === 'bodyWeight') return unit === 'kg' ? 0.1 : 0.2;
  return unit === 'kg' ? 0.5 : 1;
}
