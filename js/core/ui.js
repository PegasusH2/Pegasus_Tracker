import * as repo from '../db/repository.js';
import { escapeHtml } from './escape.js';
import { toast } from './store.js';

// Helper compartido para mostrar un modal tipo "bottom sheet" (patrón iOS).
// onClose (opcional) se llama al cerrarse por CUALQUIER vía — botón, tocar
// fuera o Escape — como máximo una vez.
export function openSheet(innerHtml, { onMount, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-sheet"><div class="sheet-handle"></div>${innerHtml}</div>`;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  const sheet = overlay.querySelector('.modal-sheet');
  if (onMount) onMount(sheet, close);
  return close;
}

// Confirmación mediante el bottom-sheet propio de la app — nunca usa
// window.confirm(), que puede no dispararse de forma fiable en una PWA
// instalada en iOS (modo standalone). Devuelve Promise<boolean>.
export function openConfirmSheet(message, { confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = true } = {}) {
  return new Promise((resolve) => {
    const close = openSheet(`
      <p class="type-body" style="margin-bottom:20px;">${escapeHtml(message)}</p>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" id="confirm-yes">${escapeHtml(confirmLabel)}</button>
      <button class="btn btn-ghost btn-block" id="confirm-no" style="margin-top:8px;">${escapeHtml(cancelLabel)}</button>
    `, {
      onMount: (sheet) => {
        sheet.querySelector('#confirm-yes').addEventListener('click', () => { resolve(true); close(); });
        sheet.querySelector('#confirm-no').addEventListener('click', () => { resolve(false); close(); });
      },
      onClose: () => resolve(false),
    });
  });
}

// Iconos de navegación — familia PEGASUS: trazo redondeado, geometría limpia,
// monocromo (currentColor según estado activo/inactivo) con un único detalle
// de acento fijo en progreso/ajustes, igual que en la marca. Sin marcas ni
// imitaciones de terceros.
export const NAV_ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 12.2 12 4.2l9.3 8"/><path d="M5.5 10.3V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.7"/><path d="M9.4 20v-4.3a2.6 2.6 0 0 1 5.2 0V20"/></svg>`,
  entreno: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="9.3" width="2.8" height="5.4" rx="1.2"/><rect x="6.4" y="7.2" width="3" height="9.6" rx="1.3"/><path d="M10.4 12h3.2"/><rect x="14.6" y="7.2" width="3" height="9.6" rx="1.3"/><rect x="19" y="9.3" width="2.8" height="5.4" rx="1.2"/></svg>`,
  progreso: `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 19v-2.6M8.6 19v-4.4M13 19v-2" stroke="currentColor" stroke-width="1.6" opacity="0.45"/><path d="M3 14.8l4.6-4.6 3.4 2.9L17 6.5" stroke="currentColor" stroke-width="2"/><path d="M13.2 6.1h4.1v4.1" stroke="var(--accent)" stroke-width="2"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="12" r="5.6"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none" transform="rotate(45 12 12)"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none" transform="rotate(90 12 12)"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none" transform="rotate(135 12 12)"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none" transform="rotate(180 12 12)"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none" transform="rotate(225 12 12)"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none" transform="rotate(270 12 12)"/><rect x="10.8" y="3.6" width="2.4" height="2.6" rx="0.7" fill="currentColor" stroke="none" transform="rotate(315 12 12)"/><circle cx="12" cy="12" r="2.1" fill="var(--accent)" stroke="none"/></svg>`,
};

// Iconos de la pantalla Entreno (accesos rápidos, cabeceras de sección) — misma
// familia visual que NAV_ICONS: trazo redondeado 2px, geometría simple.
export const ACTION_ICONS = {
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  dumbbell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="9.3" width="2.8" height="5.4" rx="1.2"/><rect x="6.4" y="7.2" width="3" height="9.6" rx="1.3"/><path d="M10.4 12h3.2"/><rect x="14.6" y="7.2" width="3" height="9.6" rx="1.3"/><rect x="19" y="9.3" width="2.8" height="5.4" rx="1.2"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.5h7L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.3"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.2" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.2" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.2" cy="18" r="1.1" fill="currentColor" stroke="none"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8 3.5v3M16 3.5v3"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l6 7-6 7"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 6 7-6"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 9 12l6 7"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.6l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 4 14h6l-1 7 9-11h-6l1-7z"/></svg>`,
  document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h6.5L17 7v13.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z"/><path d="M13.5 3.5V7H17"/></svg>`,
  starFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 3.6l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`,
};

export const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;

export const AVATAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>`;

// Iconos ilustrados de grupo muscular para las rutinas (icons/muscles/icon-<id>.png).
export const TEMPLATE_ICONS = [
  { id: 'pierna', label: 'Pierna' },
  { id: 'culo', label: 'Culo' },
  { id: 'espalda', label: 'Espalda' },
  { id: 'abs', label: 'Abs' },
  { id: 'pecho', label: 'Pecho' },
  { id: 'hombro', label: 'Hombro' },
  { id: 'brazo', label: 'Brazo' },
];
const TEMPLATE_ICON_IDS = new Set(TEMPLATE_ICONS.map((ic) => ic.id));

// Las plantillas creadas antes de este cambio guardan un emoji en vez de un id
// de icono de músculo; ambos se siguen mostrando correctamente.
export function templateIconHtml(icon) {
  if (TEMPLATE_ICON_IDS.has(icon)) {
    return `<img src="icons/muscles/icon-${icon}.png" alt="" class="icon-badge-img">`;
  }
  return icon ?? '';
}

// Renderiza un aviso de progresión (insight) generado por el motor de progresión
// como un callout visual — no cambia el texto ni la lógica, solo la presentación.
export function renderInsightCallout(insight) {
  const clean = insight.text.replace(/^[🟢🟠]\s*/u, '');
  if (insight.level === 'neutral') {
    return `<div class="progress-callout progress-callout--neutral"><div class="progress-callout-text">${clean}</div></div>`;
  }
  const isGood = insight.level === 'good';
  return `
    <div class="progress-callout ${isGood ? 'progress-callout--good' : 'progress-callout--warn'}">
      <div class="progress-callout-icon">${isGood ? '↑' : '!'}</div>
      <div class="progress-callout-body">
        <div class="progress-callout-title">${isGood ? 'Progresando' : 'Atención'}</div>
        <div class="progress-callout-text">${clean}</div>
      </div>
    </div>`;
}

// Sheet reutilizable para buscar un ejercicio existente o crear uno nuevo.
// onSelect(exercise) se llama con el ejercicio elegido (existente o recién creado);
// el llamador decide qué hacer con él (añadirlo a una sesión, a una plantilla...).
export function openExercisePickerSheet({ onSelect, title = 'Añadir ejercicio', initialSearch = '' } = {}) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">${escapeHtml(title)}</h3>
    <input type="search" id="ex-search" placeholder="Buscar ejercicio..." value="${escapeHtml(initialSearch)}" style="margin-bottom:12px;" />
    <div id="ex-results" class="list"></div>
    <button class="btn btn-secondary btn-block" id="ex-create-new" style="margin-top:12px;">+ Crear ejercicio nuevo</button>
  `, {
    onMount: async (sheet, close) => {
      async function renderResults(search) {
        const results = await repo.listExercises({ search });
        const box = sheet.querySelector('#ex-results');
        if (!results.length) {
          box.innerHTML = `<div class="empty-state">Sin resultados.</div>`;
          return;
        }
        box.innerHTML = `<div class="grouped-list">${results.map((ex) => `
          <div class="grouped-row" data-id="${ex.id}">
            <span class="type-body">${escapeHtml(ex.name)}</span>
            <button class="btn btn-primary btn-sm">Añadir</button>
          </div>
        `).join('')}</div>`;
        box.querySelectorAll('[data-id]').forEach((row) => {
          row.querySelector('button').addEventListener('click', async () => {
            const ex = await repo.getExercise(row.dataset.id);
            close();
            await onSelect(ex);
          });
        });
      }
      sheet.querySelector('#ex-search').addEventListener('input', (e) => renderResults(e.target.value));
      sheet.querySelector('#ex-create-new').addEventListener('click', () => {
        const name = sheet.querySelector('#ex-search').value.trim();
        openSheet(`
          <h3 class="type-headline" style="margin-bottom:16px;">Nuevo ejercicio</h3>
          <div class="field">
            <label class="label">Nombre</label>
            <input type="text" id="new-ex-name" value="${escapeHtml(name)}" autofocus />
          </div>
          <div class="field">
            <label class="label">Grupo muscular (opcional)</label>
            <input type="text" id="new-ex-muscle" />
          </div>
          <button class="btn btn-primary btn-block" id="new-ex-save">Crear y añadir</button>
        `, {
          onMount: (sheet2, close2) => {
            sheet2.querySelector('#new-ex-save').addEventListener('click', async () => {
              const n = sheet2.querySelector('#new-ex-name').value.trim();
              if (!n) { toast('El nombre es obligatorio'); return; }
              const muscleGroup = sheet2.querySelector('#new-ex-muscle').value.trim();
              const ex = await repo.createExercise({ name: n, muscleGroup });
              close2();
              close();
              await onSelect(ex);
            });
          },
        });
      });
      await renderResults(initialSearch);
    },
  });
}

// Lee los colores actuales del tema (claro/oscuro) para que las gráficas de
// Chart.js sigan la paleta activa en vez de colores fijos.
export function getChartThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const read = (name) => cs.getPropertyValue(name).trim();
  return {
    accent: read('--accent'),
    accentSoft: read('--accent-soft'),
    grid: read('--border'),
    ticks: read('--text-tertiary'),
  };
}
