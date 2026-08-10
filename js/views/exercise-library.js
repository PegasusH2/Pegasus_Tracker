import * as repo from '../db/repository.js';
import { openSheet } from '../core/ui.js';
import { toast, confirmDialog } from '../core/store.js';
import { escapeHtml } from '../core/escape.js';
import { navigate } from '../app.js';

const escapeAttr = escapeHtml;

let state = { search: '', showArchived: false };

export async function renderExerciseLibrary(mount) {
  mount.innerHTML = `
    <div class="field">
      <input type="search" id="ex-search" placeholder="Buscar ejercicio..." value="${escapeAttr(state.search)}" />
    </div>
    <div id="ex-list" class="list"></div>
    <button class="btn btn-secondary btn-sm" id="toggle-archived" style="margin-top:16px;">
      ${state.showArchived ? 'Ocultar archivados' : 'Ver archivados'}
    </button>
    <button class="btn btn-primary btn-block" id="new-exercise" style="margin-top:16px;">+ Nuevo ejercicio</button>
  `;

  mount.querySelector('#ex-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderList(mount);
  });
  mount.querySelector('#toggle-archived').addEventListener('click', () => {
    state.showArchived = !state.showArchived;
    renderExerciseLibrary(mount);
  });
  mount.querySelector('#new-exercise').addEventListener('click', () => openExerciseForm(mount));

  await renderList(mount);
}

async function renderList(mount) {
  const listEl = mount.querySelector('#ex-list');
  const exercises = await repo.listExercises({ includeArchived: state.showArchived, search: state.search });

  if (!exercises.length) {
    listEl.innerHTML = `<div class="empty-state">No hay ejercicios todavía.<br/>Crea el primero con "+ Nuevo ejercicio".</div>`;
    return;
  }

  listEl.innerHTML = exercises.map((ex) => `
    <div class="card row" data-id="${ex.id}">
      <div style="flex:1; min-width:0;" class="ex-open">
        <div style="font-weight:600; ${ex.archived ? 'opacity:0.5;' : ''}">${escapeHtml(ex.name)}</div>
        ${ex.muscleGroup ? `<div class="text-dim" style="font-size:13px;">${escapeHtml(ex.muscleGroup)}</div>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm ex-edit">Editar</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.ex-open').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.closest('[data-id]').dataset.id;
      navigate(`/entreno/ejercicio/${id}`);
    });
  });
  listEl.querySelectorAll('.ex-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-id]').dataset.id;
      const ex = await repo.getExercise(id);
      openExerciseForm(mount, ex);
    });
  });
}

function openExerciseForm(mount, existing) {
  const isEdit = !!existing;
  openSheet(`
    <h3 style="margin-bottom:16px;">${isEdit ? 'Editar ejercicio' : 'Nuevo ejercicio'}</h3>
    <div class="field">
      <label class="label">Nombre</label>
      <input type="text" id="f-name" value="${escapeAttr(existing?.name || '')}" placeholder="Ej. Press banca" autofocus />
    </div>
    <div class="field">
      <label class="label">Grupo muscular (opcional)</label>
      <input type="text" id="f-muscle" value="${escapeAttr(existing?.muscleGroup || '')}" placeholder="Ej. Pecho" />
    </div>
    <div class="field">
      <label class="label">Notas (opcional)</label>
      <textarea id="f-notes" rows="2">${escapeHtml(existing?.notes || '')}</textarea>
    </div>
    <button class="btn btn-primary btn-block" id="f-save">${isEdit ? 'Guardar cambios' : 'Crear ejercicio'}</button>
    ${isEdit ? `
      <button class="btn btn-secondary btn-block" id="f-archive" style="margin-top:8px;">
        ${existing.archived ? 'Desarchivar' : 'Archivar'}
      </button>
      <button class="btn btn-danger btn-block" id="f-delete" style="margin-top:8px;">Eliminar</button>
    ` : ''}
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async () => {
        const name = sheet.querySelector('#f-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const muscleGroup = sheet.querySelector('#f-muscle').value.trim();
        const notes = sheet.querySelector('#f-notes').value.trim();
        if (isEdit) {
          await repo.updateExercise(existing.id, { name, muscleGroup, notes });
        } else {
          await repo.createExercise({ name, muscleGroup, notes });
        }
        close();
        await renderList(mount);
        toast(isEdit ? 'Ejercicio actualizado' : 'Ejercicio creado');
      });

      sheet.querySelector('#f-archive')?.addEventListener('click', async () => {
        await repo.setExerciseArchived(existing.id, !existing.archived);
        close();
        await renderList(mount);
      });

      sheet.querySelector('#f-delete')?.addEventListener('click', async () => {
        if (!confirmDialog(`¿Eliminar "${existing.name}"? Esto no elimina los entrenamientos pasados, pero perderás la ficha del ejercicio.`)) return;
        await repo.deleteExercise(existing.id);
        close();
        await renderList(mount);
        toast('Ejercicio eliminado');
      });
    },
  });
}
