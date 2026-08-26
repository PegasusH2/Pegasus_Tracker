import * as repo from '../db/repository.js';
import { todayISO, formatDate, relativeDays } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openConfirmSheet, openExercisePickerSheet, TEMPLATE_ICONS, templateIconHtml } from '../core/ui.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';
import { describeRepsTarget } from '../core/progression.js';

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
        <span class="icon-badge icon-badge--lg" style="font-size:22px;">${templateIconHtml(template.icon)}</span>
        <h1 class="type-title">${escapeHtml(template.name)}</h1>
      </div>
      <button class="btn btn-ghost btn-sm" id="edit-template">Editar</button>
    </div>
    <div class="type-caption text-dim" style="margin-bottom:2px;">
      ${summary.exerciseCount} ejercicio${summary.exerciseCount === 1 ? '' : 's'} · ${summary.totalSets} series
    </div>
    <div class="type-caption text-faint" style="margin-bottom:${template.description ? '2px' : 'var(--space-5)'};">
      ${lastWorkout ? `Último entrenamiento · ${relativeDays(lastWorkout.date)}` : 'Todavía no has hecho esta rutina'}
    </div>
    ${template.description ? `<div class="type-body text-dim" style="margin-bottom:var(--space-5); white-space:pre-wrap;">${escapeHtml(template.description)}</div>` : ''}

    ${exercises.length ? `<button class="btn btn-primary btn-block" id="start-workout" style="margin-bottom:var(--space-5);">Empezar</button>` : ''}

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
  mount.querySelector('#start-workout')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const workout = await repo.startWorkoutFromTemplate(templateId, { date: todayISO() });
      navigate(`/entreno/sesion/${workout.id}`);
    } catch (err) {
      console.error('Error al empezar la rutina', err);
      toast('No se ha podido empezar el entrenamiento. Inténtalo de nuevo.');
      btn.disabled = false;
    }
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

const SET_TYPE_LABELS = { normal: 'Normal', fallo: 'Fallo', restpause: 'Rest-pause', descendente: 'Descendente', amrap: 'AMRAP' };

function targetSummary(te) {
  const parts = [`${te.targetSets} serie${te.targetSets === 1 ? '' : 's'}`];
  const reps = describeRepsTarget(te);
  if (reps) parts.push(reps);
  if (te.targetRir != null) parts.push(`RIR ${te.targetRir}`);
  if (te.targetRestSeconds != null) parts.push(`${te.targetRestSeconds}s descanso`);
  if (te.defaultSetType && te.defaultSetType !== 'normal') {
    parts.push(`${SET_TYPE_LABELS[te.defaultSetType]}${te.defaultLastSetOnly ? ' (última serie)' : ''}`);
  }
  return parts.join(' · ');
}

// Solo el tipo de serie por defecto + "solo última serie" se configuran aquí —
// los desgloses de rest-pause/descendente (bloques/escalones concretos) siguen
// siendo una decisión de la sesión real (workout-session.js), no de la plantilla.
function openTemplateExerciseForm(mount, template, { te, exercise, isNew }) {
  let setType = te?.defaultSetType ?? 'normal';
  let lastSetOnly = te?.defaultLastSetOnly ?? false;

  const close = openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">${escapeHtml(exercise.name)}</h3>
    <div class="field">
      <label class="label">Series objetivo</label>
      <input type="number" inputmode="numeric" id="te-sets" value="${te?.targetSets ?? 3}" />
    </div>
    <div class="field">
      <label class="label">Repeticiones objetivo (opcional)</label>
      <div class="row" style="gap:8px; align-items:center;">
        <input type="number" inputmode="numeric" id="te-reps-min" placeholder="Mín" value="${te?.targetRepsMin ?? ''}" style="flex:1;" />
        <span class="type-body text-faint">–</span>
        <input type="number" inputmode="numeric" id="te-reps-max" placeholder="Máx (opcional)" value="${te?.targetRepsMax ?? ''}" style="flex:1;" />
      </div>
      <div class="type-caption text-faint" style="margin-top:4px;">Deja "Máx" en blanco para una cantidad exacta (ej. solo "8" = 8 reps).</div>
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
      <label class="label">Tipo de serie por defecto</label>
      <button type="button" class="set-type-btn ${setType !== 'normal' ? 'set-type-btn--active' : ''}" id="te-type-btn">${SET_TYPE_LABELS[setType]} <span class="set-type-caret">▾</span></button>
      <div class="type-caption text-faint" style="margin-top:4px;">Cada vez que empieces esta rutina, las series se crearán ya marcadas con esta técnica.</div>
    </div>
    <div class="field" id="te-last-set-field" style="display:${setType !== 'normal' ? '' : 'none'};">
      <label class="checkbox-row">
        <input type="checkbox" id="te-last-set-only" ${lastSetOnly ? 'checked' : ''} />
        <span class="type-body">Solo en la última serie</span>
      </label>
    </div>
    <div class="field">
      <label class="label">Notas (opcional)</label>
      <textarea id="te-notes" rows="2">${escapeHtml(te?.notes || '')}</textarea>
    </div>
    <button class="btn btn-primary btn-block" id="te-save">${isNew ? 'Añadir a la rutina' : 'Guardar cambios'}</button>
    ${!isNew ? `<button class="btn btn-ghost-danger btn-block" id="te-remove" style="margin-top:8px;">Quitar de la rutina</button>` : ''}
  `, {
    onMount: (sheet) => {
      const typeBtn = sheet.querySelector('#te-type-btn');
      const lastSetField = sheet.querySelector('#te-last-set-field');
      const lastSetCheckbox = sheet.querySelector('#te-last-set-only');
      typeBtn.addEventListener('click', () => {
        openTypeChoiceSheet(setType, (newType) => {
          setType = newType;
          typeBtn.textContent = '';
          typeBtn.innerHTML = `${SET_TYPE_LABELS[setType]} <span class="set-type-caret">▾</span>`;
          typeBtn.classList.toggle('set-type-btn--active', setType !== 'normal');
          lastSetField.style.display = setType !== 'normal' ? '' : 'none';
        });
      });
      lastSetCheckbox.addEventListener('change', (e) => { lastSetOnly = e.target.checked; });

      sheet.querySelector('#te-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const targetSets = Number(sheet.querySelector('#te-sets').value) || 1;
          const repsMinRaw = sheet.querySelector('#te-reps-min').value;
          const repsMaxRaw = sheet.querySelector('#te-reps-max').value;
          const targetRepsMin = repsMinRaw === '' ? null : Number(repsMinRaw);
          const targetRepsMax = repsMaxRaw === '' ? targetRepsMin : Number(repsMaxRaw);
          const targetReps = targetRepsMax ?? targetRepsMin;
          const targetRir = sheet.querySelector('#te-rir').value === '' ? null : Number(sheet.querySelector('#te-rir').value);
          const targetRestSeconds = sheet.querySelector('#te-rest').value === '' ? null : Number(sheet.querySelector('#te-rest').value);
          const notes = sheet.querySelector('#te-notes').value.trim();
          const values = {
            targetSets, targetReps, targetRepsMin, targetRepsMax, targetRir, targetRestSeconds, notes,
            defaultSetType: setType,
            defaultLastSetOnly: setType !== 'normal' && lastSetOnly,
          };
          if (isNew) {
            await repo.addTemplateExercise(template.id, exercise.id, values);
          } else {
            await repo.updateTemplateExercise(te.id, values);
          }
          close();
          await renderTemplateDetail(mount, { templateId: template.id });
        } catch (err) {
          console.error('Error al guardar el ejercicio de la rutina', err);
          toast('No se ha podido guardar. Inténtalo de nuevo.');
          btn.disabled = false;
        }
      });
      sheet.querySelector('#te-remove')?.addEventListener('click', async () => {
        close();
        const ok = await openConfirmSheet(`¿Quitar "${exercise.name}" de esta rutina?`, { confirmLabel: 'Quitar' });
        if (!ok) return;
        try {
          await repo.removeTemplateExercise(te.id);
          await renderTemplateDetail(mount, { templateId: template.id });
        } catch (err) {
          console.error('Error al quitar el ejercicio de la rutina', err);
          toast('No se ha podido quitar el ejercicio.');
        }
      });
    },
  });
}

function openTypeChoiceSheet(current, onSelect) {
  const options = ['normal', 'fallo', 'restpause', 'descendente', 'amrap'];
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:12px;">Tipo de serie</h3>
    <div class="grouped-list">
      ${options.map((key) => `
        <div class="grouped-row" data-type="${key}" style="cursor:pointer;">
          <span class="type-body">${SET_TYPE_LABELS[key]}</span>
          ${key === current ? '<span class="text-faint">✓</span>' : ''}
        </div>
      `).join('')}
    </div>
  `, {
    onMount: (sheet, closeInner) => {
      sheet.querySelectorAll('[data-type]').forEach((row) => {
        row.addEventListener('click', () => { closeInner(); onSelect(row.dataset.type); });
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
      <label class="label">Descripción (opcional)</label>
      <textarea id="t-desc" rows="2" placeholder="Objetivo, enfoque, notas...">${escapeHtml(template.description || '')}</textarea>
    </div>
    <div class="field">
      <label class="label">Icono</label>
      <div class="icon-picker" id="icon-picker">
        ${TEMPLATE_ICONS.map((ic) => `<button class="icon-picker-opt ${ic.id === template.icon ? 'active' : ''}" data-icon="${ic.id}" aria-label="${ic.label}">${templateIconHtml(ic.id)}</button>`).join('')}
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
      sheet.querySelector('#t-save').addEventListener('click', async (e) => {
        const name = sheet.querySelector('#t-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const description = sheet.querySelector('#t-desc').value.trim();
          await repo.updateTemplate(template.id, { name, description, icon: selectedIcon });
          close();
          await renderTemplateDetail(mount, { templateId: template.id });
        } catch (err) {
          console.error('Error al guardar la rutina', err);
          toast('No se ha podido guardar. Inténtalo de nuevo.');
          btn.disabled = false;
        }
      });
      sheet.querySelector('#t-delete').addEventListener('click', async () => {
        close();
        const ok = await openConfirmSheet(`¿Eliminar la rutina "${template.name}"? Los entrenamientos que ya has hecho con ella no se verán afectados.`, { confirmLabel: 'Eliminar' });
        if (!ok) return;
        try {
          await repo.deleteTemplate(template.id);
          navigate('/entreno');
        } catch (err) {
          console.error('Error al eliminar la rutina', err);
          toast('No se ha podido eliminar la rutina.');
        }
      });
    },
  });
}
