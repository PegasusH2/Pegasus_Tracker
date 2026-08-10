import * as repo from '../db/repository.js';
import { bodyWeightStats } from '../core/stats.js';
import { compareSessions } from '../core/progression.js';
import { formatDate, formatWeight, relativeDays } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { navigate } from '../app.js';

export async function renderHome(mount) {
  const [weightEntries, workouts, measurementTypes, exercises] = await Promise.all([
    repo.listBodyWeight(),
    repo.listWorkouts({ limit: 5 }),
    repo.listMeasurementTypes(),
    repo.listExercises(),
  ]);

  const weightStats = weightEntries.length ? bodyWeightStats(weightEntries) : null;
  const lastWorkout = workouts[0] ?? null;
  const progressExercises = await getRecentProgressExercises(exercises, 3);
  const recentMeasurements = await getRecentMeasurements(measurementTypes, 3);

  mount.innerHTML = `
    <h1 style="font-size:24px; margin-bottom:16px;">Hola 👋</h1>

    <div class="grid-2" style="margin-bottom:20px;">
      <button class="btn btn-secondary" id="q-workout">+ Entrenamiento</button>
      <button class="btn btn-secondary" id="q-weight">+ Peso</button>
      <button class="btn btn-secondary" id="q-measure">+ Medida</button>
      <button class="btn btn-secondary" id="q-skinfold">+ Plicómetro</button>
    </div>

    <div class="card" style="margin-bottom:16px;" id="weight-card">
      <div class="last-session-title" style="margin-bottom:8px;">Peso</div>
      ${weightStats ? `
        <div class="row">
          <div>
            <div class="stat-value">${formatWeight(weightStats.current)}</div>
            <div class="text-dim" style="font-size:13px;">Media semanal: ${formatWeight(weightStats.weeklyAvg)}</div>
          </div>
          <div class="${weightStats.weeklyChange > 0 ? 'text-warn' : weightStats.weeklyChange < 0 ? 'text-good' : 'text-dim'}" style="font-size:15px; font-weight:600;">
            ${weightStats.weeklyChange != null ? (weightStats.weeklyChange > 0 ? '+' : '') + weightStats.weeklyChange.toFixed(1) + ' kg' : ''}
          </div>
        </div>
      ` : `<div class="text-dim">Sin registros todavía.</div>`}
    </div>

    <div class="card" style="margin-bottom:16px;" id="last-workout-card">
      <div class="last-session-title" style="margin-bottom:8px;">Último entrenamiento</div>
      ${lastWorkout ? `
        <div style="font-weight:600;">${escapeHtml(lastWorkout.name)}</div>
        <div class="text-dim" style="font-size:13px;">${formatDate(lastWorkout.date)} · ${relativeDays(lastWorkout.date)}</div>
      ` : `<div class="text-dim">Todavía no has registrado ningún entrenamiento.</div>`}
    </div>

    ${progressExercises.length ? `
      <div class="last-session-title" style="margin-bottom:8px;">Progresión reciente</div>
      <div class="list" style="margin-bottom:16px;" id="progress-list"></div>
    ` : ''}

    ${recentMeasurements.length ? `
      <div class="last-session-title" style="margin-bottom:8px;">Últimas medidas</div>
      <div class="list" style="margin-bottom:16px;" id="measurements-list"></div>
    ` : ''}

    <button class="btn btn-secondary btn-block" id="analyze-progress" style="margin-top:8px;">Analizar mi progreso</button>
  `;

  mount.querySelector('#q-workout').addEventListener('click', () => navigate('/entreno/nuevo'));
  mount.querySelector('#q-weight').addEventListener('click', () => navigate('/progreso/peso'));
  mount.querySelector('#q-measure').addEventListener('click', () => navigate('/progreso/medidas'));
  mount.querySelector('#q-skinfold').addEventListener('click', () => navigate('/progreso/plicometro'));
  mount.querySelector('#analyze-progress').addEventListener('click', () => navigate('/progreso/ia'));
  if (lastWorkout) {
    mount.querySelector('#last-workout-card').addEventListener('click', () => navigate(`/entreno/sesion/${lastWorkout.id}`));
    mount.querySelector('#last-workout-card').style.cursor = 'pointer';
  }
  if (weightStats) {
    mount.querySelector('#weight-card').addEventListener('click', () => navigate('/progreso/peso'));
    mount.querySelector('#weight-card').style.cursor = 'pointer';
  }

  if (progressExercises.length) {
    mount.querySelector('#progress-list').innerHTML = progressExercises.map((p) => `
      <div class="card" data-id="${p.exercise.id}" style="cursor:pointer;">
        <div class="row">
          <span style="font-weight:600;">${escapeHtml(p.exercise.name)}</span>
        </div>
        <div class="insight insight-good" style="margin-top:6px; margin-bottom:0;">${p.insight.text}</div>
      </div>
    `).join('');
    mount.querySelectorAll('#progress-list [data-id]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/entreno/ejercicio/${el.dataset.id}`));
    });
  }

  if (recentMeasurements.length) {
    mount.querySelector('#measurements-list').innerHTML = recentMeasurements.map((m) => `
      <div class="card row">
        <span>${escapeHtml(m.typeName)}</span>
        <span style="font-weight:600;">${m.valueCm} cm <span class="text-dim" style="font-weight:400;">· ${formatDate(m.date)}</span></span>
      </div>
    `).join('');
  }
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

async function getRecentMeasurements(types, limit) {
  const results = [];
  for (const type of types) {
    const entries = await repo.listMeasurementsByType(type.id);
    if (entries.length) results.push({ typeName: type.name, valueCm: entries[0].valueCm, date: entries[0].date });
  }
  results.sort((a, b) => (a.date < b.date ? 1 : -1));
  return results.slice(0, limit);
}
