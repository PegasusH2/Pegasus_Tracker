// Utilidades de UI compartidas: bus de eventos simple y toasts.
// No es un "estado global" de la app — el estado real vive en IndexedDB;
// esto solo sirve para que unas vistas avisen a otras de que algo cambió.

const listeners = new Map();

export function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => listeners.get(event)?.delete(callback);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((cb) => cb(payload));
}

export function toast(message, { duration = 2200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

export function confirmDialog(message) {
  return window.confirm(message);
}
