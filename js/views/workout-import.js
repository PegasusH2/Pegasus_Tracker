// Importar entrenamiento desde foto — la IA solo interpreta la imagen; esta
// vista es la única responsable de guardar datos, y solo lo hace después de
// que el usuario revise/corrija y pulse "Crear rutina". El resultado es una
// RUTINA reutilizable (como "DIA 1"), no un entreno ya registrado — usa
// exactamente las mismas funciones de repository.js que una plantilla creada
// a mano (createTemplate/addTemplateExercise) — nada paralelo.
import * as repo from '../db/repository.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openExercisePickerSheet } from '../core/ui.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';
import { analyzeWorkoutPhoto } from '../core/ai-import.js';
import { matchExerciseName } from '../core/exercise-match.js';

const SET_TYPE_LABELS = { normal: 'Normal', fallo: 'Fallo', restpause: 'Rest-pause', descendente: 'Descendente' };

export async function renderWorkoutImport(mount) {
  renderPicker(mount);
}

function renderPicker(mount) {
  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:8px;">Importar desde foto</h1>
    <p class="type-body text-dim" style="margin-bottom:var(--space-5);">
      Haz una foto de tu rutina (papel, pizarra, captura de pantalla) y la IA la convierte en un entrenamiento.
      Podrás revisar y corregir todo antes de guardar nada.
    </p>
    <input type="file" accept="image/*" id="photo-input" style="display:none;" />
    <button class="btn btn-primary btn-block" id="pick-photo">📷 Hacer foto o elegir de la galería</button>
    <button class="btn btn-ghost btn-block" id="manual-instead" style="margin-top:8px;">Crear manualmente</button>
  `;
  const input = mount.querySelector('#photo-input');
  mount.querySelector('#pick-photo').addEventListener('click', () => input.click());
  mount.querySelector('#manual-instead').addEventListener('click', () => navigate('/entreno/nuevo'));
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    await renderAnalyzing(mount, file);
  });
}

async function renderAnalyzing(mount, file) {
  mount.innerHTML = `
    <div class="empty-state" style="margin-top:80px;">
      <div class="type-headline" style="margin-bottom:8px;">Analizando tu entrenamiento…</div>
      <div class="type-body text-dim">Esto tarda unos segundos.</div>
    </div>
  `;
  try {
    const result = await analyzeWorkoutPhoto(file);
    await renderReview(mount, result, file);
  } catch (err) {
    console.error(err);
    renderError(mount, file);
  }
}

function renderError(mount, file) {
  mount.innerHTML = `
    <div class="empty-state" style="margin-top:60px;">
      <div class="type-headline" style="margin-bottom:8px;">No hemos podido interpretar esta imagen.</div>
    </div>
    <button class="btn btn-primary btn-block" id="retry" style="margin-top:var(--space-4);">Intentar de nuevo</button>
    <button class="btn btn-secondary btn-block" id="other-photo" style="margin-top:8px;">Elegir otra foto</button>
    <button class="btn btn-ghost btn-block" id="manual" style="margin-top:8px;">Crear manualmente</button>
  `;
  mount.querySelector('#retry').addEventListener('click', () => renderAnalyzing(mount, file));
  mount.querySelector('#other-photo').addEventListener('click', () => renderPicker(mount));
  mount.querySelector('#manual').addEventListener('click', () => navigate('/entreno/nuevo'));
}

async function renderReview(mount, result, file) {
  const existing = await repo.listExercises();
  const items = result.exercises.map((e, i) => {
    const match = matchExerciseName(e.recognizedName, existing);
    return { tempId: `t${i}`, ...e, matchedExercise: match?.exercise ?? null };
  });
  const state = { workoutName: result.workoutName, items, unrecognized: result.unrecognized };
  paintReview(mount, state, file);
}

function paintReview(mount, state, file) {
  const hasSupersets = state.items.some((it) => it.supersetGroup);
  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:4px;">Importar rutina</h1>
    <p class="type-caption text-faint" style="margin-bottom:var(--space-4);">Revisa y corrige — nada se guarda todavía. Se creará como una rutina reutilizable, no como un entreno de hoy.</p>

    <div class="field">
      <label class="label">Nombre de la rutina</label>
      <input type="text" id="wi-name" value="${escapeHtml(state.workoutName)}" />
    </div>

    ${hasSupersets ? `<div class="type-caption text-faint" style="margin-bottom:var(--space-3);">Se detectaron superseries (A1/A2…) — de momento se crean como ejercicios independientes; la agrupación real llegará más adelante.</div>` : ''}

    <div class="section-label">Ejercicios</div>
    <div id="wi-list" class="stack" style="margin-bottom:var(--space-4);"></div>
    <button class="btn btn-secondary btn-block" id="wi-add-exercise" style="margin-bottom:var(--space-4);">+ Añadir ejercicio</button>

    ${state.unrecognized.length ? `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="type-caption text-faint" style="margin-bottom:6px;">No reconocido en la foto:</div>
        ${state.unrecognized.map((u) => `<div class="type-caption text-faint">"${escapeHtml(u)}"</div>`).join('')}
      </div>
    ` : ''}

    <button class="btn btn-primary btn-block" id="wi-create" ${state.items.length ? '' : 'disabled'}>Crear rutina</button>
  `;

  mount.querySelector('#wi-name').addEventListener('blur', (e) => { state.workoutName = e.target.value.trim() || state.workoutName; });

  renderList(mount, state, file);

  mount.querySelector('#wi-add-exercise').addEventListener('click', () => {
    openExercisePickerSheet({
      title: 'Añadir ejercicio',
      onSelect: (exercise) => {
        state.items.push({
          tempId: `t${Date.now()}`,
          recognizedName: exercise.name,
          matchedExercise: exercise,
          sets: 3,
          repsMin: null,
          repsMax: null,
          rir: null,
          setType: 'normal',
          lastSetOnly: false,
          extraReps: null,
          steps: null,
          supersetGroup: null,
          supersetOrder: null,
          weightHintKg: null,
          notes: null,
          confidence: 'high',
        });
        paintReview(mount, state, file);
      },
    });
  });

  mount.querySelector('#wi-create').addEventListener('click', () => createTemplateFromReview(mount, state));
}

function renderList(mount, state, file) {
  const list = mount.querySelector('#wi-list');
  list.innerHTML = state.items.map((it) => `
    <div class="card" data-temp-id="${it.tempId}" style="margin-bottom:0;">
      <div class="row" style="align-items:flex-start; margin-bottom:6px;">
        <div style="min-width:0;">
          <div class="type-body" style="font-weight:700;">
            ${it.supersetGroup ? `<span class="text-faint">${escapeHtml(it.supersetGroup)}${it.supersetOrder ?? ''} · </span>` : ''}${escapeHtml(it.recognizedName)}
          </div>
          ${it.confidence === 'low' ? `<div class="type-caption" style="color:var(--warn);">⚠️ Revisar — lectura poco segura</div>` : ''}
          ${it.matchedExercise
      ? `<div class="type-caption text-faint">✓ Coincide con: ${escapeHtml(it.matchedExercise.name)} <button type="button" class="wi-change-match" style="color:var(--accent); font-weight:600;">Cambiar</button></div>`
      : `<div class="type-caption" style="color:var(--warn);">⚠️ Ejercicio no encontrado <button type="button" class="wi-resolve-match" style="color:var(--accent); font-weight:600;">Resolver</button></div>`}
        </div>
        <button class="icon-btn wi-remove" aria-label="Quitar">✕</button>
      </div>

      <div class="row" style="gap:8px; margin-bottom:8px;">
        <div class="field" style="margin-bottom:0; flex:1;">
          <label class="label">Series</label>
          <input type="number" inputmode="numeric" class="wi-sets" value="${it.sets}" />
        </div>
        <div class="field" style="margin-bottom:0; flex:1;">
          <label class="label">Mín</label>
          <input type="number" inputmode="numeric" class="wi-reps-min" value="${it.repsMin ?? ''}" placeholder="—" />
        </div>
        <div class="field" style="margin-bottom:0; flex:1;">
          <label class="label">Máx</label>
          <input type="number" inputmode="numeric" class="wi-reps-max" value="${it.repsMax ?? ''}" placeholder="—" />
        </div>
        <div class="field" style="margin-bottom:0; flex:1;">
          <label class="label">RIR</label>
          <input type="number" inputmode="numeric" class="wi-rir" value="${it.rir ?? ''}" placeholder="—" />
        </div>
      </div>

      <button type="button" class="wi-type-btn set-type-btn ${it.setType !== 'normal' ? 'set-type-btn--active' : ''}">${SET_TYPE_LABELS[it.setType]}${it.setType !== 'normal' && it.lastSetOnly ? ' (última serie)' : ''} <span class="set-type-caret">▾</span></button>
    </div>
  `).join('');

  list.querySelectorAll('[data-temp-id]').forEach((card) => {
    const tempId = card.dataset.tempId;
    const item = state.items.find((i) => i.tempId === tempId);

    card.querySelector('.wi-remove').addEventListener('click', () => {
      state.items = state.items.filter((i) => i.tempId !== tempId);
      paintReview(mount, state, file);
    });
    card.querySelector('.wi-sets').addEventListener('blur', (e) => { item.sets = Math.max(1, Number(e.target.value) || 1); });
    card.querySelector('.wi-reps-min').addEventListener('blur', (e) => { item.repsMin = e.target.value === '' ? null : Number(e.target.value); });
    card.querySelector('.wi-reps-max').addEventListener('blur', (e) => { item.repsMax = e.target.value === '' ? null : Number(e.target.value); });
    card.querySelector('.wi-rir').addEventListener('blur', (e) => { item.rir = e.target.value === '' ? null : Number(e.target.value); });

    card.querySelector('.wi-type-btn').addEventListener('click', () => {
      openTypeChoiceSheet(item.setType, (newType) => {
        item.setType = newType;
        renderList(mount, state, file); // repinta solo la lista, mantiene lo demás
      });
    });

    card.querySelector('.wi-change-match')?.addEventListener('click', () => openMatchPicker(item, mount, state, file));
    card.querySelector('.wi-resolve-match')?.addEventListener('click', () => openMatchPicker(item, mount, state, file));
  });
}

function openMatchPicker(item, mount, state, file) {
  openExercisePickerSheet({
    title: `Ejercicio para "${item.recognizedName}"`,
    initialSearch: item.recognizedName,
    onSelect: (exercise) => {
      item.matchedExercise = exercise;
      renderList(mount, state, file);
    },
  });
}

function openTypeChoiceSheet(current, onSelect) {
  const options = ['normal', 'fallo', 'restpause', 'descendente'];
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
    onMount: (sheet, close) => {
      sheet.querySelectorAll('[data-type]').forEach((row) => {
        row.addEventListener('click', () => { close(); onSelect(row.dataset.type); });
      });
    },
  });
}

async function createTemplateFromReview(mount, state) {
  const unresolved = state.items.find((i) => !i.matchedExercise);
  if (unresolved) {
    toast(`Resuelve el ejercicio "${unresolved.recognizedName}" antes de crear la rutina`);
    return;
  }
  const template = await repo.createTemplate({ name: state.workoutName });
  for (const item of state.items) {
    const usesSpecialType = item.setType !== 'normal';
    await repo.addTemplateExercise(template.id, item.matchedExercise.id, {
      targetSets: item.sets,
      targetRepsMin: item.repsMin,
      targetRepsMax: item.repsMax,
      targetRir: item.rir,
      notes: item.notes || '',
      defaultSetType: usesSpecialType ? item.setType : 'normal',
      defaultLastSetOnly: usesSpecialType && item.lastSetOnly,
    });
  }
  toast('Rutina creada');
  navigate(`/entreno/plantilla/${template.id}`);
}
