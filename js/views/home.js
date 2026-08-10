import * as repo from '../db/repository.js';
import { bodyWeightStats } from '../core/stats.js';
import { compareSessions } from '../core/progression.js';
import { formatDate, formatWeight, relativeDays, todayISO, daysAgoISO } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { renderInsightCallout, AVATAR_ICON, colorForId, NAV_ICONS } from '../core/ui.js';
import { navigate } from '../app.js';

const QUICK_ACTIONS = [
  {
    key: 'workout', label: 'Entreno', path: '/entreno', color: 'green',
    icon: NAV_ICONS.entreno,
  },
  {
    key: 'weight', label: 'Peso', path: '/progreso/peso', color: 'blue',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1"/></svg>`,
  },
  {
    key: 'measure', label: 'Medida', path: '/progreso/medidas', color: 'purple',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="1.5"/><path d="M7.5 9v3M12 9v3M16.5 9v3"/></svg>`,
  },
  {
    key: 'skinfold', label: 'Plicómetro', path: '/progreso/plicometro', color: 'amber',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M6 7l6-4 6 4"/><path d="M6 17l6 4 6-4"/></svg>`,
  },
];

export async function renderHome(mount) {
  const [weightEntries, measurementTypes, skinfoldByDate, templates, workouts, exercises] = await Promise.all([
    repo.listBodyWeight(),
    repo.listMeasurementTypes(),
    repo.listSkinfoldEntriesByDate(),
    repo.listTemplates(),
    repo.listWorkouts({ limit: 3 }),
    repo.listExercises(),
  ]);

  const weightStats = weightEntries.length ? bodyWeightStats(weightEntries) : null;
  const measureTile = await computeMeasureTile(measurementTypes);
  const skinfoldTile = computeSkinfoldTile(skinfoldByDate);
  const entrenoTile = await computeEntrenoTile();
  const suggestedTemplate = await getSuggestedTemplate(templates);
  const progressExercises = await getRecentProgressExercises(exercises, 2);

  mount.innerHTML = `
    <div class="row" style="margin-bottom:var(--space-5); align-items:flex-start;">
      <div>
        <div class="type-caption text-dim">${todayGreeting()}</div>
        <h1 class="type-title">Inicio</h1>
      </div>
      <button class="avatar-badge" id="avatar-btn" aria-label="Datos">${AVATAR_ICON}</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-5); cursor:pointer;" id="resumen-card">
      <div class="row" style="margin-bottom:var(--space-4);">
        <div class="section-label" style="margin-bottom:0;">Resumen general</div>
        <span class="text-faint">›</span>
      </div>
      <div class="resumen-grid">
        <div class="resumen-tile">
          <span class="icon-badge icon-badge--blue">${QUICK_ACTIONS[1].icon}</span>
          <span class="resumen-label">Peso actual</span>
          <span class="resumen-value">${weightStats ? formatWeight(weightStats.current) : '—'}</span>
          <span class="resumen-delta">${weightStats ? formatDelta(weightStats.weeklyChange, 'kg') : 'Sin datos'}</span>
        </div>
        <div class="resumen-tile">
          <span class="icon-badge icon-badge--purple">${QUICK_ACTIONS[2].icon}</span>
          <span class="resumen-label">${measureTile ? escapeHtml(measureTile.name) : 'Medidas'}</span>
          <span class="resumen-value">${measureTile ? `${measureTile.value} cm` : '—'}</span>
          <span class="resumen-delta">${measureTile ? formatDelta(measureTile.delta, 'cm') : 'Sin datos'}</span>
        </div>
        <div class="resumen-tile">
          <span class="icon-badge icon-badge--amber">${QUICK_ACTIONS[3].icon}</span>
          <span class="resumen-label">Plicómetro</span>
          <span class="resumen-value">${skinfoldTile ? `${skinfoldTile.value} mm` : '—'}</span>
          <span class="resumen-delta">${skinfoldTile ? formatDelta(skinfoldTile.delta, 'mm') : 'Sin datos'}</span>
        </div>
        <div class="resumen-tile">
          <span class="icon-badge icon-badge--green">${NAV_ICONS.entreno}</span>
          <span class="resumen-label">Series (7 días)</span>
          <span class="resumen-value">${entrenoTile.current}</span>
          <span class="resumen-delta">${formatDelta(entrenoTile.delta, '', 0)}</span>
        </div>
      </div>
    </div>

    ${suggestedTemplate ? `
      <div class="section-label">Próximo entrenamiento</div>
      <div class="card" style="margin-bottom:var(--space-5); display:flex; align-items:center; gap:var(--space-3);">
        <span class="icon-badge icon-badge--lg icon-badge--${colorForId(suggestedTemplate.id)}" style="font-size:24px;">${suggestedTemplate.icon}</span>
        <div style="flex:1; min-width:0;">
          <div class="type-headline">${escapeHtml(suggestedTemplate.name)}</div>
          <div class="type-caption text-faint" id="suggested-meta">&nbsp;</div>
        </div>
        <button class="btn btn-primary btn-sm" id="start-suggested">Empezar</button>
      </div>
    ` : ''}

    ${workouts.length ? `
      <div class="row" style="margin-bottom:var(--space-3);">
        <div class="section-label" style="margin-bottom:0;">Entrenamientos recientes</div>
        <button class="btn btn-ghost btn-sm" id="see-all-workouts" style="padding:0;">Ver todos</button>
      </div>
      <div class="grouped-list" style="margin-bottom:var(--space-5);" id="recent-workouts"></div>
    ` : ''}

    ${progressExercises.length ? `
      <div class="section-label">Progresión reciente</div>
      <div class="list" style="margin-bottom:var(--space-5);" id="progress-list"></div>
    ` : ''}

    <div class="section-label">Accesos rápidos</div>
    <div class="grid-2" style="margin-bottom:var(--space-5);" id="quick-actions">
      ${QUICK_ACTIONS.map((a) => `
        <button class="quick-action" data-path="${a.path}" style="background:none; display:flex; align-items:center; gap:10px; padding:0;">
          <span class="icon-badge icon-badge--${a.color}">${a.icon}</span>
          <span class="type-caption" style="color:var(--text); font-weight:600;">${a.label}</span>
        </button>
      `).join('')}
    </div>

    <div class="grouped-row" id="analyze-progress" style="cursor:pointer; background:var(--surface); border-radius:var(--radius-lg); box-shadow:var(--shadow-card);">
      <span class="type-body" style="font-weight:600;">Analizar mi progreso</span>
      <span class="text-faint">›</span>
    </div>
  `;

  mount.querySelector('#avatar-btn').addEventListener('click', () => navigate('/datos'));
  mount.querySelector('#resumen-card').addEventListener('click', () => navigate('/progreso'));
  mount.querySelector('#analyze-progress').addEventListener('click', () => navigate('/progreso/ia'));
  mount.querySelectorAll('.quick-action').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.path));
  });

  if (suggestedTemplate) {
    const summary = await repo.getTemplateSummary(suggestedTemplate.id);
    mount.querySelector('#suggested-meta').textContent =
      `${summary.exerciseCount} ejercicio${summary.exerciseCount === 1 ? '' : 's'} · ${summary.totalSets} series`;
    mount.querySelector('#start-suggested').addEventListener('click', async () => {
      const workout = await repo.startWorkoutFromTemplate(suggestedTemplate.id, { date: todayISO() });
      navigate(`/entreno/sesion/${workout.id}`);
    });
  }

  if (workouts.length) {
    mount.querySelector('#see-all-workouts').addEventListener('click', () => navigate('/entreno'));
    const rows = await Promise.all(workouts.map(async (w) => {
      const template = w.templateId ? await repo.getTemplate(w.templateId) : null;
      const count = await repo.getWorkoutExerciseCount(w.id);
      const icon = template ? template.icon : NAV_ICONS.entreno;
      const colorClass = template ? `icon-badge--${colorForId(template.id)}` : 'icon-badge';
      return `
        <div class="grouped-row" data-id="${w.id}" style="cursor:pointer;">
          <span class="icon-badge ${colorClass}" style="font-size:18px;">${icon}</span>
          <div style="flex:1; min-width:0;">
            <div class="type-body" style="font-weight:600;">${escapeHtml(w.name)}</div>
            <div class="type-caption text-faint">${formatDate(w.date)} · ${count} ejercicio${count === 1 ? '' : 's'}</div>
          </div>
          <span class="text-faint">›</span>
        </div>
      `;
    }));
    const listEl = mount.querySelector('#recent-workouts');
    listEl.innerHTML = rows.join('');
    listEl.querySelectorAll('[data-id]').forEach((row) => {
      row.addEventListener('click', () => navigate(`/entreno/sesion/${row.dataset.id}`));
    });
  }

  if (progressExercises.length) {
    mount.querySelector('#progress-list').innerHTML = progressExercises.map((p) => `
      <div class="card" data-id="${p.exercise.id}" style="cursor:pointer;">
        <div class="type-headline" style="margin-bottom:6px;">${escapeHtml(p.exercise.name)}</div>
        ${renderInsightCallout(p.insight)}
      </div>
    `).join('');
    mount.querySelectorAll('#progress-list [data-id]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/entreno/ejercicio/${el.dataset.id}`));
    });
  }
}

function todayGreeting() {
  return new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Los deltas son siempre informativos/neutros — la dirección de un cambio de
// peso o de medida no es "buena" o "mala" sin conocer el objetivo del usuario.
function formatDelta(value, unit, decimals = 1) {
  if (value == null || Number.isNaN(value)) return 'Sin datos';
  if (Math.abs(value) < (decimals === 0 ? 1 : 0.05)) return '→ sin cambios';
  const arrow = value > 0 ? '↑' : '↓';
  const n = Math.abs(value).toFixed(decimals).replace(/\.0$/, '');
  return `${arrow} ${n}${unit ? ' ' + unit : ''}`;
}

async function computeMeasureTile(types) {
  let best = null;
  for (const type of types) {
    const entries = await repo.listMeasurementsByType(type.id); // desc
    if (!entries.length) continue;
    if (!best || entries[0].date > best.date) {
      best = {
        name: type.name,
        value: entries[0].valueCm,
        delta: entries[1] ? entries[0].valueCm - entries[1].valueCm : null,
        date: entries[0].date,
      };
    }
  }
  return best;
}

function computeSkinfoldTile(byDate) {
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return null;
  const sumFor = (d) => byDate[d].reduce((s, e) => s + e.valueMm, 0);
  const last = sumFor(dates[dates.length - 1]);
  const prev = dates.length > 1 ? sumFor(dates[dates.length - 2]) : null;
  return { value: last, delta: prev != null ? last - prev : null };
}

async function computeEntrenoTile() {
  const today = todayISO();
  const current = await repo.countSetsInRange(daysAgoISO(6), today);
  const previous = await repo.countSetsInRange(daysAgoISO(13), daysAgoISO(7));
  return { current, delta: current - previous };
}

async function getSuggestedTemplate(templates) {
  if (!templates.length) return null;
  const withDates = await Promise.all(templates.map(async (t) => {
    const last = await repo.getLastWorkoutForTemplate(t.id);
    return { template: t, lastDate: last?.date ?? null };
  }));
  withDates.sort((a, b) => {
    if (a.lastDate === b.lastDate) return 0;
    if (!a.lastDate) return -1;
    if (!b.lastDate) return 1;
    return a.lastDate < b.lastDate ? -1 : 1;
  });
  return withDates[0].template;
}

async function getRecentProgressExercises(exercises, limit) {
  const results = [];
  for (const exercise of exercises) {
    const history = await repo.getExerciseHistory(exercise.id);
    if (history.length < 2) continue;
    const comparison = compareSessions(history[0].sets, history[1].sets);
    const goodInsight = comparison.insights.find((i) => i.level === 'good');
    if (goodInsight) results.push({ exercise, insight: goodInsight, date: history[0].workout.date });
  }
  results.sort((a, b) => (a.date < b.date ? 1 : -1));
  return results.slice(0, limit);
}
