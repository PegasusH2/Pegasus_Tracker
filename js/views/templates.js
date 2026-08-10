import * as repo from '../db/repository.js';
import { todayISO, formatDate, relativeDays } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openExercisePickerSheet, colorForId } from '../core/ui.js';
import { toast, confirmDialog } from '../core/store.js';
import { navigate } from '../app.js';

const TEMPLATE_ICONS = ['💪', '🦵', '🏋️', '🔥', '⚡', '🎯', '🏃', '🤸', '🧘', '🥊', '🦾', '🚴'];

export async function renderTemplateDetail(mount, { templateId }) {
  const template = await repo.getTemplate(templateId);
  if (!template) {
    mount.innerHTML = `<div class="empty-state">Esta rutina no existe.</div>`;
    return;
  }

  const [exercises, summary, lastWorkout] = await Promise.all([
    repo.getTemplateExercises(templateId),
    repo.getTemplateSummary(templateId),
    repo.getLastWorkoutForTemplate(templateId),
  ]);

  mount.innerHTML = `
    <div class="row" style="align-items:flex-start; margin-bottom:4px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <span class="icon-badge icon-badge--lg icon-badge--${colorForId(template.id)}" style="font-size:22px;">${template.icon}</span>
        <h1 class="type-title">${escapeHtml(template.name)}</h1>
      </div>
      <button class="btn btn-ghost btn-sm" id="edit-template">Editar</button>
    </div>
    <div class="type-caption text-dim" style="margin-bottom:2px;">
      ${summary.exerciseCount} ejercicio${summary.exerciseCount === 1 ? '' : 's'} · ${summary.totalSets} series
    </div>
    <div class="type-caption text-faint" style="margin-bottom:var(--space-5);">
      ${lastWorkout ? `Último entrenamiento · ${relativeDays(lastWorkout.date)}` : 'Todavía no has hecho esta rutina'}
    </div>

    <button class="btn btn-primary btn-block" id="start-workout" style="margin-bottom:var(--space-5);">Empezar</button>

    <div class="section-label">Ejercicios</div>
    <div id="template-exercise-list" style="margin-bottom:var(--space-4);"></div>
    <button class="btn btn-secondary btn-block" id="add-exercise">+ Añadir ejercicio</button>
  `;

  renderExerciseList(mount, template, exercises);

  mount.querySelector('#edit-template').addEventListener('click', () => openEditTemplateSheet(mount, template));
  mount.querySelector('#add-exercise').addEventListener('click', () => {
    openExercisePickerSheet({
      title: 'Añadir ejercicio a la rutina',
      onSelect: async (exercise) => {
        openTemplateExerciseForm(mount, template, { exercise, isNew: true });
      },
    });
  });
  mount.querySelector('#start-workout').addEventListener('click', async () => {
    if (!exercises.length) { toast('Añade al menos un ejercicio a la rutina antes de empezar'); return; }
    const workout = await repo.startWorkoutFromTemplate(templateId, { date: todayISO() });
    navigate(`/entreno/sesion/${workout.id}`);
  });
}

function renderExerciseList(mount, template, exercises) {
  const list = mount.querySelector('#template-exercise-list');
  if (!exercises.length) {
    list.innerHTML = `<div class="empty-state">Añade el primer ejercicio de esta rutina.</div>`;
    return;
  }
  list.innerHTML = `<div class="grouped-list">${exercises.map((te) => `
    <div class="grouped-row" data-id="${te.id}">
      <div style="flex:1; min-width:0; cursor:pointer;" class="te-edit">
        <div class="type-body" style="font-weight:600;">${escapeHtml(te.exercise?.name ?? 'Ejercicio eliminado')}</div>
        <div class="type-caption text-faint">${targetSummary(te)}</div>
      </div>
      <div style="display:flex;">
        <button class="icon-btn te-up" aria-label="Subir">↑</button>
        <button class="icon-btn te-down" aria-label="Bajar">↓</button>
      </div>
    </div>
  `).join('')}</div>`;

  list.querySelectorAll('[data-id]').forEach((row) => {
    const teId = row.dataset.id;
    const te = exercises.find((e) => e.id === teId);
    row.querySelector('.te-edit').addEventListener('click', () => openTemplateExerciseForm(mount, template, { te, exercise: te.exercise, isNew: false }));
    row.querySelector('.te-up').addEventListener('click', async () => {
      await repo.moveTemplateExercise(template.id, teId, -1);
      await renderTemplateDetail(mount, { templateId: template.id });
    });
    row.querySelector('.te-down').addEventListener('click', async () => {
      await repo.moveTemplateExercise(template.id, teId, 1);
      await renderTemplateDetail(mount, { templateId: template.id });
    });
  });
}

function targetSummary(te) {
  const parts = [`${te.targetSets} serie${te.targetSets === 1 ? '' : 's'}`];
  if (te.targetReps != null) parts.push(`${te.targetReps} reps`);
  if (te.targetRir != null) parts.push(`RIR ${te.targetRir}`);
  if (te.targetRestSeconds != null) parts.push(`${te.targetRestSeconds}s descanso`);
  return parts.join(' · ');
}

function openTemplateExerciseForm(mount, template, { te, exercise, isNew }) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">${escapeHtml(exercise.name)}</h3>
    <div class="field">
      <label class="label">Series objetivo</label>
      <input type="number" inputmode="numeric" id="te-sets" value="${te?.targetSets ?? 3}" />
    </div>
    <div class="field">
      <label class="label">Repeticiones objetivo (opcional)</label>
      <input type="number" inputmode="numeric" id="te-reps" value="${te?.targetReps ?? ''}" />
    </div>
    <div class="field">
      <label class="label">RIR objetivo (opcional)</label>
      <input type="number" inputmode="numeric" min="0" max="10" id="te-rir" value="${te?.targetRir ?? ''}" />
    </div>
    <div class="field">
      <label class="label">Descanso objetivo en segundos (opcional)</label>
      <input type="number" inputmode="numeric" id="te-rest" value="${te?.targetRestSeconds ?? ''}" />
    </div>
    <div class="field">
      <label class="label">Notas (opcional)</label>
      <textarea id="te-notes" rows="2">${escapeHtml(te?.notes || '')}</textarea>
    </div>
    <button class="btn btn-primary btn-block" id="te-save">${isNew ? 'Añadir a la rutina' : 'Guardar cambios'}</button>
    ${!isNew ? `<button class="btn btn-ghost-danger btn-block" id="te-remove" style="margin-top:8px;">Quitar de la rutina</button>` : ''}
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#te-save').addEventListener('click', async () => {
        const targetSets = Number(sheet.querySelector('#te-sets').value) || 1;
        const targetReps = sheet.querySelector('#te-reps').value === '' ? null : Number(sheet.querySelector('#te-reps').value);
        const targetRir = sheet.querySelector('#te-rir').value === '' ? null : Number(sheet.querySelector('#te-rir').value);
        const targetRestSeconds = sheet.querySelector('#te-rest').value === '' ? null : Number(sheet.querySelector('#te-rest').value);
        const notes = sheet.querySelector('#te-notes').value.trim();
        if (isNew) {
          await repo.addTemplateExercise(template.id, exercise.id, { targetSets, targetReps, targetRir, targetRestSeconds, notes });
        } else {
          await repo.updateTemplateExercise(te.id, { targetSets, targetReps, targetRir, targetRestSeconds, notes });
        }
        close();
        await renderTemplateDetail(mount, { templateId: template.id });
      });
      sheet.querySelector('#te-remove')?.addEventListener('click', async () => {
        if (!confirmDialog(`¿Quitar "${exercise.name}" de esta rutina?`)) return;
        await repo.removeTemplateExercise(te.id);
        close();
        await renderTemplateDetail(mount, { templateId: template.id });
      });
    },
  });
}

function openEditTemplateSheet(mount, template) {
  let selectedIcon = template.icon;
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Editar rutina</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="t-name" value="${escapeHtml(template.name)}" />
    </div>
    <div class="field">
      <label class="label">Icono</label>
      <div class="icon-picker" id="icon-picker">
        ${TEMPLATE_ICONS.map((ic) => `<button class="icon-picker-opt ${ic === template.icon ? 'active' : ''}" data-icon="${ic}">${ic}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="t-save">Guardar</button>
    <button class="btn btn-ghost-danger btn-block" id="t-delete" style="margin-top:8px;">Eliminar rutina</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#icon-picker').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-icon]');
        if (!btn) return;
        selectedIcon = btn.dataset.icon;
        sheet.querySelectorAll('.icon-picker-opt').forEach((b) => b.classList.toggle('active', b === btn));
      });
      sheet.querySelector('#t-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#t-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        await repo.updateTemplate(template.id, { name, icon: selectedIcon });
        close();
        await renderTemplateDetail(mount, { templateId: template.id });
      });
      sheet.querySelector('#t-delete').addEventListener('click', async () => {
        if (!confirmDialog(`¿Eliminar la rutina "${template.name}"? Los entrenamientos que ya has hecho con ella no se verán afectados.`)) return;
        await repo.deleteTemplate(template.id);
        close();
        navigate('/entreno');
      });
    },
  });
}
