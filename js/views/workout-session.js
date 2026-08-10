import * as repo from '../db/repository.js';
import { compareSessions } from '../core/progression.js';
import { formatDate, relativeDays } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet } from '../core/ui.js';
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
    <div class="row" style="margin-bottom:4px;">
      <h1 style="font-size:20px;" id="w-title">${escapeHtml(workout.name)}</h1>
      <button class="btn btn-ghost btn-sm" id="w-edit">Editar</button>
    </div>
    <div class="text-dim" style="margin-bottom:16px;">${formatDate(workout.date)}${workout.completed ? ' · <span class="text-good">Finalizado</span>' : ''}</div>

    <div id="exercise-cards" class="stack"></div>

    <button class="btn btn-secondary btn-block" id="add-exercise" style="margin-top:8px;">+ Añadir ejercicio</button>

    <div class="field" style="margin-top:20px;">
      <label class="label">Notas del entrenamiento</label>
      <textarea id="w-notes" rows="2">${escapeHtml(workout.notes || '')}</textarea>
    </div>

    <button class="btn ${workout.completed ? 'btn-secondary' : 'btn-primary'} btn-block" id="w-finish" style="margin-top:8px;">
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
    <h3 style="margin-bottom:16px;">Editar entrenamiento</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="e-name" value="${escapeHtml(workout.name)}" />
    </div>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="e-date" value="${workout.date}" />
    </div>
    <button class="btn btn-primary btn-block" id="e-save">Guardar</button>
    <button class="btn btn-danger btn-block" id="e-delete" style="margin-top:8px;">Eliminar entrenamiento</button>
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
  openSheet(`
    <h3 style="margin-bottom:16px;">Añadir ejercicio</h3>
    <input type="search" id="ex-search" placeholder="Buscar ejercicio..." style="margin-bottom:12px;" />
    <div id="ex-results" class="list"></div>
    <button class="btn btn-secondary btn-block" id="ex-create-new" style="margin-top:12px;">+ Crear ejercicio nuevo</button>
  `, {
    onMount: async (sheet, close) => {
      async function renderResults(search) {
        const results = await repo.listExercises({ search });
        const box = sheet.querySelector('#ex-results');
        if (!results.length) {
          box.innerHTML = `<div class="empty-state">Sin resultados.</div>`;
          return;
        }
        box.innerHTML = results.map((ex) => `
          <div class="card row" data-id="${ex.id}" style="padding:12px;">
            <span>${escapeHtml(ex.name)}</span>
            <button class="btn btn-primary btn-sm">Añadir</button>
          </div>
        `).join('');
        box.querySelectorAll('[data-id]').forEach((row) => {
          row.querySelector('button').addEventListener('click', async () => {
            await repo.addExerciseToWorkout(workoutId, row.dataset.id);
            close();
            await renderWorkoutSession(mount, { workoutId });
          });
        });
      }
      sheet.querySelector('#ex-search').addEventListener('input', (e) => renderResults(e.target.value));
      sheet.querySelector('#ex-create-new').addEventListener('click', () => {
        const name = sheet.querySelector('#ex-search').value.trim();
        openSheet(`
          <h3 style="margin-bottom:16px;">Nuevo ejercicio</h3>
          <div class="field">
            <label class="label">Nombre</label>
            <input type="text" id="new-ex-name" value="${escapeHtml(name)}" autofocus />
          </div>
          <div class="field">
            <label class="label">Grupo muscular (opcional)</label>
            <input type="text" id="new-ex-muscle" />
          </div>
          <button class="btn btn-primary btn-block" id="new-ex-save">Crear y añadir</button>
        `, {
          onMount: (sheet2, close2) => {
            sheet2.querySelector('#new-ex-save').addEventListener('click', async () => {
              const n = sheet2.querySelector('#new-ex-name').value.trim();
              if (!n) { toast('El nombre es obligatorio'); return; }
              const muscleGroup = sheet2.querySelector('#new-ex-muscle').value.trim();
              const ex = await repo.createExercise({ name: n, muscleGroup });
              await repo.addExerciseToWorkout(workoutId, ex.id);
              close2();
              close();
              await renderWorkoutSession(mount, { workoutId });
            });
          },
        });
      });
      await renderResults('');
    },
  });
}

async function renderExerciseCard(card, workout, exerciseId, workoutExerciseId) {
  const exercise = await repo.getExercise(exerciseId);
  const currentSets = await repo.getSetsForWorkoutExercise(workoutExerciseId);
  const lastEntry = await repo.getLastSessionForExercise(exerciseId, { excludeWorkoutId: workout.id });
  const lastSets = lastEntry?.sets ?? [];

  const completedCurrentSets = currentSets.filter((s) => s.weight != null && s.reps != null);
  const comparison = (completedCurrentSets.length && lastSets.length)
    ? compareSessions(currentSets, lastSets, { compareVolume: currentSets.length >= lastSets.length })
    : null;

  card.innerHTML = `
    <div class="exercise-card-header">
      <h3 class="ex-title-link" style="cursor:pointer;">${escapeHtml(exercise.name)}</h3>
      <button class="btn btn-ghost btn-sm remove-exercise">Quitar</button>
    </div>

    ${lastEntry ? `
      <div class="last-session">
        <div class="last-session-title">Última sesión · ${relativeDays(lastEntry.workout.date)}</div>
        ${lastSets.map((s) => `
          <div class="last-session-set">
            <span class="set-idx">S${s.setNumber}</span>
            <span>${s.weight ?? '—'}kg × ${s.reps ?? '—'}</span>
            <span class="text-dim">${s.rir != null ? `RIR ${s.rir}` : ''}</span>
          </div>
        `).join('') || '<span class="text-dim">Sin series registradas</span>'}
      </div>
    ` : `<div class="text-faint" style="margin-bottom:12px; font-size:13px;">Primera vez que registras este ejercicio.</div>`}

    <div class="last-session-title" style="margin-bottom:6px;">Sesión actual</div>
    <div class="set-headers"><span></span><span>Peso</span><span>Reps</span><span>RIR</span><span></span></div>
    <div class="sets-list"></div>
    <button class="btn btn-secondary btn-sm add-set" style="margin-top:8px;">+ Añadir serie</button>

    <div class="insights-box" style="margin-top:12px;"></div>
  `;

  const setsList = card.querySelector('.sets-list');
  setsList.innerHTML = currentSets.map((s) => `
    <div class="set-row" data-set-id="${s.id}">
      <span class="set-idx">${s.setNumber}</span>
      <input type="number" inputmode="decimal" step="0.5" class="input-weight" value="${s.weight ?? ''}" placeholder="kg" />
      <input type="number" inputmode="numeric" class="input-reps" value="${s.reps ?? ''}" placeholder="reps" />
      <input type="number" inputmode="numeric" min="0" max="10" class="input-rir" value="${s.rir ?? ''}" placeholder="RIR" />
      <button class="set-remove">✕</button>
    </div>
  `).join('');

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
  if (comparison && comparison.insights.length) {
    insightsBox.innerHTML = comparison.insights.map((i) => `
      <div class="insight ${i.level === 'good' ? 'insight-good' : i.level === 'warn' ? 'insight-warn' : ''}">${i.text}</div>
    `).join('');
  } else {
    insightsBox.innerHTML = '';
  }
}
