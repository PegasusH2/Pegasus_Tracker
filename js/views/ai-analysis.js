import * as repo from '../db/repository.js';
import { todayISO } from '../core/format.js';
import { toast } from '../core/store.js';

const PERIODS = [
  { key: '2w', label: '2 semanas', days: 14 },
  { key: '1m', label: '1 mes', days: 30 },
  { key: '3m', label: '3 meses', days: 90 },
  { key: '6m', label: '6 meses', days: 180 },
  { key: 'custom', label: 'Personalizado' },
];

const DATA_OPTIONS = [
  { key: 'peso', label: 'Peso corporal' },
  { key: 'medidas', label: 'Medidas' },
  { key: 'plicometro', label: 'Plicómetro' },
  { key: 'entrenamientos', label: 'Entrenamientos' },
  { key: 'volumen', label: 'Volumen' },
  { key: 'rir', label: 'RIR' },
  { key: 'prs', label: 'Récords personales (PRs)' },
];

const state = {
  period: '1m',
  customFrom: todayISO(),
  customTo: todayISO(),
  flags: Object.fromEntries(DATA_OPTIONS.map((o) => [o.key, true])),
};

export async function renderAiAnalysis(mount) {
  mount.innerHTML = `
    <h1 style="font-size:22px; margin-bottom:8px;">Análisis IA</h1>
    <p class="text-dim" style="font-size:14px; margin-bottom:20px;">
      El análisis solo se ejecuta cuando tú lo solicitas expresamente. No se envía ningún dato de forma automática ni en segundo plano.
    </p>

    <div class="card" style="margin-bottom:16px;">
      <div class="last-session-title" style="margin-bottom:10px;">Periodo a analizar</div>
      <div class="period-selector" id="period-selector">
        ${PERIODS.map((p) => `<button class="period-chip ${p.key === state.period ? 'active' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}
      </div>
      <div id="custom-range" style="${state.period === 'custom' ? '' : 'display:none;'} margin-top:8px;">
        <div class="grid-2">
          <div class="field" style="margin-bottom:0;">
            <label class="label">Desde</label>
            <input type="date" id="custom-from" value="${state.customFrom}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label class="label">Hasta</label>
            <input type="date" id="custom-to" value="${state.customTo}" />
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="last-session-title" style="margin-bottom:6px;">Datos a incluir</div>
      ${DATA_OPTIONS.map((o) => `
        <label class="checkbox-row">
          <input type="checkbox" data-flag="${o.key}" ${state.flags[o.key] ? 'checked' : ''} />
          <span>${o.label}</span>
        </label>
      `).join('')}
    </div>

    <button class="btn btn-primary btn-block" id="show-summary">Ver resumen antes de analizar</button>

    <div id="summary-section" style="margin-top:20px;"></div>
  `;

  mount.querySelector('#period-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    state.period = btn.dataset.period;
    renderAiAnalysis(mount);
  });
  mount.querySelector('#custom-from')?.addEventListener('change', (e) => { state.customFrom = e.target.value; });
  mount.querySelector('#custom-to')?.addEventListener('change', (e) => { state.customTo = e.target.value; });

  mount.querySelectorAll('[data-flag]').forEach((cb) => {
    cb.addEventListener('change', (e) => { state.flags[e.target.dataset.flag] = e.target.checked; });
  });

  mount.querySelector('#show-summary').addEventListener('click', () => renderSummary(mount));
}

function periodRange() {
  if (state.period === 'custom') return { from: state.customFrom, to: state.customTo };
  const period = PERIODS.find((p) => p.key === state.period);
  const to = todayISO();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - period.days);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

async function renderSummary(mount) {
  const { from, to } = periodRange();
  const flags = state.flags;

  const [workouts, weightEntries, measurementTypes, skinfoldByDate] = await Promise.all([
    repo.listWorkouts(),
    repo.listBodyWeight(),
    repo.listMeasurementTypes(),
    repo.listSkinfoldEntriesByDate(),
  ]);

  const workoutsInRange = workouts.filter((w) => w.date >= from && w.date <= to);
  const weightInRange = weightEntries.filter((e) => e.date >= from && e.date <= to);
  const skinfoldDatesInRange = Object.keys(skinfoldByDate).filter((d) => d >= from && d <= to);

  let measurementsCount = 0;
  for (const type of measurementTypes) {
    const entries = await repo.listMeasurementsByType(type.id);
    measurementsCount += entries.filter((e) => e.date >= from && e.date <= to).length;
  }

  const items = [];
  if (flags.entrenamientos) items.push(`${workoutsInRange.length} entrenamiento(s)`);
  if (flags.volumen) items.push(`volumen de entrenamiento de ese periodo`);
  if (flags.rir) items.push(`RIR registrado en cada serie`);
  if (flags.prs) items.push(`récords personales acumulados hasta la fecha`);
  if (flags.peso) items.push(`${weightInRange.length} registro(s) de peso corporal`);
  if (flags.medidas) items.push(`${measurementsCount} registro(s) de medidas`);
  if (flags.plicometro) items.push(`${skinfoldDatesInRange.length} registro(s) de plicómetro`);

  const section = mount.querySelector('#summary-section');
  section.innerHTML = `
    <div class="card">
      <div class="last-session-title" style="margin-bottom:8px;">Estos son los datos que se enviarían para el análisis</div>
      <div class="text-dim" style="font-size:13px; margin-bottom:10px;">Periodo: ${from} a ${to}</div>
      <ul style="padding-left:18px; margin-bottom:16px;">
        ${items.map((i) => `<li style="margin-bottom:4px;">${i}</li>`).join('') || '<li>No has seleccionado ningún dato.</li>'}
      </ul>
      <div class="row">
        <button class="btn btn-secondary" id="cancel-analysis">Cancelar</button>
        <button class="btn btn-primary" id="confirm-analysis">Confirmar análisis</button>
      </div>
    </div>
  `;
  section.querySelector('#cancel-analysis').addEventListener('click', () => {
    section.innerHTML = '';
  });
  section.querySelector('#confirm-analysis').addEventListener('click', () => {
    toast('El análisis con IA todavía no está conectado. Se añadirá en una fase posterior.');
  });
}
