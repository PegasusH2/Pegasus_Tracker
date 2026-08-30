// Nutrición · Macros — objetivo de calorías/proteína/carbohidratos/grasa
// vigente, independiente para entrenamiento y descanso (ver
// repository.js#listMacroTargets). Si lo ha fijado el entrenador
// (repo.isReadOnlyForMe), es de solo lectura: el bloqueo real está en RLS
// (ver supabase/migrations/002_nutrition_trainer_link.sql), aquí solo se
// ocultan los controles de edición para no ofrecer una acción que fallaría igual.
import * as repo from '../db/repository.js';
import { formatDate, todayISO } from '../core/format.js';
import { openSheet, openConfirmSheet, NAV_ICONS } from '../core/ui.js';
import { toast } from '../core/store.js';
import * as settings from '../core/settings.js';
import { DAY_TYPE_LABELS, resolveTodayDayType } from '../core/nutrition.js';
import { navigate } from '../app.js';

// Markup del resumen (calorías + P/C/G + fecha) — lo reutiliza
// nutrition-diet.js para mostrarlo arriba del plan sin duplicar el bloque.
export function renderMacroSummaryHtml(target) {
  if (!target) return '';
  return `
    <div class="stat-hero">
      <div class="type-caption text-dim">Calorías</div>
      <div class="stat-hero-value">
        <span class="type-hero">${target.calories ?? '—'}</span>
        ${target.calories != null ? `<span class="type-headline text-dim">kcal</span>` : ''}
      </div>
    </div>
    <div class="card stat-grid" style="margin-bottom:var(--space-4);">
      <div class="stat-tile">
        <div class="stat-label">Proteína</div>
        <div class="stat-value">${target.proteinG ?? '—'}</div>
        <div class="stat-sub">${target.proteinG != null ? 'g' : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Carbohidratos</div>
        <div class="stat-value">${target.carbsG ?? '—'}</div>
        <div class="stat-sub">${target.carbsG != null ? 'g' : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Grasa</div>
        <div class="stat-value">${target.fatG ?? '—'}</div>
        <div class="stat-sub">${target.fatG != null ? 'g' : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Vigente desde</div>
        <div class="stat-value" style="font-size:17px;">${formatDate(target.effectiveDate)}</div>
      </div>
    </div>
  `;
}

// Selector Entrenamiento/Descanso — mismo patrón .segmented que las subtabs
// y exercise-detail.js, reutilizado también por nutrition-diet.js.
export function dayTypeSelectorHtml(id, dayType) {
  return `
    <div class="segmented" id="${id}" style="margin-bottom:var(--space-4);">
      <button type="button" class="seg ${dayType === 'training' ? 'active' : ''}" data-day-type="training">🏋️ ${DAY_TYPE_LABELS.training}</button>
      <button type="button" class="seg ${dayType === 'rest' ? 'active' : ''}" data-day-type="rest">💤 ${DAY_TYPE_LABELS.rest}</button>
    </div>
  `;
}

let dayType = null;

export async function renderNutritionMacros(mount) {
  if (!dayType) dayType = resolveTodayDayType(settings.getNutricionWeekdayTypes());
  await paint(mount);
}

async function paint(mount) {
  const target = await repo.getCurrentMacroTarget(dayType);
  const readOnly = repo.isReadOnlyForMe(target);

  mount.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <h1 class="type-title">Macros</h1>
      <button type="button" class="icon-btn" id="m-config" aria-label="Configurar nutrición">${NAV_ICONS.settings}</button>
    </div>
    ${dayTypeSelectorHtml('m-daytype', dayType)}
    ${!target ? `
      <div class="empty-state">Todavía no hay ningún objetivo de macros de ${DAY_TYPE_LABELS[dayType].toLowerCase()} registrado.</div>
      <button class="btn btn-primary btn-block" id="m-create" style="margin-top:var(--space-4);">Definir objetivo</button>
    ` : `
      ${readOnly ? `<div class="type-caption text-faint" style="margin-bottom:16px;">Definido por tu entrenador · ${formatDate(target.effectiveDate)}</div>` : ''}
      ${renderMacroSummaryHtml(target)}
      ${target.notes ? `<p class="type-body text-dim" style="margin-bottom:var(--space-4);">${target.notes}</p>` : ''}
      ${!readOnly ? `
        <button class="btn btn-secondary btn-block" id="m-edit">Actualizar objetivo</button>
        <button class="btn btn-ghost-danger btn-block" id="m-delete" style="margin-top:8px;">Eliminar</button>
      ` : ''}
    `}
  `;

  mount.querySelector('#m-config').addEventListener('click', () => navigate('/nutricion/configurar'));
  mount.querySelector('#m-daytype').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day-type]');
    if (!btn || btn.dataset.dayType === dayType) return;
    dayType = btn.dataset.dayType;
    paint(mount);
  });
  mount.querySelector('#m-create')?.addEventListener('click', () => openMacroForm(mount));
  mount.querySelector('#m-edit')?.addEventListener('click', () => openMacroForm(mount, target));
  mount.querySelector('#m-delete')?.addEventListener('click', async () => {
    const ok = await openConfirmSheet('¿Eliminar el objetivo de macros?', { confirmLabel: 'Eliminar' });
    if (!ok) return;
    await repo.deleteMacroTarget(target.id);
    await paint(mount);
  });
}

function openMacroForm(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:4px;">Objetivo de macros</h3>
    <p class="type-caption text-faint" style="margin-bottom:16px;">${DAY_TYPE_LABELS[dayType]} — independiente del otro tipo de día.</p>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="f-date" value="${todayISO()}" />
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;">
        <label class="label">Calorías</label>
        <input type="number" inputmode="numeric" id="f-calories" placeholder="kcal" />
      </div>
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;">
        <label class="label">Proteína (g)</label>
        <input type="number" inputmode="decimal" id="f-protein" />
      </div>
      <div class="field" style="flex:1;">
        <label class="label">Carbohidratos (g)</label>
        <input type="number" inputmode="decimal" id="f-carbs" />
      </div>
      <div class="field" style="flex:1;">
        <label class="label">Grasa (g)</label>
        <input type="number" inputmode="decimal" id="f-fat" />
      </div>
    </div>
    <div class="field">
      <label class="label">Notas (opcional)</label>
      <input type="text" id="f-notes" />
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Guardar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async (e) => {
        const effectiveDate = sheet.querySelector('#f-date').value;
        if (!effectiveDate) { toast('La fecha es obligatoria'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await repo.addMacroTarget({
            effectiveDate,
            dayType,
            calories: sheet.querySelector('#f-calories').value,
            proteinG: sheet.querySelector('#f-protein').value,
            carbsG: sheet.querySelector('#f-carbs').value,
            fatG: sheet.querySelector('#f-fat').value,
            notes: sheet.querySelector('#f-notes').value.trim(),
          });
          close();
          await paint(mount);
        } catch (err) {
          toast(err.message || 'No se ha podido guardar');
          btn.disabled = false;
        }
      });
    },
  });
}
