// Nutrición · Macros — datos REALES de Pegasus Coach (tabla
// nutrition_macro_plan en Supabase, ver js/core/pegasus-nutrition.js), no un
// duplicado local. Modelo real: un ciclo semanal de días ON/OFF con su
// propio juego de macros cada uno (no "entrenamiento/descanso" por día de la
// semana). Requiere sesión iniciada — sin cuenta no hay forma de saber de
// quién son los datos.
import * as pegasus from '../core/pegasus-nutrition.js';
import * as settings from '../core/settings.js';
import { getUser } from '../core/auth.js';
import { formatDate, todayISO } from '../core/format.js';
import { openSheet, openConfirmSheet, replayEnterAnimation } from '../core/ui.js';
import { toast } from '../core/store.js';
import { escapeHtml } from '../core/escape.js';
import { navigate, refreshRoute } from '../app.js';

const FLAME_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-3 4-3 8a3 3 0 1 0 6 0c0-1.2-.6-2-1-2.8.9.3 2 1.6 2 4a5 5 0 1 1-10 0C6 8 9 7 12 3Z"/></svg>`;

export function kcal(proteinG, carbsG, fatG) {
  if (proteinG == null && carbsG == null && fatG == null) return null;
  return Math.round((proteinG || 0) * 4 + (carbsG || 0) * 4 + (fatG || 0) * 9);
}

function ringHtml(label, value) {
  return `
    <div class="macro-ring-item">
      <div class="macro-ring"><span class="macro-ring-value">${value ?? '—'}${value != null ? '<small>g</small>' : ''}</span></div>
      <div class="macro-ring-label">${label}</div>
    </div>
  `;
}

// "Nutrición días de entreno/descanso" — objetivo diario (nunca consumo real,
// ver cabecera del archivo) más los 3 macros como aros. days (×N/semana) se
// añade junto a "Objetivo diario" en vez de en el título, para no recargar
// la cabecera de la card.
export function macroBlockHtml(label, days, proteinG, carbsG, fatG) {
  const calories = kcal(proteinG, carbsG, fatG);
  return `
    <div class="card nutrition-hero">
      <div class="nutrition-hero-top">
        <div class="nutrition-hero-label">${FLAME_ICON} ${label}</div>
      </div>
      <div class="nutrition-hero-kcal">${calories ?? '—'} <span class="type-headline text-dim">kcal</span></div>
      <div class="type-caption text-faint">Objetivo diario${days != null ? ` · ×${days}/semana` : ''}</div>
    </div>
    <div class="macro-ring-row">
      ${ringHtml('Proteínas', proteinG)}
      ${ringHtml('Carbohidratos', carbsG)}
      ${ringHtml('Grasas', fatG)}
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
      <div class="empty-state">Inicia sesión con tu cuenta de Pegasus para ver tus macros de Pegasus Coach.</div>
      <button class="btn btn-primary btn-block" id="m-login" style="margin-top:var(--space-4);">Ir a Ajustes › Cuenta</button>
    `;
    replayEnterAnimation(mount);
    mount.querySelector('#m-login').addEventListener('click', () => navigate('/ajustes/cuenta'));
    return;
  }

  // Un cliente con entrenador vinculado (accepted) no gestiona su propia
  // nutrición — la RLS real de Pegasus Coach ya lo impide en el
  // servidor (ver macroplan_write), pero además de eso la interfaz no debe
  // ni ofrecer los controles: es el mismo criterio que ya aplica el
  // selector de Tipo de nutrición en Ajustes (ver settings-hub.js).
  const [tipoInfo, trainerLink] = await Promise.all([
    pegasus.pegasusGetTipoDieta(),
    pegasus.pegasusGetTrainerLink(),
  ]);
  const soloLectura = !!trainerLink;
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
    <h1 class="type-title" style="margin-bottom:${soloLectura ? '4px' : '16px'};">Macros</h1>
    ${soloLectura ? '<p class="type-caption text-faint" style="margin-bottom:16px;">🔒 Gestionado por tu entrenador</p>' : ''}
    ${!plan ? `
      <div class="empty-state">${soloLectura ? 'Tu entrenador todavía no te ha asignado un plan de macros.' : 'Tu entrenador todavía no ha configurado tus macros en Pegasus Coach.'}</div>
      ${soloLectura ? '' : '<button class="btn btn-primary btn-block" id="m-create" style="margin-top:var(--space-4);">Crear el primero</button>'}
    ` : `
      <div class="type-caption text-faint" style="margin-bottom:16px;">Actualizado ${formatDate(plan.fecha)}</div>
      ${macroBlockHtml('Nutrición días de entreno', plan.diasOn, plan.proteinaOn, plan.hidratosOn, plan.grasasOn)}
      ${macroBlockHtml('Nutrición días de descanso', plan.diasOff, plan.proteinaOff, plan.hidratosOff, plan.grasasOff)}
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
      ${plan.notas ? `
        <div class="card coach-note" style="margin-bottom:var(--space-4);">
          <div class="type-micro text-good" style="margin-bottom:4px;">Nota de tu entrenador</div>
          <p class="type-body">${escapeHtml(plan.notas)}</p>
        </div>
      ` : ''}
      ${soloLectura ? '' : `
        <button class="btn btn-secondary btn-block" id="m-edit">Editar este registro</button>
        <button class="btn btn-primary btn-block" id="m-new" style="margin-top:8px;">Nuevo registro</button>
        <button class="btn btn-ghost-danger btn-block" id="m-delete" style="margin-top:8px;">Eliminar</button>
      `}
    `}
  `;
  replayEnterAnimation(mount);

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
