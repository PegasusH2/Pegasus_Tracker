// Nutrición · Histórico — versiones pasadas de macros, leídas en vivo del
// backend real de Pegasus Nutrition (nutrition_macro_plan). Siempre de solo
// lectura: cada actualización ya es una fila nueva por fecha (ver
// js/core/pegasus-nutrition.js), así que el pasado completo está aquí sin
// necesitar nada aparte.
import * as pegasus from '../core/pegasus-nutrition.js';
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

  const plans = await pegasus.pegasusListMacroPlans();

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:16px;">Histórico</h1>
    ${!plans.length ? `<div class="empty-state">Todavía no hay ningún registro de macros.</div>` : `
      <div class="grouped-list">
        ${plans.map((p) => `
          <div class="grouped-row">
            <div style="min-width:0;">
              <div class="type-body">${formatDate(p.fecha)}</div>
              <div class="type-caption text-faint">
                ON ×${p.diasOn ?? '—'} · P${p.proteinaOn ?? '—'}/C${p.hidratosOn ?? '—'}/G${p.grasasOn ?? '—'}
                · OFF ×${p.diasOff ?? '—'} · P${p.proteinaOff ?? '—'}/C${p.hidratosOff ?? '—'}/G${p.grasasOff ?? '—'}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}
