// Nutrición · Historial — versiones pasadas de Macros Y Dieta cerrada,
// leídas en vivo del backend real de Pegasus Coach (nutrition_macro_plan
// + nutrition_closed_diet_plan). Siempre de solo lectura: cada actualización
// ya es una fila nueva por fecha (ver js/core/pegasus-nutrition.js), así que
// el pasado completo de ambos modelos está aquí sin necesitar nada aparte.
// Cambiar profiles.tipoDieta nunca borra el histórico del modelo anterior —
// por eso este listado combina los dos en vez de mostrar solo el vigente.
import * as pegasus from '../core/pegasus-nutrition.js';
import * as settings from '../core/settings.js';
import { getUser } from '../core/auth.js';
import { formatDate } from '../core/format.js';
import { openSheet, replayEnterAnimation } from '../core/ui.js';
import { navigate } from '../app.js';
import { macroBlockHtml } from './nutrition-macros.js';
import { timelineHtml, coachNoteHtml } from './nutrition-closed-diet.js';

export async function renderNutritionHistory(mount) {
  const user = await getUser();
  if (!user) {
    mount.innerHTML = `
      <h1 class="type-title" style="margin-bottom:16px;">Historial</h1>
      <div class="empty-state">Inicia sesión con tu cuenta de Pegasus para ver tu historial de Pegasus Coach.</div>
      <button class="btn btn-primary btn-block" id="h-login" style="margin-top:var(--space-4);">Ir a Ajustes › Cuenta</button>
    `;
    replayEnterAnimation(mount);
    mount.querySelector('#h-login').addEventListener('click', () => navigate('/ajustes/cuenta'));
    return;
  }

  const [tipoInfo, macroPlans, closedDietPlans] = await Promise.all([
    pegasus.pegasusGetTipoDieta(),
    pegasus.pegasusListMacroPlans(),
    pegasus.pegasusListClosedDietPlans(),
  ]);
  const tipoActual = tipoInfo?.tipoDieta ?? 'macros';
  settings.setNutricionTipoCache({
    tipoDieta: tipoActual,
    dietaCerradaDistingueDias: tipoInfo?.dietaCerradaDistingueDias ?? false,
  });

  // "Actual" es la entrada más reciente DEL TIPO vigente — tipoDieta es el
  // estado actual, los planes son histórico (ver profiles.tipoDieta): una
  // entrada del otro modelo nunca es "Actual" aunque su fecha sea más
  // reciente que la última del modelo vigente.
  const entradas = [
    ...macroPlans.map((p, i) => ({ tipo: 'macros', plan: p, esActual: tipoActual === 'macros' && i === 0 })),
    ...closedDietPlans.map((p, i) => ({ tipo: 'cerrada', plan: p, esActual: tipoActual === 'cerrada' && i === 0 })),
  ].sort((a, b) => (a.plan.fecha < b.plan.fecha ? 1 : a.plan.fecha > b.plan.fecha ? -1 : 0));

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:16px;">Historial</h1>
    ${!entradas.length ? `<div class="empty-state">Todavía no hay ningún registro nutricional.</div>` : `
      <div class="stack">
        ${entradas.map((entrada, i) => historyCardHtml(entrada, i)).join('')}
      </div>
    `}
  `;
  replayEnterAnimation(mount);

  entradas.forEach((entrada, i) => {
    mount.querySelector(`[data-historial-index="${i}"]`)?.addEventListener('click', () => abrirDetalle(entrada));
  });
}

function historyCardHtml({ tipo, plan: p, esActual }, index) {
  const resumen = tipo === 'macros'
    ? `Macros · ON P${p.proteinaOn ?? '—'}/C${p.hidratosOn ?? '—'}/G${p.grasasOn ?? '—'}`
    : 'Dieta cerrada';
  return `
    <button type="button" class="card history-card" data-historial-index="${index}">
      <div class="history-card-top">
        <span class="type-headline">${esActual ? 'Versión actual' : 'Versión anterior'}</span>
        ${esActual ? '<span class="badge badge-good">Actual</span>' : ''}
      </div>
      <div class="type-caption text-faint" style="margin-bottom:6px;">${formatDate(p.fecha)}</div>
      <div class="type-body text-dim">${resumen}</div>
    </button>
  `;
}

async function abrirDetalle({ tipo, plan }) {
  if (tipo === 'macros') {
    openSheet(`
      <h3 class="type-headline" style="margin-bottom:4px;">${formatDate(plan.fecha)}</h3>
      <p class="type-caption text-faint" style="margin-bottom:16px;">Macros</p>
      ${macroBlockHtml('Días ON', plan.diasOn, plan.proteinaOn, plan.hidratosOn, plan.grasasOn)}
      ${macroBlockHtml('Días OFF', plan.diasOff, plan.proteinaOff, plan.hidratosOff, plan.grasasOff)}
      ${(plan.normocalorico != null || plan.aguaLitros != null || plan.salGramos != null || plan.neatObjetivoPasos != null) ? `
        <div class="type-caption text-faint">
          ${[
            plan.normocalorico != null ? `Mantenimiento ${plan.normocalorico} kcal` : null,
            plan.aguaLitros != null ? `Agua ${plan.aguaLitros} L` : null,
            plan.salGramos != null ? `Sal ${plan.salGramos} g` : null,
            plan.neatObjetivoPasos != null ? `${plan.neatObjetivoPasos} pasos` : null,
          ].filter(Boolean).join(' · ')}
        </div>
      ` : ''}
    `);
    return;
  }

  openSheet('<div id="hist-detail"><p class="type-caption text-faint">Cargando…</p></div>', {
    onMount: async (sheet) => {
      const items = await pegasus.pegasusListClosedDietItems(plan.id);
      sheet.querySelector('#hist-detail').innerHTML = `
        <h3 class="type-headline" style="margin-bottom:4px;">${formatDate(plan.fecha)}</h3>
        <p class="type-caption text-faint" style="margin-bottom:16px;">Dieta cerrada</p>
        ${timelineHtml(items)}
        ${coachNoteHtml(plan.notas)}
      `;
    },
  });
}
