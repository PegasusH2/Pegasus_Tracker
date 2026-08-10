import * as repo from '../db/repository.js';
import { todayISO, formatDate, formatDateShort } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, getChartThemeColors } from '../core/ui.js';
import { toast, confirmDialog } from '../core/store.js';

let chartInstance = null;
const state = { selectedTypeId: null };

export async function renderMeasurements(mount) {
  const types = await repo.listMeasurementTypes();

  if (!state.selectedTypeId && types.length) state.selectedTypeId = types[0].id;
  if (state.selectedTypeId && !types.find((t) => t.id === state.selectedTypeId)) {
    state.selectedTypeId = types[0]?.id ?? null;
  }

  mount.innerHTML = `
    <div class="row" style="margin-bottom:var(--space-4); align-items:center;">
      <div class="subtabs" id="type-tabs" style="flex:1;">
        ${types.map((t) => `<button class="subtab ${t.id === state.selectedTypeId ? 'active' : ''}" data-type="${t.id}">${escapeHtml(t.name)}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="new-type" style="white-space:nowrap;">+ Tipo</button>
    </div>

    ${!types.length ? `<div class="empty-state">Crea tu primer tipo de medida (ej. Cintura, Brazo...) con "+ Tipo".</div>` : `
      <button class="btn btn-secondary btn-block" id="add-measurement" style="margin-bottom:var(--space-5);">+ Añadir medida</button>
      <div class="chart-container" style="margin-bottom:var(--space-5);"><canvas id="measure-chart"></canvas></div>
      <div class="section-label">Historial</div>
      <div id="measure-list"></div>
    `}
  `;

  mount.querySelector('#new-type').addEventListener('click', () => openTypeForm(mount));

  mount.querySelector('#type-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    state.selectedTypeId = btn.dataset.type;
    renderMeasurements(mount);
  });

  if (!types.length) return;

  mount.querySelector('#add-measurement').addEventListener('click', () => openMeasurementForm(mount, state.selectedTypeId));

  await renderTypeData(mount, state.selectedTypeId);
}

async function renderTypeData(mount, typeId) {
  const entries = await repo.listMeasurementsByType(typeId); // desc

  const list = mount.querySelector('#measure-list');
  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">Sin registros todavía para esta medida.</div>`;
  } else {
    list.innerHTML = `<div class="grouped-list">${entries.map((e) => `
      <div class="grouped-row" data-id="${e.id}">
        <div>
          <div class="type-body num" style="font-weight:600;">${e.valueCm} cm</div>
          <div class="type-caption text-faint">${formatDate(e.date)}${e.notes ? ' · ' + escapeHtml(e.notes) : ''}</div>
        </div>
        <button class="icon-btn m-delete" aria-label="Eliminar">✕</button>
      </div>
    `).join('')}</div>`;
    list.querySelectorAll('[data-id]').forEach((row) => {
      row.querySelector('.m-delete').addEventListener('click', async () => {
        if (!confirmDialog('¿Eliminar este registro?')) return;
        await repo.deleteMeasurement(row.dataset.id);
        await renderMeasurements(mount);
      });
    });
  }

  const ascending = entries.slice().reverse();
  const canvas = mount.querySelector('#measure-chart');
  if (chartInstance) chartInstance.destroy();
  if (!ascending.length) return;

  const colors = getChartThemeColors();
  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: ascending.map((e) => formatDateShort(e.date)),
      datasets: [{
        data: ascending.map((e) => e.valueCm),
        borderColor: colors.accent,
        backgroundColor: colors.accentSoft,
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: colors.ticks, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: colors.ticks }, grid: { color: colors.grid } },
      },
    },
  });
}

function openTypeForm(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Nuevo tipo de medida</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="f-name" placeholder="Ej. Cintura" autofocus />
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Crear</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#f-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const type = await repo.createMeasurementType(name);
        state.selectedTypeId = type.id;
        close();
        await renderMeasurements(mount);
      });
    },
  });
}

function openMeasurementForm(mount, typeId) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Añadir medida</h3>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="f-date" value="${todayISO()}" />
    </div>
    <div class="field">
      <label class="label">Valor (cm)</label>
      <input type="number" inputmode="decimal" step="0.1" id="f-value" autofocus />
    </div>
    <div class="field">
      <label class="label">Notas (opcional)</label>
      <input type="text" id="f-notes" />
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Guardar</button>
    <button class="btn btn-ghost-danger btn-block" id="f-delete-type" style="margin-top:16px;">Eliminar este tipo de medida</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async () => {
        const date = sheet.querySelector('#f-date').value;
        const valueCm = Number(sheet.querySelector('#f-value').value);
        const notes = sheet.querySelector('#f-notes').value.trim();
        if (!date || !valueCm) { toast('Fecha y valor son obligatorios'); return; }
        await repo.addMeasurement({ typeId, date, valueCm, notes });
        close();
        await renderMeasurements(mount);
      });
      sheet.querySelector('#f-delete-type').addEventListener('click', async () => {
        if (!confirmDialog('¿Eliminar este tipo de medida y todo su historial?')) return;
        await repo.deleteMeasurementType(typeId);
        state.selectedTypeId = null;
        close();
        await renderMeasurements(mount);
      });
    },
  });
}
