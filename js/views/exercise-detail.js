import * as repo from '../db/repository.js';
import { bestRecordsFromHistory, filterHistoryByPeriod, trendSeries, trendDirection } from '../core/stats.js';
import { compareSessions } from '../core/progression.js';
import { formatDate, formatDateShort, relativeDays, formatNumber } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
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
  const records = bestRecordsFromHistory(history);

  mount.innerHTML = `
    <h1 style="font-size:22px;">${escapeHtml(exercise.name)}</h1>
    ${exercise.muscleGroup ? `<div class="text-dim" style="margin-bottom:16px;">${escapeHtml(exercise.muscleGroup)}</div>` : '<div style="margin-bottom:16px;"></div>'}

    ${!history.length ? `<div class="empty-state">Todavía no hay sesiones registradas de este ejercicio.</div>` : `

    <div class="grid-2" style="margin-bottom:20px;">
      <div class="stat-tile">
        <div class="stat-label">Mejor peso</div>
        <div class="stat-value">${records.bestWeight ?? '—'}${records.bestWeight != null ? ' kg' : ''}</div>
        <div class="stat-sub">${records.bestWeightEntry ? `${records.bestWeightEntry.set.reps} reps · ${formatDateShort(records.bestWeightEntry.date)}` : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Mejor volumen (sesión)</div>
        <div class="stat-value">${records.bestVolumeSession != null ? formatNumber(records.bestVolumeSession, 0) : '—'}</div>
        <div class="stat-sub">kg totales</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Más repeticiones</div>
        <div class="stat-value">${records.bestReps ?? '—'}</div>
        <div class="stat-sub">${records.bestRepsEntry ? `${records.bestRepsEntry.set.weight}kg · ${formatDateShort(records.bestRepsEntry.date)}` : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">1RM estimado</div>
        <div class="stat-value">${records.best1RM != null ? formatNumber(records.best1RM, 1) : '—'}${records.best1RM != null ? ' kg' : ''}</div>
        <div class="stat-sub">orientativo (Epley)</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="last-session-title" style="margin-bottom:10px;">Comparativa: última sesión vs. semana anterior</div>
      <div id="comparison-box"></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="row" style="margin-bottom:8px;">
        <div class="last-session-title">Evolución</div>
        <div class="text-dim" id="trend-label" style="font-size:13px;"></div>
      </div>
      <div class="period-selector" id="period-selector">
        ${PERIODS.map((p) => `<button class="period-chip ${p.key === state.period ? 'active' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}
      </div>
      <div class="subtabs" id="metric-selector" style="margin-bottom:8px;">
        ${METRICS.map((m) => `<button class="subtab ${m.key === state.metric ? 'active' : ''}" data-metric="${m.key}">${m.label}</button>`).join('')}
      </div>
      <div class="chart-container"><canvas id="trend-chart"></canvas></div>
    </div>

    <div class="last-session-title" style="margin-bottom:8px;">Historial</div>
    <div id="history-list" class="list"></div>
    `}
  `;

  if (!history.length) return;

  renderComparison(mount, history);
  renderHistoryList(mount, history);

  mount.querySelector('#period-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    state.period = btn.dataset.period;
    mount.querySelectorAll('#period-selector .period-chip').forEach((b) => b.classList.toggle('active', b === btn));
    renderTrendChart(mount, history);
  });
  mount.querySelector('#metric-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-metric]');
    if (!btn) return;
    state.metric = btn.dataset.metric;
    mount.querySelectorAll('#metric-selector .subtab').forEach((b) => b.classList.toggle('active', b === btn));
    renderTrendChart(mount, history);
  });

  renderTrendChart(mount, history);
}

function renderComparison(mount, history) {
  const box = mount.querySelector('#comparison-box');
  const [latest, previous] = history;
  if (!latest || !previous) {
    box.innerHTML = `<div class="text-dim">Necesitas al menos dos sesiones para comparar.</div>`;
    return;
  }
  const comparison = compareSessions(latest.sets, previous.sets);
  box.innerHTML = `
    <div class="text-dim" style="font-size:13px; margin-bottom:8px;">
      ${relativeDays(latest.workout.date)} vs. ${relativeDays(previous.workout.date)}
    </div>
    ${comparison.insights.length
      ? comparison.insights.map((i) => `<div class="insight ${i.level === 'good' ? 'insight-good' : i.level === 'warn' ? 'insight-warn' : ''}">${i.text}</div>`).join('')
      : `<div class="text-dim">Sin cambios relevantes detectados.</div>`}
  `;
}

function renderHistoryList(mount, history) {
  const list = mount.querySelector('#history-list');
  list.innerHTML = history.map((entry) => `
    <div class="card row" data-workout-id="${entry.workout.id}">
      <div>
        <div style="font-weight:600;">${formatDate(entry.workout.date)}</div>
        <div class="text-dim" style="font-size:13px;">
          ${entry.sets.filter((s) => s.weight != null).map((s) => `${s.weight}×${s.reps}${s.rir != null ? ` (RIR ${s.rir})` : ''}`).join(' · ') || 'Sin datos'}
        </div>
      </div>
      <span class="text-faint">›</span>
    </div>
  `).join('');
  list.querySelectorAll('[data-workout-id]').forEach((row) => {
    row.addEventListener('click', () => navigate(`/entreno/sesion/${row.dataset.workoutId}`));
  });
}

function renderTrendChart(mount, history) {
  const filtered = filterHistoryByPeriod(history, state.period);
  const series = trendSeries(filtered, state.metric).filter((p) => p.value != null);
  const metricInfo = METRICS.find((m) => m.key === state.metric);

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

  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: series.map((p) => formatDateShort(p.date)),
      datasets: [{
        label: metricInfo.label,
        data: series.map((p) => p.value),
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
