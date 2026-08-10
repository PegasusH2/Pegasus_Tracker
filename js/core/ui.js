// Helper compartido para mostrar un modal tipo "bottom sheet" (patrón iOS).
export function openSheet(innerHtml, { onMount } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-sheet">${innerHtml}</div>`;

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  const sheet = overlay.querySelector('.modal-sheet');
  if (onMount) onMount(sheet, close);
  return close;
}
