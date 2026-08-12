import * as repo from '../db/repository.js';
import { toast } from '../core/store.js';
import { openConfirmSheet } from '../core/ui.js';
import { navigate } from '../app.js';

export async function renderSettingsBackup(mount) {
  mount.innerHTML = `
    <h1 class="type-title" style="margin-bottom:var(--space-5);">Datos</h1>

    <div class="section-label">Copia de seguridad</div>
    <div class="card" style="margin-bottom:var(--space-4); margin-top:var(--space-2);">
      <div class="type-headline" style="margin-bottom:6px;">Exportar datos</div>
      <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
        Descarga un archivo JSON con todos tus entrenamientos, ejercicios, peso, medidas y plicómetro.
        Tus datos nunca salen de tu dispositivo salvo que tú los exportes.
      </p>
      <button class="btn btn-primary btn-block" id="export-btn">Exportar todos los datos</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-4);">
      <div class="type-headline" style="margin-bottom:6px;">Importar / restaurar datos</div>
      <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
        Restaura un backup exportado previamente. Esto <strong>sustituye</strong> todos los datos actuales.
      </p>
      <input type="file" accept="application/json" id="import-file" style="display:none;" />
      <button class="btn btn-secondary btn-block" id="import-btn">Seleccionar archivo de backup</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-4);">
      <div class="type-headline" style="margin-bottom:6px;">Importar progreso (añadir, sin sustituir)</div>
      <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
        Añade registros de peso, medidas y plicómetro desde un archivo (por ejemplo, exportados de una
        hoja de cálculo). <strong>Nunca borra ni sustituye nada</strong> — ni tus entrenamientos, ni
        datos ya existentes. Solo añade filas nuevas.
      </p>
      <input type="file" accept="application/json" id="import-progress-file" style="display:none;" />
      <button class="btn btn-secondary btn-block" id="import-progress-btn">Seleccionar archivo de progreso</button>
    </div>

    <div class="section-label">Zona de riesgo</div>
    <div class="card" style="margin-top:var(--space-2);">
      <div class="type-headline text-danger" style="margin-bottom:6px;">Borrar todos los datos</div>
      <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
        Elimina permanentemente todos los entrenamientos, ejercicios, peso, medidas y plicómetro de este dispositivo.
        Esta acción no se puede deshacer.
      </p>
      <label class="row" style="margin-bottom:var(--space-4); cursor:pointer;">
        <span class="type-body">Entiendo que esto es irreversible</span>
        <input type="checkbox" id="confirm-delete-checkbox" style="width:24px; height:24px; accent-color:var(--danger);" />
      </label>
      <button class="btn btn-danger btn-block" id="delete-btn" disabled>Borrar todos los datos</button>
    </div>
  `;

  mount.querySelector('#export-btn').addEventListener('click', async () => {
    const backup = await repo.exportAllData();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitness-tracker-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup exportado');
  });

  const fileInput = mount.querySelector('#import-file');
  mount.querySelector('#import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const ok = await openConfirmSheet('Esto sustituirá todos tus datos actuales por los del archivo. ¿Continuar?', { confirmLabel: 'Sustituir' });
    if (!ok) {
      fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      await repo.importAllData(backup);
      toast('Datos importados correctamente');
      navigate('/home');
    } catch (err) {
      console.error(err);
      toast('El archivo no es un backup válido');
    }
    fileInput.value = '';
  });

  const progressFileInput = mount.querySelector('#import-progress-file');
  mount.querySelector('#import-progress-btn').addEventListener('click', () => progressFileInput.click());
  progressFileInput.addEventListener('change', async () => {
    const file = progressFileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const totalCount = (data.bodyWeight?.length || 0) + (data.measurements?.length || 0) + (data.skinfold?.length || 0);
      const ok = await openConfirmSheet(
        `Se añadirán ${data.bodyWeight?.length || 0} registros de peso, ${data.measurements?.length || 0} de medidas y ${data.skinfold?.length || 0} de plicómetro. No se borra nada existente. ¿Continuar?`,
        { confirmLabel: 'Añadir', danger: false }
      );
      if (!ok || totalCount === 0) { progressFileInput.value = ''; return; }
      const result = await repo.importProgressData(data);
      toast(`Añadido: ${result.bodyWeight} peso, ${result.measurements} medidas, ${result.skinfold} plicómetro`);
      navigate('/progreso');
    } catch (err) {
      console.error(err);
      toast('El archivo no tiene un formato válido');
    }
    progressFileInput.value = '';
  });

  const checkbox = mount.querySelector('#confirm-delete-checkbox');
  const deleteBtn = mount.querySelector('#delete-btn');
  checkbox.addEventListener('change', () => { deleteBtn.disabled = !checkbox.checked; });
  deleteBtn.addEventListener('click', async () => {
    const ok = await openConfirmSheet('Última confirmación: se borrarán TODOS tus datos de este dispositivo. ¿Continuar?', { confirmLabel: 'Borrar todo' });
    if (!ok) return;
    await repo.clearAllData();
    toast('Todos los datos han sido borrados');
    navigate('/home');
  });
}
