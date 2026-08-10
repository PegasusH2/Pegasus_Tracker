import * as repo from '../db/repository.js';
import { escapeHtml } from './escape.js';
import { toast } from './store.js';

// Helper compartido para mostrar un modal tipo "bottom sheet" (patrón iOS).
export function openSheet(innerHtml, { onMount } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-sheet"><div class="sheet-handle"></div>${innerHtml}</div>`;

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
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

// Iconos de navegación — trazo simple (currentColor), sin marcas ni imitaciones.
export const NAV_ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/></svg>`,
  entreno: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9v6"/><path d="M4 10v4"/><path d="M18 9v6"/><path d="M20 10v4"/><path d="M6 12h12"/></svg>`,
  progreso: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l5-5 4 4 7-8"/><path d="M15 6h5v5"/></svg>`,
  datos: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M4.9 7l2.1 1.3M17 15.7l2.1 1.3M4.9 17l2.1-1.3M17 8.3l2.1-1.3M3 12h2.5M18.5 12H21"/></svg>`,
};

export const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;

export const AVATAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>`;

// Color de identidad determinista para una entidad (p. ej. una plantilla),
// para poder distinguirlas visualmente sin necesitar que el usuario elija un
// color. Es puramente decorativo — nunca representa un estado bueno/malo.
const CATEGORY_ROTATION = ['blue', 'purple', 'amber', 'teal', 'pink'];
export function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CATEGORY_ROTATION[hash % CATEGORY_ROTATION.length];
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
export function openExercisePickerSheet({ onSelect, title = 'Añadir ejercicio' } = {}) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">${title}</h3>
    <input type="search" id="ex-search" placeholder="Buscar ejercicio..." style="margin-bottom:12px;" />
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
      await renderResults('');
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
