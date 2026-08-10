import * as repo from '../db/repository.js';
import { formatDate, todayISO } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, colorForId } from '../core/ui.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';

const TEMPLATE_ICONS = ['💪', '🦵', '🏋️', '🔥', '⚡', '🎯', '🏃', '🤸', '🧘', '🥊', '🦾', '🚴'];

export async function renderWorkoutHistory(mount) {
  const [templates, workouts] = await Promise.all([
    repo.listTemplates(),
    repo.listWorkouts(),
  ]);

  mount.innerHTML = `
    <div class="section-label">Tus rutinas</div>
    <div class="template-grid" id="template-grid" style="margin-bottom:var(--space-5);">
      ${templates.map((t) => `
        <button class="template-tile" data-id="${t.id}">
          <span class="icon-badge icon-badge--lg icon-badge--${colorForId(t.id)}">${t.icon}</span>
          <span class="template-tile-label">${escapeHtml(t.name)}</span>
        </button>
      `).join('')}
      <button class="template-tile template-tile-add" id="add-template">
        <span class="icon-badge icon-badge--lg">+</span>
        <span class="template-tile-label">Nueva</span>
      </button>
    </div>

    <button class="btn btn-secondary btn-block" id="new-workout" style="margin-bottom:var(--space-5);">+ Entrenamiento libre</button>

    <div class="section-label">Tus entrenos</div>
    <div id="w-list"></div>
  `;

  mount.querySelector('#new-workout').addEventListener('click', () => navigate('/entreno/nuevo'));
  mount.querySelector('#add-template').addEventListener('click', () => openNewTemplateSheet());
  mount.querySelectorAll('.template-tile[data-id]').forEach((tile) => {
    tile.addEventListener('click', () => navigate(`/entreno/plantilla/${tile.dataset.id}`));
  });

  const listEl = mount.querySelector('#w-list');
  if (!workouts.length) {
    listEl.innerHTML = `<div class="empty-state">Todavía no has registrado ningún entrenamiento.</div>`;
    return;
  }

  const counts = await Promise.all(workouts.map((w) => repo.getWorkoutExerciseCount(w.id)));

  listEl.innerHTML = `<div class="grouped-list">${workouts.map((w, i) => `
    <div class="grouped-row" data-id="${w.id}">
      <div class="w-open" style="flex:1; min-width:0; cursor:pointer;">
        <div class="type-headline">${escapeHtml(w.name)}</div>
        <div class="type-caption text-faint">
          ${formatDate(w.date)} · ${counts[i]} ejercicio${counts[i] === 1 ? '' : 's'}${w.completed ? ' · <span class="text-good">Finalizado</span>' : ''}
        </div>
      </div>
      <button class="icon-btn w-repeat" aria-label="Repetir entrenamiento">↻</button>
    </div>
  `).join('')}</div>`;

  listEl.querySelectorAll('[data-id]').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.w-open').addEventListener('click', () => navigate(`/entreno/sesion/${id}`));
    row.querySelector('.w-repeat').addEventListener('click', async () => {
      const original = workouts.find((w) => w.id === id);
      const today = todayISO();
      const newWorkout = await repo.repeatWorkout(id, {
        name: `${original.name} (repetido)`,
        date: today,
      });
      toast('Entrenamiento creado a partir del anterior');
      navigate(`/entreno/sesion/${newWorkout.id}`);
    });
  });
}

function openNewTemplateSheet() {
  let selectedIcon = TEMPLATE_ICONS[0];
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Nueva rutina</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="t-name" placeholder="Ej. Día 1 · Pecho" autofocus />
    </div>
    <div class="field">
      <label class="label">Icono</label>
      <div class="icon-picker" id="icon-picker">
        ${TEMPLATE_ICONS.map((ic, i) => `<button class="icon-picker-opt ${i === 0 ? 'active' : ''}" data-icon="${ic}">${ic}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="t-save">Crear rutina</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#icon-picker').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-icon]');
        if (!btn) return;
        selectedIcon = btn.dataset.icon;
        sheet.querySelectorAll('.icon-picker-opt').forEach((b) => b.classList.toggle('active', b === btn));
      });
      sheet.querySelector('#t-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#t-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const template = await repo.createTemplate({ name, icon: selectedIcon });
        close();
        navigate(`/entreno/plantilla/${template.id}`);
      });
    },
  });
}
