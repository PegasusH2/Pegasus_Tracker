// Nutrición · Dieta cerrada — datos REALES de Pegasus Coach (tablas
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
import { replayEnterAnimation } from '../core/ui.js';
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

// ---------------------------------------------------------------------
// Timeline de comidas (solo lectura) — agrupa la lista plana de alimentos
// por `momento`. LIMITACIÓN CONOCIDA: `momento` es texto libre, no una hora
// estructurada ni un id de comida — el agrupado es por IGUALDAD EXACTA de
// string. "Desayuno" y "desayuno" (o un espacio de más) generan dos grupos
// distintos en vez de uno. No se modifica el modelo para corregir esto.
// Los alimentos sin momento (null) van siempre al final, como un grupo
// "Sin horario especificado".
// ---------------------------------------------------------------------
function groupItemsByMomento(items) {
  const grupos = [];
  const indicePorMomento = new Map();
  const ordenados = [...items].sort((a, b) => a.orden - b.orden);
  for (const item of ordenados) {
    const clave = item.momento || null;
    let indice = indicePorMomento.get(clave);
    if (indice === undefined) {
      indice = grupos.length;
      indicePorMomento.set(clave, indice);
      grupos.push({ momento: clave, items: [] });
    }
    grupos[indice].items.push(item);
  }
  const conMomento = grupos.filter((g) => g.momento !== null);
  const sinMomento = grupos.filter((g) => g.momento === null);
  return [...conMomento, ...sinMomento];
}

export function timelineHtml(items) {
  const grupos = groupItemsByMomento(items);
  if (grupos.length === 0) {
    return '<div class="empty-state">Todavía no hay alimentos en este plan.</div>';
  }
  return `
    <div class="meal-timeline">
      ${grupos.map((grupo, i) => `
        <div class="meal-node">
          <div class="meal-node-marker">
            <span class="meal-node-dot"></span>
            ${i < grupos.length - 1 ? '<span class="meal-node-line"></span>' : ''}
          </div>
          <div class="meal-node-content">
            <div class="meal-node-title">${escapeHtml(grupo.momento ?? 'Sin horario especificado')}</div>
            <div class="card meal-card">
              ${grupo.items.map((item) => `
                <div class="meal-food-row">
                  <span class="meal-food-name">${escapeHtml(item.alimento)}</span>
                  <span class="meal-food-grams">${escapeHtml(String(item.gramos))} g</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

export function coachNoteHtml(notas) {
  if (!notas) return '';
  return `
    <div class="card coach-note" style="margin-top:var(--space-4);">
      <div class="type-micro text-good" style="margin-bottom:4px;">Nota de tu entrenador</div>
      <p class="type-body">${escapeHtml(notas)}</p>
    </div>
  `;
}

export async function renderNutritionClosedDiet(mount) {
  await paint(mount);
}

async function paint(mount) {
  const user = await getUser();
  if (!user) {
    mount.innerHTML = `
      <h1 class="type-title" style="margin-bottom:16px;">Dieta</h1>
      <div class="empty-state">Inicia sesión con tu cuenta de Pegasus para ver tu dieta de Pegasus Coach.</div>
      <button class="btn btn-primary btn-block" id="dc-login" style="margin-top:var(--space-4);">Ir a Ajustes › Cuenta</button>
    `;
    replayEnterAnimation(mount);
    mount.querySelector('#dc-login').addEventListener('click', () => navigate('/ajustes/cuenta'));
    return;
  }

  // Mismo criterio que en nutrition-macros.js: con entrenador vinculado, la
  // dieta cerrada es de solo lectura — ni siquiera se montan los controles
  // de edición (ver settings-hub.js para el mismo patrón ya usado en el
  // selector de Tipo de nutrición).
  const [tipo, trainerLink] = await Promise.all([
    pegasus.pegasusGetTipoDieta(),
    pegasus.pegasusGetTrainerLink(),
  ]);
  const soloLectura = !!trainerLink;
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

  if (soloLectura) {
    paintReadOnly(mount, plan, items, distingueDias);
    return;
  }

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
    ${coachNoteHtml(plan?.notas)}
    <button class="btn btn-secondary btn-block" id="dc-new" style="margin-top:var(--space-4);">${plan ? 'Nuevo registro' : 'Crear dieta'}</button>
    ${plan ? `<button class="btn btn-primary btn-block" id="dc-save" style="margin-top:8px;">Guardar cambios</button>` : ''}
  `;
  replayEnterAnimation(mount);

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

// ---------------------------------------------------------------------
// Cliente con entrenador vinculado: solo lectura absoluta. Ni "Nuevo
// registro", ni "Guardar cambios", ni añadir/eliminar/editar alimentos —
// esos controles no se montan en el DOM en ningún momento de esta función.
// ---------------------------------------------------------------------
function paintReadOnly(mount, plan, items, distingueDias) {
  let diaActivo = 'on';

  function render() {
    const itemsDelDia = distingueDias ? items.filter((i) => i.diaTipo === diaActivo) : items;
    mount.innerHTML = `
      <h1 class="type-title" style="margin-bottom:16px;">Tu plan de hoy</h1>
      ${!plan ? `
        <div class="empty-state">Tu entrenador todavía no te ha asignado una dieta.</div>
      ` : `
        <div class="type-caption text-faint" style="margin-bottom:16px;">Dieta activa desde ${formatDate(plan.fecha)}</div>
        ${distingueDias ? `
          <div class="segmented" style="width:fit-content; margin-bottom:var(--space-4);">
            <button type="button" class="seg ${diaActivo === 'on' ? 'active' : ''}" data-dia="on">Día ON</button>
            <button type="button" class="seg ${diaActivo === 'off' ? 'active' : ''}" data-dia="off">Día OFF</button>
          </div>
        ` : ''}
        ${timelineHtml(itemsDelDia)}
        ${coachNoteHtml(plan.notas)}
      `}
    `;
    replayEnterAnimation(mount);
    mount.querySelectorAll('[data-dia]').forEach((btn) => {
      btn.addEventListener('click', () => {
        diaActivo = btn.dataset.dia;
        render();
      });
    });
  }

  render();
}
