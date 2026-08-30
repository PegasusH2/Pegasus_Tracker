// Importar entrenamiento desde foto — la IA solo interpreta la imagen; esta
// vista es la única responsable de guardar datos, y solo lo hace después de
// que el usuario revise/corrija y pulse "Guardar rutina(s)". El resultado son
// RUTINAS reutilizables (como "DIA 1"), no entrenos ya registrados — usa
// exactamente las mismas funciones de repository.js que una plantilla creada
// a mano (createTemplate/addTemplateExercise) — nada paralelo.
//
// Flujo híbrido IA + usuario: la imagen puede contener una única rutina o un
// programa completo con varias. El usuario elige el modo (o pide detección
// automática); la IA nunca decide sola cuántas rutinas hay — como mucho
// propone una división tentativa que el usuario confirma, fusiona o corrige.
import * as repo from '../db/repository.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openConfirmSheet, openExercisePickerSheet, ACTION_ICONS } from '../core/ui.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';
import { analyzeWorkoutPhoto } from '../core/ai-import.js';
import { matchExerciseName } from '../core/exercise-match.js';
import * as settings from '../core/settings.js';

const SET_TYPE_LABELS = { normal: 'Normal', fallo: 'Fallo', restpause: 'Rest-pause', descendente: 'Descendente', amrap: 'AMRAP' };

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2)}`;
}

const CAPABILITIES = [
  'Varias rutinas y días',
  'Ejercicios, series y repeticiones',
  'Rangos, progresiones y pesos',
  'Supersets y técnicas especiales',
  'RIR, descansos y notas',
];

// Debe coincidir con RATE_LIMIT_MAX_REQUESTS/RATE_LIMIT_WINDOW_SECONDS en
// worker/index.js — informativo, no se puede consultar el límite real desde
// aquí (el conteo vive solo en el Worker).
const NORMAL_RATE_LIMIT_TEXT = 'Límite: 10 análisis por hora, para evitar abusos.';

function rateLimitNoticeHtml() {
  if (settings.isAdminSessionActive()) {
    return `<p class="type-caption" style="text-align:center; margin-top:var(--space-3); color:var(--accent); font-weight:600;">● Modo administrador activo — sin límite de peticiones</p>`;
  }
  return `<p class="type-caption text-faint" style="text-align:center; margin-top:var(--space-3);">${NORMAL_RATE_LIMIT_TEXT}</p>`;
}

export async function renderWorkoutImport(mount) {
  renderPicker(mount);
}

// ---------- Paso 1: elegir foto ----------
function renderPicker(mount) {
  mount.innerHTML = `
    <div style="text-align:center; margin-bottom:var(--space-5);">
      <span class="action-card-icon action-card-icon--dashed" style="width:64px; height:64px; margin:0 auto var(--space-4);">${ACTION_ICONS.camera}</span>
      <h1 class="type-title" style="margin-bottom:8px;">Importar desde foto</h1>
      <p class="type-body text-dim">La IA analizará tu imagen y extraerá tus rutinas y ejercicios.<br/>Papel, pizarra, captura de pantalla…</p>
    </div>

    <input type="file" accept="image/*" capture="environment" id="photo-input-camera" style="display:none;" />
    <input type="file" accept="image/*" id="photo-input-gallery" style="display:none;" />
    <button class="btn btn-primary btn-block" id="pick-camera">Hacer foto</button>
    <button class="btn btn-secondary btn-block" id="pick-gallery" style="margin-top:8px;">Elegir de la galería</button>

    <div class="card" style="margin-top:var(--space-5);">
      <div class="type-headline" style="margin-bottom:10px;">¿Qué puede detectar la IA?</div>
      <div class="stack" style="gap:8px;">
        ${CAPABILITIES.map((c) => `
          <div class="row" style="justify-content:flex-start; gap:8px;">
            <span style="color:var(--accent); display:flex; flex-shrink:0; width:16px; height:16px;">${ACTION_ICONS.check}</span>
            <span class="type-caption text-dim">${c}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ${rateLimitNoticeHtml()}

    <button class="btn btn-ghost btn-block" id="manual-instead" style="margin-top:var(--space-4);">Crear manualmente</button>
  `;

  const cameraInput = mount.querySelector('#photo-input-camera');
  const galleryInput = mount.querySelector('#photo-input-gallery');
  mount.querySelector('#pick-camera').addEventListener('click', () => cameraInput.click());
  mount.querySelector('#pick-gallery').addEventListener('click', () => galleryInput.click());
  mount.querySelector('#manual-instead').addEventListener('click', () => navigate('/entreno/nuevo'));

  const onPicked = (input) => {
    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      renderModeSelect(mount, file);
    });
  };
  onPicked(cameraInput);
  onPicked(galleryInput);
}

// ---------- Paso 2: modo de importación ----------
const MODES = [
  { key: 'auto', title: 'Detectar automáticamente', desc: 'PEGASUS analizará la imagen y detectará si contiene una o varias rutinas.', icon: ACTION_ICONS.bolt },
  { key: 'single', title: 'Una rutina', desc: 'Todo el contenido de la imagen se interpretará como una única rutina.', icon: ACTION_ICONS.document },
  { key: 'multi', title: 'Programa completo', desc: 'La imagen puede contener varias rutinas o sesiones.', icon: ACTION_ICONS.calendar },
];

function renderModeSelect(mount, file) {
  let mode = 'auto';

  mount.innerHTML = `
    <div class="row" style="align-items:center; margin-bottom:var(--space-4);">
      <button type="button" class="icon-btn" id="mode-back" aria-label="Volver">${ACTION_ICONS.chevronLeft}</button>
      <h1 class="type-title" style="flex:1; text-align:center; font-size:19px;">¿Qué quieres importar?</h1>
      <span style="width:34px;"></span>
    </div>
    <p class="type-body text-dim" style="margin-bottom:var(--space-5); text-align:center;">
      PEGASUS puede leer una única rutina o un programa completo con varios días.
    </p>
    <div class="stack" id="mode-list" style="margin-bottom:var(--space-5);">
      ${MODES.map((m) => `
        <button type="button" class="import-mode-opt ${m.key === mode ? 'import-mode-opt--active' : ''}" data-mode="${m.key}">
          <span class="action-card-icon" style="margin-bottom:8px;">${m.icon}</span>
          <div class="type-headline">${m.title}</div>
          <div class="type-caption text-faint">${m.desc}</div>
        </button>
      `).join('')}
    </div>
    <button class="btn btn-primary btn-block" id="mode-continue">Continuar</button>
  `;

  mount.querySelector('#mode-back').addEventListener('click', () => renderPicker(mount));
  mount.querySelectorAll('.import-mode-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      mode = opt.dataset.mode;
      mount.querySelectorAll('.import-mode-opt').forEach((o) => o.classList.toggle('import-mode-opt--active', o === opt));
    });
  });
  mount.querySelector('#mode-continue').addEventListener('click', () => renderAnalyzing(mount, file, mode));
}

// ---------- Paso 3: analizando (progreso simulado — la llamada real es una
// única petición atómica; esto solo da sensación de avance real) ----------
const ANALYZING_STEPS = ['Leyendo texto', 'Identificando rutinas', 'Extrayendo ejercicios', 'Verificando series y repeticiones'];

async function renderAnalyzing(mount, file, mode) {
  let step = 0;
  let pct = 0;

  function paint() {
    mount.innerHTML = `
      <div style="text-align:center; margin-top:50px;">
        <div class="analyzing-ring" style="--pct:${pct};"><span class="analyzing-pct">${pct}%</span></div>
        <div class="type-headline" style="margin:var(--space-4) 0 var(--space-4);">Analizando tu imagen…</div>
      </div>
      <div class="stack" style="gap:10px; max-width:320px; margin:0 auto;">
        ${ANALYZING_STEPS.map((s, i) => `
          <div class="row" style="justify-content:flex-start; gap:8px;">
            <span style="display:flex; flex-shrink:0; width:16px; height:16px; color:${i < step ? 'var(--accent)' : 'var(--text-tertiary)'};">${i < step ? ACTION_ICONS.check : ''}</span>
            <span class="type-body ${i < step ? '' : 'text-faint'}">${s}</span>
          </div>
        `).join('')}
      </div>
      <p class="type-caption text-faint" style="text-align:center; margin-top:var(--space-5);">Siempre podrás revisar y corregir antes de guardar.</p>
    `;
  }
  paint();

  const timer = setInterval(() => {
    if (step < ANALYZING_STEPS.length) {
      step++;
      pct = Math.min(95, Math.round((step / ANALYZING_STEPS.length) * 100));
      paint();
    }
  }, 650);

  try {
    const adminSession = settings.isAdminSessionActive() ? settings.getAdminSession() : null;
    const result = await analyzeWorkoutPhoto(file, mode, { adminToken: adminSession?.token });
    clearInterval(timer);
    step = ANALYZING_STEPS.length;
    pct = 100;
    paint();
    const existing = await repo.listExercises();
    const programState = buildProgramState(result.routines, existing);
    routeAfterAnalysis(mount, result.structureConfidence, programState, file, mode);
  } catch (err) {
    clearInterval(timer);
    console.error(err);
    renderError(mount, file, mode, err);
  }
}

function renderError(mount, file, mode, err) {
  const rateLimited = err?.message === 'RATE_LIMITED';
  mount.innerHTML = `
    <div class="empty-state" style="margin-top:60px;">
      <div class="type-headline" style="margin-bottom:8px;">${rateLimited ? 'Demasiadas peticiones por ahora.' : 'No hemos podido interpretar esta imagen.'}</div>
      ${rateLimited ? '<p class="type-caption text-faint">Espera un poco y vuelve a intentarlo.</p>' : ''}
    </div>
    <button class="btn btn-primary btn-block" id="retry" style="margin-top:var(--space-4);">Intentar de nuevo</button>
    <button class="btn btn-secondary btn-block" id="other-photo" style="margin-top:8px;">Elegir otra foto</button>
    <button class="btn btn-ghost btn-block" id="manual" style="margin-top:8px;">Crear manualmente</button>
  `;
  mount.querySelector('#retry').addEventListener('click', () => renderAnalyzing(mount, file, mode));
  mount.querySelector('#other-photo').addEventListener('click', () => renderPicker(mount));
  mount.querySelector('#manual').addEventListener('click', () => navigate('/entreno/nuevo'));
}

function buildProgramState(rawRoutines, existingExercises) {
  return {
    routines: rawRoutines.map((r) => ({
      tempRoutineId: uid('r'),
      workoutName: r.workoutName,
      description: r.description || '',
      unrecognized: r.unrecognized,
      items: r.exercises.map((e) => {
        const match = matchExerciseName(e.recognizedName, existingExercises);
        return { tempId: uid('t'), ...e, matchedExercise: match?.exercise ?? null };
      }),
    })),
  };
}

// ---------- Paso 3 (solo modo automático): confirmar con el usuario cuando
// la IA no está segura de la separación en varias rutinas ----------
function routeAfterAnalysis(mount, structureConfidence, programState, file, mode) {
  if (mode === 'auto') {
    if (structureConfidence === 'low') return renderAmbiguousChoice(mount, programState, file, mode);
    if (structureConfidence === 'none' || !structureConfidence) return renderNoStructureChoice(mount, programState, file, mode);
  }
  renderProgramReview(mount, programState, file, mode);
}

function mergeToSingleRoutine(programState) {
  const routines = programState.routines;
  const name = routines[0]?.workoutName || 'Entrenamiento importado';
  const description = [...new Set(routines.map((r) => r.description).filter(Boolean))].join('\n');
  const items = routines.flatMap((r) => r.items);
  const unrecognized = routines.flatMap((r) => r.unrecognized);
  return { routines: [{ tempRoutineId: uid('r'), workoutName: name, description, items, unrecognized }] };
}

function renderAmbiguousChoice(mount, programState, file, mode) {
  mount.innerHTML = `
    <div style="margin-top:60px; margin-bottom:var(--space-5);">
      <div class="type-headline" style="margin-bottom:8px;">Parece que esta imagen puede contener varias rutinas.</div>
      <div class="type-body text-dim">¿Cómo quieres importarla?</div>
    </div>
    <button class="btn btn-primary btn-block" id="choice-multi">Crear varias rutinas</button>
    <button class="btn btn-secondary btn-block" id="choice-single" style="margin-top:8px;">Crear una única rutina</button>
  `;
  mount.querySelector('#choice-multi').addEventListener('click', () => renderProgramReview(mount, programState, file, mode));
  mount.querySelector('#choice-single').addEventListener('click', () => renderProgramReview(mount, mergeToSingleRoutine(programState), file, mode));
}

function renderNoStructureChoice(mount, programState, file, mode) {
  mount.innerHTML = `
    <div style="margin-top:60px; margin-bottom:var(--space-5);">
      <div class="type-headline">No hemos podido identificar varias rutinas.</div>
    </div>
    <button class="btn btn-primary btn-block" id="choice-one">Importar como una rutina</button>
    <button class="btn btn-ghost btn-block" id="choice-back" style="margin-top:8px;">Volver</button>
  `;
  mount.querySelector('#choice-one').addEventListener('click', () => renderProgramReview(mount, programState, file, mode));
  mount.querySelector('#choice-back').addEventListener('click', () => renderPicker(mount));
}

// ---------- Paso 4: revisión — lista de rutinas detectadas ----------
function renderProgramReview(mount, programState, file, mode) {
  paintProgramList(mount, programState, file, mode);
}

function countUnresolved(programState) {
  return programState.routines.reduce((sum, r) => sum + r.items.filter((it) => !it.matchedExercise).length, 0);
}

function paintProgramList(mount, programState, file, mode) {
  const count = programState.routines.length;
  const unresolvedCount = countUnresolved(programState);
  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:4px;">${count === 1 ? '1 rutina detectada' : `${count} rutinas detectadas`}</h1>
    <p class="type-caption text-faint" style="margin-bottom:var(--space-4);">Revisa y corrige — nada se guarda todavía. Se crearán como rutinas reutilizables, no como entrenos de hoy.</p>

    <div class="action-card-list" id="pr-list" style="margin-bottom:var(--space-5);"></div>

    ${unresolvedCount ? `<button class="btn btn-secondary btn-block" id="pr-resolve-all" style="margin-bottom:8px;">Dar de alta los ${unresolvedCount} ejercicios pendientes</button>` : ''}
    <button class="btn btn-primary btn-block" id="pr-save">Guardar rutina${count === 1 ? '' : 's'}</button>
    <button class="btn btn-ghost btn-block" id="pr-cancel" style="margin-top:8px;">Cancelar</button>
  `;

  renderProgramList(mount, programState, file, mode);

  mount.querySelector('#pr-resolve-all')?.addEventListener('click', () => resolveAllPending(mount, programState, file, mode));
  mount.querySelector('#pr-save').addEventListener('click', (e) => saveProgram(programState, e.currentTarget));
  mount.querySelector('#pr-cancel').addEventListener('click', () => navigate('/entreno'));
}

// Da de alta de golpe todos los ejercicios pendientes de resolver de TODAS
// las rutinas (no solo la que se esté editando) — el nombre detectado por la
// IA pasa a ser el nombre real del ejercicio. Si el mismo nombre aparece sin
// resolver en varias rutinas, se crea una única vez y se reutiliza.
async function resolveAllPending(mount, programState, file, mode) {
  const pending = programState.routines.flatMap((r) => r.items.filter((it) => !it.matchedExercise));
  if (!pending.length) return;

  const createdByName = new Map();
  for (const it of pending) {
    const key = it.recognizedName.trim().toLowerCase();
    let exercise = createdByName.get(key);
    if (!exercise) {
      exercise = await repo.createExercise({ name: it.recognizedName.trim() });
      createdByName.set(key, exercise);
    }
    it.matchedExercise = exercise;
  }

  toast(`${pending.length} ejercicio${pending.length === 1 ? '' : 's'} dado${pending.length === 1 ? '' : 's'} de alta`);
  paintProgramList(mount, programState, file, mode);
}

function renderProgramList(mount, programState, file, mode) {
  const list = mount.querySelector('#pr-list');
  const routines = programState.routines;
  list.innerHTML = routines.map((r, i) => {
    const totalSets = r.items.reduce((sum, it) => sum + (it.sets || 0), 0);
    const unresolved = r.items.some((it) => !it.matchedExercise);
    return `
      <div class="action-card" data-routine-id="${r.tempRoutineId}">
        <span class="action-card-icon">${ACTION_ICONS.dumbbell}</span>
        <button type="button" class="action-card-body pr-open" style="text-align:left; background:none; padding:0;">
          <span class="action-card-title">${escapeHtml(r.workoutName)}</span>
          <span class="action-card-desc">${r.items.length} ejercicio${r.items.length === 1 ? '' : 's'} · ${totalSets} series${unresolved ? ' · pendiente de resolver' : ''}</span>
        </button>
        ${i > 0 ? `<button type="button" class="icon-btn pr-move-up" aria-label="Subir">↑</button>` : ''}
        ${i < routines.length - 1 ? `<button type="button" class="icon-btn pr-move-down" aria-label="Bajar">↓</button>` : ''}
        <button type="button" class="icon-btn pr-more" aria-label="Más opciones">⋯</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-routine-id]').forEach((card) => {
    const id = card.dataset.routineId;
    card.querySelector('.pr-open').addEventListener('click', () => renderRoutineEditor(mount, programState, id, file, mode));
    card.querySelector('.pr-move-up')?.addEventListener('click', () => { moveRoutine(programState, id, -1); renderProgramList(mount, programState, file, mode); });
    card.querySelector('.pr-move-down')?.addEventListener('click', () => { moveRoutine(programState, id, 1); renderProgramList(mount, programState, file, mode); });
    card.querySelector('.pr-more').addEventListener('click', () => openRoutineMenu(mount, programState, id, file, mode));
  });
}

function moveRoutine(programState, id, delta) {
  const idx = programState.routines.findIndex((r) => r.tempRoutineId === id);
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= programState.routines.length) return;
  const [item] = programState.routines.splice(idx, 1);
  programState.routines.splice(newIdx, 0, item);
}

function openRoutineMenu(mount, programState, id, file, mode) {
  const idx = programState.routines.findIndex((r) => r.tempRoutineId === id);
  const routine = programState.routines[idx];
  const canMergeNext = idx < programState.routines.length - 1;
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:12px;">${escapeHtml(routine.workoutName)}</h3>
    <div class="grouped-list">
      <div class="grouped-row" id="rm-rename" style="cursor:pointer;"><span class="type-body">Cambiar nombre</span></div>
      ${canMergeNext ? `<div class="grouped-row" id="rm-merge" style="cursor:pointer;"><span class="type-body">Unir con la siguiente rutina</span></div>` : ''}
      <div class="grouped-row" id="rm-delete" style="cursor:pointer;"><span class="type-body" style="color:var(--danger);">Eliminar rutina</span></div>
    </div>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#rm-rename').addEventListener('click', () => {
        close();
        openRenameSheet(routine.workoutName, (name) => {
          routine.workoutName = name;
          paintProgramList(mount, programState, file, mode);
        });
      });
      sheet.querySelector('#rm-merge')?.addEventListener('click', () => {
        close();
        const next = programState.routines[idx + 1];
        routine.items = [...routine.items, ...next.items];
        routine.unrecognized = [...routine.unrecognized, ...next.unrecognized];
        if (next.description && next.description !== routine.description) {
          routine.description = [routine.description, next.description].filter(Boolean).join('\n');
        }
        programState.routines.splice(idx + 1, 1);
        paintProgramList(mount, programState, file, mode);
      });
      sheet.querySelector('#rm-delete').addEventListener('click', async () => {
        close();
        if (programState.routines.length <= 1) { toast('Debe quedar al menos una rutina'); return; }
        const ok = await openConfirmSheet(`¿Eliminar "${routine.workoutName}" de esta importación? No afecta a ninguna rutina ya guardada.`, { confirmLabel: 'Eliminar' });
        if (!ok) return;
        programState.routines.splice(idx, 1);
        paintProgramList(mount, programState, file, mode);
      });
    },
  });
}

function openRenameSheet(currentName, onSave) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">Nombre de la rutina</h3>
    <div class="field">
      <input type="text" id="rn-name" value="${escapeHtml(currentName)}" autofocus />
    </div>
    <button class="btn btn-primary btn-block" id="rn-save">Guardar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#rn-save').addEventListener('click', () => {
        const name = sheet.querySelector('#rn-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        close();
        onSave(name);
      });
    },
  });
}

// ---------- Editor de una rutina — mismos campos por ejercicio que antes
// (series/reps/RIR/tipo de serie), ahora dentro de la revisión del programa ----------
function renderRoutineEditor(mount, programState, routineId, file, mode) {
  const routine = programState.routines.find((r) => r.tempRoutineId === routineId);
  paintRoutineEditor(mount, programState, routine, file, mode);
}

function paintRoutineEditor(mount, programState, routine, file, mode) {
  const hasSupersets = routine.items.some((it) => it.supersetGroup);
  mount.innerHTML = `
    <button type="button" class="row" id="re-back" style="align-items:center; gap:6px; margin-bottom:var(--space-4); background:none; padding:0; width:auto;">
      <span class="re-back-icon" style="pointer-events:none;">${ACTION_ICONS.chevronLeft}</span>
      <span class="type-headline">Rutinas</span>
    </button>

    <div class="field">
      <label class="label">Nombre de la rutina</label>
      <input type="text" id="re-name" value="${escapeHtml(routine.workoutName)}" />
    </div>
    <div class="field">
      <label class="label">Descripción (opcional)</label>
      <textarea id="re-desc" rows="2" placeholder="Objetivo, enfoque, notas...">${escapeHtml(routine.description || '')}</textarea>
    </div>

    ${hasSupersets ? `<div class="type-caption text-faint" style="margin-bottom:var(--space-3);">Se detectaron superseries (A1/A2…) — de momento se crean como ejercicios independientes; la agrupación real llegará más adelante.</div>` : ''}

    <div class="section-label">Ejercicios</div>
    <div id="re-list" class="stack" style="margin-bottom:var(--space-4);"></div>
    <button class="btn btn-secondary btn-block" id="re-add-exercise" style="margin-bottom:var(--space-4);">+ Añadir ejercicio</button>

    ${routine.unrecognized.length ? `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="type-caption text-faint" style="margin-bottom:6px;">No reconocido en la foto:</div>
        ${routine.unrecognized.map((u) => `<div class="type-caption text-faint">"${escapeHtml(u)}"</div>`).join('')}
      </div>
    ` : ''}
  `;

  const goBack = () => {
    const name = mount.querySelector('#re-name').value.trim();
    routine.workoutName = name || routine.workoutName;
    routine.description = mount.querySelector('#re-desc').value.trim();
    paintProgramList(mount, programState, file, mode);
  };
  mount.querySelector('#re-back').addEventListener('click', goBack);
  mount.querySelector('#re-name').addEventListener('blur', (e) => { routine.workoutName = e.target.value.trim() || routine.workoutName; });
  mount.querySelector('#re-desc').addEventListener('blur', (e) => { routine.description = e.target.value.trim(); });

  const rerender = () => paintRoutineEditor(mount, programState, routine, file, mode);
  const onSplit = (splitIdx) => {
    const newItems = routine.items.splice(splitIdx);
    if (!newItems.length) return;
    const newRoutine = { tempRoutineId: uid('r'), workoutName: `${routine.workoutName} (2)`, description: '', items: newItems, unrecognized: [] };
    const idx = programState.routines.indexOf(routine);
    programState.routines.splice(idx + 1, 0, newRoutine);
    toast('Rutina dividida en dos');
    paintProgramList(mount, programState, file, mode);
  };

  renderExerciseEditList(mount.querySelector('#re-list'), routine, rerender, onSplit);

  mount.querySelector('#re-add-exercise').addEventListener('click', () => {
    openExercisePickerSheet({
      title: 'Añadir ejercicio',
      onSelect: (exercise) => {
        routine.items.push({
          tempId: uid('t'),
          recognizedName: exercise.name,
          matchedExercise: exercise,
          sets: 3,
          repsMin: null,
          repsMax: null,
          repsSequence: null,
          weightSequence: null,
          rir: null,
          targetRestSeconds: null,
          setType: 'normal',
          lastSetOnly: false,
          extraReps: null,
          steps: null,
          supersetGroup: null,
          supersetOrder: null,
          weightHintKg: null,
          notes: null,
          confidence: 'high',
          rawText: null,
        });
        rerender();
      },
    });
  });
}

function renderExerciseEditList(listEl, routine, onChange, onSplit) {
  listEl.innerHTML = routine.items.map((it, idx) => `
    <div class="card" data-temp-id="${it.tempId}" style="margin-bottom:0;">
      <div class="row" style="align-items:flex-start; margin-bottom:6px;">
        <div style="min-width:0;">
          <div class="type-body" style="font-weight:700;">
            ${it.supersetGroup ? `<span class="text-faint">${escapeHtml(it.supersetGroup)}${it.supersetOrder ?? ''} · </span>` : ''}${escapeHtml(it.recognizedName)}
          </div>
          ${it.confidence === 'low' ? `
            <div class="type-caption" style="color:var(--warn);">Revisar — lectura poco segura</div>
            ${it.rawText ? `<div class="type-caption text-faint">Texto original: "${escapeHtml(it.rawText)}"</div>` : ''}
          ` : ''}
          ${it.matchedExercise
      ? `<div class="type-caption text-faint">Coincide con: ${escapeHtml(it.matchedExercise.name)} <button type="button" class="ex-change-match" style="color:var(--accent); font-weight:600;">Cambiar</button></div>`
      : `<div class="type-caption" style="color:var(--warn);">Ejercicio no encontrado <button type="button" class="ex-resolve-match" style="color:var(--accent); font-weight:600;">Resolver</button></div>`}
        </div>
        <button class="icon-btn ex-remove" aria-label="Quitar">✕</button>
      </div>

      ${it.repsSequence ? `
        <div class="type-caption" style="color:var(--accent); font-weight:700; margin-bottom:6px;">✓ Progresión detectada · ${it.repsSequence.length} series</div>
        <div class="stack" style="gap:6px; margin-bottom:8px;">
          ${it.repsSequence.map((r, i) => `
            <div class="row" style="gap:6px; align-items:center;">
              <span class="type-caption text-faint" style="width:52px; flex-shrink:0;">Serie ${i + 1}</span>
              ${it.weightSequence ? `<input type="number" inputmode="decimal" class="ex-seq-weight" data-idx="${i}" value="${it.weightSequence[i]}" style="flex:1; text-align:center;" />` : ''}
              ${it.weightSequence ? `<span class="type-caption text-faint">kg ×</span>` : ''}
              <input type="number" inputmode="numeric" class="ex-seq-reps" data-idx="${i}" value="${r}" style="flex:1; text-align:center;" />
              <span class="type-caption text-faint">reps</span>
            </div>
          `).join('')}
        </div>
        <div class="row" style="gap:8px; margin-bottom:8px; align-items:flex-end;">
          <div class="field" style="margin-bottom:0; flex:1;">
            <label class="label">RIR</label>
            <input type="number" inputmode="numeric" class="ex-rir" value="${it.rir ?? ''}" placeholder="—" />
          </div>
          <button type="button" class="ex-use-range btn btn-ghost btn-sm" style="flex-shrink:0;">Usar un rango en su lugar</button>
        </div>
      ` : `
        <div class="row" style="gap:8px; margin-bottom:8px;">
          <div class="field" style="margin-bottom:0; flex:1;">
            <label class="label">Series</label>
            <input type="number" inputmode="numeric" class="ex-sets" value="${it.sets}" />
          </div>
          <div class="field" style="margin-bottom:0; flex:1;">
            <label class="label">Mín</label>
            <input type="number" inputmode="numeric" class="ex-reps-min" value="${it.repsMin ?? ''}" placeholder="—" />
          </div>
          <div class="field" style="margin-bottom:0; flex:1;">
            <label class="label">Máx</label>
            <input type="number" inputmode="numeric" class="ex-reps-max" value="${it.repsMax ?? ''}" placeholder="—" />
          </div>
          <div class="field" style="margin-bottom:0; flex:1;">
            <label class="label">RIR</label>
            <input type="number" inputmode="numeric" class="ex-rir" value="${it.rir ?? ''}" placeholder="—" />
          </div>
        </div>
        <div class="row" style="gap:8px; margin-bottom:8px;">
          <div class="field" style="margin-bottom:0; flex:1;">
            <label class="label">Peso (kg)</label>
            <input type="number" inputmode="decimal" class="ex-weight-hint" value="${it.weightHintKg ?? ''}" placeholder="—" />
          </div>
        </div>
      `}

      <div class="row" style="align-items:center;">
        <button type="button" class="ex-type-btn set-type-btn ${it.setType !== 'normal' ? 'set-type-btn--active' : ''}">${SET_TYPE_LABELS[it.setType]}${it.setType !== 'normal' && it.lastSetOnly ? ' (última serie)' : ''} <span class="set-type-caret">▾</span></button>
        ${idx > 0 ? `<button type="button" class="ex-split text-faint" style="font-size:12px; font-weight:600;">Dividir rutina aquí ›</button>` : ''}
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-temp-id]').forEach((card) => {
    const tempId = card.dataset.tempId;
    const item = routine.items.find((i) => i.tempId === tempId);

    card.querySelector('.ex-remove').addEventListener('click', async () => {
      const ok = await openConfirmSheet(`¿Quitar "${item.recognizedName}" de esta rutina?`, { confirmLabel: 'Quitar' });
      if (!ok) return;
      routine.items = routine.items.filter((i) => i.tempId !== tempId);
      onChange();
    });
    card.querySelector('.ex-sets')?.addEventListener('blur', (e) => { item.sets = Math.max(1, Number(e.target.value) || 1); });
    card.querySelector('.ex-reps-min')?.addEventListener('blur', (e) => { item.repsMin = e.target.value === '' ? null : Number(e.target.value); });
    card.querySelector('.ex-reps-max')?.addEventListener('blur', (e) => { item.repsMax = e.target.value === '' ? null : Number(e.target.value); });
    card.querySelector('.ex-rir')?.addEventListener('blur', (e) => { item.rir = e.target.value === '' ? null : Number(e.target.value); });
    card.querySelector('.ex-weight-hint')?.addEventListener('blur', (e) => { item.weightHintKg = e.target.value === '' ? null : Number(e.target.value); });

    card.querySelectorAll('.ex-seq-reps').forEach((input) => {
      input.addEventListener('blur', (e) => {
        const i = Number(e.target.dataset.idx);
        const v = Number(e.target.value);
        if (Number.isFinite(v)) item.repsSequence[i] = v;
      });
    });
    card.querySelectorAll('.ex-seq-weight').forEach((input) => {
      input.addEventListener('blur', (e) => {
        const i = Number(e.target.dataset.idx);
        const v = e.target.value === '' ? null : Number(e.target.value);
        item.weightSequence[i] = v;
      });
    });
    card.querySelector('.ex-use-range')?.addEventListener('click', () => {
      item.sets = item.repsSequence.length;
      item.repsMin = Math.min(...item.repsSequence);
      item.repsMax = Math.max(...item.repsSequence);
      item.repsSequence = null;
      item.weightSequence = null;
      renderExerciseEditList(listEl, routine, onChange, onSplit);
    });

    card.querySelector('.ex-type-btn').addEventListener('click', () => {
      openTypeChoiceSheet(item.setType, (newType) => {
        item.setType = newType;
        renderExerciseEditList(listEl, routine, onChange, onSplit); // repinta solo la lista
      });
    });

    card.querySelector('.ex-change-match')?.addEventListener('click', () => openMatchPicker(item, () => renderExerciseEditList(listEl, routine, onChange, onSplit)));
    card.querySelector('.ex-resolve-match')?.addEventListener('click', () => openMatchPicker(item, () => renderExerciseEditList(listEl, routine, onChange, onSplit)));

    card.querySelector('.ex-split')?.addEventListener('click', () => {
      const splitIdx = routine.items.findIndex((i) => i.tempId === tempId);
      onSplit(splitIdx);
    });
  });
}

function openMatchPicker(item, onChange) {
  openExercisePickerSheet({
    title: `Ejercicio para "${item.recognizedName}"`,
    initialSearch: item.recognizedName,
    onSelect: (exercise) => {
      item.matchedExercise = exercise;
      onChange();
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

// ---------- Guardar ----------
async function saveProgram(programState, btn) {
  const unresolvedRoutine = programState.routines.find((r) => r.items.some((i) => !i.matchedExercise));
  if (unresolvedRoutine) {
    toast(`Resuelve todos los ejercicios de "${unresolvedRoutine.workoutName}" antes de guardar`);
    return;
  }
  const emptyRoutine = programState.routines.find((r) => r.items.length === 0);
  if (emptyRoutine) {
    toast(`Añade al menos un ejercicio a "${emptyRoutine.workoutName}" o elimínala`);
    return;
  }

  // La confianza baja no bloquea el guardado (el usuario puede decidir que ya
  // ha revisado y corregido lo necesario), pero exige una confirmación
  // explícita en vez de dejar pasar en silencio una lectura insegura.
  const lowConfidenceCount = programState.routines.reduce(
    (sum, r) => sum + r.items.filter((i) => i.confidence === 'low').length, 0,
  );
  if (lowConfidenceCount > 0) {
    const ok = await openConfirmSheet(
      `Hay ${lowConfidenceCount} ejercicio${lowConfidenceCount === 1 ? '' : 's'} marcado${lowConfidenceCount === 1 ? '' : 's'} como "lectura poco segura". Revísalos antes de guardar si no lo has hecho ya.`,
      { confirmLabel: 'Guardar de todos modos', cancelLabel: 'Revisar primero', danger: false },
    );
    if (!ok) return;
  }

  if (btn) btn.disabled = true;
  try {
    let firstTemplateId = null;
    for (const routine of programState.routines) {
      const template = await repo.createTemplate({ name: routine.workoutName, description: routine.description || '' });
      if (!firstTemplateId) firstTemplateId = template.id;
      for (const item of routine.items) {
        const usesSpecialType = item.setType !== 'normal';
        await repo.addTemplateExercise(template.id, item.matchedExercise.id, {
          targetSets: item.repsSequence ? item.repsSequence.length : item.sets,
          targetRepsMin: item.repsMin,
          targetRepsMax: item.repsMax,
          targetRepsSequence: item.repsSequence,
          targetWeightSequence: item.weightSequence,
          targetRir: item.rir,
          targetRestSeconds: item.targetRestSeconds ?? null,
          targetWeightKg: item.weightHintKg ?? null,
          notes: item.notes || '',
          defaultSetType: usesSpecialType ? item.setType : 'normal',
          defaultLastSetOnly: usesSpecialType && item.lastSetOnly,
          defaultRestPauseExtra: usesSpecialType && item.setType === 'restpause' ? item.extraReps : null,
          defaultDropSteps: usesSpecialType && item.setType === 'descendente' ? item.steps : null,
          rawText: item.rawText ?? null,
        });
      }
    }

    const count = programState.routines.length;
    toast(count === 1 ? 'Rutina creada' : `${count} rutinas creadas`);
    navigate(count === 1 ? `/entreno/plantilla/${firstTemplateId}` : '/entreno');
  } catch (err) {
    console.error('Error al guardar el programa importado', err);
    toast('No se ha podido guardar. Inténtalo de nuevo.');
    if (btn) btn.disabled = false;
  }
}
