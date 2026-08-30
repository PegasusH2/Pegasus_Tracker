// Nutrición · Histórico — versiones pasadas de dieta y macros. Siempre de
// solo lectura (es un archivo): cada edición ya es una fila nueva por
// diseño (nunca se sobreescribe una versión anterior, ver
// repository.js#createDietPlan/addMacroTarget), así que el pasado completo
// está aquí sin necesitar una tabla aparte de versiones.
import * as repo from '../db/repository.js';
import { escapeHtml } from '../core/escape.js';
import { formatDate } from '../core/format.js';
import { DAY_TYPE_LABELS } from '../core/nutrition.js';

export async function renderNutritionHistory(mount) {
  const [plans, macros] = await Promise.all([repo.listDietPlans(), repo.listMacroTargets()]);

  const entries = [
    ...plans.map((p) => ({ date: p.effectiveDate, dayType: p.dayType ?? 'training', kind: 'Dieta', title: p.name, sub: p.description || '' })),
    ...macros.map((m) => ({
      date: m.effectiveDate, dayType: m.dayType ?? 'training', kind: 'Macros', title: `${m.calories ?? '—'} kcal`,
      sub: [m.proteinG != null ? `P ${m.proteinG}g` : null, m.carbsG != null ? `C ${m.carbsG}g` : null, m.fatG != null ? `G ${m.fatG}g` : null].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:16px;">Histórico</h1>
    ${!entries.length ? `<div class="empty-state">Todavía no hay ningún registro de nutrición.</div>` : `
      <div class="grouped-list">
        ${entries.map((e) => `
          <div class="grouped-row">
            <div style="min-width:0;">
              <div class="type-body">${escapeHtml(e.title)}</div>
              <div class="type-caption text-faint">${e.kind} · ${formatDate(e.date)} · ${DAY_TYPE_LABELS[e.dayType]}${e.sub ? ` · ${escapeHtml(e.sub)}` : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}
