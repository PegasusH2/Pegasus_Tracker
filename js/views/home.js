import * as repo from '../db/repository.js';
import { bodyWeightStats } from '../core/stats.js';
import { todayISO } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { AVATAR_ICON } from '../core/ui.js';
import { getUserName, getWeightProgressUnit } from '../core/settings.js';
import { toUnit, formatWeightUnit } from '../core/units.js';
import { navigate } from '../app.js';

export async function renderHome(mount) {
  const [weightEntries, templates] = await Promise.all([
    repo.listBodyWeight(),
    repo.listTemplates(),
  ]);

  const weightStats = weightEntries.length ? bodyWeightStats(weightEntries) : null;
  const suggestedTemplate = await getSuggestedTemplate(templates);
  const name = getUserName();
  const unit = getWeightProgressUnit();

  mount.innerHTML = `
    <div class="row" style="margin-bottom:var(--space-5); align-items:flex-start;">
      <div>
        <div class="type-caption text-dim">${todayGreeting()}</div>
        <h1 class="type-title">${name ? `Hola, ${escapeHtml(name)}` : 'Inicio'}</h1>
      </div>
      <button class="avatar-badge" id="avatar-btn" aria-label="Ajustes">${AVATAR_ICON}</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-5); cursor:pointer;" id="weight-card">
      <div class="stat-hero" style="margin-bottom:0;">
        <div class="stat-hero-label">Peso actual</div>
        <div class="stat-hero-value">
          <span class="type-hero">${weightStats ? formatWeightUnit(weightStats.current, unit) : '—'}</span>
          <span class="stat-hero-delta text-dim">${weightStats ? formatDelta(weightStats.weeklyChange, unit) : 'Sin datos'}</span>
        </div>
      </div>
    </div>

    ${suggestedTemplate ? `
      <div class="section-label">Próximo entrenamiento</div>
      <div class="card" style="margin-bottom:var(--space-5); display:flex; align-items:center; gap:var(--space-3);">
        <span class="icon-badge icon-badge--lg" style="font-size:24px;">${suggestedTemplate.icon}</span>
        <div style="flex:1; min-width:0;">
          <div class="type-headline">${escapeHtml(suggestedTemplate.name)}</div>
          <div class="type-caption text-faint" id="suggested-meta">&nbsp;</div>
        </div>
        <button class="btn btn-primary btn-sm" id="start-suggested">Empezar</button>
      </div>
    ` : ''}

    <div class="grouped-row" id="go-progreso" style="cursor:pointer; background:var(--surface); border-radius:var(--radius-lg); box-shadow:var(--shadow-card);">
      <span class="type-body" style="font-weight:600;">Ver progreso completo</span>
      <span class="text-faint">›</span>
    </div>
  `;

  mount.querySelector('#avatar-btn').addEventListener('click', () => navigate('/ajustes'));
  mount.querySelector('#weight-card').addEventListener('click', () => navigate('/progreso/peso'));
  mount.querySelector('#go-progreso').addEventListener('click', () => navigate('/progreso'));

  if (suggestedTemplate) {
    const summary = await repo.getTemplateSummary(suggestedTemplate.id);
    mount.querySelector('#suggested-meta').textContent =
      `${summary.exerciseCount} ejercicio${summary.exerciseCount === 1 ? '' : 's'} · ${summary.totalSets} series`;
    mount.querySelector('#start-suggested').addEventListener('click', async () => {
      const workout = await repo.startWorkoutFromTemplate(suggestedTemplate.id, { date: todayISO() });
      navigate(`/entreno/sesion/${workout.id}`);
    });
  }
}

function todayGreeting() {
  return new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

// El delta es siempre informativo/neutro — la dirección de un cambio de peso
// no es "buena" o "mala" sin conocer el objetivo del usuario.
function formatDelta(kgValue, unit) {
  if (kgValue == null || Number.isNaN(kgValue)) return 'Sin datos';
  const converted = toUnit(kgValue, unit);
  if (Math.abs(converted) < 0.05) return '→ sin cambios';
  const arrow = converted > 0 ? '↑' : '↓';
  const n = Math.abs(converted).toFixed(1).replace(/\.0$/, '');
  return `${arrow} ${n} ${unit}`;
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
