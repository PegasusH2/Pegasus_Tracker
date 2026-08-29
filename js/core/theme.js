// Aplicación visual del tema elegido — único módulo que toca el DOM para
// esto. Los valores REALES de cada tema viven en css/base.css
// ([data-theme="..."] { ... }); este archivo solo decide QUÉ atributo poner
// y sincroniza el theme-color de la barra de estado del móvil con el --bg
// resultante (leído ya computado, nunca duplicado a mano).
import * as settings from './settings.js';

// Preview en hex literal para el selector de Ajustes — tiene que poder
// mostrar el aspecto de un tema que NO está activo, así que no puede leer
// las variables CSS reales (esas solo existen para el tema aplicado). Si
// cambias una paleta en css/base.css, actualiza también su preview aquí.
export const THEMES = [
  { key: 'default', label: 'Predeterminado', preview: { bg: '#F2F2F5', surface: '#FFFFFF', accent: '#FF3B30' } },
  { key: 'white', label: 'Blanco', preview: { bg: '#FAFAFA', surface: '#FFFFFF', accent: '#FF3B30' } },
  { key: 'queens', label: '4 the Queens', preview: { bg: '#FDFBFC', surface: '#F7EEF2', accent: '#D6336C' } },
];

// Contenido ORIGINAL de cada <meta theme-color> de index.html (uno por media
// query claro/oscuro), capturado una sola vez antes de tocar ninguno — hace
// falta para poder restaurarlos tal cual si el usuario vuelve a
// "Predeterminado" después de haber estado en un tema manual.
let originalMetaContents = null;

export function applyTheme(themeKey) {
  document.documentElement.dataset.theme = themeKey;

  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!originalMetaContents) originalMetaContents = [...metas].map((m) => m.getAttribute('content'));

  // "Predeterminado" deja los DOS <meta theme-color> exactamente como están
  // en index.html: siguen vivos y reaccionan solos si el usuario cambia el
  // modo del SO mientras la app está abierta, igual que hoy. Un tema manual
  // fijo (Blanco/Queens) sí necesita igualarlos, porque ya no dependen del
  // modo del sistema.
  if (themeKey === 'default') {
    metas.forEach((meta, i) => meta.setAttribute('content', originalMetaContents[i]));
    return;
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (!bg) return;
  metas.forEach((meta) => meta.setAttribute('content', bg));
}

export function initTheme() {
  applyTheme(settings.getTheme());
}
