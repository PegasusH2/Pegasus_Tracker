import * as repo from '../db/repository.js';
import { bodyWeightStats } from '../core/stats.js';
import { filterByPeriodGeneric } from '../core/stats.js';
import { todayISO, formatDate, formatDateShort, formatWeight } from '../core/format.js';
import { openSheet } from '../core/ui.js';
import { toast, confirmDialog } from '../core/store.js';

const PERIODS = [
  { key: '4w', label: '4 sem' },
  { key: '8w', label: '8 sem' },
  { key: '12w', label: '12 sem' },
  { key: '6m', label: '6 meses' },
  { key: '1y', label: '1 año' },
  { key: 'all', label: 'Todo' },
];

let chartInstance = null;
const state = { period: '12w' };

export async function renderBodyWeight(mount) {
  const entries = await repo.listBodyWeight(); // desc
  const stats = bodyWeightStats(entries);

  mount.innerHTML = `
    <button class="btn btn-primary btn-block" id="add-weight" style="margin-bottom:20px;">+ Registrar peso</button>

    ${!entries.length ? `<div class="empty-state">Todavía no has registrado tu peso.</div>` : `
    <div class="grid-2" style="margin-bottom:20px;">
      <div class="stat-tile">
        <div class="stat-label">Peso actual</div>
        <div class="stat-value">${formatWeight(stats.current)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Media semanal</div>
        <div class="stat-value">${formatWeight(stats.weeklyAvg)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Cambio semanal</div>
        <div class="stat-value">${changeText(stats.weeklyChange)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Cambio mensual</div>
        <div class="stat-value">${changeText(stats.monthlyChange)}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="period-selector" id="period-selector">
        ${PERIODS.map((p) => `<button class="period-chip ${p.key === state.period ? 'active' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}
      </div>
      <div class="chart-container"><canvas id="weight-chart"></canvas></div>
    </div>

    <div class="last-session-title" style="margin-bottom:8px;">Historial</div>
    <div id="weight-list" class="list"></div>
    `}
  `;

  mount.querySelector('#add-weight').addEventListener('click', () => openWeightForm(mount));
  if (!entries.length) return;

  renderList(mount, entries);
  renderChart(mount, entries);

  mount.querySelector('#period-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    state.period = btn.dataset.period;
    mount.querySelectorAll('#period-selector .period-chip').forEach((b) => b.classList.toggle('active', b === btn));
    renderChart(mount, entries);
  });
}

function changeText(value) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} kg`;
}

function renderList(mount, entries) {
  const list = mount.querySelector('#weight-list');
  list.innerHTML = entries.map((e) => `
    <div class="card row" data-id="${e.id}">
      <div>
        <div style="font-weight:600;">${formatWeight(e.weightKg)}</div>
        <div class="text-dim" style="font-size:13px;">${formatDate(e.date)}${e.notes ? ' · ' + e.notes : ''}</div>
      </div>
      <button class="btn btn-ghost btn-sm w-edit">Editar</button>
    </div>
  `).join('');
  list.querySelectorAll('[data-id]').forEach((row) => {
    row.querySelector('.w-edit').addEventListener('click', () => {
      const entry = entries.find((e) => e.id === row.dataset.id);
      openWeightForm(mount, entry);
    });
  });
}

function renderChart(mount, entries) {
  const filtered = filterByPeriodGeneric(entries, state.period).slice().reverse(); // ascendente
  const canvas = mount.querySelector('#weight-chart');
  if (chartInstance) chartInstance.destroy();
  if (!filtered.length) return;

  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: filtered.map((e) => formatDateShort(e.date)),
      datasets: [{
        data: filtered.map((e) => e.weightKg),
        borderColor: '#39ff88',
        backgroundColor: 'rgba(57,255,136,0.12)',
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
        x: { ticks: { color: '#9a9ea5', maxRotation: 0 }, grid: { color: '#2a2c30' } },
        y: { ticks: { color: '#9a9ea5' }, grid: { color: '#2a2c30' } },
      },
    },
  });
}

function openWeightForm(mount, existing) {
  const isEdit = !!existing;
  openSheet(`
    <h3 style="margin-bottom:16px;">${isEdit ? 'Editar registro' : 'Registrar peso'}</h3>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="f-date" value="${existing?.date || todayISO()}" />
    </div>
    <div class="field">
      <label class="label">Peso (kg)</label>
      <input type="number" inputmode="decimal" step="0.1" id="f-weight" value="${existing?.weightKg ?? ''}" autofocus />
    </div>
    <div class="field">
      <label class="label">Notas (opcional)</label>
      <input type="text" id="f-notes" value="${existing?.notes || ''}" />
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Guardar</button>
    ${isEdit ? `<button class="btn btn-danger btn-block" id="f-delete" style="margin-top:8px;">Eliminar</button>` : ''}
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async () => {
        const date = sheet.querySelector('#f-date').value;
        const weightKg = Number(sheet.querySelector('#f-weight').value);
        const notes = sheet.querySelector('#f-notes').value.trim();
        if (!date || !weightKg) { toast('Fecha y peso son obligatorios'); return; }
        if (isEdit) {
          await repo.updateBodyWeight(existing.id, { date, weightKg, notes });
        } else {
          await repo.addBodyWeight({ date, weightKg, notes });
        }
        close();
        await renderBodyWeight(mount);
      });
      sheet.querySelector('#f-delete')?.addEventListener('click', async () => {
        if (!confirmDialog('¿Eliminar este registro de peso?')) return;
        await repo.deleteBodyWeight(existing.id);
        close();
        await renderBodyWeight(mount);
      });
    },
  });
}
