// Calendario mensual de entrenamientos — sustituye la lista plana "Tus
// entrenos". Representa SESIONES REALIZADAS (workouts), nunca plantillas sin
// ejecutar. Tap normal: abre/elige sesión o propone crear una si no hay
// ninguna. Pulsación larga sobre un día ya entrenado: propone un segundo
// entreno independiente sin tocar el/los ya existentes.
import * as repo from '../db/repository.js';
import { formatDate, todayISO } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, templateIconHtml } from '../core/ui.js';
import { navigate } from '../app.js';

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const LONG_PRESS_MS = 500;
const CANCEL_PX = 10;

const today = new Date();
const calState = { year: today.getFullYear(), month: today.getMonth() };

export async function renderWorkoutCalendar(container) {
  await paint(container);
}

async function paint(container) {
  const byDate = await repo.listWorkoutsByMonth(calState.year, calState.month);
  const days = getMonthGrid(calState.year, calState.month);
  const todayIso = todayISO();

  container.innerHTML = `
    <div class="cal-header">
      <button class="icon-btn" id="cal-prev" aria-label="Mes anterior">‹</button>
      <button class="cal-title" id="cal-today">${MONTH_NAMES[calState.month]} ${calState.year}</button>
      <button class="icon-btn" id="cal-next" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal-weekdays">${WEEKDAY_LABELS.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid" id="cal-grid">
      ${days.map((d) => {
        const iso = isoDate(d);
        const inMonth = d.getMonth() === calState.month;
        const workouts = byDate[iso] || [];
        return `
          <button class="cal-day ${inMonth ? '' : 'is-outside'} ${iso === todayIso ? 'is-today' : ''} ${workouts.length ? 'has-workout' : ''} ${workouts.length > 1 ? 'has-multiple' : ''}" data-date="${iso}">
            <span class="cal-day-num">${d.getDate()}</span>
            ${workouts.length ? '<span class="cal-dot"></span>' : ''}
          </button>
        `;
      }).join('')}
    </div>
  `;

  container.querySelector('#cal-prev').addEventListener('click', () => shiftMonth(container, -1));
  container.querySelector('#cal-next').addEventListener('click', () => shiftMonth(container, 1));
  container.querySelector('#cal-today').addEventListener('click', () => {
    calState.year = today.getFullYear();
    calState.month = today.getMonth();
    paint(container);
  });

  attachPressHandlers(container, byDate);
}

function shiftMonth(container, delta) {
  calState.month += delta;
  if (calState.month < 0) { calState.month = 11; calState.year -= 1; }
  if (calState.month > 11) { calState.month = 0; calState.year += 1; }
  paint(container);
}

// Lunes primero, 42 celdas (6 semanas) incluyendo días de meses adyacentes.
function getMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = lunes
  const start = new Date(year, month, 1 - startWeekday);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Pointer Events (no click/touchstart) para long-press fiable en iOS Safari
// standalone: unifica mouse+touch y evita el retraso/doble disparo táctil.
function attachPressHandlers(container, byDate) {
  const grid = container.querySelector('#cal-grid');
  let timer = null;
  let longPressFired = false;
  let startX = 0, startY = 0;

  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cal-day[data-date]');
    if (!cell) return;
    startX = e.clientX;
    startY = e.clientY;
    longPressFired = false;
    const date = cell.dataset.date;
    timer = setTimeout(() => {
      longPressFired = true;
      const workouts = byDate[date] || [];
      if (workouts.length) openSecondWorkoutConfirm(date, workouts.length);
    }, LONG_PRESS_MS);
  });

  grid.addEventListener('pointermove', (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > CANCEL_PX || Math.abs(e.clientY - startY) > CANCEL_PX) {
      clearTimeout(timer);
      timer = null;
    }
  });

  const endPress = (e) => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (longPressFired) { longPressFired = false; return; }
    const cell = e.target.closest?.('.cal-day[data-date]');
    if (!cell) return;
    const workouts = byDate[cell.dataset.date] || [];
    handleTap(cell.dataset.date, workouts);
  };
  grid.addEventListener('pointerup', endPress);
  grid.addEventListener('pointercancel', endPress);
  grid.addEventListener('pointerleave', endPress);
}

function handleTap(date, workouts) {
  if (!workouts.length) return openCreateForDateSheet(date);
  if (workouts.length === 1) return navigate(`/entreno/sesion/${workouts[0].id}`);
  return openDaySummarySheet(date, workouts);
}

async function openDaySummarySheet(date, workouts) {
  const rows = await Promise.all(workouts.map(async (w) => {
    const detail = await repo.getWorkoutDetail(w.id);
    const totalSets = detail.exercises.reduce((sum, e) => sum + e.sets.length, 0);
    return { workout: w, exerciseCount: detail.exercises.length, totalSets };
  }));

  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">${formatDate(date)} · ${rows.length} entrenamientos</h3>
    <div class="grouped-list">
      ${rows.map((r) => `
        <div class="grouped-row" data-id="${r.workout.id}" style="cursor:pointer;">
          <div>
            <div class="type-body" style="font-weight:600;">${escapeHtml(r.workout.name)}</div>
            <div class="type-caption text-faint">${r.exerciseCount} ejercicio${r.exerciseCount === 1 ? '' : 's'} · ${r.totalSets} series</div>
          </div>
          <span class="text-faint">›</span>
        </div>
      `).join('')}
    </div>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelectorAll('[data-id]').forEach((row) => {
        row.addEventListener('click', () => {
          close();
          navigate(`/entreno/sesion/${row.dataset.id}`);
        });
      });
    },
  });
}

function openSecondWorkoutConfirm(date, count) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:12px;">¿Registrar un segundo entreno?</h3>
    <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
      Ya tienes ${count} entrenamiento${count === 1 ? '' : 's'} registrado${count === 1 ? '' : 's'} el ${formatDate(date)}. Se creará como una sesión independiente.
    </p>
    <button class="btn btn-primary btn-block" id="confirm-second">Segundo entreno</button>
    <button class="btn btn-ghost btn-block" id="cancel-second" style="margin-top:8px;">Cancelar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#confirm-second').addEventListener('click', () => {
        close();
        openCreateForDateSheet(date);
      });
      sheet.querySelector('#cancel-second').addEventListener('click', close);
    },
  });
}

async function openCreateForDateSheet(date) {
  const templates = await repo.listTemplates();
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">Entrenar el ${formatDate(date)}</h3>
    ${templates.length ? `
      <div class="template-grid" style="margin-bottom:var(--space-4);" id="cal-template-grid">
        ${templates.map((t) => `
          <button class="template-tile" data-id="${t.id}">
            <span class="icon-badge icon-badge--lg">${templateIconHtml(t.icon)}</span>
            <span class="template-tile-label">${escapeHtml(t.name)}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
    <button class="btn btn-secondary btn-block" id="cal-free-workout">+ Entrenamiento libre</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelectorAll('.template-tile[data-id]').forEach((tile) => {
        tile.addEventListener('click', async () => {
          const workout = await repo.startWorkoutFromTemplate(tile.dataset.id, { date });
          close();
          navigate(`/entreno/sesion/${workout.id}`);
        });
      });
      sheet.querySelector('#cal-free-workout').addEventListener('click', () => {
        close();
        navigate(`/entreno/nuevo/${date}`);
      });
    },
  });
}
