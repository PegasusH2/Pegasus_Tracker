import * as repo from '../db/repository.js';
import { compareSessions } from '../core/progression.js';
import { trendSeries } from '../core/stats.js';
import { formatDate, relativeDays } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openExercisePickerSheet, renderInsightCallout, getChartThemeColors, CHECK_ICON } from '../core/ui.js';
import { toast, confirmDialog } from '../core/store.js';
import { navigate } from '../app.js';

export async function renderWorkoutSession(mount, { workoutId }) {
  const detail = await repo.getWorkoutDetail(workoutId);
  if (!detail) {
    mount.innerHTML = `<div class="empty-state">Este entrenamiento no existe.</div>`;
    return;
  }
  const { workout, exercises } = detail;

  mount.innerHTML = `
    <div class="row" style="margin-bottom:2px; align-items:flex-start;">
      <h1 class="type-title" id="w-title">${escapeHtml(workout.name)}</h1>
      <button class="btn btn-ghost btn-sm" id="w-edit">Editar</button>
    </div>
    <div class="type-caption text-dim" style="margin-bottom:24px;">${formatDate(workout.date)}${workout.completed ? ' · <span class="text-good">Finalizado</span>' : ''}</div>

    <div id="exercise-cards" class="stack"></div>

    <button class="btn btn-secondary btn-block" id="add-exercise" style="margin-top:4px;">+ Añadir ejercicio</button>

    <div class="field" style="margin-top:28px;">
      <label class="label">Notas del entrenamiento</label>
      <textarea id="w-notes" rows="2" placeholder="Opcional">${escapeHtml(workout.notes || '')}</textarea>
    </div>

    <button class="btn ${workout.completed ? 'btn-secondary' : 'btn-primary'} btn-block" id="w-finish">
      ${workout.completed ? 'Reabrir entrenamiento' : 'Finalizar entrenamiento'}
    </button>
  `;

  const cardsContainer = mount.querySelector('#exercise-cards');
  if (!exercises.length) {
    cardsContainer.innerHTML = `<div class="empty-state">Añade tu primer ejercicio para empezar a registrar series.</div>`;
  } else {
    for (const we of exercises) {
      const card = document.createElement('div');
      card.className = 'card exercise-card';
      card.dataset.weId = we.id;
      cardsContainer.appendChild(card);
      await renderExerciseCard(card, workout, we.exerciseId, we.id);
    }
  }

  mount.querySelector('#w-edit').addEventListener('click', () => openWorkoutEditSheet(mount, workout));
  mount.querySelector('#w-notes').addEventListener('blur', async (e) => {
    await repo.updateWorkout(workout.id, { notes: e.target.value });
  });
  mount.querySelector('#w-finish').addEventListener('click', async () => {
    await repo.updateWorkout(workout.id, { completed: !workout.completed });
    await renderWorkoutSession(mount, { workoutId });
    toast(workout.completed ? 'Entrenamiento reabierto' : 'Entrenamiento finalizado');
  });
  mount.querySelector('#add-exercise').addEventListener('click', () => openAddExerciseSheet(mount, workoutId));
}

function openWorkoutEditSheet(mount, workout) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Editar entrenamiento</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="e-name" value="${escapeHtml(workout.name)}" />
    </div>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="e-date" value="${workout.date}" />
    </div>
    <button class="btn btn-primary btn-block" id="e-save">Guardar</button>
    <button class="btn btn-ghost-danger btn-block" id="e-delete" style="margin-top:8px;">Eliminar entrenamiento</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#e-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#e-name').value.trim() || workout.name;
        const date = sheet.querySelector('#e-date').value || workout.date;
        await repo.updateWorkout(workout.id, { name, date });
        close();
        await renderWorkoutSession(mount, { workoutId: workout.id });
      });
      sheet.querySelector('#e-delete').addEventListener('click', async () => {
        if (!confirmDialog('¿Eliminar este entrenamiento y todas sus series? Esta acción no se puede deshacer.')) return;
        await repo.deleteWorkout(workout.id);
        close();
        navigate('/entreno');
      });
    },
  });
}

function openAddExerciseSheet(mount, workoutId) {
  openExercisePickerSheet({
    onSelect: async (exercise) => {
      await repo.addExerciseToWorkout(workoutId, exercise.id);
      await renderWorkoutSession(mount, { workoutId });
    },
  });
}

async function renderExerciseCard(card, workout, exerciseId, workoutExerciseId) {
  const exercise = await repo.getExercise(exerciseId);
  const workoutExercise = await repo.getWorkoutExercise(workoutExerciseId);
  const currentSets = await repo.getSetsForWorkoutExercise(workoutExerciseId);
  const lastEntry = await repo.getLastSessionForExercise(exerciseId, { excludeWorkoutId: workout.id });
  const lastSets = lastEntry?.sets ?? [];

  const completedCurrentSets = currentSets.filter((s) => s.weight != null && s.reps != null);
  const comparison = (completedCurrentSets.length && lastSets.length)
    ? compareSessions(currentSets, lastSets, { compareVolume: currentSets.length >= lastSets.length })
    : null;

  const history = await repo.getExerciseHistory(exerciseId);
  const sparkValues = trendSeries(history, 'topWeight').map((p) => p.value).filter((v) => v != null);

  card.innerHTML = `
    <div class="exercise-card-header">
      <h3 class="ex-title-link" style="cursor:pointer;">${escapeHtml(exercise.name)}</h3>
      <button class="btn btn-ghost-danger btn-sm remove-exercise">Quitar</button>
    </div>
    ${targetCaption(workoutExercise)}

    ${lastEntry ? `
      <div class="last-session">
        <div class="section-label">Última sesión · ${relativeDays(lastEntry.workout.date)}</div>
        ${lastSets.map((s) => `
          <div class="last-session-set">
            <span class="set-idx num">${s.setNumber}</span>
            <span class="num">${s.weight ?? '—'} kg × ${s.reps ?? '—'}</span>
            <span class="text-faint">${s.rir != null ? `RIR ${s.rir}` : ''}</span>
          </div>
        `).join('') || '<span class="last-session-empty">Sin series registradas</span>'}
      </div>
    ` : `<div class="last-session-empty" style="margin-bottom:16px; display:block;">Primera vez que registras este ejercicio.</div>`}

    <div class="section-label">Hoy</div>
    <div class="sets-list"></div>
    <button class="btn btn-secondary btn-sm add-set" style="margin-top:10px;">+ Añadir serie</button>

    <div class="insights-box" style="margin-top:14px;"></div>
    ${sparkValues.length >= 2 ? `<div class="sparkline-container"><canvas class="sparkline-canvas"></canvas></div>` : ''}
  `;

  const setsList = card.querySelector('.sets-list');
  setsList.innerHTML = currentSets.map((s) => {
    const done = s.weight != null && s.reps != null;
    return `
    <div class="set-row" data-set-id="${s.id}">
      <span class="set-idx">${s.setNumber}</span>
      <div class="set-field">
        <input type="number" inputmode="decimal" step="0.5" class="input-weight" value="${s.weight ?? ''}" placeholder="—" />
        <span class="set-unit">kg</span>
      </div>
      <div class="set-field">
        <input type="number" inputmode="numeric" class="input-reps" value="${s.reps ?? ''}" placeholder="—" />
        <span class="set-unit">reps</span>
      </div>
      <div class="set-field">
        <input type="number" inputmode="numeric" min="0" max="10" class="input-rir" value="${s.rir ?? ''}" placeholder="—" />
        <span class="set-unit">RIR</span>
      </div>
      <span class="set-check ${done ? 'done' : ''}">${CHECK_ICON}</span>
      <button class="set-remove">✕</button>
    </div>
  `;
  }).join('');

  setsList.querySelectorAll('.set-row').forEach((row) => {
    const setId = row.dataset.setId;
    ['input-weight', 'input-reps', 'input-rir'].forEach((cls, i) => {
      const field = ['weight', 'reps', 'rir'][i];
      row.querySelector(`.${cls}`).addEventListener('blur', async (e) => {
        const raw = e.target.value;
        const value = raw === '' ? null : Number(raw);
        await repo.updateSet(setId, { [field]: value });
        await renderExerciseCard(card, workout, exerciseId, workoutExerciseId);
      });
    });
    row.querySelector('.set-remove').addEventListener('click', async () => {
      await repo.deleteSet(setId);
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId);
    });
  });

  card.querySelector('.add-set').addEventListener('click', async (e) => {
    e.target.disabled = true; // evita duplicar el número de serie si se pulsa varias veces rápido
    const template = lastSets[currentSets.length];
    await repo.addSet(workoutExerciseId, { weight: template?.weight ?? null, reps: template?.reps ?? null });
    await renderExerciseCard(card, workout, exerciseId, workoutExerciseId);
  });

  card.querySelector('.remove-exercise').addEventListener('click', async () => {
    if (!confirmDialog(`¿Quitar "${exercise.name}" de este entrenamiento?`)) return;
    await repo.removeExerciseFromWorkout(workoutExerciseId);
    card.remove();
  });

  card.querySelector('.ex-title-link').addEventListener('click', () => {
    navigate(`/entreno/ejercicio/${exerciseId}`);
  });

  const insightsBox = card.querySelector('.insights-box');
  insightsBox.innerHTML = comparison && comparison.insights.length
    ? comparison.insights.map(renderInsightCallout).join('')
    : '';

  const sparkCanvas = card.querySelector('.sparkline-canvas');
  if (sparkCanvas) renderSparkline(sparkCanvas, sparkValues);
}

// Objetivo planeado (congelado al crear la sesión desde una plantilla) — solo
// informativo, nunca se prellena en los campos de la serie salvo las reps.
function targetCaption(we) {
  if (!we) return '';
  const parts = [];
  if (we.targetReps != null) parts.push(`${we.targetReps} reps`);
  if (we.targetRir != null) parts.push(`RIR ${we.targetRir}`);
  if (we.targetRestSeconds != null) parts.push(`${we.targetRestSeconds}s descanso`);
  if (!parts.length) return '';
  return `<div class="type-caption text-faint" style="margin-bottom:10px;">Objetivo: ${parts.join(' · ')}</div>`;
}

function renderSparkline(canvas, values) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  if (values.length < 2) return;
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
