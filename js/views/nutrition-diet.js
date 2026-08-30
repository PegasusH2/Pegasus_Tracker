// Nutrición · Dieta — el plan vigente (el más reciente por fecha), con sus
// comidas y alimentos. Si lo asignó el entrenador (repo.isReadOnlyForMe) es
// de solo lectura — mismo criterio que nutrition-macros.js.
import * as repo from '../db/repository.js';
import { escapeHtml } from '../core/escape.js';
import { formatDate, todayISO } from '../core/format.js';
import { openSheet, openConfirmSheet, NAV_ICONS } from '../core/ui.js';
import { toast } from '../core/store.js';
import * as settings from '../core/settings.js';
import { DAY_TYPE_LABELS, resolveTodayDayType } from '../core/nutrition.js';
import { renderMacroSummaryHtml, dayTypeSelectorHtml } from './nutrition-macros.js';
import { navigate } from '../app.js';

let dayType = null;

export async function renderNutritionDiet(mount) {
  if (!dayType) dayType = resolveTodayDayType(settings.getNutricionWeekdayTypes());
  await paint(mount);
}

async function paint(mount) {
  const plan = await repo.getCurrentDietPlan(dayType);
  const readOnly = repo.isReadOnlyForMe(plan);
  const macroTarget = await repo.getCurrentMacroTarget(dayType);
  const meals = plan ? await repo.listDietMeals(plan.id) : [];
  const mealsWithFoods = await Promise.all(meals.map(async (m) => ({ meal: m, foods: await repo.listDietFoods(m.id) })));

  mount.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <h1 class="type-title">Dieta</h1>
      <button type="button" class="icon-btn" id="d-config" aria-label="Configurar nutrición">${NAV_ICONS.settings}</button>
    </div>
    ${dayTypeSelectorHtml('d-daytype', dayType)}
    ${renderMacroSummaryHtml(macroTarget)}
    ${!plan ? `
      <div class="empty-state">Todavía no hay ningún plan de dieta de ${DAY_TYPE_LABELS[dayType].toLowerCase()} registrado.</div>
      <button class="btn btn-primary btn-block" id="d-create" style="margin-top:var(--space-4);">Crear plan</button>
    ` : `
      <div class="row" style="align-items:flex-start; margin-bottom:4px;">
        <div style="min-width:0;">
          <div class="type-headline">${escapeHtml(plan.name)}</div>
          <div class="type-caption text-faint">Vigente desde ${formatDate(plan.effectiveDate)}${readOnly ? ' · Definido por tu entrenador' : ''}</div>
        </div>
        ${!readOnly ? `<button class="btn btn-ghost-danger btn-sm" id="d-delete">Eliminar</button>` : ''}
      </div>
      ${plan.description ? `<p class="type-body text-dim" style="margin:8px 0 var(--space-4);">${escapeHtml(plan.description)}</p>` : '<div style="margin-bottom:var(--space-4);"></div>'}

      <div class="stack" id="d-meals" style="gap:var(--space-3);"></div>

      ${!readOnly ? `<button class="btn btn-secondary btn-block" id="d-add-meal" style="margin-top:var(--space-3);">+ Añadir comida</button>` : ''}
      ${!readOnly ? `<button class="btn btn-ghost btn-block" id="d-new-version" style="margin-top:8px;">Empezar un plan nuevo</button>` : ''}
    `}
  `;

  const mealsList = mount.querySelector('#d-meals');
  if (mealsList) {
    mealsList.innerHTML = mealsWithFoods.map(({ meal, foods }) => `
      <div class="card" data-meal-id="${meal.id}" style="margin-bottom:0;">
        <div class="row" style="margin-bottom:8px;">
          <div class="type-body" style="font-weight:700;">${escapeHtml(meal.name)}</div>
          ${!readOnly ? `<button class="icon-btn meal-remove" aria-label="Quitar comida">✕</button>` : ''}
        </div>
        ${foods.length ? `
          <div class="grouped-list" style="margin-bottom:${!readOnly ? 'var(--space-2)' : '0'};">
            ${foods.map((f) => `
              <div class="grouped-row" data-food-id="${f.id}">
                <div style="min-width:0;">
                  <div class="type-body">${escapeHtml(f.name)}</div>
                  <div class="type-caption text-faint">${[
                    f.quantity != null ? `${f.quantity} ${f.unit || 'g'}` : null,
                    f.calories != null ? `${f.calories} kcal` : null,
                    f.proteinG != null ? `P ${f.proteinG}g` : null,
                    f.carbsG != null ? `C ${f.carbsG}g` : null,
                    f.fatG != null ? `G ${f.fatG}g` : null,
                  ].filter(Boolean).join(' · ')}</div>
                </div>
                ${!readOnly ? `<button class="icon-btn food-remove" aria-label="Quitar alimento">✕</button>` : ''}
              </div>
            `).join('')}
          </div>
        ` : `<div class="last-session-empty" style="display:block; margin-bottom:${!readOnly ? '8px' : '0'};">Sin alimentos todavía.</div>`}
        ${!readOnly ? `<button type="button" class="btn btn-ghost btn-sm add-food">+ Añadir alimento</button>` : ''}
      </div>
    `).join('') || (readOnly ? '' : '<div class="last-session-empty" style="display:block;">Añade tu primera comida.</div>');
  }

  mount.querySelector('#d-config').addEventListener('click', () => navigate('/nutricion/configurar'));
  mount.querySelector('#d-daytype').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day-type]');
    if (!btn || btn.dataset.dayType === dayType) return;
    dayType = btn.dataset.dayType;
    paint(mount);
  });
  mount.querySelector('#d-create')?.addEventListener('click', () => openPlanForm(mount));
  mount.querySelector('#d-new-version')?.addEventListener('click', () => openPlanForm(mount));
  mount.querySelector('#d-delete')?.addEventListener('click', async () => {
    const ok = await openConfirmSheet(`¿Eliminar "${plan.name}" y todas sus comidas?`, { confirmLabel: 'Eliminar' });
    if (!ok) return;
    await repo.deleteDietPlan(plan.id);
    await paint(mount);
  });
  mount.querySelector('#d-add-meal')?.addEventListener('click', () => openMealForm(mount, plan.id));

  mealsList?.querySelectorAll('[data-meal-id]').forEach((card) => {
    const mealId = card.dataset.mealId;
    card.querySelector('.meal-remove')?.addEventListener('click', async () => {
      const meal = meals.find((m) => m.id === mealId);
      const ok = await openConfirmSheet(`¿Quitar "${meal.name}" de la dieta?`, { confirmLabel: 'Quitar' });
      if (!ok) return;
      await repo.deleteDietMeal(mealId);
      await paint(mount);
    });
    card.querySelector('.add-food')?.addEventListener('click', () => openFoodForm(mount, mealId));
    card.querySelectorAll('[data-food-id]').forEach((row) => {
      row.querySelector('.food-remove')?.addEventListener('click', async () => {
        const ok = await openConfirmSheet('¿Quitar este alimento?', { confirmLabel: 'Quitar' });
        if (!ok) return;
        await repo.deleteDietFood(row.dataset.foodId);
        await paint(mount);
      });
    });
  });
}

function openPlanForm(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:4px;">Nuevo plan de dieta</h3>
    <p class="type-caption text-faint" style="margin-bottom:16px;">${DAY_TYPE_LABELS[dayType]} — independiente del otro tipo de día.</p>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="f-name" placeholder="Ej. Fase de volumen" />
    </div>
    <div class="field">
      <label class="label">Fecha de inicio</label>
      <input type="date" id="f-date" value="${todayISO()}" />
    </div>
    <div class="field">
      <label class="label">Descripción (opcional)</label>
      <textarea id="f-desc" rows="2"></textarea>
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Crear</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async (e) => {
        const name = sheet.querySelector('#f-name').value.trim();
        const effectiveDate = sheet.querySelector('#f-date').value;
        if (!name || !effectiveDate) { toast('Nombre y fecha son obligatorios'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await repo.createDietPlan({ name, effectiveDate, dayType, description: sheet.querySelector('#f-desc').value.trim() });
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

function openMealForm(mount, dietPlanId) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Nueva comida</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="f-name" placeholder="Ej. Desayuno" autofocus />
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Añadir</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async (e) => {
        const name = sheet.querySelector('#f-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await repo.addDietMeal(dietPlanId, { name });
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

function openFoodForm(mount, mealId) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Nuevo alimento</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="f-name" autofocus />
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;">
        <label class="label">Cantidad</label>
        <input type="number" inputmode="decimal" id="f-qty" />
      </div>
      <div class="field" style="flex:1;">
        <label class="label">Unidad</label>
        <input type="text" id="f-unit" value="g" />
      </div>
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;">
        <label class="label">Calorías</label>
        <input type="number" inputmode="numeric" id="f-calories" />
      </div>
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;">
        <label class="label">Proteína (g)</label>
        <input type="number" inputmode="decimal" id="f-protein" />
      </div>
      <div class="field" style="flex:1;">
        <label class="label">Carbos (g)</label>
        <input type="number" inputmode="decimal" id="f-carbs" />
      </div>
      <div class="field" style="flex:1;">
        <label class="label">Grasa (g)</label>
        <input type="number" inputmode="decimal" id="f-fat" />
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="f-save">Añadir</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async (e) => {
        const name = sheet.querySelector('#f-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await repo.addDietFood(mealId, {
            name,
            quantity: sheet.querySelector('#f-qty').value,
            unit: sheet.querySelector('#f-unit').value.trim() || 'g',
            calories: sheet.querySelector('#f-calories').value,
            proteinG: sheet.querySelector('#f-protein').value,
            carbsG: sheet.querySelector('#f-carbs').value,
            fatG: sheet.querySelector('#f-fat').value,
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
