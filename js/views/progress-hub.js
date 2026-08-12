import * as repo from '../db/repository.js';
import { bodyWeightStats, measurementValue, changeSinceFirst, neutralDirection } from '../core/stats.js';
import { formatNumber } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { getProgressSections, getWeightProgressUnit } from '../core/settings.js';
import { toUnit, formatWeightUnit } from '../core/units.js';
import { navigate } from '../app.js';

const DIRECTION_ARROW = { up: '↑', down: '↓', flat: '→' };

export async function renderProgressHub(mount) {
  const sections = getProgressSections();
  const [weightEntries, measurementTypes, skinfoldByDate] = await Promise.all([
    sections.peso ? repo.listBodyWeight() : Promise.resolve([]),
    sections.medidas ? repo.listMeasurementTypes() : Promise.resolve([]),
    sections.plicometro ? repo.listSkinfoldEntriesByDate() : Promise.resolve({}),
  ]);

  const weightUnit = getWeightProgressUnit();
  const weightStats = weightEntries.length ? bodyWeightStats(weightEntries) : null;
  const measureCards = await computeMeasureCards(measurementTypes);
  const skinfoldCard = computeSkinfoldCard(skinfoldByDate);
  const comparativeRows = await computeComparativeRows(weightStats, measurementTypes, skinfoldByDate, weightUnit);

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:4px;">Progreso</h1>
    <p class="type-caption text-dim" style="margin-bottom:var(--space-5);">
      Evolución reciente de tu peso, medidas y plicómetro.
    </p>

    <div class="section-label">Evolución reciente</div>
    <div class="list" style="margin-bottom:var(--space-5);" id="evolution-list"></div>

    ${comparativeRows.length ? `
      <div class="grouped-row" id="toggle-comparativa" style="cursor:pointer; margin-bottom:var(--space-2);">
        <span class="type-body" style="font-weight:600;">Ver comparativa (inicio vs. actual)</span>
        <span class="text-faint" id="comparativa-chevron">›</span>
      </div>
      <div class="card" style="margin-bottom:var(--space-5); overflow-x:auto; display:none;" id="comparativa-card">
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
            ${comparativeRows.map((r) => `
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
    ` : ''}

    <div class="grouped-row" id="analyze-progress" style="cursor:pointer; background:var(--surface); border-radius:var(--radius-lg); box-shadow:var(--shadow-card);">
      <span class="type-body" style="font-weight:600;">Analizar mi progreso</span>
      <span class="text-faint">›</span>
    </div>
  `;

  mount.querySelector('#analyze-progress').addEventListener('click', () => navigate('/progreso/ia'));
  mount.querySelector('#toggle-comparativa')?.addEventListener('click', () => {
    const card = mount.querySelector('#comparativa-card');
    const chevron = mount.querySelector('#comparativa-chevron');
    const open = card.style.display !== 'none';
    card.style.display = open ? 'none' : 'block';
    chevron.textContent = open ? '›' : '⌄';
  });

  const list = mount.querySelector('#evolution-list');
  const cards = [];

  if (weightStats) {
    cards.push(evolutionCard({
      label: 'Peso',
      value: formatWeightUnit(weightStats.current, weightUnit),
      direction: neutralDirection(weightStats.changeAbs ?? 0),
      deltaText: weightStats.changeAbs != null ? `${formatSignedUnit(weightStats.changeAbs, weightUnit)}` : 'Sin datos',
      path: '/progreso/peso',
    }));
  }
  if (measureCards.length) {
    const card = measureCards[0];
    cards.push(evolutionCard({
      label: card.name,
      value: `${formatNumber(card.value, 1)} ${card.unit}`,
      direction: neutralDirection(card.delta ?? 0),
      deltaText: card.delta != null ? `${formatSigned(card.delta)} ${card.unit}` : 'Sin datos previos',
      path: '/progreso/medidas',
    }));
  }
  if (skinfoldCard) {
    cards.push(evolutionCard({
      label: 'Plicómetro (suma)',
      value: `${skinfoldCard.value} mm`,
      direction: neutralDirection(skinfoldCard.delta ?? 0),
      deltaText: skinfoldCard.delta != null ? `${formatSigned(skinfoldCard.delta)} mm` : 'Sin datos previos',
      path: '/progreso/plicometro',
    }));
  }

  if (!cards.length) {
    list.innerHTML = `<div class="empty-state">Registra tu peso, medidas o plicómetro para ver aquí tu evolución.</div>`;
  } else {
    list.innerHTML = cards.join('');
    list.querySelectorAll('[data-path]').forEach((el) => {
      el.addEventListener('click', () => navigate(el.dataset.path));
    });
  }
}

function formatSigned(n) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, 1)}`;
}

// kgValue: delta crudo en kg — se convierte a `unit` antes de mostrarse.
function formatSignedUnit(kgValue, unit) {
  const converted = toUnit(kgValue, unit);
  return `${formatSigned(converted)} ${unit}`;
}

function evolutionCard({ label, value, direction, deltaText, path }) {
  return `
    <div class="card row" data-path="${path}" style="cursor:pointer;">
      <div>
        <div class="type-caption text-dim">${escapeHtml(label)}</div>
        <div class="type-headline" style="font-size:20px;">${value}</div>
      </div>
      <div style="text-align:right;">
        <span class="badge badge-neutral">${DIRECTION_ARROW[direction]} ${deltaText}</span>
      </div>
    </div>
  `;
}

async function computeMeasureCards(types) {
  const cards = [];
  for (const type of types) {
    const entries = await repo.listMeasurementsByType(type.id); // desc
    if (!entries.length) continue;
    const value = measurementValue(entries[0]);
    const prevValue = entries[1] ? measurementValue(entries[1]) : null;
    cards.push({
      name: type.name,
      unit: type.unit || 'cm',
      value,
      delta: prevValue != null ? value - prevValue : null,
      date: entries[0].date,
    });
  }
  cards.sort((a, b) => (a.date < b.date ? 1 : -1));
  return cards.slice(0, 1);
}

function computeSkinfoldCard(byDate) {
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return null;
  const sumFor = (d) => byDate[d].reduce((s, e) => s + e.valueMm, 0);
  const last = sumFor(dates[dates.length - 1]);
  const prev = dates.length > 1 ? sumFor(dates[dates.length - 2]) : null;
  return { value: last, delta: prev != null ? last - prev : null };
}

async function computeComparativeRows(weightStats, types, skinfoldByDate, weightUnit) {
  const rows = [];
  if (weightStats) {
    rows.push({
      label: 'Peso',
      initial: formatWeightUnit(weightStats.initial, weightUnit),
      current: formatWeightUnit(weightStats.current, weightUnit),
      change: formatSignedUnit(weightStats.changeAbs, weightUnit),
    });
  }
  for (const type of types) {
    const entries = await repo.listMeasurementsByType(type.id); // desc
    if (entries.length < 2) continue;
    const current = measurementValue(entries[0]);
    const initial = measurementValue(entries[entries.length - 1]);
    const { abs } = changeSinceFirst(current, initial);
    rows.push({
      label: type.name,
      initial: `${formatNumber(initial, 1)} ${type.unit || 'cm'}`,
      current: `${formatNumber(current, 1)} ${type.unit || 'cm'}`,
      change: `${formatSigned(abs)} ${type.unit || 'cm'}`,
    });
  }
  const dates = Object.keys(skinfoldByDate).sort();
  if (dates.length >= 2) {
    const sumFor = (d) => skinfoldByDate[d].reduce((s, e) => s + e.valueMm, 0);
    const initial = sumFor(dates[0]);
    const current = sumFor(dates[dates.length - 1]);
    rows.push({
      label: 'Suma pliegues',
      initial: `${initial} mm`,
      current: `${current} mm`,
      change: `${formatSigned(current - initial)} mm`,
    });
  }
  return rows;
}
