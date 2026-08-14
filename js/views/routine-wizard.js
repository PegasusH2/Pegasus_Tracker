// Asistente de creación manual de rutinas — 3 pasos: 1) nombre/descripción/
// icono, 2) elegir ejercicios (selección múltiple, con pestañas Todos/
// Favoritos/Recientes/Grupos), 3) revisar orden y guardar. Usa exactamente
// las mismas funciones de repository.js que cualquier otra rutina
// (createTemplate/addTemplateExercise) — nada paralelo.
import * as repo from '../db/repository.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openConfirmSheet, TEMPLATE_ICONS, templateIconHtml, ACTION_ICONS } from '../core/ui.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';

export async function renderRoutineWizard(mount) {
  const state = {
    name: '',
    description: '',
    icon: TEMPLATE_ICONS[0].id,
    selected: [], // [{ exercise }] en el orden en que se añadieron
    tab: 'todos',
    search: '',
  };
  renderStep1(mount, state);
}

function wizardHeader(title, { rightLabel, rightDisabled } = {}) {
  return `
    <div class="row" style="align-items:center; margin-bottom:var(--space-4);">
      <button type="button" class="icon-btn" id="wiz-back" aria-label="Volver">${ACTION_ICONS.chevronLeft}</button>
      <h1 class="type-title" style="flex:1; text-align:center; font-size:19px;">${escapeHtml(title)}</h1>
      ${rightLabel ? `<button type="button" class="btn btn-ghost btn-sm" id="wiz-right" ${rightDisabled ? 'disabled' : ''}>${escapeHtml(rightLabel)}</button>` : '<span style="width:34px;"></span>'}
    </div>
  `;
}

function bindHeader(mount, { onBack, onRight }) {
  mount.querySelector('#wiz-back').addEventListener('click', onBack);
  mount.querySelector('#wiz-right')?.addEventListener('click', onRight);
}

// ---------- Paso 1: nombre, descripción, icono ----------
function renderStep1(mount, state) {
  mount.innerHTML = `
    ${wizardHeader('Nueva rutina')}
    <div class="field">
      <label class="label">Nombre de la rutina</label>
      <input type="text" id="rw-name" placeholder="Ej. Piernas, Push, Upper A…" value="${escapeHtml(state.name)}" autofocus />
    </div>
    <div class="field">
      <label class="label">Descripción (opcional)</label>
      <textarea id="rw-desc" rows="2" placeholder="Objetivo, enfoque, notas...">${escapeHtml(state.description)}</textarea>
    </div>
    <div class="field">
      <label class="label">Icono</label>
      <div class="icon-picker" id="icon-picker">
        ${TEMPLATE_ICONS.map((ic) => `<button type="button" class="icon-picker-opt ${ic.id === state.icon ? 'active' : ''}" data-icon="${ic.id}" aria-label="${ic.label}">${templateIconHtml(ic.id)}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="rw-continue" style="margin-top:var(--space-2);">Continuar</button>
  `;

  bindHeader(mount, { onBack: () => navigate('/entreno') });
  mount.querySelector('#icon-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-icon]');
    if (!btn) return;
    state.icon = btn.dataset.icon;
    mount.querySelectorAll('.icon-picker-opt').forEach((b) => b.classList.toggle('active', b === btn));
  });
  mount.querySelector('#rw-continue').addEventListener('click', () => {
    const name = mount.querySelector('#rw-name').value.trim();
    if (!name) { toast('El nombre es obligatorio'); return; }
    state.name = name;
    state.description = mount.querySelector('#rw-desc').value.trim();
    renderStep2(mount, state);
  });
}

// ---------- Paso 2: elegir ejercicios (selección múltiple) ----------
const TABS = [
  { key: 'todos', label: 'Todos' },
  { key: 'favoritos', label: 'Favoritos' },
  { key: 'recientes', label: 'Recientes' },
  { key: 'grupos', label: 'Grupos' },
];

async function renderStep2(mount, state) {
  mount.innerHTML = `
    ${wizardHeader('Añadir ejercicios', { rightLabel: 'Cancelar' })}
    <input type="search" id="rw-search" placeholder="Buscar ejercicio..." value="${escapeHtml(state.search)}" style="margin-bottom:var(--space-3);" />
    <div class="subtabs" id="rw-tabs" style="margin-bottom:var(--space-4);">
      ${TABS.map((t) => `<button type="button" class="subtab ${t.key === state.tab ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="rw-ex-list" style="margin-bottom:var(--space-4);"></div>
    <button class="btn btn-secondary btn-block" id="rw-create-exercise" style="margin-bottom:var(--space-5);">+ Crear ejercicio personalizado</button>
    <button class="btn btn-primary btn-block" id="rw-continue">Continuar${state.selected.length ? ` (${state.selected.length})` : ''}</button>
  `;

  bindHeader(mount, { onBack: () => renderStep1(mount, state), onRight: () => navigate('/entreno') });

  mount.querySelector('#rw-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderExerciseList(mount, state);
  });
  mount.querySelector('#rw-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    mount.querySelectorAll('#rw-tabs .subtab').forEach((b) => b.classList.toggle('active', b === btn));
    renderExerciseList(mount, state);
  });
  mount.querySelector('#rw-create-exercise').addEventListener('click', () => openCreateExerciseSheet(mount, state));
  mount.querySelector('#rw-continue').addEventListener('click', () => renderStep3(mount, state));

  await renderExerciseList(mount, state);
}

async function loadExercisesForTab(state) {
  if (state.tab === 'recientes') {
    const recent = await repo.getRecentExercises(20);
    const q = state.search.trim().toLowerCase();
    return q ? recent.filter((e) => e.name.toLowerCase().includes(q)) : recent;
  }
  const all = await repo.listExercises({ search: state.search });
  if (state.tab === 'favoritos') return all.filter((e) => e.isFavorite);
  return all; // 'todos' y 'grupos' parten de la misma lista, 'grupos' solo cambia cómo se agrupa
}

async function renderExerciseList(mount, state) {
  const list = mount.querySelector('#rw-ex-list');
  const exercises = await loadExercisesForTab(state);

  if (!exercises.length) {
    list.innerHTML = `<div class="empty-state">${state.tab === 'favoritos' ? 'Aún no tienes ejercicios favoritos.' : state.tab === 'recientes' ? 'Todavía no has entrenado ningún ejercicio.' : 'Sin resultados.'}</div>`;
    return;
  }

  if (state.tab === 'grupos') {
    const groups = new Map();
    for (const ex of exercises) {
      const key = ex.muscleGroup?.trim() || 'Sin grupo';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ex);
    }
    list.innerHTML = [...groups.entries()].map(([group, items]) => `
      <div class="section-label" style="margin-top:var(--space-3);">${escapeHtml(group)}</div>
      <div class="grouped-list">${items.map((ex) => exerciseRowHtml(ex, state)).join('')}</div>
    `).join('');
  } else {
    list.innerHTML = `<div class="grouped-list">${exercises.map((ex) => exerciseRowHtml(ex, state)).join('')}</div>`;
  }

  bindExerciseRows(list, mount, state);
}

function exerciseRowHtml(ex, state) {
  const isSelected = state.selected.some((s) => s.exercise.id === ex.id);
  return `
    <div class="grouped-row" data-id="${ex.id}" style="cursor:pointer;">
      <button type="button" class="icon-btn rw-fav" data-id="${ex.id}" aria-label="${ex.isFavorite ? 'Quitar de favoritos' : 'Marcar como favorito'}" style="color:${ex.isFavorite ? 'var(--accent)' : 'var(--text-tertiary)'};">
        ${ex.isFavorite ? ACTION_ICONS.starFilled : ACTION_ICONS.star}
      </button>
      <div style="flex:1; min-width:0;" class="rw-toggle" data-id="${ex.id}">
        <div class="type-body" style="font-weight:600;">${escapeHtml(ex.name)}</div>
        ${ex.muscleGroup ? `<div class="type-caption text-faint">${escapeHtml(ex.muscleGroup)}</div>` : ''}
      </div>
      <span class="set-check ${isSelected ? 'done' : ''}" style="flex-shrink:0;">${isSelected ? ACTION_ICONS.check : ''}</span>
    </div>
  `;
}

function bindExerciseRows(list, mount, state) {
  list.querySelectorAll('.rw-fav').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ex = await repo.getExercise(btn.dataset.id);
      await repo.setExerciseFavorite(ex.id, !ex.isFavorite);
      renderExerciseList(mount, state);
    });
  });
  list.querySelectorAll('.rw-toggle').forEach((row) => {
    row.addEventListener('click', async () => {
      const id = row.dataset.id;
      const idx = state.selected.findIndex((s) => s.exercise.id === id);
      if (idx >= 0) {
        state.selected.splice(idx, 1);
      } else {
        const exercise = await repo.getExercise(id);
        state.selected.push({ exercise });
      }
      renderExerciseList(mount, state);
      const continueBtn = mount.querySelector('#rw-continue');
      if (continueBtn) continueBtn.textContent = `Continuar${state.selected.length ? ` (${state.selected.length})` : ''}`;
    });
  });
}

function openCreateExerciseSheet(mount, state) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">Nuevo ejercicio</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="new-ex-name" autofocus />
    </div>
    <div class="field">
      <label class="label">Grupo muscular (opcional)</label>
      <input type="text" id="new-ex-muscle" />
    </div>
    <button class="btn btn-primary btn-block" id="new-ex-save">Crear y añadir</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#new-ex-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#new-ex-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const muscleGroup = sheet.querySelector('#new-ex-muscle').value.trim();
        const exercise = await repo.createExercise({ name, muscleGroup });
        state.selected.push({ exercise });
        close();
        renderExerciseList(mount, state);
        const continueBtn = mount.querySelector('#rw-continue');
        if (continueBtn) continueBtn.textContent = `Continuar${state.selected.length ? ` (${state.selected.length})` : ''}`;
      });
    },
  });
}

// ---------- Paso 3: revisar orden y guardar ----------
function renderStep3(mount, state) {
  mount.innerHTML = `
    ${wizardHeader(state.name, { rightLabel: 'Guardar' })}
    <div class="type-caption text-faint" style="margin-bottom:var(--space-3);">${state.selected.length} ejercicio${state.selected.length === 1 ? '' : 's'}</div>
    <div id="rw-review-list" class="grouped-list" style="margin-bottom:var(--space-4);"></div>
    <button class="btn btn-secondary btn-block" id="rw-add-more">+ Añadir más ejercicios</button>
  `;

  bindHeader(mount, { onBack: () => renderStep2(mount, state), onRight: () => saveRoutine(mount, state) });
  mount.querySelector('#rw-add-more').addEventListener('click', () => renderStep2(mount, state));

  renderReviewList(mount, state);
}

function renderReviewList(mount, state) {
  const list = mount.querySelector('#rw-review-list');
  if (!state.selected.length) {
    list.innerHTML = `<div class="empty-state">Todavía no has añadido ningún ejercicio.</div>`;
    return;
  }
  list.innerHTML = state.selected.map((item, i) => `
    <div class="grouped-row" data-idx="${i}">
      <span class="type-caption text-faint" style="width:22px; flex-shrink:0;">${i + 1}</span>
      <div style="flex:1; min-width:0;">
        <div class="type-body" style="font-weight:600;">${escapeHtml(item.exercise.name)}</div>
        <div class="type-caption text-faint">3 series</div>
      </div>
      <div style="display:flex;">
        ${i > 0 ? `<button class="icon-btn rw-up" aria-label="Subir">↑</button>` : ''}
        ${i < state.selected.length - 1 ? `<button class="icon-btn rw-down" aria-label="Bajar">↓</button>` : ''}
        <button class="icon-btn rw-remove" aria-label="Quitar">✕</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-idx]').forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelector('.rw-up')?.addEventListener('click', () => {
      [state.selected[idx - 1], state.selected[idx]] = [state.selected[idx], state.selected[idx - 1]];
      renderReviewList(mount, state);
    });
    row.querySelector('.rw-down')?.addEventListener('click', () => {
      [state.selected[idx], state.selected[idx + 1]] = [state.selected[idx + 1], state.selected[idx]];
      renderReviewList(mount, state);
    });
    row.querySelector('.rw-remove').addEventListener('click', () => {
      state.selected.splice(idx, 1);
      renderReviewList(mount, state);
    });
  });
}

async function saveRoutine(mount, state) {
  if (!state.selected.length) {
    const ok = await openConfirmSheet('¿Guardar la rutina sin ejercicios? Podrás añadirlos más tarde desde la rutina.', { confirmLabel: 'Guardar igualmente', danger: false });
    if (!ok) return;
  }

  const template = await repo.createTemplate({ name: state.name, icon: state.icon, description: state.description });
  for (const item of state.selected) {
    await repo.addTemplateExercise(template.id, item.exercise.id, { targetSets: 3 });
  }
  toast('Rutina creada');
  navigate(`/entreno/plantilla/${template.id}`);
}
