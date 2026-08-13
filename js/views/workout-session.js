import * as repo from '../db/repository.js';
import { compareSessions, describeRepsTarget, checkRangeCompletion } from '../core/progression.js';
import { trendSeries } from '../core/stats.js';
import { formatDate, relativeDays } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openConfirmSheet, openExercisePickerSheet, renderInsightCallout, getChartThemeColors, CHECK_ICON } from '../core/ui.js';
import { toKg, toUnit, roundForDisplay, inputStep } from '../core/units.js';
import { getWeightUnitsEnabled, getWeightLastInputUnit } from '../core/settings.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';

export async function renderWorkoutSession(mount, { workoutId }) {
  const detail = await repo.getWorkoutDetail(workoutId);
  if (!detail) {
    mount.innerHTML = `<div class="empty-state">Este entrenamiento no existe.</div>`;
    return;
  }
  const { workout, exercises } = detail;
  // No hay un toggle de unidad por sesión: cada serie elige su propia unidad
  // (kg/lb) tocando su etiqueta — así se pueden combinar discos de distinto
  // sistema dentro del mismo ejercicio. defaultUnit solo fija con qué unidad
  // empieza una serie nueva que todavía no se ha tocado.
  const defaultUnit = getWeightLastInputUnit();

  mount.innerHTML = `
    <div class="row" style="margin-bottom:2px; align-items:flex-start;">
      <div style="display:flex; align-items:center; gap:8px; min-width:0;">
        <button class="icon-btn" id="w-back" aria-label="Volver a Entreno" style="flex-shrink:0; margin-left:-6px;">←</button>
        <h1 class="type-title" id="w-title" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(workout.name)}</h1>
      </div>
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

  async function renderAllCards() {
    cardsContainer.innerHTML = '';
    if (!exercises.length) {
      cardsContainer.innerHTML = `<div class="empty-state">Añade tu primer ejercicio para empezar a registrar series.</div>`;
      return;
    }
    for (const we of exercises) {
      const card = document.createElement('div');
      card.className = 'card exercise-card';
      card.dataset.weId = we.id;
      cardsContainer.appendChild(card);
      await renderExerciseCard(card, workout, we.exerciseId, we.id, defaultUnit);
    }
  }
  await renderAllCards();

  mount.querySelector('#w-back').addEventListener('click', () => navigate('/entreno'));
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
        close();
        const ok = await openConfirmSheet('¿Eliminar este entrenamiento y todas sus series? Esta acción no se puede deshacer.', { confirmLabel: 'Eliminar' });
        if (!ok) return;
        await repo.deleteWorkout(workout.id);
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

async function renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit = 'kg') {
  const exercise = await repo.getExercise(exerciseId);
  const workoutExercise = await repo.getWorkoutExercise(workoutExerciseId);
  const currentSets = await repo.getSetsForWorkoutExercise(workoutExerciseId);
  const lastEntry = await repo.getLastSessionForExercise(exerciseId, { excludeWorkoutId: workout.id });
  const lastSets = lastEntry?.sets ?? [];

  // kg y lb son DATOS que se SUMAN cuando ambas unidades están activas
  // (Ajustes > Pesos) — ej. 10kg + 2,5lb de discos combinados en la misma
  // serie — no una conversión del mismo número. weight sigue siendo el total
  // canónico en kg (weightKgPart/weightLbPart son solo los dos componentes
  // introducidos, para poder mostrarlos y editarlos por separado).
  const enabledUnits = getWeightUnitsEnabled();
  const dualUnit = enabledUnits.kg && enabledUnits.lb;
  const soloUnit = enabledUnits.kg ? 'kg' : 'lb';

  const completedCurrentSets = currentSets.filter((s) => s.weight != null && s.reps != null);
  const comparison = (completedCurrentSets.length && lastSets.length)
    ? compareSessions(currentSets, lastSets, { compareVolume: currentSets.length >= lastSets.length, unit: defaultUnit, loadMode: exercise.loadMode })
    : null;

  const history = await repo.getExerciseHistory(exerciseId);
  const sparkValues = trendSeries(history, 'topWeight', { loadMode: exercise.loadMode }).map((p) => p.value).filter((v) => v != null);

  card.innerHTML = `
    <div class="exercise-card-header">
      <h3 class="ex-title-link" style="cursor:pointer;">${escapeHtml(exercise.name)}</h3>
      <button class="btn btn-ghost-danger btn-sm remove-exercise">Quitar</button>
    </div>
    ${targetCaption(workoutExercise)}
    ${exercise.loadMode === 'perSide' ? `<div class="type-caption text-faint" style="margin-bottom:10px;">Peso por lado/mancuerna — la carga total se calcula ×2.</div>` : ''}

    ${lastEntry ? `
      <div class="last-session">
        <div class="section-label">Última sesión · ${relativeDays(lastEntry.workout.date)}</div>
        ${lastSets.map((s) => `
          <div class="last-session-set">
            <span class="set-idx num">${s.setNumber}</span>
            <span class="num">${weightSummary(s, defaultUnit)} × ${s.reps ?? '—'}</span>
            <span class="text-faint">${[s.rir != null ? `RIR ${s.rir}` : '', s.type && s.type !== 'normal' ? setTypeLabel(s.type).toUpperCase() : ''].filter(Boolean).join(' · ')}</span>
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
    const soloVal = s.weight != null ? roundForDisplay(toUnit(s.weight, soloUnit), 1) : '';
    const type = s.type ?? 'normal';
    const rangeDone = checkRangeCompletion(s, workoutExercise);
    return `
    <div class="set-group">
    <div class="set-type-row">
      <button type="button" class="set-type-btn ${type !== 'normal' ? 'set-type-btn--active' : ''}" data-set-id="${s.id}">${setTypeLabel(type)} <span class="set-type-caret">▾</span></button>
      ${rangeDone ? '<span class="set-range-done">✓ Rango completado</span>' : ''}
    </div>
    <div class="set-row ${dualUnit ? 'set-row--dual-unit' : ''}" data-set-id="${s.id}">
      <span class="set-idx">${s.setNumber}</span>
      ${dualUnit ? `
        <div class="set-field set-weight-dual">
          <div class="set-weight-col">
            <input type="number" inputmode="decimal" step="${inputStep('kg', 'set')}" class="input-weight-kgpart" value="${s.weightKgPart ?? ''}" placeholder="0" />
            <span class="set-unit">kg</span>
          </div>
          <div class="set-weight-col">
            <input type="number" inputmode="decimal" step="${inputStep('lb', 'set')}" class="input-weight-lbpart" value="${s.weightLbPart ?? ''}" placeholder="0" />
            <span class="set-unit">lb</span>
          </div>
        </div>
      ` : `
        <div class="set-field">
          <input type="number" inputmode="decimal" step="${inputStep(soloUnit, 'set')}" class="input-weight" value="${soloVal}" placeholder="—" />
          <span class="set-unit">${soloUnit}</span>
        </div>
      `}
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
    ${dualUnit && s.weight != null ? `
      <div class="set-total">
        Total <button type="button" class="set-total-toggle" data-weight-kg="${s.weight}" data-unit="${defaultUnit}">${formatTotal(s.weight, defaultUnit)}</button>
      </div>
    ` : ''}
    ${renderSetExtraBlock(s)}
    </div>
  `;
  }).join('');

  setsList.querySelectorAll('.set-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const setId = btn.dataset.setId;
      const current = currentSets.find((s) => s.id === setId);
      openSetTypeSheet(current?.type, async (newType) => {
        const changes = { type: newType };
        changes.restPauseExtra = newType === 'restpause' ? [] : null;
        changes.dropSteps = newType === 'descendente' ? [] : null;
        await repo.updateSet(setId, changes);
        await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
      });
    });
  });

  setsList.querySelectorAll('.set-extra-chip-input').forEach((input) => {
    input.addEventListener('blur', async (e) => {
      const row = e.target.closest('.set-extra-row');
      const setId = row.dataset.setId;
      const current = currentSets.find((s) => s.id === setId);
      const blocks = [...(current.restPauseExtra ?? [])];
      const idx = Number(e.target.dataset.idx);
      const value = e.target.value === '' ? null : Number(e.target.value);
      blocks[idx] = { reps: value };
      await repo.updateSet(setId, { restPauseExtra: blocks });
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
    });
  });

  setsList.querySelectorAll('.set-step-weight, .set-step-reps').forEach((input) => {
    input.addEventListener('blur', async (e) => {
      const row = e.target.closest('.set-extra-row');
      const setId = row.dataset.setId;
      const current = currentSets.find((s) => s.id === setId);
      const steps = (current.dropSteps ?? []).map((s) => ({ ...s }));
      const idx = Number(e.target.dataset.idx);
      const field = e.target.classList.contains('set-step-weight') ? 'weight' : 'reps';
      steps[idx] = { ...steps[idx], [field]: e.target.value === '' ? null : Number(e.target.value) };
      await repo.updateSet(setId, { dropSteps: steps });
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
    });
  });

  setsList.querySelectorAll('.set-step-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.set-extra-row');
      const setId = row.dataset.setId;
      const current = currentSets.find((s) => s.id === setId);
      const steps = (current.dropSteps ?? []).filter((_, i) => i !== Number(btn.dataset.idx));
      await repo.updateSet(setId, { dropSteps: steps });
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
    });
  });

  setsList.querySelectorAll('.set-extra-add').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.set-extra-row');
      const setId = row.dataset.setId;
      const current = currentSets.find((s) => s.id === setId);
      if (btn.dataset.kind === 'restpause') {
        const blocks = [...(current.restPauseExtra ?? []), { reps: null }];
        await repo.updateSet(setId, { restPauseExtra: blocks });
      } else {
        const steps = [...(current.dropSteps ?? []).map((s) => ({ ...s })), { weight: null, reps: null }];
        await repo.updateSet(setId, { dropSteps: steps });
      }
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
    });
  });

  setsList.querySelectorAll('.set-total-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const newUnit = btn.dataset.unit === 'kg' ? 'lb' : 'kg';
      btn.dataset.unit = newUnit;
      btn.textContent = formatTotal(Number(btn.dataset.weightKg), newUnit);
    });
  });

  setsList.querySelectorAll('.set-row').forEach((row) => {
    const setId = row.dataset.setId;

    const kgPartInput = row.querySelector('.input-weight-kgpart');
    const lbPartInput = row.querySelector('.input-weight-lbpart');
    const soloInput = row.querySelector('.input-weight');

    if (kgPartInput && lbPartInput) {
      // kg y lb son componentes que se SUMAN (discos combinados) — cada uno
      // se guarda tal cual se escribe, sin recalcular el otro.
      async function commitParts() {
        const kgRaw = kgPartInput.value;
        const lbRaw = lbPartInput.value;
        if (kgRaw === '' && lbRaw === '') {
          await repo.updateSet(setId, { weight: null, weightKgPart: null, weightLbPart: null });
        } else {
          const kgPart = kgRaw === '' ? 0 : Number(kgRaw);
          const lbPart = lbRaw === '' ? 0 : Number(lbRaw);
          const weight = kgPart + toKg(lbPart, 'lb');
          await repo.updateSet(setId, { weight, weightKgPart: kgRaw === '' ? null : kgPart, weightLbPart: lbRaw === '' ? null : lbPart });
        }
        await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
      }
      kgPartInput.addEventListener('blur', commitParts);
      lbPartInput.addEventListener('blur', commitParts);
    } else if (soloInput) {
      soloInput.addEventListener('blur', async (e) => {
        const raw = e.target.value;
        const value = raw === '' ? null : toKg(raw, soloUnit);
        await repo.updateSet(setId, { weight: value, weightKgPart: null, weightLbPart: null });
        await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
      });
    }

    row.querySelector('.input-reps').addEventListener('blur', async (e) => {
      const value = e.target.value === '' ? null : Number(e.target.value);
      await repo.updateSet(setId, { reps: value });
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
    });
    row.querySelector('.input-rir').addEventListener('blur', async (e) => {
      const value = e.target.value === '' ? null : Number(e.target.value);
      await repo.updateSet(setId, { rir: value });
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
    });
    row.querySelector('.set-remove').addEventListener('click', async () => {
      await repo.deleteSet(setId);
      await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
    });
  });

  card.querySelector('.add-set').addEventListener('click', async (e) => {
    e.target.disabled = true; // evita duplicar el número de serie si se pulsa varias veces rápido
    const template = lastSets[currentSets.length];
    await repo.addSet(workoutExerciseId, {
      weight: template?.weight ?? null,
      weightKgPart: template?.weightKgPart ?? null,
      weightLbPart: template?.weightLbPart ?? null,
      reps: template?.reps ?? null,
    });
    await renderExerciseCard(card, workout, exerciseId, workoutExerciseId, defaultUnit);
  });

  card.querySelector('.remove-exercise').addEventListener('click', async () => {
    const ok = await openConfirmSheet(`¿Quitar "${exercise.name}" de este entrenamiento?`, { confirmLabel: 'Quitar' });
    if (!ok) return;
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

// Texto compacto del total en la unidad elegida, p.ej. "11,1 kg".
function formatTotal(weightKg, unit) {
  const v = roundForDisplay(toUnit(weightKg, unit), 1);
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, '');
  return `${n} ${unit}`;
}

// Para "última sesión": si la serie combinaba kg+lb, muestra el desglose real
// (ej. "10 kg + 2,5 lb"); si no, el total simple en la unidad por defecto.
function weightSummary(s, defaultUnit) {
  if (s.weight == null) return '—';
  if (s.weightKgPart != null && s.weightLbPart != null) {
    return `${s.weightKgPart} kg + ${s.weightLbPart} lb`;
  }
  return formatTotal(s.weight, defaultUnit);
}

// Objetivo planeado (congelado al crear la sesión desde una plantilla) — solo
// informativo, nunca se prellena en los campos de la serie salvo las reps.
function targetCaption(we) {
  if (!we) return '';
  const parts = [];
  const reps = describeRepsTarget(we);
  if (reps) parts.push(reps);
  if (we.targetRir != null) parts.push(`RIR ${we.targetRir}`);
  if (we.targetRestSeconds != null) parts.push(`${we.targetRestSeconds}s descanso`);
  if (!parts.length) return '';
  return `<div class="type-caption text-faint" style="margin-bottom:10px;">Objetivo: ${parts.join(' · ')}</div>`;
}

const SET_TYPE_LABELS = { normal: 'Normal', fallo: 'Fallo', restpause: 'Rest-pause', descendente: 'Descendente' };
function setTypeLabel(type) {
  return SET_TYPE_LABELS[type] ?? 'Normal';
}

// Sheet compacto para elegir el tipo de serie — se abre solo al pedirlo (sección
// 18 del pedido: "no mostrar cuatro botones grandes permanentemente").
function openSetTypeSheet(currentType, onSelect) {
  const options = ['normal', 'fallo', 'restpause', 'descendente'];
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:12px;">Tipo de serie</h3>
    <div class="grouped-list">
      ${options.map((key) => `
        <div class="grouped-row" data-type="${key}" style="cursor:pointer;">
          <span class="type-body">${setTypeLabel(key)}</span>
          ${key === (currentType ?? 'normal') ? '<span class="text-faint">✓</span>' : ''}
        </div>
      `).join('')}
    </div>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelectorAll('[data-type]').forEach((row) => {
        row.addEventListener('click', () => {
          close();
          onSelect(row.dataset.type);
        });
      });
    },
  });
}

// Bloques extra de una técnica especial, más allá del bloque principal
// (weight/reps de la propia serie): rest-pause suma reps con el mismo peso;
// descendente añade escalones con su propio peso.
function renderSetExtraBlock(s) {
  if (s.type === 'restpause') {
    const blocks = s.restPauseExtra ?? [];
    return `
      <div class="set-extra-row" data-set-id="${s.id}" data-kind="restpause">
        <span class="set-extra-label">+ reps</span>
        <div class="set-extra-chips">
          ${blocks.map((b, i) => `<input type="number" inputmode="numeric" class="set-extra-chip-input" data-idx="${i}" value="${b.reps ?? ''}" placeholder="0" />`).join('')}
          <button type="button" class="set-extra-add" data-kind="restpause">+</button>
        </div>
      </div>`;
  }
  if (s.type === 'descendente') {
    const steps = s.dropSteps ?? [];
    return `
      <div class="set-extra-row set-extra-row--steps" data-set-id="${s.id}" data-kind="descendente">
        <span class="set-extra-label">↓ escalones</span>
        <div class="set-extra-steps">
          ${steps.map((step, i) => `
            <span class="set-step" data-idx="${i}">
              <input type="number" inputmode="decimal" class="set-step-weight" data-idx="${i}" value="${step.weight ?? ''}" placeholder="kg" />
              <span class="set-step-x">×</span>
              <input type="number" inputmode="numeric" class="set-step-reps" data-idx="${i}" value="${step.reps ?? ''}" placeholder="reps" />
              <button type="button" class="set-step-remove" data-idx="${i}">✕</button>
            </span>
          `).join('')}
          <button type="button" class="set-extra-add" data-kind="descendente">+ escalón</button>
        </div>
      </div>`;
  }
  return '';
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
