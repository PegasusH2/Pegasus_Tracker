// Configurar nutrición — qué sistema(s) usa el cliente (Macros/Dieta/Ambos,
// distinto de Personalizar: eso solo oculta/muestra pestañas, esto decide
// qué contenido tienen) y qué días de la semana son de entrenamiento o
// descanso. Persiste al toque, igual que Personalizar — sin paso de
// "Guardar" (ver settings-hub.js#openPersonalizarSheet, mismo criterio).
import * as settings from '../core/settings.js';
import { ACTION_ICONS } from '../core/ui.js';
import { escapeHtml } from '../core/escape.js';
import { DAY_TYPE_ICONS, WEEKDAY_ORDER, WEEKDAY_LABELS } from '../core/nutrition.js';
import { navigate } from '../app.js';

const MODES = [
  { key: 'macros', label: 'Macros' },
  { key: 'dieta', label: 'Dieta' },
  { key: 'ambos', label: 'Macros + Dieta' },
];

export async function renderNutritionConfig(mount) {
  paint(mount);
}

function paint(mount) {
  const mode = settings.getNutricionMode();
  const weekdayTypes = settings.getNutricionWeekdayTypes();

  mount.innerHTML = `
    <div class="row" style="align-items:center; margin-bottom:var(--space-4);">
      <button type="button" class="icon-btn" id="cfg-back" aria-label="Volver">${ACTION_ICONS.chevronLeft}</button>
      <h1 class="type-title" style="flex:1; text-align:center; font-size:19px;">Configurar nutrición</h1>
      <span style="width:34px;"></span>
    </div>

    <div class="section-label">¿Qué quieres utilizar?</div>
    <div class="segmented" id="cfg-mode" style="margin-bottom:var(--space-5);">
      ${MODES.map((m) => `<button type="button" class="seg ${m.key === mode ? 'active' : ''}" data-mode="${m.key}">${escapeHtml(m.label)}</button>`).join('')}
    </div>

    <div class="section-label">Días de entrenamiento y descanso</div>
    <p class="type-caption text-faint" style="margin-bottom:var(--space-3);">
      Toca un día para alternar entre entrenamiento y descanso. Podrás cambiarlo cuando quieras sin perder los objetivos ya configurados.
    </p>
    <div class="row" id="cfg-weekdays" style="gap:6px; justify-content:space-between;">
      ${WEEKDAY_ORDER.map((day) => `
        <button type="button" class="cfg-day-btn" data-day="${day}" style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 0; border-radius:var(--radius-sm); background:var(--surface-2);">
          <span class="type-caption text-faint">${WEEKDAY_LABELS[day]}</span>
          <span style="font-size:18px;">${DAY_TYPE_ICONS[weekdayTypes[day] ?? 'training']}</span>
        </button>
      `).join('')}
    </div>
    <p class="type-caption text-faint" style="margin-top:var(--space-3);">
      🏋️ Entrenamiento · 💤 Descanso
    </p>
  `;

  mount.querySelector('#cfg-back').addEventListener('click', () => navigate('/nutricion'));

  mount.querySelector('#cfg-mode').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn || btn.dataset.mode === mode) return;
    await settings.setNutricionMode(btn.dataset.mode);
    paint(mount);
  });

  mount.querySelector('#cfg-weekdays').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-day]');
    if (!btn) return;
    const day = btn.dataset.day;
    const current = weekdayTypes[day] ?? 'training';
    const next = current === 'training' ? 'rest' : 'training';
    await settings.setNutricionWeekdayType(day, next);
    paint(mount);
  });
}
