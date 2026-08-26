import * as repo from '../db/repository.js';
import { todayISO, formatDate } from '../core/format.js';
import { navigate } from '../app.js';
import { toast } from '../core/store.js';

export async function renderWorkoutNew(mount, { presetDate } = {}) {
  const date0 = presetDate || todayISO();
  const defaultName = `Entrenamiento ${formatDate(date0)}`;

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:24px;">Nuevo entrenamiento</h1>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="w-name" value="${defaultName}" />
    </div>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="w-date" value="${date0}" />
    </div>
    <button class="btn btn-primary btn-block" id="w-start">Empezar entrenamiento</button>
  `;

  mount.querySelector('#w-start').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const name = mount.querySelector('#w-name').value.trim() || defaultName;
      const date = mount.querySelector('#w-date').value || date0;
      const workout = await repo.createWorkout({ name, date });
      navigate(`/entreno/sesion/${workout.id}`);
    } catch (err) {
      console.error('Error al crear el entrenamiento', err);
      toast('No se ha podido crear el entrenamiento. Inténtalo de nuevo.');
      btn.disabled = false;
    }
  });
}
