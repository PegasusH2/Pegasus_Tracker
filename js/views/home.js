import * as repo from '../db/repository.js';
import { bodyWeightStats } from '../core/stats.js';
import { compareSessions } from '../core/progression.js';
import { todayISO, formatNumber } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { AVATAR_ICON, getChartThemeColors, templateIconHtml } from '../core/ui.js';
import { getUserName, getWeightProgressUnit } from '../core/settings.js';
import { toUnit, formatWeightUnit } from '../core/units.js';
import { navigate } from '../app.js';

const ICONS = {
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-3 4-3 8a3 3 0 1 0 6 0c0-1.2-.6-2-1-2.8.9.3 2 1.6 2 4a5 5 0 1 1-10 0C6 8 9 7 12 3Z"/></svg>`,
  trendUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l5-5 4 4 7-8"/><path d="M15 6h5v5"/></svg>`,
  dumbbell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9v6"/><path d="M4 10v4"/><path d="M18 9v6"/><path d="M20 10v4"/><path d="M6 12h12"/></svg>`,
};

const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const QUOTES = [
  { title: 'Entrena hoy, sé fuerte mañana.', subtitle: 'La disciplina de hoy construye la fuerza de mañana.' },
  { title: 'La constancia vence al talento.', subtitle: 'Un poco cada día pesa más que mucho de vez en cuando.' },
  { title: 'No cuenta el día perfecto.', subtitle: 'Cuenta el día que apareces aunque no tengas ganas.' },
  { title: 'El progreso no siempre se ve.', subtitle: 'A veces solo se siente — confía en el proceso.' },
  { title: 'Hoy suma, aunque sea poco.', subtitle: 'Cada serie registrada es una prueba de que sigues aquí.' },
  { title: 'Compite contigo de hace un mes.', subtitle: 'Esa es la única comparación que importa.' },
];

export async function renderHome(mount) {
  const today = new Date();
  const todayIso = todayISO();
  const [weightEntries, templates, workouts, exercises] = await Promise.all([
    repo.listBodyWeight(),
    repo.listTemplates(),
    repo.listWorkouts(),
    repo.listExercises(),
  ]);

  const weightStats = weightEntries.length ? bodyWeightStats(weightEntries) : null;
  const name = getUserName();
  const unit = getWeightProgressUnit();
  const quote = QUOTES[dayOfYear(today) % QUOTES.length];

  const monthWorkouts = workouts.filter((w) => w.date.startsWith(monthPrefix(today)));
  const daysTrainedThisMonth = new Set(monthWorkouts.map((w) => w.date)).size;
  const daysElapsed = today.getDate();
  const constancyPct = daysElapsed ? Math.min(100, Math.round((daysTrainedThisMonth / daysElapsed) * 100)) : 0;

  const trainedDates = new Set(workouts.map((w) => w.date));
  const weekDays = currentWeekDates(today);

  const weeklyCounts = lastWeeksCounts(workouts, today, 5);
  const improvements = await getRecentImprovements(exercises, 3, unit);
  const suggestedTemplate = await getSuggestedTemplate(templates);

  mount.innerHTML = `
    <div class="row" style="margin-bottom:var(--space-5); align-items:flex-start;">
      <div>
        <h1 class="type-title">${name ? `Hola, ${escapeHtml(name)}` : 'Inicio'}</h1>
        <div class="home-underline"></div>
      </div>
      <button class="avatar-badge" id="avatar-btn" aria-label="Ajustes">${AVATAR_ICON}</button>
    </div>

    <div class="quote-card" style="margin-bottom:var(--space-5);">
      <div class="quote-mark">&ldquo;</div>
      <div class="type-headline" style="font-size:19px; margin-bottom:4px;">${escapeHtml(quote.title)}</div>
      <div class="type-caption text-dim">${escapeHtml(quote.subtitle)}</div>
    </div>

    <div class="card" style="margin-bottom:var(--space-5);">
      <div class="row" style="margin-bottom:var(--space-4);">
        <div class="section-label" style="margin-bottom:0; display:flex; align-items:center; gap:6px;">
          <span style="width:16px; height:16px; display:inline-flex;">${ICONS.calendar}</span> Tu mes
        </div>
      </div>
      <div class="row" style="align-items:center;">
        <div>
          <div class="type-hero">${monthWorkouts.length}</div>
          <div class="type-caption text-dim">entrenos</div>
          <div class="type-caption text-faint">este mes</div>
        </div>
        ${progressRing(constancyPct)}
      </div>
      <div class="week-dots" style="margin-top:var(--space-4);">
        ${weekDays.map((d) => `
          <div class="week-dot-col">
            <span class="week-dot ${trainedDates.has(d.iso) ? 'active' : ''} ${d.iso === todayIso ? 'is-today' : ''}"></span>
            <span class="type-caption text-faint">${WEEKDAY_LETTERS[d.weekdayIdx]}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section-label">Tu progreso</div>
    <div class="grid-2" style="margin-bottom:var(--space-5);">
      <div class="card home-progress-tile" id="peso-tile" style="cursor:pointer;">
        <div class="home-tile-label"><span class="home-tile-icon">${ICONS.trendUp}</span> Peso</div>
        ${weightStats ? `
          <div class="type-headline" style="font-size:22px; margin:6px 0 1px;">${formatSignedDelta(weightStats.changeAbs, unit)}</div>
          <div class="type-caption text-faint" style="margin-bottom:8px;">desde el inicio</div>
          <div class="mini-sparkline"><canvas id="peso-spark"></canvas></div>
        ` : `<div class="type-body text-dim" style="margin-top:var(--space-3);">Sin datos</div>`}
      </div>
      <div class="card home-progress-tile" id="entrenos-tile" style="cursor:pointer;">
        <div class="home-tile-label"><span class="home-tile-icon">${ICONS.dumbbell}</span> Entrenos</div>
        <div class="type-headline" style="font-size:22px; margin:6px 0 1px;">${monthWorkouts.length}</div>
        <div class="type-caption text-faint" style="margin-bottom:8px;">este mes</div>
        <div class="mini-bars">
          ${weeklyCounts.map((c) => `<div class="mini-bar" style="height:${barHeight(c, weeklyCounts)}%;"></div>`).join('')}
        </div>
      </div>
    </div>

    ${improvements.length ? `
      <div class="section-label">Tus mejoras</div>
      <div class="mejoras-row" style="margin-bottom:var(--space-5);">
        ${improvements.map((m) => `
          <div class="mejora-tile" data-id="${m.exercise.id}">
            <span class="icon-badge icon-badge--accent">${ICONS.dumbbell}</span>
            <div class="type-caption" style="font-weight:700; margin-top:6px;">${escapeHtml(m.exercise.name)}</div>
            <div class="type-body" style="font-weight:700; color:var(--accent);">${m.deltaText}</div>
            <div class="type-caption text-faint">${m.caption}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${suggestedTemplate ? `
      <div class="section-label">Próximo entrenamiento</div>
      <div class="card" style="margin-bottom:var(--space-5); display:flex; align-items:center; gap:var(--space-3);">
        <span class="icon-badge icon-badge--lg" style="font-size:24px;">${templateIconHtml(suggestedTemplate.icon)}</span>
        <div style="flex:1; min-width:0;">
          <div class="type-headline">${escapeHtml(suggestedTemplate.name)}</div>
          <div class="type-caption text-faint" id="suggested-meta">&nbsp;</div>
        </div>
        <button class="btn btn-primary btn-sm" id="start-suggested">Empezar</button>
      </div>
    ` : ''}
  `;

  mount.querySelector('#avatar-btn').addEventListener('click', () => navigate('/ajustes'));
  mount.querySelector('#peso-tile').addEventListener('click', () => navigate('/progreso/peso'));
  mount.querySelector('#entrenos-tile').addEventListener('click', () => navigate('/entreno'));
  mount.querySelectorAll('.mejora-tile').forEach((el) => {
    el.addEventListener('click', () => navigate(`/entreno/ejercicio/${el.dataset.id}`));
  });

  if (weightStats) {
    const sparkValues = weightEntries.slice(0, 14).reverse().map((e) => toUnit(e.weightKg, unit));
    renderSparkline(mount.querySelector('#peso-spark'), sparkValues);
  }

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

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000);
}

function monthPrefix(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-`;
}

function currentWeekDates(today) {
  const weekdayIdx = (today.getDay() + 6) % 7; // 0 = lunes
  const monday = new Date(today);
  monday.setDate(today.getDate() - weekdayIdx);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push({ iso: isoDate(d), weekdayIdx: i });
  }
  return days;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Nº de entrenamientos por cada una de las últimas `count` semanas (lunes-domingo), más reciente al final.
function lastWeeksCounts(workouts, today, count) {
  const weekdayIdx = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - weekdayIdx);

  const counts = [];
  for (let w = count - 1; w >= 0; w--) {
    const start = new Date(thisMonday);
    start.setDate(thisMonday.getDate() - w * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startIso = isoDate(start);
    const endIso = isoDate(end);
    const n = new Set(workouts.filter((wk) => wk.date >= startIso && wk.date <= endIso).map((wk) => wk.date)).size;
    counts.push(n);
  }
  return counts;
}

function barHeight(value, all) {
  const max = Math.max(1, ...all);
  return Math.max(8, Math.round((value / max) * 100));
}

// El delta de peso es siempre neutro/informativo (nunca verde=bueno) — no
// conocemos el objetivo del usuario. Se muestra en rojo (acento) solo porque
// es el único color de énfasis de la app, no como juicio de "bien/mal".
function formatSignedDelta(kgValue, unit) {
  if (kgValue == null) return '—';
  const converted = toUnit(kgValue, unit);
  const sign = converted > 0 ? '+' : '';
  return `${sign}${formatNumber(converted, 1)} ${unit}`;
}

function progressRing(pct) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return `
    <svg width="76" height="76" viewBox="0 0 76 76" style="flex-shrink:0;">
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        transform="rotate(-90 38 38)"/>
      <foreignObject x="14" y="14" width="50" height="50">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:50px; height:50px; color:var(--accent);">
          <span style="width:14px; height:14px; display:inline-flex;">${ICONS.flame}</span>
          <span style="font-size:12px; font-weight:700; color:var(--text); margin-top:2px;">${pct}%</span>
        </div>
      </foreignObject>
    </svg>
  `;
}

function renderSparkline(canvas, values) {
  if (!canvas || values.length < 2) return;
  const colors = getChartThemeColors();
  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{
        data: values,
        borderColor: colors.accent,
        backgroundColor: colors.accentSoft,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      elements: { point: { radius: 0 } },
    },
  });
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

// Últimas mejoras detectadas por el motor de progresión (mismo criterio que
// las series individuales), resumidas en una frase corta por ejercicio.
async function getRecentImprovements(exercises, limit, unit) {
  const results = [];
  for (const exercise of exercises) {
    const history = await repo.getExerciseHistory(exercise.id);
    if (history.length < 2) continue;
    const comparison = compareSessions(history[0].sets, history[1].sets, { loadMode: exercise.loadMode, unit, compareVolume: false });
    const row = comparison.perSet.find((r) => ['big_progress', 'more_weight', 'more_reps', 'rir_improved'].includes(r.type));
    if (!row) continue;
    const info = improvementCaption(row, unit);
    if (!info) continue;
    results.push({ exercise, date: history[0].workout.date, ...info });
  }
  results.sort((a, b) => (a.date < b.date ? 1 : -1));
  return results.slice(0, limit);
}

function improvementCaption(row, unit) {
  switch (row.type) {
    case 'more_weight':
    case 'big_progress': {
      const delta = toUnit(row.curr.weight - row.prev.weight, unit);
      return { deltaText: `+${formatNumber(delta, 1)} ${unit}`, caption: 'desde tu mejor marca' };
    }
    case 'more_reps':
      return { deltaText: `+${row.curr.reps - row.prev.reps} reps`, caption: 'con el mismo peso' };
    case 'rir_improved':
      return { deltaText: `RIR ${row.prev.rir}→${row.curr.rir}`, caption: 'mismo trabajo, menos esfuerzo' };
    default:
      return null;
  }
}
