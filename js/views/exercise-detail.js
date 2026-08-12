import * as repo from '../db/repository.js';
import { bestRecordsFromHistory, filterHistoryByPeriod, trendSeries, trendDirection } from '../core/stats.js';
import { compareSessions } from '../core/progression.js';
import { formatDate, formatDateShort, relativeDays, formatNumber } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { renderInsightCallout, getChartThemeColors } from '../core/ui.js';
import { getWeightProgressUnit } from '../core/settings.js';
import { toUnit, roundForDisplay } from '../core/units.js';
import { navigate } from '../app.js';

const PERIODS = [
  { key: '4w', label: '4 sem' },
  { key: '8w', label: '8 sem' },
  { key: '12w', label: '12 sem' },
  { key: '6m', label: '6 meses' },
  { key: '1y', label: '1 año' },
  { key: 'all', label: 'Todo' },
];

const METRICS = [
  { key: 'topWeight', label: 'Peso', unit: 'kg' },
  { key: 'topReps', label: 'Reps', unit: '' },
  { key: 'avgRir', label: 'RIR', unit: '' },
  { key: 'totalVolume', label: 'Volumen', unit: 'kg' },
];

let chartInstance = null;
const state = { period: '12w', metric: 'topWeight' };

export async function renderExerciseDetail(mount, { exerciseId }) {
  const exercise = await repo.getExercise(exerciseId);
  if (!exercise) {
    mount.innerHTML = `<div class="empty-state">Ejercicio no encontrado.</div>`;
    return;
  }

  const history = await repo.getExerciseHistory(exerciseId); // más reciente primero
  const records = bestRecordsFromHistory(history, { loadMode: exercise.loadMode });
  const unit = getWeightProgressUnit();
  const conv = (kg, decimals = 1) => (kg == null ? null : roundForDisplay(toUnit(kg, unit), decimals));

  mount.innerHTML = `
    <h1 class="type-title">${escapeHtml(exercise.name)}</h1>
    <div class="type-caption text-dim" style="margin-bottom:24px;">${exercise.muscleGroup ? escapeHtml(exercise.muscleGroup) : '&nbsp;'}</div>

    ${!history.length ? `<div class="empty-state">Todavía no hay sesiones registradas de este ejercicio.</div>` : `

    <div class="stat-hero">
      <div class="type-caption text-dim">Mejor peso</div>
      <div class="stat-hero-value">
        <span class="type-hero">${conv(records.bestWeight) ?? '—'}</span>
        ${records.bestWeight != null ? `<span class="type-headline text-dim">${unit}</span>` : ''}
      </div>
      <div class="type-caption text-faint">${records.bestWeightEntry ? `${records.bestWeightEntry.set.reps} reps · ${formatDateShort(records.bestWeightEntry.date)}` : ''}</div>
    </div>

    <div class="card stat-grid" style="margin-bottom:var(--space-5);">
      <div class="stat-tile">
        <div class="stat-label">Mejor volumen (sesión)</div>
        <div class="stat-value">${records.bestVolumeSession != null ? formatNumber(conv(records.bestVolumeSession, 0), 0) : '—'}</div>
        <div class="stat-sub">${unit} totales</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Más repeticiones</div>
        <div class="stat-value">${records.bestReps ?? '—'}</div>
        <div class="stat-sub">${records.bestRepsEntry ? `${conv(records.bestRepsEntry.set.weight)}${unit} · ${formatDateShort(records.bestRepsEntry.date)}` : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">1RM estimado</div>
        <div class="stat-value">${records.best1RM != null ? formatNumber(conv(records.best1RM), 1) : '—'}</div>
        <div class="stat-sub">${records.best1RM != null ? `${unit} · orientativo (Epley)` : 'orientativo (Epley)'}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Sesiones registradas</div>
        <div class="stat-value">${history.length}</div>
        <div class="stat-sub">&nbsp;</div>
      </div>
    </div>

    <div class="section-label">Comparativa reciente</div>
    <div id="comparison-box" style="margin-bottom:var(--space-5);"></div>

    <div class="row" style="margin-bottom:var(--space-3);">
      <div class="section-label" style="margin-bottom:0;">Evolución</div>
      <div class="type-caption text-dim" id="trend-label"></div>
    </div>
    <div class="segmented" id="metric-selector">
      ${METRICS.map((m) => `<button class="seg ${m.key === state.metric ? 'active' : ''}" data-metric="${m.key}">${m.label}</button>`).join('')}
    </div>
    <div class="period-selector" id="period-selector">
      ${PERIODS.map((p) => `<button class="period-chip ${p.key === state.period ? 'active' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}
    </div>
    <div class="chart-container" style="margin-bottom:var(--space-5);"><canvas id="trend-chart"></canvas></div>

    <div class="section-label">Historial</div>
    <div id="history-list"></div>
    `}
  `;

  if (!history.length) return;

  renderComparison(mount, history, unit, exercise.loadMode);
  renderHistoryList(mount, history, unit);

  mount.querySelector('#period-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    state.period = btn.dataset.period;
    mount.querySelectorAll('#period-selector .period-chip').forEach((b) => b.classList.toggle('active', b === btn));
    renderTrendChart(mount, history, unit, exercise.loadMode);
  });
  mount.querySelector('#metric-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-metric]');
    if (!btn) return;
    state.metric = btn.dataset.metric;
    mount.querySelectorAll('#metric-selector .seg').forEach((b) => b.classList.toggle('active', b === btn));
    renderTrendChart(mount, history, unit, exercise.loadMode);
  });

  renderTrendChart(mount, history, unit, exercise.loadMode);
}

function renderComparison(mount, history, unit, loadMode) {
  const box = mount.querySelector('#comparison-box');
  const [latest, previous] = history;
  if (!latest || !previous) {
    box.innerHTML = `<div class="type-body text-dim">Necesitas al menos dos sesiones para comparar.</div>`;
    return;
  }
  const comparison = compareSessions(latest.sets, previous.sets, { unit, loadMode });
  box.innerHTML = `
    <div class="type-caption text-faint" style="margin-bottom:8px;">
      ${relativeDays(latest.workout.date)} vs. ${relativeDays(previous.workout.date)}
    </div>
    ${comparison.insights.length
      ? comparison.insights.map(renderInsightCallout).join('')
      : `<div class="type-body text-dim">Sin cambios relevantes detectados.</div>`}
  `;
}

function renderHistoryList(mount, history, unit) {
  const list = mount.querySelector('#history-list');
  list.innerHTML = `<div class="grouped-list">${history.map((entry) => `
    <div class="grouped-row" data-workout-id="${entry.workout.id}" style="cursor:pointer;">
      <div>
        <div class="type-body" style="font-weight:600;">${formatDate(entry.workout.date)}</div>
        <div class="type-caption text-faint">
          ${entry.sets.filter((s) => s.weight != null).map((s) => `${roundForDisplay(toUnit(s.weight, unit), 1)}×${s.reps}${s.rir != null ? ` (RIR ${s.rir})` : ''}`).join(' · ') || 'Sin datos'}
        </div>
      </div>
      <span class="text-faint">›</span>
    </div>
  `).join('')}</div>`;
  list.querySelectorAll('[data-workout-id]').forEach((row) => {
    row.addEventListener('click', () => navigate(`/entreno/sesion/${row.dataset.workoutId}`));
  });
}

function renderTrendChart(mount, history, unit, loadMode) {
  const filtered = filterHistoryByPeriod(history, state.period);
  const series = trendSeries(filtered, state.metric, { loadMode }).filter((p) => p.value != null);
  const metricInfo = METRICS.find((m) => m.key === state.metric);
  const isWeightMetric = metricInfo.unit === 'kg';

  const label = mount.querySelector('#trend-label');
  const direction = trendDirection(series.map((p) => p.value));
  label.textContent = direction === 'up' ? '↑ al alza' : direction === 'down' ? '↓ a la baja' : '→ estable';

  const canvas = mount.querySelector('#trend-chart');
  if (chartInstance) chartInstance.destroy();

  if (!series.length) {
    chartInstance = null;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const colors = getChartThemeColors();
  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: series.map((p) => formatDateShort(p.date)),
      datasets: [{
        label: isWeightMetric ? `${metricInfo.label} (${unit})` : metricInfo.label,
        data: series.map((p) => (isWeightMetric ? toUnit(p.value, unit) : p.value)),
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
