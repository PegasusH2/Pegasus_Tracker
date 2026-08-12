import * as settings from '../core/settings.js';
import { openSheet } from '../core/ui.js';
import { escapeHtml } from '../core/escape.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';

const SECTION_LABELS = {
  general: 'Progreso general',
  peso: 'Peso corporal',
  medidas: 'Medidas',
  plicometro: 'Plicómetro',
};

export async function renderSettingsHub(mount) {
  render(mount);
}

function render(mount) {
  const name = settings.getUserName();
  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:var(--space-5);">Ajustes</h1>

    <div class="grouped-list" style="margin-bottom:var(--space-5);">
      <div class="grouped-row" id="row-perfil" style="cursor:pointer;">
        <div>
          <div class="type-body" style="font-weight:600;">Perfil</div>
          <div class="type-caption text-faint">${name ? escapeHtml(name) : 'Sin nombre'}</div>
        </div>
        <span class="text-faint">›</span>
      </div>
      <div class="grouped-row" id="row-pesos" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Pesos</span>
        <span class="text-faint">›</span>
      </div>
      <div class="grouped-row" id="row-personalizar" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Personalizar</span>
        <span class="text-faint">›</span>
      </div>
      <div class="grouped-row" id="row-datos" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Datos</span>
        <span class="text-faint">›</span>
      </div>
    </div>

    <div class="card">
      <div class="type-headline" style="margin-bottom:4px;">Aplicación</div>
      <div class="type-caption text-faint">Fitness Tracker · uso personal, sin cuentas ni servidores. Tus datos viven solo en este dispositivo.</div>
    </div>
  `;

  mount.querySelector('#row-perfil').addEventListener('click', () => openPerfilSheet(mount));
  mount.querySelector('#row-pesos').addEventListener('click', () => openPesosSheet());
  mount.querySelector('#row-personalizar').addEventListener('click', () => openPersonalizarSheet());
  mount.querySelector('#row-datos').addEventListener('click', () => navigate('/ajustes/datos'));
}

function openPerfilSheet(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Perfil</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="p-name" value="${escapeHtml(settings.getUserName())}" autofocus />
    </div>
    <button class="btn btn-primary btn-block" id="p-save">Guardar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#p-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#p-name').value.trim();
        await settings.setUserName(name);
        close();
        render(mount);
      });
    },
  });
}

function openPesosSheet() {
  const enabled = settings.getWeightUnitsEnabled();
  const progressUnit = settings.getWeightProgressUnit();
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Pesos</h3>
    <label class="checkbox-row"><span class="type-body">Kilogramos (kg)</span><input type="checkbox" id="u-kg" ${enabled.kg ? 'checked' : ''} /></label>
    <label class="checkbox-row"><span class="type-body">Libras (lb)</span><input type="checkbox" id="u-lb" ${enabled.lb ? 'checked' : ''} /></label>
    <div class="field" id="progress-unit-field" style="margin-top:var(--space-4); ${enabled.kg && enabled.lb ? '' : 'display:none;'}">
      <label class="label">Unidad principal para el progreso</label>
      <div class="segmented" id="progress-unit-toggle">
        <button type="button" class="seg ${progressUnit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
        <button type="button" class="seg ${progressUnit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
      </div>
    </div>
  `, {
    onMount: (sheet) => {
      const kgBox = sheet.querySelector('#u-kg');
      const lbBox = sheet.querySelector('#u-lb');
      const progressField = sheet.querySelector('#progress-unit-field');
      const progressToggle = sheet.querySelector('#progress-unit-toggle');

      async function commit(revertBox) {
        if (!kgBox.checked && !lbBox.checked) {
          revertBox.checked = true;
          toast('Debes tener al menos una unidad activa');
          return;
        }
        await settings.setWeightUnitsEnabled({ kg: kgBox.checked, lb: lbBox.checked });
        const showToggle = kgBox.checked && lbBox.checked;
        progressField.style.display = showToggle ? '' : 'none';
        const clamped = settings.getWeightProgressUnit();
        progressToggle.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.unit === clamped));
      }

      kgBox.addEventListener('change', () => commit(kgBox));
      lbBox.addEventListener('change', () => commit(lbBox));

      progressToggle.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-unit]');
        if (!btn) return;
        await settings.setWeightProgressUnit(btn.dataset.unit);
        progressToggle.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
      });
    },
  });
}

function openPersonalizarSheet() {
  const sections = settings.getProgressSections();
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:12px;">Secciones visibles</h3>
    <p class="type-caption text-faint" style="margin-bottom:var(--space-3);">
      Ocultar una sección no borra sus datos — puedes reactivarla cuando quieras.
    </p>
    ${Object.entries(SECTION_LABELS).map(([key, label]) => `
      <label class="checkbox-row">
        <span class="type-body">${label}</span>
        <input type="checkbox" data-section="${key}" ${sections[key] ? 'checked' : ''} />
      </label>
    `).join('')}
  `, {
    onMount: (sheet) => {
      sheet.querySelectorAll('[data-section]').forEach((cb) => {
        cb.addEventListener('change', async (e) => {
          await settings.setProgressSection(e.target.dataset.section, e.target.checked);
        });
      });
    },
  });
}
