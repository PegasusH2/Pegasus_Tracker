import { renderHome } from './views/home.js';
import { renderExerciseLibrary } from './views/exercise-library.js';
import { renderExerciseDetail } from './views/exercise-detail.js';
import { renderWorkoutNew } from './views/workout-new.js';
import { renderWorkoutSession } from './views/workout-session.js';
import { renderWorkoutHistory } from './views/workout-history.js';
import { renderTemplateDetail } from './views/templates.js';
import { renderBodyWeight } from './views/bodyweight.js';
import { renderMeasurements } from './views/measurements.js';
import { renderSkinfold } from './views/skinfold.js';
import { renderAiAnalysis } from './views/ai-analysis.js';
import { renderSettingsBackup } from './views/settings-backup.js';
import { NAV_ICONS } from './core/ui.js';

const TABS = [
  { key: 'home', label: 'Inicio', icon: NAV_ICONS.home, path: '/home' },
  { key: 'entreno', label: 'Entreno', icon: NAV_ICONS.entreno, path: '/entreno' },
  { key: 'progreso', label: 'Progreso', icon: NAV_ICONS.progreso, path: '/progreso' },
  { key: 'datos', label: 'Datos', icon: NAV_ICONS.datos, path: '/datos' },
];

const ENTRENO_SUBTABS = [
  { key: 'entrenamientos', label: 'Entrenamientos', path: '/entreno' },
  { key: 'ejercicios', label: 'Ejercicios', path: '/entreno/ejercicios' },
];

const PROGRESO_SUBTABS = [
  { key: 'peso', label: 'Peso', path: '/progreso/peso' },
  { key: 'medidas', label: 'Medidas', path: '/progreso/medidas' },
  { key: 'plicometro', label: 'Plicómetro', path: '/progreso/plicometro' },
  { key: 'ia', label: 'Análisis IA', path: '/progreso/ia' },
];

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
    if (sub === 'nuevo') return { view: renderWorkoutNew, tab: 'entreno', subtab: 'entrenamientos' };
    if (sub === 'sesion' && param) return { view: renderWorkoutSession, tab: 'entreno', subtab: 'entrenamientos', params: { workoutId: param } };
    if (sub === 'plantilla' && param) return { view: renderTemplateDetail, tab: 'entreno', subtab: 'entrenamientos', params: { templateId: param } };
    if (sub === 'ejercicio' && param) return { view: renderExerciseDetail, tab: 'entreno', subtab: 'ejercicios', params: { exerciseId: param } };
  }

  if (root === 'progreso') {
    if (!sub || sub === 'peso') return { view: renderBodyWeight, tab: 'progreso', subtab: 'peso' };
    if (sub === 'medidas') return { view: renderMeasurements, tab: 'progreso', subtab: 'medidas' };
    if (sub === 'plicometro') return { view: renderSkinfold, tab: 'progreso', subtab: 'plicometro' };
    if (sub === 'ia') return { view: renderAiAnalysis, tab: 'progreso', subtab: 'ia' };
  }

  if (root === 'datos') return { view: renderSettingsBackup, tab: 'datos' };

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

function renderBottomNav(activeTab) {
  const nav = document.getElementById('bottom-nav');
  nav.innerHTML = TABS.map((tab) => `
    <a class="nav-item ${tab.key === activeTab ? 'active' : ''}" href="#${tab.path}">
      ${tab.icon}
      <span>${tab.label}</span>
    </a>
  `).join('');
}

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
  view.innerHTML = '';
  view.scrollTop = 0;

  renderBottomNav(match.tab);

  if (match.tab === 'entreno' && match.subtab) renderSubtabs(view, ENTRENO_SUBTABS, match.subtab);
  if (match.tab === 'progreso' && match.subtab) renderSubtabs(view, PROGRESO_SUBTABS, match.subtab);

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

window.addEventListener('hashchange', renderRoute);
window.addEventListener('DOMContentLoaded', () => {
  renderShell();
  renderRoute();
});
