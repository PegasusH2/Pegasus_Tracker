import * as repo from '../db/repository.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet } from '../core/ui.js';
import { toast } from '../core/store.js';
import { renderWorkoutCalendar } from './workout-calendar.js';
import { navigate } from '../app.js';

const TEMPLATE_ICONS = ['💪', '🦵', '🏋️', '🔥', '⚡', '🎯', '🏃', '🤸', '🧘', '🥊', '🦾', '🚴'];

export async function renderWorkoutHistory(mount) {
  const templates = await repo.listTemplates();

  mount.innerHTML = `
    <div class="section-label">Tus rutinas</div>
    <div class="template-grid" id="template-grid" style="margin-bottom:var(--space-5);">
      ${templates.map((t) => `
        <button class="template-tile" data-id="${t.id}">
          <span class="icon-badge icon-badge--lg">${t.icon}</span>
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
    <div id="w-calendar"></div>
  `;

  mount.querySelector('#new-workout').addEventListener('click', () => navigate('/entreno/nuevo'));
  mount.querySelector('#add-template').addEventListener('click', () => openNewTemplateSheet());
  mount.querySelectorAll('.template-tile[data-id]').forEach((tile) => {
    tile.addEventListener('click', () => navigate(`/entreno/plantilla/${tile.dataset.id}`));
  });

  await renderWorkoutCalendar(mount.querySelector('#w-calendar'));
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
