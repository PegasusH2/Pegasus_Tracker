// Ajustes > Cuenta y sincronización. Pegasus sigue funcionando exactamente
// igual sin cuenta (modo local) — esta pantalla es la ÚNICA parte de la app
// que sabe que existe sincronización; nada de esto invade la pantalla de
// entrenamiento ni ninguna otra vista. Ver docs/supabase-sync-design.md.
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import * as repo from '../db/repository.js';
import * as settings from '../core/settings.js';
import { openSheet, openConfirmSheet } from '../core/ui.js';
import { escapeHtml } from '../core/escape.js';
import { toast, on } from '../core/store.js';

let currentMount = null;
let subscribed = false;

export async function renderSettingsAccount(mount) {
  currentMount = mount;
  if (!subscribed) {
    subscribed = true;
    // Un solo listener para toda la sesión de la app (mismo patrón que
    // 'prefs:changed' en settings-hub.js) — se repinta cada vez que
    // sync.js emite un cambio de estado, mientras esta pantalla sea la
    // que esté montada.
    on('sync:status', () => { if (currentMount) render(currentMount); });
  }
  await render(mount);
}

async function render(mount) {
  if (!auth.isSupabaseConfigured()) {
    mount.innerHTML = `
      <h1 class="type-title" style="margin-bottom:var(--space-5);">Cuenta y sincronización</h1>
      <div class="card">
        <div class="type-headline" style="margin-bottom:6px;">Todavía no disponible</div>
        <p class="type-body text-dim">
          La sincronización en la nube no está configurada en esta instalación de Pegasus Tracker.
          Tus datos siguen guardándose con normalidad en este dispositivo.
        </p>
      </div>
    `;
    return;
  }

  const session = await auth.getSession();
  if (!session) {
    renderSignedOut(mount);
  } else {
    await renderSignedIn(mount, session);
  }
}

function authErrorMessage(err) {
  const msg = String(err?.message || err || '');
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos';
  if (/already registered|already exists/i.test(msg)) return 'Ya existe una cuenta con ese email';
  if (/password/i.test(msg) && /(least|short|6)/i.test(msg)) return 'La contraseña es demasiado corta (mínimo 6 caracteres)';
  if (msg === 'SYNC_NOT_CONFIGURED') return 'La sincronización no está configurada';
  return 'No se pudo completar la operación';
}

function renderSignedOut(mount) {
  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:var(--space-5);">Cuenta y sincronización</h1>
    <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
      Pegasus funciona igual sin cuenta — tus datos siguen guardándose en este dispositivo.
      Crea una cuenta solo si quieres tenerlos sincronizados entre varios dispositivos.
    </p>

    <div class="section-label">Iniciar sesión</div>
    <div class="card" style="margin-bottom:var(--space-4); margin-top:var(--space-2);">
      <div class="field">
        <label class="label">Email</label>
        <input type="email" id="signin-email" autocomplete="email" />
      </div>
      <div class="field">
        <label class="label">Contraseña</label>
        <input type="password" id="signin-password" autocomplete="current-password" />
      </div>
      <button class="btn btn-primary btn-block" id="signin-btn">Iniciar sesión</button>
    </div>

    <div class="section-label">Crear cuenta</div>
    <div class="card" style="margin-top:var(--space-2);">
      <div class="field">
        <label class="label">Email</label>
        <input type="email" id="signup-email" autocomplete="email" />
      </div>
      <div class="field">
        <label class="label">Contraseña</label>
        <input type="password" id="signup-password" autocomplete="new-password" />
      </div>
      <button class="btn btn-secondary btn-block" id="signup-btn">Crear cuenta</button>
    </div>
  `;

  wireAuthButton(mount, {
    btn: '#signin-btn', email: '#signin-email', password: '#signin-password',
    loadingLabel: 'Iniciando sesión…',
    action: (email, password) => auth.signIn(email, password),
  });
  wireAuthButton(mount, {
    btn: '#signup-btn', email: '#signup-email', password: '#signup-password',
    loadingLabel: 'Creando cuenta…',
    action: (email, password) => auth.signUp(email, password),
  });
}

function wireAuthButton(mount, { btn, email, password, action, loadingLabel }) {
  const btnEl = mount.querySelector(btn);
  const originalLabel = btnEl.textContent;
  btnEl.addEventListener('click', async () => {
    const emailValue = mount.querySelector(email).value.trim();
    const passwordValue = mount.querySelector(password).value;
    if (!emailValue || !passwordValue) { toast('Escribe email y contraseña'); return; }
    btnEl.disabled = true;
    btnEl.textContent = loadingLabel;
    try {
      await action(emailValue, passwordValue);
      toast('Sesión iniciada');
      await afterSignedIn(mount);
    } catch (err) {
      toast(authErrorMessage(err));
      btnEl.disabled = false;
      btnEl.textContent = originalLabel;
    }
  });
}

// Se ofrece UNA vez, justo tras el primer inicio de sesión en un dispositivo
// con datos locales — nunca se borra IndexedDB, nunca se sube nada sin que
// el usuario lo confirme explícitamente (ver punto 20 del diseño). Si el
// usuario declina, sigue pudiendo subirlo más tarde a mano desde la tarjeta
// "Datos locales" de la pantalla ya con sesión iniciada.
async function afterSignedIn(mount) {
  if (!settings.isLocalDataMigrated()) {
    const count = await repo.countLocalRows();
    if (count > 0) {
      const ok = await openConfirmSheet(
        `Este dispositivo tiene ${count} registros guardados (entrenamientos, rutinas, peso...). ¿Quieres subirlos a tu cuenta para tenerlos disponibles en tus otros dispositivos?`,
        { confirmLabel: 'Subir datos', cancelLabel: 'Ahora no', danger: false },
      );
      if (ok) {
        toast('Subiendo datos…');
        await sync.migrateLocalDataToAccount();
        toast('Datos subidos');
      }
    }
    await settings.setLocalDataMigrated(true);
  }
  await render(mount);
}

function statusLabel(st) {
  if (st.state === 'syncing') return '↻ Sincronizando…';
  if (st.state === 'error') return '⚠ Error de sincronización';
  if (st.pendingCount > 0) return `○ Pendiente (${st.pendingCount})`;
  return '✓ Sincronizado';
}

function statusDetail(st) {
  if (st.state === 'error') return st.lastError || 'No se pudo completar la última sincronización.';
  if (st.lastSyncedAt) {
    const d = new Date(st.lastSyncedAt);
    return `Última sincronización: ${d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}`;
  }
  return 'Todavía no se ha sincronizado.';
}

async function renderSignedIn(mount, session) {
  const st = sync.getSyncStatus();
  const localCount = await repo.countLocalRows();

  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:var(--space-5);">Cuenta y sincronización</h1>

    <div class="section-label">Cuenta</div>
    <div class="card" style="margin-bottom:var(--space-4); margin-top:var(--space-2);">
      <div class="type-headline" style="margin-bottom:6px;">${escapeHtml(session.user.email || '')}</div>
      <button class="btn btn-ghost btn-block" id="signout-btn">Cerrar sesión</button>
    </div>

    <div class="section-label">Sincronización</div>
    <div class="card" style="margin-bottom:var(--space-4); margin-top:var(--space-2);">
      <div class="type-body" style="margin-bottom:6px; font-weight:600;">${statusLabel(st)}</div>
      <p class="type-caption text-faint" style="margin-bottom:var(--space-4);">${escapeHtml(statusDetail(st))}</p>
      ${!navigator.onLine ? '<p class="type-caption text-faint" style="margin-bottom:var(--space-4);">Sin conexión. Los cambios se sincronizarán cuando vuelva Internet.</p>' : ''}
      <button class="btn btn-primary btn-block" id="sync-now-btn" ${st.state === 'syncing' ? 'disabled' : ''}>${st.state === 'syncing' ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
    </div>

    ${localCount > 0 ? `
      <div class="section-label">Datos locales</div>
      <div class="card" style="margin-top:var(--space-2);">
        <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
          Este dispositivo tiene ${localCount} registros. Si alguno todavía no está en tu cuenta, puedes forzar la subida.
        </p>
        <button class="btn btn-secondary btn-block" id="upload-local-btn">Subir datos locales</button>
      </div>
    ` : ''}
  `;

  mount.querySelector('#signout-btn').addEventListener('click', () => openSignOutSheet(mount));
  mount.querySelector('#sync-now-btn').addEventListener('click', async () => {
    await sync.syncNow({ manual: true });
    toast('Sincronización completada');
  });
  mount.querySelector('#upload-local-btn')?.addEventListener('click', async () => {
    toast('Subiendo datos…');
    await sync.migrateLocalDataToAccount();
    toast('Datos subidos');
    await render(mount);
  });
}

// Cerrar sesión NUNCA borra datos locales por defecto (ver punto 25 del
// diseño) — borrarlos es una acción aparte, explícita, y con la misma
// confirmación de doble paso que "Borrar todos los datos" en Ajustes > Datos.
function openSignOutSheet(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:6px;">Cerrar sesión</h3>
    <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
      Tus datos seguirán guardados en este dispositivo. Si quieres, también puedes borrarlos al cerrar sesión.
    </p>
    <label class="row" style="margin-bottom:var(--space-4); cursor:pointer;">
      <span class="type-body">Borrar también los datos locales de este dispositivo</span>
      <input type="checkbox" id="signout-delete-local" style="width:24px; height:24px; accent-color:var(--danger);" />
    </label>
    <button class="btn btn-ghost btn-block" id="signout-confirm">Cerrar sesión</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#signout-confirm').addEventListener('click', async () => {
        const deleteLocal = sheet.querySelector('#signout-delete-local').checked;
        close();
        await auth.signOut();
        repo.setSyncActive(false);
        if (deleteLocal) {
          const ok = await openConfirmSheet('Última confirmación: se borrarán TODOS tus datos de este dispositivo. ¿Continuar?', { confirmLabel: 'Borrar todo' });
          if (ok) await repo.clearAllData();
        }
        toast('Sesión cerrada');
        await render(mount);
      });
    },
  });
}
