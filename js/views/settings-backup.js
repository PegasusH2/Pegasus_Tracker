import * as repo from '../db/repository.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';

export async function renderSettingsBackup(mount) {
  mount.innerHTML = `
    <h1 style="font-size:22px; margin-bottom:20px;">Datos / Copia de seguridad</h1>

    <div class="card" style="margin-bottom:16px;">
      <div class="last-session-title" style="margin-bottom:8px;">Exportar datos</div>
      <p class="text-dim" style="font-size:14px; margin-bottom:12px;">
        Descarga un archivo JSON con todos tus entrenamientos, ejercicios, peso, medidas y plicómetro.
        Tus datos nunca salen de tu dispositivo salvo que tú los exportes.
      </p>
      <button class="btn btn-primary btn-block" id="export-btn">Exportar todos los datos</button>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="last-session-title" style="margin-bottom:8px;">Importar / restaurar datos</div>
      <p class="text-dim" style="font-size:14px; margin-bottom:12px;">
        Restaura un backup exportado previamente. Esto <strong>sustituye</strong> todos los datos actuales.
      </p>
      <input type="file" accept="application/json" id="import-file" style="display:none;" />
      <button class="btn btn-secondary btn-block" id="import-btn">Seleccionar archivo de backup</button>
    </div>

    <div class="card" style="border-color: var(--danger);">
      <div class="last-session-title" style="margin-bottom:8px;">Borrar todos los datos</div>
      <p class="text-dim" style="font-size:14px; margin-bottom:12px;">
        Elimina permanentemente todos los entrenamientos, ejercicios, peso, medidas y plicómetro de este dispositivo.
        Esta acción no se puede deshacer.
      </p>
      <label class="row" style="margin-bottom:12px; cursor:pointer;">
        <span style="font-size:14px;">Entiendo que esto es irreversible</span>
        <input type="checkbox" id="confirm-delete-checkbox" style="width:22px; height:22px;" />
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
    if (!window.confirm('Esto sustituirá todos tus datos actuales por los del archivo. ¿Continuar?')) {
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

  const checkbox = mount.querySelector('#confirm-delete-checkbox');
  const deleteBtn = mount.querySelector('#delete-btn');
  checkbox.addEventListener('change', () => { deleteBtn.disabled = !checkbox.checked; });
  deleteBtn.addEventListener('click', async () => {
    if (!window.confirm('Última confirmación: se borrarán TODOS tus datos de este dispositivo. ¿Continuar?')) return;
    await repo.clearAllData();
    toast('Todos los datos han sido borrados');
    navigate('/home');
  });
}
