// Nutrición · Macros — datos REALES de Pegasus Nutrition (tabla
// nutrition_macro_plan en Supabase, ver js/core/pegasus-nutrition.js), no un
// duplicado local. Modelo real: un ciclo semanal de días ON/OFF con su
// propio juego de macros cada uno (no "entrenamiento/descanso" por día de la
// semana). Requiere sesión iniciada — sin cuenta no hay forma de saber de
// quién son los datos.
import * as pegasus from '../core/pegasus-nutrition.js';
import * as settings from '../core/settings.js';
import { getUser } from '../core/auth.js';
import { formatDate, todayISO } from '../core/format.js';
import { openSheet, openConfirmSheet } from '../core/ui.js';
import { toast } from '../core/store.js';
import { escapeHtml } from '../core/escape.js';
import { navigate, refreshRoute } from '../app.js';

function kcal(proteinG, carbsG, fatG) {
  if (proteinG == null && carbsG == null && fatG == null) return null;
  return Math.round((proteinG || 0) * 4 + (carbsG || 0) * 4 + (fatG || 0) * 9);
}

function macroBlockHtml(label, days, proteinG, carbsG, fatG) {
  const calories = kcal(proteinG, carbsG, fatG);
  return `
    <div class="type-caption text-dim" style="margin-bottom:4px;">${label}${days != null ? ` · ×${days}/semana` : ''}</div>
    <div class="stat-hero" style="margin-bottom:0;">
      <div class="stat-hero-value">
        <span class="type-hero">${calories ?? '—'}</span>
        ${calories != null ? `<span class="type-headline text-dim">kcal</span>` : ''}
      </div>
    </div>
    <div class="card stat-grid" style="margin-bottom:var(--space-4);">
      <div class="stat-tile">
        <div class="stat-label">Proteína</div>
        <div class="stat-value">${proteinG ?? '—'}</div>
        <div class="stat-sub">${proteinG != null ? 'g' : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Carbohidratos</div>
        <div class="stat-value">${carbsG ?? '—'}</div>
        <div class="stat-sub">${carbsG != null ? 'g' : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Grasa</div>
        <div class="stat-value">${fatG ?? '—'}</div>
        <div class="stat-sub">${fatG != null ? 'g' : ''}</div>
      </div>
    </div>
  `;
}

export async function renderNutritionMacros(mount) {
  await paint(mount);
}

async function paint(mount) {
  const user = await getUser();
  if (!user) {
    mount.innerHTML = `
      <h1 class="type-title" style="margin-bottom:16px;">Macros</h1>
      <div class="empty-state">Inicia sesión con tu cuenta de Pegasus para ver tus macros de Pegasus Nutrition.</div>
      <button class="btn btn-primary btn-block" id="m-login" style="margin-top:var(--space-4);">Ir a Ajustes › Cuenta</button>
    `;
    mount.querySelector('#m-login').addEventListener('click', () => navigate('/ajustes/cuenta'));
    return;
  }

  const tipoInfo = await pegasus.pegasusGetTipoDieta();
  settings.setNutricionTipoCache({
    tipoDieta: tipoInfo?.tipoDieta ?? 'macros',
    dietaCerradaDistingueDias: tipoInfo?.dietaCerradaDistingueDias ?? false,
  });
  // La caché síncrona que decidió mostrar esta vista (ver js/app.js) estaba
  // desactualizada: el tipo real ya no es Macros — corrige sin esperar a la
  // siguiente navegación manual.
  if (tipoInfo?.tipoDieta === 'cerrada') {
    refreshRoute();
    return;
  }

  const plan = await pegasus.pegasusGetLatestMacroPlan();

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:16px;">Macros</h1>
    ${!plan ? `
      <div class="empty-state">Tu entrenador todavía no ha configurado tus macros en Pegasus Nutrition.</div>
      <button class="btn btn-primary btn-block" id="m-create" style="margin-top:var(--space-4);">Crear el primero</button>
    ` : `
      <div class="type-caption text-faint" style="margin-bottom:16px;">Actualizado ${formatDate(plan.fecha)}</div>
      ${macroBlockHtml('Días ON', plan.diasOn, plan.proteinaOn, plan.hidratosOn, plan.grasasOn)}
      ${macroBlockHtml('Días OFF', plan.diasOff, plan.proteinaOff, plan.hidratosOff, plan.grasasOff)}
      ${(plan.normocalorico != null || plan.aguaLitros != null || plan.salGramos != null || plan.neatObjetivoPasos != null) ? `
        <div class="type-caption text-faint" style="margin-bottom:var(--space-4);">
          ${[
            plan.normocalorico != null ? `Mantenimiento ${plan.normocalorico} kcal` : null,
            plan.aguaLitros != null ? `Agua ${plan.aguaLitros} L` : null,
            plan.salGramos != null ? `Sal ${plan.salGramos} g` : null,
            plan.neatObjetivoPasos != null ? `${plan.neatObjetivoPasos} pasos` : null,
          ].filter(Boolean).join(' · ')}
        </div>
      ` : ''}
      ${plan.notas ? `<p class="type-body text-dim" style="margin-bottom:var(--space-4);">${escapeHtml(plan.notas)}</p>` : ''}
      <button class="btn btn-secondary btn-block" id="m-edit">Editar este registro</button>
      <button class="btn btn-primary btn-block" id="m-new" style="margin-top:8px;">Nuevo registro</button>
      <button class="btn btn-ghost-danger btn-block" id="m-delete" style="margin-top:8px;">Eliminar</button>
    `}
  `;

  mount.querySelector('#m-create')?.addEventListener('click', () => openMacroForm(mount));
  mount.querySelector('#m-edit')?.addEventListener('click', () => openMacroForm(mount, plan));
  mount.querySelector('#m-new')?.addEventListener('click', () => openMacroForm(mount));
  mount.querySelector('#m-delete')?.addEventListener('click', async () => {
    const ok = await openConfirmSheet('¿Eliminar este registro de macros?', { confirmLabel: 'Eliminar' });
    if (!ok) return;
    try {
      await pegasus.pegasusDeleteMacroPlan(plan.id);
      await paint(mount);
    } catch (err) {
      toast(err.message || 'No se ha podido eliminar');
    }
  });
}

function numOrNull(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function openMacroForm(mount, existing = null) {
  const v = existing || {};
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">${existing ? 'Actualizar registro' : 'Nuevo registro de macros'}</h3>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="f-fecha" value="${v.fecha || todayISO()}" />
    </div>

    <div class="section-label">Días ON</div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;"><label class="label">Días/semana</label><input type="number" inputmode="numeric" id="f-diasOn" value="${v.diasOn ?? ''}" /></div>
      <div class="field" style="flex:1;"><label class="label">Proteína (g)</label><input type="number" inputmode="decimal" id="f-proteinaOn" value="${v.proteinaOn ?? ''}" /></div>
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;"><label class="label">Carbohidratos (g)</label><input type="number" inputmode="decimal" id="f-hidratosOn" value="${v.hidratosOn ?? ''}" /></div>
      <div class="field" style="flex:1;"><label class="label">Grasa (g)</label><input type="number" inputmode="decimal" id="f-grasasOn" value="${v.grasasOn ?? ''}" /></div>
    </div>

    <div class="section-label">Días OFF</div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;"><label class="label">Días/semana</label><input type="number" inputmode="numeric" id="f-diasOff" value="${v.diasOff ?? ''}" /></div>
      <div class="field" style="flex:1;"><label class="label">Proteína (g)</label><input type="number" inputmode="decimal" id="f-proteinaOff" value="${v.proteinaOff ?? ''}" /></div>
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;"><label class="label">Carbohidratos (g)</label><input type="number" inputmode="decimal" id="f-hidratosOff" value="${v.hidratosOff ?? ''}" /></div>
      <div class="field" style="flex:1;"><label class="label">Grasa (g)</label><input type="number" inputmode="decimal" id="f-grasasOff" value="${v.grasasOff ?? ''}" /></div>
    </div>

    <div class="section-label">Otros (opcional)</div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;"><label class="label">Mantenimiento (kcal)</label><input type="number" inputmode="numeric" id="f-normocalorico" value="${v.normocalorico ?? ''}" /></div>
      <div class="field" style="flex:1;"><label class="label">Pasos NEAT</label><input type="number" inputmode="numeric" id="f-pasos" value="${v.neatObjetivoPasos ?? ''}" /></div>
    </div>
    <div class="row" style="gap:8px;">
      <div class="field" style="flex:1;"><label class="label">Agua (L)</label><input type="number" inputmode="decimal" id="f-agua" value="${v.aguaLitros ?? ''}" /></div>
      <div class="field" style="flex:1;"><label class="label">Sal (g)</label><input type="number" inputmode="decimal" id="f-sal" value="${v.salGramos ?? ''}" /></div>
    </div>
    <div class="field">
      <label class="label">Notas</label>
      <input type="text" id="f-notas" value="${escapeHtml(v.notas || '')}" />
    </div>

    <button class="btn btn-primary btn-block" id="f-save">Guardar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async (e) => {
        const fecha = sheet.querySelector('#f-fecha').value;
        if (!fecha) { toast('La fecha es obligatoria'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        const fields = {
          fecha,
          diasOn: numOrNull(sheet.querySelector('#f-diasOn').value),
          proteinaOn: numOrNull(sheet.querySelector('#f-proteinaOn').value),
          hidratosOn: numOrNull(sheet.querySelector('#f-hidratosOn').value),
          grasasOn: numOrNull(sheet.querySelector('#f-grasasOn').value),
          diasOff: numOrNull(sheet.querySelector('#f-diasOff').value),
          proteinaOff: numOrNull(sheet.querySelector('#f-proteinaOff').value),
          hidratosOff: numOrNull(sheet.querySelector('#f-hidratosOff').value),
          grasasOff: numOrNull(sheet.querySelector('#f-grasasOff').value),
          normocalorico: numOrNull(sheet.querySelector('#f-normocalorico').value),
          neatObjetivoPasos: numOrNull(sheet.querySelector('#f-pasos').value),
          aguaLitros: numOrNull(sheet.querySelector('#f-agua').value),
          salGramos: numOrNull(sheet.querySelector('#f-sal').value),
          notas: sheet.querySelector('#f-notas').value.trim() || null,
        };
        try {
          if (existing) await pegasus.pegasusUpdateMacroPlan(existing.id, fields);
          else await pegasus.pegasusCreateMacroPlan(fields);
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
