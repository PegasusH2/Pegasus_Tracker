export function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function relativeDays(iso) {
  if (!iso) return '';
  const then = new Date(iso + 'T00:00:00').getTime();
  const now = new Date(todayISO() + 'T00:00:00').getTime();
  const days = Math.round((now - then) / 86400000);
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days > 1) return `hace ${days} días`;
  if (days === -1) return 'mañana';
  return `en ${-days} días`;
}

export function formatWeight(kg) {
  if (kg === null || kg === undefined || kg === '') return '—';
  const n = Number(kg);
  return (Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, '')) + ' kg';
}

export function formatNumber(n, decimals = 1) {
  if (n === null || n === undefined) return '—';
  const rounded = Number(n.toFixed(decimals));
  return String(rounded).replace('.', ',');
}

export function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
