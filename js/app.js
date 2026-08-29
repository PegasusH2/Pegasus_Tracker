import { renderHome } from './views/home.js';
import { renderExerciseLibrary } from './views/exercise-library.js';
import { renderExerciseDetail } from './views/exercise-detail.js';
import { renderWorkoutNew } from './views/workout-new.js';
import { renderWorkoutImport } from './views/workout-import.js';
import { renderWorkoutSession } from './views/workout-session.js';
import { renderWorkoutHistory, renderAllRoutines } from './views/workout-history.js';
import { renderRoutineWizard } from './views/routine-wizard.js';
import { renderTemplateDetail } from './views/templates.js';
import { renderProgressHub } from './views/progress-hub.js';
import { renderBodyWeight } from './views/bodyweight.js';
import { renderMeasurements, renderMeasurementDetail } from './views/measurements.js';
import { renderSkinfold } from './views/skinfold.js';
import { renderAiAnalysis } from './views/ai-analysis.js';
import { renderSettingsBackup } from './views/settings-backup.js';
import { renderSettingsHub } from './views/settings-hub.js';
import { renderSettingsAccount } from './views/settings-account.js';
import { hasExistingUserData, runOnboarding } from './views/onboarding.js';
import { NAV_ICONS } from './core/ui.js';
import { on, toast } from './core/store.js';
import * as settings from './core/settings.js';
import { initSync } from './core/sync.js';
import { initAuthListener } from './core/auth.js';
import { initTheme, applyTheme } from './core/theme.js';

// Splash de arranque (ver index.html/#app-splash) — se queda visible un
// mínimo de 2s desde que este módulo empieza a ejecutarse, aunque el resto
// del arranque (settings, tema, comprobación de onboarding) termine antes.
const APP_BOOT_STARTED_AT = Date.now();
const MIN_SPLASH_MS = 2000;
// El trazo único de la firma "4 the Queens" (ver index.html + css/layout.css)
// tiene que terminar de recorrer el texto ANTES de que el splash empiece a
// desvanecerse — si no, se corta a medias. animation-delay 0.4s + 1.3s de
// animación = 1.7s. Estos dos números viven aquí, sueltos, porque son
// producto de las constantes usadas al generar el SVG (no algo que se pueda
// leer del DOM antes de que la animación empiece) — si alguna vez se retocan
// esos tiempos, hay que actualizar esto también.
const QUEENS_SIGNATURE_END_MS = 1700;
// 400ms de colchón de seguridad + 500ms extra a propósito, para poder leer
// la firma ya completa un momento antes de que el splash se desvanezca.
const QUEENS_SIGNATURE_MARGIN_MS = 900;

function hideSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  splash.classList.add('app-splash--hide');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
}

function waitForMinSplashDuration() {
  const minMs = settings.getTheme() === 'queens'
    ? Math.max(MIN_SPLASH_MS, QUEENS_SIGNATURE_END_MS + QUEENS_SIGNATURE_MARGIN_MS)
    : MIN_SPLASH_MS;
  const elapsed = Date.now() - APP_BOOT_STARTED_AT;
  if (elapsed >= minMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
}

// Retira el splash Y revela #app (fundido + leve deslizamiento, ver
// css/layout.css) en el mismo instante — para que el contenido "aparezca"
// justo cuando el splash se desvanece, no antes ni después.
function revealApp() {
  hideSplash();
  document.getElementById('app')?.classList.add('app-ready');
}

const ALL_TABS = [
  { key: 'home', label: 'Inicio', icon: NAV_ICONS.home, path: '/home' },
  { key: 'entreno', label: 'Entreno', icon: NAV_ICONS.entreno, path: '/entreno' },
  { key: 'progreso', label: 'Progreso', icon: NAV_ICONS.progreso, path: '/progreso' },
  { key: 'ajustes', label: 'Ajustes', icon: NAV_ICONS.settings, path: '/ajustes' },
];

function visibleTabs() {
  return ALL_TABS.filter((t) => t.key !== 'progreso' || settings.isAnyProgressSectionEnabled());
}

const ENTRENO_SUBTABS = [
  { key: 'entrenamientos', label: 'Entrenamientos', path: '/entreno' },
  { key: 'ejercicios', label: 'Ejercicios', path: '/entreno/ejercicios' },
];

const PROGRESO_SUBTABS = [
  { key: 'resumen', label: 'Resumen', path: '/progreso', sectionKey: 'general' },
  { key: 'peso', label: 'Peso', path: '/progreso/peso', sectionKey: 'peso' },
  { key: 'medidas', label: 'Medidas', path: '/progreso/medidas', sectionKey: 'medidas' },
  { key: 'plicometro', label: 'Plicómetro', path: '/progreso/plicometro', sectionKey: 'plicometro' },
];

function visibleProgresoSubtabs() {
  const sections = settings.getProgressSections();
  return PROGRESO_SUBTABS.filter((s) => sections[s.sectionKey]);
}

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/home';
  return hash.split('/').filter(Boolean);
}

function matchRoute(segments) {
  const [root, sub, param, sub2] = segments;

  if (!root || root === 'home') return { view: renderHome, tab: 'home' };

  if (root === 'entreno') {
    if (!sub) return { view: renderWorkoutHistory, tab: 'entreno', subtab: 'entrenamientos' };
    if (sub === 'ejercicios') return { view: renderExerciseLibrary, tab: 'entreno', subtab: 'ejercicios' };
    if (sub === 'rutinas') return { view: renderAllRoutines, tab: 'entreno', subtab: 'entrenamientos' };
    if (sub === 'rutina-nueva') return { view: renderRoutineWizard, tab: 'entreno', subtab: null, focusMode: true };
    if (sub === 'nuevo') return { view: renderWorkoutNew, tab: 'entreno', subtab: 'entrenamientos', params: { presetDate: param || null } };
    if (sub === 'importar-foto') return { view: renderWorkoutImport, tab: 'entreno', subtab: 'entrenamientos' };
    if (sub === 'sesion' && param) return { view: renderWorkoutSession, tab: 'entreno', subtab: null, focusMode: true, params: { workoutId: param } };
    if (sub === 'plantilla' && param) return { view: renderTemplateDetail, tab: 'entreno', subtab: 'entrenamientos', params: { templateId: param } };
    if (sub === 'ejercicio' && param) return { view: renderExerciseDetail, tab: 'entreno', subtab: 'ejercicios', params: { exerciseId: param } };
  }

  if (root === 'progreso') {
    const sections = settings.getProgressSections();
    if (!sub) {
      if (sections.general) return { view: renderProgressHub, tab: 'progreso', subtab: 'resumen' };
      if (sections.peso) return { view: renderBodyWeight, tab: 'progreso', subtab: 'peso' };
      if (sections.medidas) return { view: renderMeasurements, tab: 'progreso', subtab: 'medidas' };
      if (sections.plicometro) return { view: renderSkinfold, tab: 'progreso', subtab: 'plicometro' };
      return { view: renderHome, tab: 'home' };
    }
    if (sub === 'peso' && sections.peso) return { view: renderBodyWeight, tab: 'progreso', subtab: 'peso' };
    if (sub === 'medidas' && param && sections.medidas) return { view: renderMeasurementDetail, tab: 'progreso', subtab: 'medidas', params: { typeId: param } };
    if (sub === 'medidas' && sections.medidas) return { view: renderMeasurements, tab: 'progreso', subtab: 'medidas' };
    if (sub === 'plicometro' && sections.plicometro) return { view: renderSkinfold, tab: 'progreso', subtab: 'plicometro' };
    if (sub === 'ia') return { view: renderAiAnalysis, tab: 'progreso', subtab: null };
  }

  if (root === 'ajustes') {
    if (!sub) return { view: renderSettingsHub, tab: 'ajustes' };
    if (sub === 'datos') return { view: renderSettingsBackup, tab: 'ajustes' };
    if (sub === 'cuenta') return { view: renderSettingsAccount, tab: 'ajustes' };
  }

  if (root === 'datos') return { view: renderSettingsBackup, tab: 'ajustes' }; // alias legado

  return { view: renderHome, tab: 'home' };
}

export function navigate(path) {
  location.hash = path;
}

function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <main class="view" id="view"></main>
    <nav class="bottom-nav" id="bottom-nav"></nav>
  `;
}

let currentTab = null;

// Modo desarrollador oculto — 5 toques seguidos (en menos de 2s entre uno y
// el siguiente) sobre el icono de Ajustes de la barra inferior lo
// desbloquea permanentemente. El contador vive aquí porque el icono de
// Ajustes puede tocarse repetidamente sin cambiar de hash (ya estando en
// /ajustes), así que no siempre se vuelve a montar renderBottomNav entre
// toque y toque.
const DEV_UNLOCK_TAPS = 5;
const DEV_UNLOCK_WINDOW_MS = 2000;
let devTapCount = 0;
let devTapTimer = null;

function handleSettingsIconTap() {
  if (settings.isDevModeUnlocked()) return;
  clearTimeout(devTapTimer);
  devTapCount++;
  if (devTapCount >= DEV_UNLOCK_TAPS) {
    devTapCount = 0;
    settings.unlockDevMode().then(() => toast('Modo desarrollador desbloqueado'));
    return;
  }
  devTapTimer = setTimeout(() => { devTapCount = 0; }, DEV_UNLOCK_WINDOW_MS);
}

function renderBottomNav(activeTab) {
  currentTab = activeTab;
  const nav = document.getElementById('bottom-nav');
  nav.innerHTML = visibleTabs().map((tab) => `
    <a class="nav-item ${tab.key === activeTab ? 'active' : ''}" href="#${tab.path}" aria-label="${tab.label}" title="${tab.label}">
      <span class="nav-icon">${tab.icon}</span>
      <span class="nav-dot"></span>
    </a>
  `).join('');

  const ajustesLink = nav.querySelector('a[href="#/ajustes"]');
  ajustesLink?.addEventListener('click', handleSettingsIconTap);
}

on('auth:recovery', () => navigate('/ajustes/cuenta'));

on('prefs:changed', ({ key }) => {
  if (key === 'progressSections') renderBottomNav(currentTab);
  if (key === 'theme') applyTheme(settings.getTheme());
});

function renderSubtabs(container, subtabs, activeSubtab) {
  if (!subtabs) return;
  const bar = document.createElement('div');
  bar.className = 'segmented';
  bar.innerHTML = subtabs.map((s) => `
    <a class="seg ${s.key === activeSubtab ? 'active' : ''}" href="#${s.path}">${s.label}</a>
  `).join('');
  container.prepend(bar);
}

async function renderRoute() {
  const segments = parseHash();
  const match = matchRoute(segments);
  const view = document.getElementById('view');
  const bottomNav = document.getElementById('bottom-nav');
  // Guardia: un hashchange puede dispararse antes de que renderShell() haya
  // creado #view/#bottom-nav (p.ej. durante la carga inicial) — sin esto,
  // `view.innerHTML = ''` lanza "Cannot set properties of null".
  if (!view || !bottomNav) return;
  view.innerHTML = '';
  view.scrollTop = 0;

  bottomNav.style.display = match.focusMode ? 'none' : '';
  view.classList.toggle('view--focus', !!match.focusMode);
  currentTab = match.tab;
  if (!match.focusMode) renderBottomNav(match.tab);

  if (match.tab === 'entreno' && match.subtab) renderSubtabs(view, ENTRENO_SUBTABS, match.subtab);
  if (match.tab === 'progreso' && match.subtab) {
    const subtabs = visibleProgresoSubtabs();
    if (subtabs.length > 1) renderSubtabs(view, subtabs, match.subtab);
  }

  const mount = document.createElement('div');
  mount.className = 'view-enter';
  view.appendChild(mount);

  try {
    await match.view(mount, match.params || {});
  } catch (err) {
    console.error('Error renderizando vista', err);
    mount.innerHTML = `<div class="empty-state">Ha ocurrido un error al cargar esta pantalla.</div>`;
  }
}

// Monta la barra/vista normal y registra los listeners de navegación.
// Devuelve la promesa de renderRoute() (la propia vista terminada de pintar)
// para poder esperarla cuando interesa (ver más abajo: revelar #app justo
// con el contenido ya listo, no antes).
function bootShell() {
  renderShell();
  // El listener se registra DESPUÉS de renderShell() para que #view/#bottom-nav
  // ya existan cuando llegue el primer hashchange real.
  window.addEventListener('hashchange', renderRoute);
  // Arranca el listener de recuperación de contraseña ANTES de renderRoute()
  // — si el usuario vuelve del enlace del email, Supabase procesa el
  // "?code=..." de forma asíncrona y puede tardar un poco; cuando el evento
  // llegue (ver 'auth:recovery' más abajo), naveguemos donde naveguemos ya
  // habrá alguien escuchando.
  initAuthListener();
  return renderRoute();
}

window.addEventListener('DOMContentLoaded', async () => {
  await settings.loadSettingsCache();
  initTheme();

  // Un "?code=..." en la URL solo puede venir de un redirect de Supabase Auth
  // (p.ej. el enlace de "olvidé mi contraseña"). Si aparece, nos saltamos el
  // onboarding aunque el dispositivo no tenga datos locales todavía — si no,
  // alguien que abre ese enlace en un navegador/dispositivo nuevo se queda
  // atrapado en el asistente de bienvenida antes de poder cambiar su contraseña.
  const hasAuthCode = new URLSearchParams(window.location.search).has('code');
  let needsOnboarding = false;
  if (!hasAuthCode && !settings.isOnboardingCompleted()) {
    if (await hasExistingUserData()) {
      // Instalación previa a la existencia del onboarding: no mostrarlo nunca,
      // solo marcar el flag en silencio.
      await settings.setOnboardingCompleted(true);
    } else {
      needsOnboarding = true;
    }
  }

  // Caso normal (ya hay cuenta/datos): se pinta la vista ANTES de revelar
  // #app, para que el fundido de entrada muestre datos ya listos, nunca una
  // pantalla vacía a medio cargar. El onboarding es al revés (no hay nada
  // que precargar) — se revela primero y su propia pantalla de bienvenida
  // aparece después, como siempre.
  if (!needsOnboarding) await bootShell();

  await waitForMinSplashDuration();
  revealApp();

  if (needsOnboarding) {
    await runOnboarding();
    bootShell();
  }

  // No se espera (fire-and-forget): si no hay Supabase configurado o no hay
  // sesión, no hace nada; si la hay, sincroniza en segundo plano sin retrasar
  // el primer render de la app (offline-first — la UI nunca depende de esto).
  initSync();
});
