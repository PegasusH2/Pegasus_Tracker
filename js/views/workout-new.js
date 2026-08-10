import * as repo from '../db/repository.js';
import { todayISO, formatDate } from '../core/format.js';
import { navigate } from '../app.js';

export async function renderWorkoutNew(mount) {
  const today = todayISO();
  const defaultName = `Entrenamiento ${formatDate(today)}`;

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:24px;">Nuevo entrenamiento</h1>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="w-name" value="${defaultName}" />
    </div>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="w-date" value="${today}" />
    </div>
    <button class="btn btn-primary btn-block" id="w-start">Empezar entrenamiento</button>
  `;

  mount.querySelector('#w-start').addEventListener('click', async () => {
    const name = mount.querySelector('#w-name').value.trim() || defaultName;
    const date = mount.querySelector('#w-date').value || today;
    const workout = await repo.createWorkout({ name, date });
    navigate(`/entreno/sesion/${workout.id}`);
  });
}
