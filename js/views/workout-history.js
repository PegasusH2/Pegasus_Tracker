import * as repo from '../db/repository.js';
import { formatDate, todayISO } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';

export async function renderWorkoutHistory(mount) {
  const workouts = await repo.listWorkouts();

  mount.innerHTML = `
    <button class="btn btn-primary btn-block" id="new-workout" style="margin-bottom:20px;">+ Nuevo entrenamiento</button>
    <div id="w-list" class="list"></div>
  `;

  mount.querySelector('#new-workout').addEventListener('click', () => navigate('/entreno/nuevo'));

  const listEl = mount.querySelector('#w-list');
  if (!workouts.length) {
    listEl.innerHTML = `<div class="empty-state">Todavía no has registrado ningún entrenamiento.</div>`;
    return;
  }

  const counts = await Promise.all(workouts.map((w) => repo.getWorkoutExerciseCount(w.id)));

  listEl.innerHTML = workouts.map((w, i) => `
    <div class="card workout-list-item" data-id="${w.id}">
      <div class="row">
        <div>
          <div style="font-weight:600;">${escapeHtml(w.name)}</div>
          <div class="text-dim" style="font-size:13px;">${formatDate(w.date)} · ${counts[i]} ejercicio${counts[i] === 1 ? '' : 's'}${w.completed ? ' · <span class="text-good">Finalizado</span>' : ''}</div>
        </div>
      </div>
      <div class="row">
        <button class="btn btn-secondary btn-sm w-open">Abrir</button>
        <button class="btn btn-ghost btn-sm w-repeat">Repetir entrenamiento</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-id]').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.w-open').addEventListener('click', () => navigate(`/entreno/sesion/${id}`));
    row.querySelector('.w-repeat').addEventListener('click', async () => {
      const original = workouts.find((w) => w.id === id);
      const today = todayISO();
      const newWorkout = await repo.repeatWorkout(id, {
        name: `${original.name} (repetido)`,
        date: today,
      });
      toast('Entrenamiento creado a partir del anterior');
      navigate(`/entreno/sesion/${newWorkout.id}`);
    });
  });
}
