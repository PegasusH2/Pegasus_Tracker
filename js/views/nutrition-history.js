// Nutrición · Histórico — versiones pasadas de Macros Y Dieta cerrada,
// leídas en vivo del backend real de Pegasus Nutrition (nutrition_macro_plan
// + nutrition_closed_diet_plan). Siempre de solo lectura: cada actualización
// ya es una fila nueva por fecha (ver js/core/pegasus-nutrition.js), así que
// el pasado completo de ambos modelos está aquí sin necesitar nada aparte.
// Cambiar profiles.tipoDieta nunca borra el histórico del modelo anterior —
// por eso este listado combina los dos en vez de mostrar solo el vigente.
import * as pegasus from '../core/pegasus-nutrition.js';
import * as settings from '../core/settings.js';
import { getUser } from '../core/auth.js';
import { formatDate } from '../core/format.js';
import { navigate } from '../app.js';

export async function renderNutritionHistory(mount) {
  const user = await getUser();
  if (!user) {
    mount.innerHTML = `
      <h1 class="type-title" style="margin-bottom:16px;">Histórico</h1>
      <div class="empty-state">Inicia sesión con tu cuenta de Pegasus para ver tu histórico de Pegasus Nutrition.</div>
      <button class="btn btn-primary btn-block" id="h-login" style="margin-top:var(--space-4);">Ir a Ajustes › Cuenta</button>
    `;
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
    <h1 class="type-title" style="margin-bottom:16px;">Histórico</h1>
    ${!entradas.length ? `<div class="empty-state">Todavía no hay ningún registro nutricional.</div>` : `
      <div class="grouped-list">
        ${entradas.map(({ tipo, plan: p, esActual }) => `
          <div class="grouped-row">
            <div style="min-width:0;">
              <div class="type-body">
                ${formatDate(p.fecha)}
                ${esActual ? '<span class="type-caption" style="color:var(--accent); font-weight:700;"> · Actual</span>' : ''}
              </div>
              <div class="type-caption text-faint">
                ${tipo === 'macros' ? 'Macros' : 'Dieta cerrada'}
                ${tipo === 'macros'
                  ? ` · ON ×${p.diasOn ?? '—'} · P${p.proteinaOn ?? '—'}/C${p.hidratosOn ?? '—'}/G${p.grasasOn ?? '—'} · OFF ×${p.diasOff ?? '—'} · P${p.proteinaOff ?? '—'}/C${p.hidratosOff ?? '—'}/G${p.grasasOff ?? '—'}`
                  : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}
