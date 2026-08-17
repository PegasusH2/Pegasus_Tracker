import * as repo from '../db/repository.js';
import * as settings from '../core/settings.js';
import { escapeHtml } from '../core/escape.js';
import { relativeDays } from '../core/format.js';
import { templateIconHtml, ACTION_ICONS } from '../core/ui.js';
import { renderWorkoutCalendar } from './workout-calendar.js';
import { navigate } from '../app.js';

export async function renderWorkoutHistory(mount) {
  const templates = await repo.listTemplates();
  const templatesWithMeta = await loadTemplatesMeta(templates);

  mount.innerHTML = `
    <div id="actions-section" style="margin-bottom:var(--space-5);"></div>
    <div id="my-routines-section" style="margin-bottom:var(--space-5);"></div>

    <div class="section-divider"></div>

    <div class="section-label-row">
      <span class="section-label-icon">${ACTION_ICONS.calendar}</span>
      <span class="section-label" style="margin-bottom:0;">Tus entrenos</span>
    </div>
    <div class="card" id="w-calendar"></div>
  `;

  renderActionsSection(mount);
  renderMyRoutinesSection(mount, templatesWithMeta);

  await renderWorkoutCalendar(mount.querySelector('#w-calendar'));
}

function collapseChevronHtml(collapsed) {
  return `<span style="display:flex; transform:rotate(${collapsed ? '0' : '180'}deg); transition:transform 160ms var(--ease);">${ACTION_ICONS.chevronDown}</span>`;
}

// Listado completo, sin límite — accesible desde "Ver todas mis rutinas".
export async function renderAllRoutines(mount) {
  const templates = await repo.listTemplates();
  const templatesWithMeta = await loadTemplatesMeta(templates);
  const ordered = sortByRecentUse(templatesWithMeta);

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:var(--space-4);">Mis rutinas</h1>
    <div class="action-card-list" id="all-routines-list"></div>
  `;

  const list = mount.querySelector('#all-routines-list');
  if (!ordered.length) {
    list.innerHTML = `<div class="empty-state">Todavía no tienes rutinas.</div>`;
    return;
  }
  list.innerHTML = ordered.map((t) => routineCardHtml(t)).join('');
  list.querySelectorAll('.action-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => navigate(`/entreno/plantilla/${card.dataset.id}`));
  });
}

async function loadTemplatesMeta(templates) {
  return Promise.all(templates.map(async (t) => {
    const [exercises, lastWorkout] = await Promise.all([
      repo.getTemplateExercises(t.id),
      repo.getLastWorkoutForTemplate(t.id),
    ]);
    return { ...t, exerciseCount: exercises.length, lastWorkout };
  }));
}

// Con uso primero (más reciente primero), sin uso después (en su orden habitual).
function sortByRecentUse(templates) {
  const withUsage = templates.filter((t) => t.lastWorkout);
  const withoutUsage = templates.filter((t) => !t.lastWorkout);
  withUsage.sort((a, b) => (a.lastWorkout.date < b.lastWorkout.date ? 1 : -1));
  return [...withUsage, ...withoutUsage];
}

function templateMetaLine(t) {
  const parts = [`${t.exerciseCount} ejercicio${t.exerciseCount === 1 ? '' : 's'}`];
  parts.push(t.lastWorkout ? `Último uso: ${relativeDays(t.lastWorkout.date)}` : 'Sin usar todavía');
  return parts.join(' · ');
}

function routineCardHtml(t) {
  return `
    <button class="action-card" data-id="${t.id}">
      <span class="action-card-icon">${templateIconHtml(t.icon)}</span>
      <span class="action-card-body">
        <span class="action-card-title">${escapeHtml(t.name)}</span>
        <span class="action-card-desc">${escapeHtml(templateMetaLine(t))}</span>
      </span>
      <span class="action-card-chevron">${ACTION_ICONS.chevronRight}</span>
    </button>
  `;
}

function renderMyRoutinesSection(mount, templates) {
  const section = mount.querySelector('#my-routines-section');
  if (!templates.length) { section.innerHTML = ''; return; }

  const stored = settings.getTemplatesGridCollapsed();
  const collapsed = stored ?? false;

  const ordered = sortByRecentUse(templates);
  const shown = ordered.slice(0, 3);

  section.innerHTML = `
    <div class="row section-label-row">
      <div class="section-label-row" style="gap:6px;">
        <span class="section-label-icon">${ACTION_ICONS.list}</span>
        <span class="section-label" style="margin-bottom:0;">Mis rutinas · ${templates.length}</span>
      </div>
      <button class="icon-btn" id="toggle-routines" aria-label="${collapsed ? 'Mostrar rutinas' : 'Ocultar rutinas'}">${collapseChevronHtml(collapsed)}</button>
    </div>
    ${collapsed ? '' : `
      <div class="action-card-list" style="margin-bottom:${templates.length > 3 ? 'var(--space-2)' : '0'};">
        ${shown.map((t) => routineCardHtml(t)).join('')}
      </div>
      ${templates.length > 3 ? `<button class="btn btn-ghost btn-sm" id="see-all-routines" style="padding-left:0;">Ver todas mis rutinas ›</button>` : ''}
    `}
  `;

  section.querySelector('#toggle-routines').addEventListener('click', async () => {
    await settings.setTemplatesGridCollapsed(!collapsed);
    renderMyRoutinesSection(mount, templates);
  });
  section.querySelectorAll('.action-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => navigate(`/entreno/plantilla/${card.dataset.id}`));
  });
  section.querySelector('#see-all-routines')?.addEventListener('click', () => navigate('/entreno/rutinas'));
}

function renderActionsSection(mount) {
  const section = mount.querySelector('#actions-section');
  const collapsed = settings.getActionsCollapsed();

  section.innerHTML = `
    <div class="row section-label-row">
      <div class="section-label-row" style="gap:6px;">
        <span class="section-label-icon">${ACTION_ICONS.plus}</span>
        <span class="section-label" style="margin-bottom:0;">Acciones</span>
      </div>
      <button class="icon-btn" id="toggle-actions" aria-label="${collapsed ? 'Mostrar acciones' : 'Ocultar acciones'}">${collapseChevronHtml(collapsed)}</button>
    </div>
    ${collapsed ? '' : `
      <div class="action-card-list">
        <button class="action-card" id="add-template">
          <span class="action-card-icon action-card-icon--dashed">${ACTION_ICONS.plus}</span>
          <span class="action-card-body">
            <span class="action-card-title">Crear rutina</span>
            <span class="action-card-desc">Diseña tu rutina desde cero</span>
          </span>
          <span class="action-card-chevron">${ACTION_ICONS.chevronRight}</span>
        </button>

        <button class="action-card" id="new-workout">
          <span class="action-card-icon">${ACTION_ICONS.dumbbell}</span>
          <span class="action-card-body">
            <span class="action-card-title">Entrenamiento libre</span>
            <span class="action-card-desc">Registra una sesión sin rutina</span>
          </span>
          <span class="action-card-chevron">${ACTION_ICONS.chevronRight}</span>
        </button>

        <button class="action-card" id="import-photo">
          <span class="action-card-icon">${ACTION_ICONS.camera}</span>
          <span class="action-card-body">
            <span class="action-card-title">Importar desde foto</span>
            <span class="action-card-desc">Convierte tu rutina en segundos</span>
          </span>
          <span class="action-card-badge">IA</span>
          <span class="action-card-chevron">${ACTION_ICONS.chevronRight}</span>
        </button>
      </div>
    `}
  `;

  section.querySelector('#toggle-actions').addEventListener('click', async () => {
    await settings.setActionsCollapsed(!collapsed);
    renderActionsSection(mount);
  });
  section.querySelector('#add-template')?.addEventListener('click', () => navigate('/entreno/rutina-nueva'));
  section.querySelector('#new-workout')?.addEventListener('click', () => navigate('/entreno/nuevo'));
  section.querySelector('#import-photo')?.addEventListener('click', () => navigate('/entreno/importar-foto'));
}
