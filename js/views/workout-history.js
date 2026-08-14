import * as repo from '../db/repository.js';
import * as settings from '../core/settings.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, TEMPLATE_ICONS, templateIconHtml } from '../core/ui.js';
import { toast } from '../core/store.js';
import { renderWorkoutCalendar } from './workout-calendar.js';
import { navigate } from '../app.js';

export async function renderWorkoutHistory(mount) {
  const templates = await repo.listTemplates();

  mount.innerHTML = `
    <div id="templates-section" style="margin-bottom:var(--space-5);"></div>

    <div class="section-label">Tus entrenos</div>
    <div id="w-calendar"></div>
  `;

  renderTemplatesSection(mount, templates);

  await renderWorkoutCalendar(mount.querySelector('#w-calendar'));
}

// Con rutinas ya creadas, todo este bloque (rejilla + accesos rápidos para
// crear un entreno) se colapsa por defecto — ya no aporta tanto verlo entero
// cada vez que abres Entreno. El usuario puede expandir/colapsar a mano y esa
// elección se recuerda (settings.js).
function renderTemplatesSection(mount, templates) {
  const stored = settings.getTemplatesGridCollapsed();
  const collapsed = stored ?? templates.length > 0;

  const section = mount.querySelector('#templates-section');
  section.innerHTML = `
    <div class="row" style="margin-bottom:${collapsed ? '0' : 'var(--space-2)'};">
      <div class="section-label" style="margin-bottom:0;">Tus rutinas${collapsed && templates.length ? ` · ${templates.length}` : ''}</div>
      <button class="icon-btn" id="toggle-templates" aria-label="${collapsed ? 'Mostrar rutinas' : 'Ocultar rutinas'}">${collapsed ? '▾' : '▴'}</button>
    </div>
    ${collapsed ? '' : `
      <div class="template-grid" id="template-grid" style="margin-bottom:var(--space-4);">
        ${templates.map((t) => `
          <button class="template-tile" data-id="${t.id}">
            <span class="icon-badge icon-badge--lg">${templateIconHtml(t.icon)}</span>
            <span class="template-tile-label">${escapeHtml(t.name)}</span>
          </button>
        `).join('')}
        <button class="template-tile template-tile-add" id="add-template">
          <span class="icon-badge icon-badge--lg">+</span>
          <span class="template-tile-label">Nueva</span>
        </button>
      </div>
      <div class="grouped-list">
        <div class="grouped-row" id="new-workout" style="cursor:pointer;">
          <span class="type-body">+ Entrenamiento libre</span>
          <span class="text-faint">›</span>
        </div>
        <div class="grouped-row" id="import-photo" style="cursor:pointer;">
          <span class="type-body">📷 Importar desde foto</span>
          <span class="text-faint">›</span>
        </div>
      </div>
    `}
  `;

  section.querySelector('#toggle-templates').addEventListener('click', async () => {
    await settings.setTemplatesGridCollapsed(!collapsed);
    renderTemplatesSection(mount, templates);
  });
  section.querySelector('#add-template')?.addEventListener('click', () => openNewTemplateSheet());
  section.querySelector('#new-workout')?.addEventListener('click', () => navigate('/entreno/nuevo'));
  section.querySelector('#import-photo')?.addEventListener('click', () => navigate('/entreno/importar-foto'));
  section.querySelectorAll('.template-tile[data-id]').forEach((tile) => {
    tile.addEventListener('click', () => navigate(`/entreno/plantilla/${tile.dataset.id}`));
  });
}

function openNewTemplateSheet() {
  let selectedIcon = TEMPLATE_ICONS[0].id;
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Nueva rutina</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="t-name" placeholder="Ej. Día 1 · Pecho" autofocus />
    </div>
    <div class="field">
      <label class="label">Icono</label>
      <div class="icon-picker" id="icon-picker">
        ${TEMPLATE_ICONS.map((ic, i) => `<button class="icon-picker-opt ${i === 0 ? 'active' : ''}" data-icon="${ic.id}" aria-label="${ic.label}">${templateIconHtml(ic.id)}</button>`).join('')}
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
