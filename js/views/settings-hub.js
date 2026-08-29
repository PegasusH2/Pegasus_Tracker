import * as settings from '../core/settings.js';
import * as repo from '../db/repository.js';
import { openSheet, openConfirmSheet } from '../core/ui.js';
import { escapeHtml } from '../core/escape.js';
import { toast, on } from '../core/store.js';
import { navigate } from '../app.js';
import { adminLogin } from '../core/ai-import.js';
import { isSupabaseConfigured } from '../core/auth.js';
import { getSyncStatus } from '../core/sync.js';
import { THEMES } from '../core/theme.js';

let currentMount = null;
on('prefs:changed', ({ key }) => {
  if (key === 'devModeUnlocked' && currentMount) render(currentMount);
});
on('sync:status', () => { if (currentMount) render(currentMount); });

function syncSubtitle() {
  const st = getSyncStatus();
  if (st.state === 'syncing') return 'Sincronizando…';
  if (st.state === 'error') return 'Error de sincronización';
  if (st.pendingCount > 0) return `Pendiente (${st.pendingCount})`;
  if (st.lastSyncedAt) return 'Sincronizado';
  return 'Sin cuenta';
}

const SECTION_LABELS = {
  general: 'Progreso general',
  peso: 'Peso corporal',
  medidas: 'Medidas',
  plicometro: 'Plicómetro',
};

export async function renderSettingsHub(mount) {
  render(mount);
}

function render(mount) {
  currentMount = mount;
  const name = settings.getUserName();
  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:var(--space-5);">Ajustes</h1>

    <div class="grouped-list" style="margin-bottom:var(--space-5);">
      <div class="grouped-row" id="row-perfil" style="cursor:pointer;">
        <div>
          <div class="type-body" style="font-weight:600;">Perfil</div>
          <div class="type-caption text-faint">${name ? escapeHtml(name) : 'Sin nombre'}</div>
        </div>
        <span class="text-faint">›</span>
      </div>
      <div class="grouped-row" id="row-pesos" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Pesos</span>
        <span class="text-faint">›</span>
      </div>
      <div class="grouped-row" id="row-personalizar" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Personalizar</span>
        <span class="text-faint">›</span>
      </div>
      <div class="grouped-row" id="row-tema" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Tema</span>
        <span class="text-faint">${THEMES.find((t) => t.key === settings.getTheme())?.label ?? ''} ›</span>
      </div>
      <div class="grouped-row" id="row-datos" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Datos</span>
        <span class="text-faint">›</span>
      </div>
      ${isSupabaseConfigured() ? `
        <div class="grouped-row" id="row-cuenta" style="cursor:pointer;">
          <span class="type-body" style="font-weight:600;">Cuenta y sincronización</span>
          <span class="text-faint">${syncSubtitle()} ›</span>
        </div>
      ` : ''}
      ${settings.isDevModeUnlocked() ? `
        <div class="grouped-row" id="row-dev" style="cursor:pointer;">
          <span class="type-body" style="font-weight:600;">Modo desarrollador</span>
          <span class="text-faint">${settings.isAdminSessionActive() ? 'Activo ›' : '›'}</span>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <div class="type-headline" style="margin-bottom:4px;">Aplicación</div>
      <div class="type-caption text-faint">Pegasus Tracker · tus datos viven en este dispositivo. La sincronización con la nube es opcional y solo se activa si creas una cuenta.</div>
    </div>
  `;

  mount.querySelector('#row-perfil').addEventListener('click', () => openPerfilSheet(mount));
  mount.querySelector('#row-pesos').addEventListener('click', () => openPesosSheet());
  mount.querySelector('#row-personalizar').addEventListener('click', () => openPersonalizarSheet());
  mount.querySelector('#row-tema').addEventListener('click', () => openTemaSheet(mount));
  mount.querySelector('#row-datos').addEventListener('click', () => navigate('/ajustes/datos'));
  mount.querySelector('#row-cuenta')?.addEventListener('click', () => navigate('/ajustes/cuenta'));
  mount.querySelector('#row-dev')?.addEventListener('click', () => openDevModeSheet(mount));
}

// Modo desarrollador — inicia sesión con la contraseña de administrador
// configurada como secreto del Worker (nunca se guarda aquí, ni en
// localStorage/IndexedDB: solo persiste la sesión temporal que devuelve el
// Worker, ver js/core/settings.js#adminSession). Sirve para probar la
// importación por IA sin el límite de peticiones de un usuario normal.
function openDevModeSheet(mount) {
  openSheet('<div id="dev-content"></div>', {
    onMount: (sheet, close) => paintDevModeSheet(sheet.querySelector('#dev-content'), close, mount),
  });
}

function paintDevModeSheet(box, close, mount) {
  const active = settings.isAdminSessionActive();
  const session = settings.getAdminSession();

  if (active) {
    const expires = new Date(session.expiresAt);
    box.innerHTML = `
      <h3 class="type-headline" style="margin-bottom:6px;">Modo desarrollador</h3>
      <p class="type-body" style="margin-bottom:2px;">
        <span style="color:var(--accent); font-weight:700;">● Administrador activo</span>
      </p>
      <p class="type-caption text-faint" style="margin-bottom:20px;">
        Sesión válida hasta ${expires.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}.
        Mientras esté activa, la importación por foto no está sujeta al límite de peticiones normal.
      </p>
      <button class="btn btn-danger btn-block" id="dev-logout">Cerrar sesión</button>
    `;
    box.querySelector('#dev-logout').addEventListener('click', async () => {
      await settings.clearAdminSession();
      toast('Sesión de administrador cerrada');
      close();
      render(mount);
    });
    return;
  }

  box.innerHTML = `
    <h3 class="type-headline" style="margin-bottom:6px;">Modo desarrollador</h3>
    <p class="type-caption text-faint" style="margin-bottom:16px;">
      Inicia sesión con tu contraseña de administrador para probar la
      importación por IA sin el límite de peticiones normal. La contraseña
      nunca se guarda en este dispositivo.
    </p>
    <div class="field">
      <label class="label">Contraseña de administrador</label>
      <input type="password" id="dev-password" autocomplete="off" autofocus />
    </div>
    <button class="btn btn-primary btn-block" id="dev-login">Iniciar sesión</button>
  `;

  const loginBtn = box.querySelector('#dev-login');
  const passwordInput = box.querySelector('#dev-password');

  async function attemptLogin() {
    const password = passwordInput.value;
    if (!password) { toast('Escribe la contraseña'); return; }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Comprobando…';
    try {
      const session = await adminLogin(password);
      await settings.setAdminSession(session);
      toast('Administrador activo');
      paintDevModeSheet(box, close, mount);
      render(mount);
    } catch (err) {
      const messages = {
        INVALID_PASSWORD: 'Contraseña incorrecta',
        RATE_LIMITED: 'Demasiados intentos, espera un poco',
        NETWORK_ERROR: 'No se pudo conectar con el servidor',
        WORKER_NOT_CONFIGURED: 'El Worker de IA no está configurado',
      };
      toast(messages[err.message] || 'No se pudo iniciar sesión');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Iniciar sesión';
    }
  }

  loginBtn.addEventListener('click', attemptLogin);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });
}

function openPerfilSheet(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Perfil</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="p-name" value="${escapeHtml(settings.getUserName())}" autofocus />
    </div>
    <button class="btn btn-primary btn-block" id="p-save">Guardar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#p-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#p-name').value.trim();
        await settings.setUserName(name);
        close();
        render(mount);
      });
    },
  });
}

function openPesosSheet() {
  const enabled = settings.getWeightUnitsEnabled();
  const progressUnit = settings.getWeightProgressUnit();
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Pesos</h3>
    <label class="checkbox-row"><span class="type-body">Kilogramos (kg)</span><input type="checkbox" id="u-kg" ${enabled.kg ? 'checked' : ''} /></label>
    <label class="checkbox-row"><span class="type-body">Libras (lb)</span><input type="checkbox" id="u-lb" ${enabled.lb ? 'checked' : ''} /></label>
    <div class="field" id="progress-unit-field" style="margin-top:var(--space-4); ${enabled.kg && enabled.lb ? '' : 'display:none;'}">
      <label class="label">Unidad principal para el progreso</label>
      <div class="segmented" id="progress-unit-toggle">
        <button type="button" class="seg ${progressUnit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
        <button type="button" class="seg ${progressUnit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
      </div>
    </div>

    <div class="grouped-list" style="margin-top:var(--space-5);">
      <div class="grouped-row" id="row-barras" style="cursor:pointer;">
        <span class="type-body" style="font-weight:600;">Barras</span>
        <span class="text-faint">›</span>
      </div>
    </div>
  `, {
    onMount: (sheet) => {
      const kgBox = sheet.querySelector('#u-kg');
      const lbBox = sheet.querySelector('#u-lb');
      const progressField = sheet.querySelector('#progress-unit-field');
      const progressToggle = sheet.querySelector('#progress-unit-toggle');

      sheet.querySelector('#row-barras').addEventListener('click', () => openBarsSheet());

      async function commit(revertBox) {
        if (!kgBox.checked && !lbBox.checked) {
          revertBox.checked = true;
          toast('Debes tener al menos una unidad activa');
          return;
        }
        await settings.setWeightUnitsEnabled({ kg: kgBox.checked, lb: lbBox.checked });
        const showToggle = kgBox.checked && lbBox.checked;
        progressField.style.display = showToggle ? '' : 'none';
        const clamped = settings.getWeightProgressUnit();
        progressToggle.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.unit === clamped));
      }

      kgBox.addEventListener('change', () => commit(kgBox));
      lbBox.addEventListener('change', () => commit(lbBox));

      progressToggle.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-unit]');
        if (!btn) return;
        await settings.setWeightProgressUnit(btn.dataset.unit);
        progressToggle.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
      });
    },
  });
}

// Barras configurables — se usan como referencia rápida al elegir barra en
// ejercicios marcados como "Barra libre" (sentadilla, peso muerto, press
// banca...). El peso de barra guardado en cada serie es una copia numérica
// (igual que kg+lb en sets.weightKgPart/weightLbPart), así que editar o
// borrar una barra aquí nunca reescribe series ya registradas.
function openBarsSheet() {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:6px;">Barras</h3>
    <p class="type-caption text-dim" style="margin-bottom:14px;">Se usan en ejercicios marcados como "Barra libre" para calcular el peso total junto a los discos por lado.</p>
    <div id="bars-list" class="grouped-list" style="margin-bottom:var(--space-4);"></div>
    <div class="field">
      <label class="label">Nueva barra</label>
      <div class="row" style="gap:8px;">
        <input type="text" id="new-bar-name" placeholder="Nombre" style="flex:2;" />
        <input type="number" inputmode="decimal" id="new-bar-weight" placeholder="kg" style="flex:1;" />
      </div>
    </div>
    <button class="btn btn-secondary btn-block" id="add-bar-btn">+ Añadir barra</button>
  `, {
    onMount: async (sheet) => {
      async function refresh() {
        const bars = await repo.listBars();
        sheet.querySelector('#bars-list').innerHTML = bars.length ? bars.map((b) => `
          <div class="grouped-row" data-id="${b.id}">
            <input type="text" class="bar-name-input" value="${escapeHtml(b.name)}" style="flex:1; min-width:0; border:none; background:transparent; font-weight:600; padding:0; font-size:15px;" />
            <input type="number" inputmode="decimal" class="bar-weight-input" value="${b.weightKg}" style="width:56px; text-align:right; border:none; background:transparent; font-size:15px;" />
            <span class="type-caption text-faint" style="margin-left:4px;">kg</span>
            <button type="button" class="icon-btn bar-delete" aria-label="Eliminar" style="margin-left:6px;">✕</button>
          </div>
        `).join('') : '<div class="empty-state">No hay barras todavía.</div>';

        sheet.querySelectorAll('#bars-list [data-id]').forEach((row) => {
          const id = row.dataset.id;
          row.querySelector('.bar-name-input').addEventListener('blur', async (e) => {
            const name = e.target.value.trim();
            if (name) await repo.updateBar(id, { name });
          });
          row.querySelector('.bar-weight-input').addEventListener('blur', async (e) => {
            const weightKg = e.target.value === '' ? 0 : Number(e.target.value);
            await repo.updateBar(id, { weightKg });
          });
          row.querySelector('.bar-delete').addEventListener('click', async () => {
            const ok = await openConfirmSheet('¿Eliminar esta barra?', { confirmLabel: 'Eliminar' });
            if (!ok) return;
            await repo.deleteBar(id);
            await refresh();
          });
        });
      }

      sheet.querySelector('#add-bar-btn').addEventListener('click', async () => {
        const nameInput = sheet.querySelector('#new-bar-name');
        const weightInput = sheet.querySelector('#new-bar-weight');
        const name = nameInput.value.trim();
        const weightKg = weightInput.value === '' ? null : Number(weightInput.value);
        if (!name || weightKg == null) { toast('Indica nombre y peso'); return; }
        await repo.createBar({ name, weightKg });
        nameInput.value = '';
        weightInput.value = '';
        await refresh();
      });

      await refresh();
    },
  });
}

function openPersonalizarSheet() {
  const sections = settings.getProgressSections();
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:12px;">Secciones visibles</h3>
    <p class="type-caption text-faint" style="margin-bottom:var(--space-3);">
      Ocultar una sección no borra sus datos — puedes reactivarla cuando quieras.
    </p>
    ${Object.entries(SECTION_LABELS).map(([key, label]) => `
      <label class="checkbox-row">
        <span class="type-body">${label}</span>
        <input type="checkbox" data-section="${key}" ${sections[key] ? 'checked' : ''} />
      </label>
    `).join('')}
  `, {
    onMount: (sheet) => {
      sheet.querySelectorAll('[data-section]').forEach((cb) => {
        cb.addEventListener('change', async (e) => {
          await settings.setProgressSection(e.target.dataset.section, e.target.checked);
        });
      });
    },
  });
}

// Reutiliza .import-mode-opt (tarjeta seleccionable tipo radio, ya usada en
// el selector de modo de importación por foto) en vez de crear un componente
// nuevo. Cada opción se aplica al instante (settings.setTheme -> emite
// 'prefs:changed' -> js/app.js llama a theme.applyTheme) para que se vea el
// cambio sin cerrar el sheet; al cerrarlo se refresca el hub para que la fila
// "Tema" muestre el nombre ya actualizado.
function openTemaSheet(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:4px;">Tema</h3>
    <p class="type-caption text-faint" style="margin-bottom:var(--space-4);">Se aplica al instante y se recuerda al volver a abrir la app.</p>
    <div class="stack" id="theme-list">
      ${THEMES.map((t) => `
        <button type="button" class="import-mode-opt ${t.key === settings.getTheme() ? 'import-mode-opt--active' : ''}" data-theme-key="${t.key}">
          <div class="row" style="justify-content:flex-start; align-items:center; gap:var(--space-3);">
            <span class="theme-swatch">
              <span style="background:${t.preview.bg};"></span>
              <span style="background:${t.preview.surface};"></span>
              <span style="background:${t.preview.accent};"></span>
            </span>
            <div class="type-headline">${t.label}</div>
          </div>
        </button>
      `).join('')}
    </div>
  `, {
    onMount: (sheet) => {
      sheet.querySelectorAll('[data-theme-key]').forEach((opt) => {
        opt.addEventListener('click', async () => {
          await settings.setTheme(opt.dataset.themeKey);
          sheet.querySelectorAll('[data-theme-key]').forEach((o) => o.classList.toggle('import-mode-opt--active', o === opt));
        });
      });
    },
    onClose: () => render(mount),
  });
}
