// Nutrición · Dieta cerrada — datos REALES de Pegasus Nutrition (tablas
// nutrition_closed_diet_plan/_item en Supabase, ver
// js/core/pegasus-nutrition.js), alternativa a Macros cuando
// profiles.tipoDieta = 'cerrada'. Mismo patrón que nutrition-macros.js:
// lista de alimentos por momento/gramos, "Guardar cambios" actualiza el
// plan activo, "Nuevo registro" crea uno nuevo fechado hoy (histórico).
import * as pegasus from '../core/pegasus-nutrition.js';
import * as settings from '../core/settings.js';
import { getUser } from '../core/auth.js';
import { formatDate, todayISO } from '../core/format.js';
import { toast } from '../core/store.js';
import { escapeHtml } from '../core/escape.js';
import { navigate, refreshRoute } from '../app.js';

function filaVacia() {
  return { momento: '', alimento: '', gramos: '' };
}

function itemToFila(item) {
  return { momento: item.momento || '', alimento: item.alimento, gramos: String(item.gramos ?? '') };
}

function filasToItems(filas, diaTipo) {
  return filas
    .filter((f) => f.alimento.trim() !== '')
    .map((f, i) => ({
      diaTipo,
      momento: f.momento.trim() || null,
      alimento: f.alimento.trim(),
      gramos: Number(f.gramos) || 0,
      orden: i,
    }));
}

export async function renderNutritionClosedDiet(mount) {
  await paint(mount);
}

async function paint(mount) {
  const user = await getUser();
  if (!user) {
    mount.innerHTML = `
      <h1 class="type-title" style="margin-bottom:16px;">Dieta</h1>
      <div class="empty-state">Inicia sesión con tu cuenta de Pegasus para ver tu dieta de Pegasus Nutrition.</div>
      <button class="btn btn-primary btn-block" id="dc-login" style="margin-top:var(--space-4);">Ir a Ajustes › Cuenta</button>
    `;
    mount.querySelector('#dc-login').addEventListener('click', () => navigate('/ajustes/cuenta'));
    return;
  }

  const tipo = await pegasus.pegasusGetTipoDieta();
  settings.setNutricionTipoCache({
    tipoDieta: tipo?.tipoDieta ?? 'macros',
    dietaCerradaDistingueDias: tipo?.dietaCerradaDistingueDias ?? false,
  });
  // Igual que en nutrition-macros.js: si la caché que decidió mostrar esta
  // vista estaba desactualizada y el tipo real ya no es Dieta cerrada, corrige.
  if ((tipo?.tipoDieta ?? 'macros') !== 'cerrada') {
    refreshRoute();
    return;
  }
  const distingueDias = tipo?.dietaCerradaDistingueDias ?? false;
  const plan = await pegasus.pegasusGetLatestClosedDietPlan();
  const items = plan ? await pegasus.pegasusListClosedDietItems(plan.id) : [];

  const state = {
    on: items.filter((i) => i.diaTipo === 'on').map(itemToFila),
    off: items.filter((i) => i.diaTipo === 'off').map(itemToFila),
    unico: items.filter((i) => i.diaTipo === 'unico').map(itemToFila),
  };

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:16px;">Dieta</h1>
    ${!plan
      ? `<div class="empty-state">Todavía no tienes una dieta configurada.</div>`
      : `<div class="type-caption text-faint" style="margin-bottom:16px;">Dieta activa desde ${formatDate(plan.fecha)}</div>`}
    <div id="dc-lists"></div>
    <button class="btn btn-secondary btn-block" id="dc-new" style="margin-top:var(--space-4);">${plan ? 'Nuevo registro' : 'Crear dieta'}</button>
    ${plan ? `<button class="btn btn-primary btn-block" id="dc-save" style="margin-top:8px;">Guardar cambios</button>` : ''}
  `;

  function listaHtml(titulo, grupo, filas) {
    return `
      <div class="section-label">${titulo}</div>
      <div class="grouped-list" data-grupo="${grupo}" style="margin-bottom:var(--space-4);">
        ${filas.map((f, i) => `
          <div class="grouped-row" data-index="${i}" style="align-items:center; gap:8px;">
            <input type="text" class="dc-momento" placeholder="Momento" value="${escapeHtml(f.momento)}" style="flex:1; min-width:0; border:none; background:transparent; font-size:14px;" />
            <input type="text" class="dc-alimento" placeholder="Alimento" value="${escapeHtml(f.alimento)}" style="flex:2; min-width:0; border:none; background:transparent; font-size:14px;" />
            <input type="number" inputmode="decimal" class="dc-gramos" placeholder="g" value="${escapeHtml(f.gramos)}" style="width:56px; text-align:right; border:none; background:transparent; font-size:14px;" />
            <button type="button" class="icon-btn dc-delete" aria-label="Eliminar">✕</button>
          </div>
        `).join('')}
        ${filas.length === 0 ? '<div class="empty-state">Todavía no hay alimentos.</div>' : ''}
      </div>
      <button type="button" class="btn btn-ghost" data-add="${grupo}" style="margin-bottom:var(--space-4);">+ Añadir alimento</button>
    `;
  }

  function renderLists() {
    const box = mount.querySelector('#dc-lists');
    box.innerHTML = distingueDias
      ? listaHtml('Alimentos — Día ON', 'on', state.on) + listaHtml('Alimentos — Día OFF', 'off', state.off)
      : listaHtml('Alimentos', 'unico', state.unico);
    bindListEvents(box);
  }

  function bindListEvents(box) {
    box.querySelectorAll('[data-grupo]').forEach((list) => {
      const grupo = list.dataset.grupo;
      list.querySelectorAll('[data-index]').forEach((row) => {
        const i = Number(row.dataset.index);
        row.querySelector('.dc-momento').addEventListener('input', (e) => { state[grupo][i].momento = e.target.value; });
        row.querySelector('.dc-alimento').addEventListener('input', (e) => { state[grupo][i].alimento = e.target.value; });
        row.querySelector('.dc-gramos').addEventListener('input', (e) => { state[grupo][i].gramos = e.target.value; });
        row.querySelector('.dc-delete').addEventListener('click', () => {
          state[grupo].splice(i, 1);
          renderLists();
        });
      });
    });
    box.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state[btn.dataset.add].push(filaVacia());
        renderLists();
      });
    });
  }

  function itemsAGuardar() {
    return distingueDias
      ? [...filasToItems(state.on, 'on'), ...filasToItems(state.off, 'off')]
      : filasToItems(state.unico, 'unico');
  }

  renderLists();

  mount.querySelector('#dc-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await pegasus.pegasusReplaceClosedDietItems(plan.id, itemsAGuardar());
      toast('Dieta guardada');
    } catch (err) {
      toast(err.message || 'No se ha podido guardar');
    } finally {
      btn.disabled = false;
    }
  });

  mount.querySelector('#dc-new').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const nuevoPlan = await pegasus.pegasusCreateClosedDietPlan({ fecha: todayISO(), semanaId: null, notas: null });
      await pegasus.pegasusReplaceClosedDietItems(nuevoPlan.id, itemsAGuardar());
      await paint(mount);
    } catch (err) {
      toast(err.message || 'No se ha podido crear el registro');
      btn.disabled = false;
    }
  });
}
