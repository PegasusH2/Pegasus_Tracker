// Resumen de Progreso — la pantalla debe ser la más simple de las 4: UNA
// métrica principal (peso si está activo; si no, la primera medida o el
// plicómetro, lo que tenga datos) + una gráfica sencilla + dos accesos.
// Nada de listas de tarjetas ni tablas — eso vive en las pestañas dedicadas.
import * as repo from '../db/repository.js';
import { bodyWeightStats, measurementValue } from '../core/stats.js';
import { formatNumber, formatDateShort } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { getProgressSections, getWeightProgressUnit } from '../core/settings.js';
import { toUnit, formatWeightUnit, roundForDisplay } from '../core/units.js';
import { openSheet, getChartThemeColors, ACTION_ICONS } from '../core/ui.js';
import { navigate } from '../app.js';

let chartInstance = null;

export async function renderProgressHub(mount) {
  const sections = getProgressSections();
  const weightUnit = getWeightProgressUnit();

  const metric = await getPrimaryMetric(sections, weightUnit);
  const comparativeRows = await computeComparativeRows(sections, weightUnit);

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:var(--space-5);">Progreso</h1>

    ${!metric ? `
      <div class="empty-state">
        Registra tu peso, una medida o el plicómetro para ver aquí tu evolución.
      </div>
      <button class="btn btn-primary btn-block" id="empty-cta" style="margin-top:var(--space-4);">+ Registrar peso</button>
    ` : `
      <div class="stat-hero" style="margin-bottom:var(--space-4); cursor:pointer;" id="hero">
        <div class="type-caption text-dim">${metric.label}</div>
        <div class="stat-hero-value">
          <span class="type-hero">${metric.currentText}</span>
          <span class="type-headline text-dim">${metric.unit}</span>
        </div>
        ${metric.deltaText ? `<div class="type-body" style="font-weight:700; color:var(--accent); margin-top:2px;">${metric.deltaText} desde el inicio</div>` : ''}
      </div>
      <div class="chart-container" style="height:150px; margin-bottom:var(--space-5);"><canvas id="summary-chart"></canvas></div>
    `}

    <div class="action-card-list">
      ${comparativeRows.length ? `
        <button class="action-card" id="ver-comparativa">
          <span class="action-card-icon">${ACTION_ICONS.document}</span>
          <span class="action-card-body">
            <span class="action-card-title">Ver comparativa</span>
            <span class="action-card-desc">Inicio vs. actual</span>
          </span>
          <span class="action-card-chevron">${ACTION_ICONS.chevronRight}</span>
        </button>
      ` : ''}
      <button class="action-card" id="analyze-progress">
        <span class="action-card-icon">${ACTION_ICONS.bolt}</span>
        <span class="action-card-body">
          <span class="action-card-title">Analizar mi progreso</span>
          <span class="action-card-desc">Resumen con IA de tu evolución</span>
        </span>
        <span class="action-card-chevron">${ACTION_ICONS.chevronRight}</span>
      </button>
    </div>
  `;

  mount.querySelector('#analyze-progress').addEventListener('click', () => navigate('/progreso/ia'));
  mount.querySelector('#empty-cta')?.addEventListener('click', () => navigate('/progreso/peso'));
  mount.querySelector('#ver-comparativa')?.addEventListener('click', () => openComparativaSheet(comparativeRows));

  if (!metric) return;

  mount.querySelector('#hero').addEventListener('click', () => navigate(metric.path));
  renderChart(mount, metric);
}

function renderChart(mount, metric) {
  const canvas = mount.querySelector('#summary-chart');
  if (chartInstance) chartInstance.destroy();
  const filtered = metric.series; // desde el primer registro, sin recortar por periodo
  if (!filtered.length) return;

  const colors = getChartThemeColors();
  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: filtered.map((p) => formatDateShort(p.date)),
      datasets: [{
        data: filtered.map((p) => p.value),
        borderColor: colors.accent,
        backgroundColor: colors.accentSoft,
        tension: 0.3,
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: colors.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 4 }, grid: { display: false } },
        y: { ticks: { color: colors.ticks, maxTicksLimit: 4 }, grid: { color: colors.grid } },
      },
    },
  });
}

function formatSigned(n, decimals = 1) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, decimals)}`;
}

// Elige UNA métrica principal, por prioridad: peso > primera medida con datos
// > plicómetro. Nunca muestra más de una a la vez en el resumen.
async function getPrimaryMetric(sections, weightUnit) {
  if (sections.peso) {
    const entries = await repo.listBodyWeight(); // desc
    if (entries.length) {
      const stats = bodyWeightStats(entries);
      const asc = entries.slice().reverse();
      const currentInUnit = roundForDisplay(toUnit(stats.current, weightUnit), 1);
      return {
        label: 'Peso actual',
        unit: weightUnit,
        currentText: Number.isInteger(currentInUnit) ? String(currentInUnit) : currentInUnit.toFixed(1).replace(/\.0$/, ''),
        deltaText: stats.changeAbs != null ? `${arrow(stats.changeAbs)} ${formatSigned(toUnit(stats.changeAbs, weightUnit))} ${weightUnit}` : null,
        series: asc.map((e) => ({ date: e.date, value: toUnit(e.weightKg, weightUnit) })),
        path: '/progreso/peso',
      };
    }
  }
  if (sections.medidas) {
    const types = await repo.listMeasurementTypes();
    for (const type of types) {
      const entries = await repo.listMeasurementsByType(type.id); // desc
      if (!entries.length) continue;
      const asc = entries.slice().reverse();
      const current = measurementValue(entries[0]);
      const initial = measurementValue(entries[entries.length - 1]);
      const delta = current - initial;
      return {
        label: `${type.name} actual`,
        unit: type.unit || 'cm',
        currentText: formatNumber(current, 1),
        deltaText: entries.length > 1 ? `${arrow(delta)} ${formatSigned(delta)} ${type.unit || 'cm'}` : null,
        series: asc.map((e) => ({ date: e.date, value: measurementValue(e) })),
        path: '/progreso/medidas',
      };
    }
  }
  if (sections.plicometro) {
    const byDate = await repo.listSkinfoldEntriesByDate();
    const dates = Object.keys(byDate).sort();
    if (dates.length) {
      const sumFor = (d) => byDate[d].reduce((s, e) => s + e.valueMm, 0);
      const current = sumFor(dates[dates.length - 1]);
      const initial = sumFor(dates[0]);
      const delta = current - initial;
      return {
        label: 'Suma de pliegues',
        unit: 'mm',
        currentText: String(current),
        deltaText: dates.length > 1 ? `${arrow(delta)} ${formatSigned(delta, 0)} mm` : null,
        series: dates.map((d) => ({ date: d, value: sumFor(d) })),
        path: '/progreso/plicometro',
      };
    }
  }
  return null;
}

function arrow(n) {
  if (n == null || Math.abs(n) < 0.05) return '→';
  return n > 0 ? '↑' : '↓';
}

function openComparativaSheet(rows) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">Inicio vs. actual</h3>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:14px; white-space:nowrap;">
        <thead>
          <tr>
            <th style="text-align:left; padding-bottom:8px; color:var(--text-tertiary); font-size:11px; text-transform:uppercase;">Métrica</th>
            <th style="text-align:right; padding-bottom:8px; color:var(--text-tertiary); font-size:11px; text-transform:uppercase;">Inicio</th>
            <th style="text-align:right; padding-bottom:8px; color:var(--text-tertiary); font-size:11px; text-transform:uppercase;">Actual</th>
            <th style="text-align:right; padding-bottom:8px; color:var(--text-tertiary); font-size:11px; text-transform:uppercase;">Cambio</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr style="border-top:0.5px solid var(--border);">
              <td style="padding:8px 0; font-weight:600;">${escapeHtml(r.label)}</td>
              <td style="padding:8px 0; text-align:right; color:var(--text-secondary);">${r.initial}</td>
              <td style="padding:8px 0; text-align:right; font-weight:600;">${r.current}</td>
              <td style="padding:8px 0; text-align:right; color:var(--text-secondary);">${r.change}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `);
}

async function computeComparativeRows(sections, weightUnit) {
  const rows = [];
  if (sections.peso) {
    const entries = await repo.listBodyWeight();
    if (entries.length) {
      const stats = bodyWeightStats(entries);
      rows.push({
        label: 'Peso',
        initial: formatWeightUnit(stats.initial, weightUnit),
        current: formatWeightUnit(stats.current, weightUnit),
        change: `${formatSigned(toUnit(stats.changeAbs, weightUnit))} ${weightUnit}`,
      });
    }
  }
  if (sections.medidas) {
    const types = await repo.listMeasurementTypes();
    for (const type of types) {
      const entries = await repo.listMeasurementsByType(type.id);
      if (entries.length < 2) continue;
      const current = measurementValue(entries[0]);
      const initial = measurementValue(entries[entries.length - 1]);
      rows.push({
        label: type.name,
        initial: `${formatNumber(initial, 1)} ${type.unit || 'cm'}`,
        current: `${formatNumber(current, 1)} ${type.unit || 'cm'}`,
        change: `${formatSigned(current - initial)} ${type.unit || 'cm'}`,
      });
    }
  }
  if (sections.plicometro) {
    const byDate = await repo.listSkinfoldEntriesByDate();
    const dates = Object.keys(byDate).sort();
    if (dates.length >= 2) {
      const sumFor = (d) => byDate[d].reduce((s, e) => s + e.valueMm, 0);
      const initial = sumFor(dates[0]);
      const current = sumFor(dates[dates.length - 1]);
      rows.push({ label: 'Suma pliegues', initial: `${initial} mm`, current: `${current} mm`, change: `${formatSigned(current - initial, 0)} mm` });
    }
  }
  return rows;
}
