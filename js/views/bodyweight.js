import * as repo from '../db/repository.js';
import { bodyWeightStats, filterByPeriodGeneric, trendDirection } from '../core/stats.js';
import { todayISO, formatDate, formatDateShort } from '../core/format.js';
import { openSheet, openConfirmSheet, getChartThemeColors } from '../core/ui.js';
import { toKg, toUnit, roundForDisplay, formatWeightUnit, inputStep } from '../core/units.js';
import { getWeightProgressUnit, getWeightUnitsEnabled, getWeightLastInputUnit, setWeightLastInputUnit } from '../core/settings.js';
import { toast } from '../core/store.js';

const PERIODS = [
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: '3m', label: '3 meses' },
  { key: '6m', label: '6 meses' },
  { key: '1y', label: '1 año' },
  { key: 'all', label: 'Todo' },
];

let chartInstance = null;
const state = { period: '3m' };

export async function renderBodyWeight(mount) {
  const entries = await repo.listBodyWeight(); // desc
  const stats = bodyWeightStats(entries);
  const unit = getWeightProgressUnit();

  mount.innerHTML = `
    ${!entries.length ? `
      <div class="empty-state">Todavía no has registrado tu peso.</div>
      <button class="btn btn-primary btn-block" id="add-weight">+ Registrar peso</button>
    ` : `
    <div class="stat-hero">
      <div class="type-caption text-dim">Peso actual</div>
      <div class="stat-hero-value">
        <span class="type-hero">${displayNumber(stats.current, unit)}</span>
        <span class="type-headline text-dim">${unit}</span>
      </div>
      <div class="type-caption text-faint">Media semanal ${formatWeightUnit(stats.weeklyAvg, unit)}</div>
    </div>

    <div class="card stat-grid" style="margin-bottom:var(--space-4);">
      <div class="stat-tile">
        <div class="stat-label">Peso inicial</div>
        <div class="stat-value">${formatWeightUnit(stats.initial, unit)}</div>
        <div class="stat-sub">${formatDate(stats.initialDate)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Cambio total</div>
        <div class="stat-value">${changeText(stats.changeAbs, unit)}</div>
        <div class="stat-sub">${stats.changePercent != null ? changePercentText(stats.changePercent) : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Cambio semanal</div>
        <div class="stat-value">${changeText(stats.weeklyChange, unit)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Cambio mensual</div>
        <div class="stat-value">${changeText(stats.monthlyChange, unit)}</div>
      </div>
    </div>

    <button class="btn btn-secondary btn-block" id="add-weight" style="margin-bottom:var(--space-5);">+ Registrar peso</button>

    <div class="row" style="margin-bottom:var(--space-3);">
      <div class="section-label" style="margin-bottom:0;">Evolución</div>
      <div class="type-caption text-dim" id="trend-label"></div>
    </div>
    <div class="period-selector" id="period-selector">
      ${PERIODS.map((p) => `<button class="period-chip ${p.key === state.period ? 'active' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}
    </div>
    <div class="chart-container" style="margin-bottom:var(--space-5);"><canvas id="weight-chart"></canvas></div>

    <div class="section-label">Historial</div>
    <div id="weight-list"></div>
    `}
  `;

  mount.querySelector('#add-weight').addEventListener('click', () => openWeightForm(mount));
  if (!entries.length) return;

  renderList(mount, entries, unit);
  renderChart(mount, entries, unit);

  mount.querySelector('#period-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    state.period = btn.dataset.period;
    mount.querySelectorAll('#period-selector .period-chip').forEach((b) => b.classList.toggle('active', b === btn));
    renderChart(mount, entries, unit);
  });
}

function displayNumber(kg, unit) {
  if (kg == null) return '—';
  const v = roundForDisplay(toUnit(kg, unit), 1);
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, '');
}

// changeAbs viene en kg (delta crudo) — se convierte a la unidad de progreso antes de mostrarse.
function changeText(kgValue, unit) {
  if (kgValue == null) return '—';
  const converted = toUnit(kgValue, unit);
  const sign = converted > 0 ? '+' : '';
  return `${sign}${converted.toFixed(1)} ${unit}`;
}

// El % de cambio es invariante ante la unidad (misma proporción en kg o en lb).
function changePercentText(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} %`;
}

function renderList(mount, entries, unit) {
  const list = mount.querySelector('#weight-list');
  list.innerHTML = `<div class="grouped-list">${entries.map((e) => `
    <div class="grouped-row" data-id="${e.id}">
      <div>
        <div class="type-body num" style="font-weight:600;">${formatWeightUnit(e.weightKg, unit)}</div>
        <div class="type-caption text-faint">${formatDate(e.date)}${e.notes ? ' · ' + e.notes : ''}</div>
      </div>
      <button class="btn btn-ghost btn-sm w-edit">Editar</button>
    </div>
  `).join('')}</div>`;
  list.querySelectorAll('[data-id]').forEach((row) => {
    row.querySelector('.w-edit').addEventListener('click', () => {
      const entry = entries.find((e) => e.id === row.dataset.id);
      openWeightForm(mount, entry);
    });
  });
}

function renderChart(mount, entries, unit) {
  const filtered = filterByPeriodGeneric(entries, state.period).slice().reverse(); // ascendente
  const canvas = mount.querySelector('#weight-chart');
  const trendLabel = mount.querySelector('#trend-label');
  const direction = trendDirection(filtered.map((e) => e.weightKg));
  trendLabel.textContent = direction === 'up' ? '↑ al alza' : direction === 'down' ? '↓ a la baja' : '→ estable';
  if (chartInstance) chartInstance.destroy();
  if (!filtered.length) return;

  const colors = getChartThemeColors();
  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: filtered.map((e) => formatDateShort(e.date)),
      datasets: [{
        data: filtered.map((e) => toUnit(e.weightKg, unit)),
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

function openWeightForm(mount, existing) {
  const isEdit = !!existing;
  const enabledUnits = getWeightUnitsEnabled();
  const showToggle = enabledUnits.kg && enabledUnits.lb;
  let formUnit = getWeightLastInputUnit();
  // Valor canónico en kg, mantenido al margen del input — el toggle kg/lb
  // reconvierte siempre a partir de este valor, nunca desde el texto ya
  // redondeado en pantalla (evita drift acumulado al alternar unidades).
  let canonicalKg = existing ? existing.weightKg : null;

  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">${isEdit ? 'Editar registro' : 'Registrar peso'}</h3>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="f-date" value="${existing?.date || todayISO()}" />
    </div>
    <div class="field">
      <label class="label">Peso</label>
      ${showToggle ? `
        <div class="segmented" id="f-unit-toggle" style="margin-bottom:8px;">
          <button type="button" class="seg ${formUnit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
          <button type="button" class="seg ${formUnit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
        </div>
      ` : ''}
      <div class="row" style="align-items:baseline; gap:8px;">
        <input type="number" inputmode="decimal" step="${inputStep(formUnit, 'bodyWeight')}" id="f-weight" value="${canonicalKg != null ? roundForDisplay(toUnit(canonicalKg, formUnit), 1) : ''}" autofocus style="flex:1;" />
        <span class="type-headline text-dim" id="f-weight-unit">${formUnit}</span>
      </div>
    </div>
    <div class="field">
      <label class="label">Notas (opcional)</label>
      <input type="text" id="f-notes" value="${existing?.notes || ''}" />
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Guardar</button>
    ${isEdit ? `<button class="btn btn-ghost-danger btn-block" id="f-delete" style="margin-top:8px;">Eliminar</button>` : ''}
  `, {
    onMount: (sheet, close) => {
      const weightInput = sheet.querySelector('#f-weight');

      weightInput.addEventListener('input', () => {
        canonicalKg = toKg(weightInput.value, formUnit);
      });

      sheet.querySelector('#f-unit-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-unit]');
        if (!btn || btn.dataset.unit === formUnit) return;
        formUnit = btn.dataset.unit;
        weightInput.value = canonicalKg != null ? roundForDisplay(toUnit(canonicalKg, formUnit), 1) : '';
        weightInput.step = inputStep(formUnit, 'bodyWeight');
        sheet.querySelector('#f-weight-unit').textContent = formUnit;
        sheet.querySelectorAll('#f-unit-toggle .seg').forEach((b) => b.classList.toggle('active', b === btn));
      });

      sheet.querySelector('#f-save').addEventListener('click', async () => {
        const date = sheet.querySelector('#f-date').value;
        const weightKg = toKg(weightInput.value, formUnit);
        const notes = sheet.querySelector('#f-notes').value.trim();
        if (!date || !weightKg) { toast('Fecha y peso son obligatorios'); return; }
        if (isEdit) {
          await repo.updateBodyWeight(existing.id, { date, weightKg, notes });
        } else {
          await repo.addBodyWeight({ date, weightKg, notes });
        }
        await setWeightLastInputUnit(formUnit);
        close();
        await renderBodyWeight(mount);
      });
      sheet.querySelector('#f-delete')?.addEventListener('click', async () => {
        close();
        const ok = await openConfirmSheet('¿Eliminar este registro de peso?', { confirmLabel: 'Eliminar' });
        if (!ok) return;
        await repo.deleteBodyWeight(existing.id);
        await renderBodyWeight(mount);
      });
    },
  });
}
