import * as repo from '../db/repository.js';
import { measurementValue, changeSinceFirst, filterByPeriodGeneric, trendDirection } from '../core/stats.js';
import { todayISO, formatDate, formatDateShort, formatNumber } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openConfirmSheet, getChartThemeColors } from '../core/ui.js';
import { toast } from '../core/store.js';
import { navigate } from '../app.js';

// Medidas sugeridas por defecto — el usuario puede desactivarlas o crear las suyas.
const DEFAULT_TYPES = [
  { name: 'Cuello', bilateral: false },
  { name: 'Hombros', bilateral: false },
  { name: 'Bíceps', bilateral: true },
  { name: 'Pecho', bilateral: false },
  { name: 'Abdomen', bilateral: false },
  { name: 'Cintura', bilateral: false },
  { name: 'Cadera', bilateral: false },
  { name: 'Muslo', bilateral: true },
  { name: 'Gemelo', bilateral: true },
];

const PERIODS = [
  { key: '3m', label: '3 meses' },
  { key: '6m', label: '6 meses' },
  { key: '1y', label: '1 año' },
];

let chartInstance = null;
const detailState = { period: '6m' };

async function seedDefaultsIfEmpty() {
  const seeded = await repo.getSetting('measurementsSeeded', false);
  if (seeded) return;
  const existing = await repo.listMeasurementTypes({ includeDisabled: true });
  if (!existing.length) {
    for (const d of DEFAULT_TYPES) {
      await repo.createMeasurementType({ name: d.name, unit: 'cm', bilateral: d.bilateral });
    }
  }
  await repo.setSetting('measurementsSeeded', true);
}

export async function renderMeasurements(mount) {
  await seedDefaultsIfEmpty();
  const types = await repo.listMeasurementTypes();

  mount.innerHTML = `
    ${!types.length ? `
      <div class="empty-state">Aún no tienes medidas configuradas.</div>
      <button class="btn btn-primary btn-block" id="configure-btn" style="margin-top:var(--space-4);">Configurar medidas</button>
    ` : `
      <div class="grid-2" style="margin-bottom:var(--space-5);">
        <button class="btn btn-primary" id="register-btn">+ Registrar</button>
        <button class="btn btn-secondary" id="configure-btn">Configurar medidas</button>
      </div>
      <div class="mejoras-row" id="summary-grid" style="grid-template-columns:repeat(2, 1fr);"></div>
    `}
  `;

  mount.querySelector('#configure-btn').addEventListener('click', () => openConfigureSheet(mount));
  mount.querySelector('#register-btn')?.addEventListener('click', () => openRegisterSheet(mount, types));

  if (!types.length) return;
  await renderSummaryGrid(mount, types);
}

async function renderSummaryGrid(mount, types) {
  const grid = mount.querySelector('#summary-grid');
  const tiles = [];
  for (const type of types) {
    const entries = await repo.listMeasurementsByType(type.id); // desc
    if (!entries.length) {
      tiles.push({ type, valueText: 'Sin dato', deltaText: '' });
      continue;
    }
    const current = measurementValue(entries[0]);
    const initial = measurementValue(entries[entries.length - 1]);
    const { abs } = changeSinceFirst(current, initial);
    const valueText = type.bilateral
      ? `D ${formatNumber(entries[0].valueRight, 1)} / I ${formatNumber(entries[0].valueLeft, 1)}`
      : `${formatNumber(current, 1)} ${type.unit}`;
    tiles.push({ type, valueText, deltaText: entries.length > 1 ? `${arrowFor(abs)} ${formatSigned(abs)} ${type.unit}` : '' });
  }

  grid.innerHTML = tiles.map(({ type, valueText, deltaText }) => `
    <div class="mejora-tile" data-id="${type.id}">
      <div class="type-caption" style="font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--text-tertiary);">${escapeHtml(type.name)}</div>
      <div class="type-headline" style="font-weight:700; margin-top:6px;">${valueText}</div>
      ${deltaText ? `<div class="type-caption" style="font-weight:700; color:var(--accent); margin-top:2px;">${deltaText}</div>` : ''}
    </div>
  `).join('');

  grid.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => navigate(`/progreso/medidas/${el.dataset.id}`));
  });
}

function arrowFor(n) {
  if (n == null || Math.abs(n) < 0.05) return '→';
  return n > 0 ? '↑' : '↓';
}
function formatSigned(n) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, 1)}`;
}

// Checklist simple — el usuario marca qué medidas quiere controlar y pulsa
// "Guardar configuración". Nada se aplica hasta guardar.
function openConfigureSheet(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:6px;">Configurar medidas</h3>
    <p class="type-caption text-dim" style="margin-bottom:14px;">Marca solo las medidas que quieras controlar.</p>
    <div id="types-list" style="margin-bottom:var(--space-4);"></div>
    <div class="field">
      <label class="label">Nueva medida personalizada</label>
      <input type="text" id="new-type-name" placeholder="Ej. Antebrazo" />
    </div>
    <label class="checkbox-row" style="padding:4px 0 var(--space-4);">
      <span class="type-body">Medida bilateral (izquierda/derecha)</span>
      <input type="checkbox" id="new-type-bilateral" />
    </label>
    <button class="btn btn-secondary btn-block" id="add-type-btn" style="margin-bottom:var(--space-3);">+ Añadir medida</button>
    <button class="btn btn-primary btn-block" id="save-config-btn">Guardar configuración</button>
  `, {
    onMount: async (sheet, close) => {
      let all = [];
      const pendingEnabled = {};

      async function refresh() {
        all = await repo.listMeasurementTypes({ includeDisabled: true });
        all.forEach((t) => { if (!(t.id in pendingEnabled)) pendingEnabled[t.id] = t.enabled !== false; });
        sheet.querySelector('#types-list').innerHTML = `<div class="grouped-list">${all.map((t) => `
          <label class="checkbox-row" data-id="${t.id}">
            <span class="type-body">${escapeHtml(t.name)}${t.bilateral ? ' <span class="type-caption text-faint">(izq./der.)</span>' : ''}</span>
            <span class="row" style="gap:10px;">
              <input type="checkbox" class="type-toggle" data-id="${t.id}" ${pendingEnabled[t.id] ? 'checked' : ''} />
              <button type="button" class="icon-btn type-delete" data-id="${t.id}" aria-label="Eliminar" style="width:26px; height:26px; font-size:13px;">✕</button>
            </span>
          </label>
        `).join('')}</div>`;

        sheet.querySelectorAll('.type-toggle').forEach((cb) => {
          cb.addEventListener('change', () => { pendingEnabled[cb.dataset.id] = cb.checked; });
        });
        sheet.querySelectorAll('.type-delete').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const t = all.find((x) => x.id === btn.dataset.id);
            const ok = await openConfirmSheet(`¿Eliminar "${t.name}" y todo su histórico? Esta acción no se puede deshacer.`, { confirmLabel: 'Eliminar' });
            if (!ok) return;
            await repo.deleteMeasurementType(t.id);
            delete pendingEnabled[t.id];
            await refresh();
          });
        });
      }

      sheet.querySelector('#add-type-btn').addEventListener('click', async () => {
        const name = sheet.querySelector('#new-type-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        const bilateral = sheet.querySelector('#new-type-bilateral').checked;
        await repo.createMeasurementType({ name, unit: 'cm', bilateral });
        sheet.querySelector('#new-type-name').value = '';
        sheet.querySelector('#new-type-bilateral').checked = false;
        await refresh();
      });

      sheet.querySelector('#save-config-btn').addEventListener('click', async () => {
        for (const t of all) {
          if (pendingEnabled[t.id] !== (t.enabled !== false)) {
            await repo.setMeasurementTypeEnabled(t.id, pendingEnabled[t.id]);
          }
        }
        close();
        toast('Configuración guardada');
        await renderMeasurements(mount);
      });

      await refresh();
    },
  });
}

function openRegisterSheet(mount, types) {
  if (!types.length) { toast('Activa alguna medida primero en "Configurar medidas"'); return; }
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">Registrar medidas</h3>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="r-date" value="${todayISO()}" />
    </div>
    <div id="r-fields"></div>
    <button class="btn btn-primary btn-block" id="r-save" style="margin-top:var(--space-2);">Guardar medidas</button>
  `, {
    onMount: (sheet, close) => {
      const fieldsBox = sheet.querySelector('#r-fields');
      fieldsBox.innerHTML = types.map((type) => {
        if (type.bilateral) {
          return `
            <div class="field">
              <label class="label">${escapeHtml(type.name)}</label>
              <div class="grid-2">
                <div>
                  <div class="type-caption text-faint" style="margin-bottom:4px;">Derecho</div>
                  <input type="number" inputmode="decimal" step="0.1" class="m-input" data-type="${type.id}" data-side="right" />
                </div>
                <div>
                  <div class="type-caption text-faint" style="margin-bottom:4px;">Izquierdo</div>
                  <input type="number" inputmode="decimal" step="0.1" class="m-input" data-type="${type.id}" data-side="left" />
                </div>
              </div>
            </div>
          `;
        }
        return `
          <div class="field">
            <label class="label">${escapeHtml(type.name)}</label>
            <input type="number" inputmode="decimal" step="0.1" class="m-input" data-type="${type.id}" data-side="single" />
          </div>
        `;
      }).join('');

      sheet.querySelector('#r-save').addEventListener('click', async () => {
        const date = sheet.querySelector('#r-date').value;
        if (!date) { toast('La fecha es obligatoria'); return; }
        const grouped = {};
        sheet.querySelectorAll('.m-input').forEach((input) => {
          if (input.value === '') return;
          grouped[input.dataset.type] = grouped[input.dataset.type] || {};
          grouped[input.dataset.type][input.dataset.side] = Number(input.value);
        });
        let any = false;
        for (const [typeId, sides] of Object.entries(grouped)) {
          any = true;
          if (sides.single != null) {
            await repo.addMeasurement({ typeId, date, value: sides.single });
          } else {
            await repo.addMeasurement({ typeId, date, valueLeft: sides.left ?? null, valueRight: sides.right ?? null });
          }
        }
        if (!any) { toast('Introduce al menos un valor'); return; }
        close();
        toast('Medidas guardadas');
        await renderMeasurements(mount);
      });
    },
  });
}

// ---------- Detalle de una medida ----------

export async function renderMeasurementDetail(mount, { typeId }) {
  const type = await repo.getMeasurementType(typeId);
  if (!type) {
    mount.innerHTML = `<div class="empty-state">Esta medida no existe.</div>`;
    return;
  }
  const entries = await repo.listMeasurementsByType(typeId); // desc

  mount.innerHTML = `
    <h1 class="type-title">${escapeHtml(type.name)}</h1>
    <div class="type-caption text-dim" style="margin-bottom:var(--space-5);">${type.bilateral ? 'Medida bilateral' : 'Medida única'} · ${type.unit}</div>

    ${!entries.length ? `<div class="empty-state">Todavía no has registrado esta medida.</div>` : `
    <div class="stat-hero">
      <div class="type-caption text-dim">Valor actual</div>
      <div class="stat-hero-value">
        <span class="type-hero">${formatNumber(measurementValue(entries[0]), 1)}</span>
        <span class="type-headline text-dim">${type.unit}</span>
      </div>
      <div class="type-caption text-faint" id="since-first"></div>
    </div>

    <div class="card stat-grid" style="margin-bottom:var(--space-5);" id="stat-grid"></div>

    <div class="row" style="margin-bottom:var(--space-3);">
      <div class="section-label" style="margin-bottom:0;">Evolución</div>
      <div class="type-caption text-dim" id="trend-label"></div>
    </div>
    <div class="period-selector" id="period-selector">
      ${PERIODS.map((p) => `<button class="period-chip ${p.key === detailState.period ? 'active' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}
    </div>
    <div class="chart-container" style="margin-bottom:var(--space-5);"><canvas id="detail-chart"></canvas></div>

    <div class="section-label">Historial</div>
    <div class="grouped-list" id="detail-history"></div>
    `}
  `;

  if (!entries.length) return;

  const ascending = entries.slice().reverse();
  const values = ascending.map((e) => measurementValue(e));
  const current = values[values.length - 1];
  const initial = values[0];
  const previous = values.length > 1 ? values[values.length - 2] : null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const { abs, percent } = changeSinceFirst(current, initial);

  mount.querySelector('#since-first').textContent =
    `${arrowFor(abs)} ${formatSigned(abs)} ${type.unit} (${percent != null ? formatSigned(percent) : '—'}%) desde la primera medición`;

  mount.querySelector('#stat-grid').innerHTML = `
    <div class="stat-tile">
      <div class="stat-label">Anterior</div>
      <div class="stat-value">${previous != null ? formatNumber(previous, 1) : '—'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Primera medición</div>
      <div class="stat-value">${formatNumber(initial, 1)}</div>
      <div class="stat-sub">${formatDate(ascending[0].date)}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Máximo</div>
      <div class="stat-value">${formatNumber(max, 1)}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Mínimo</div>
      <div class="stat-value">${formatNumber(min, 1)}</div>
    </div>
  `;

  renderDetailHistory(mount, entries, type);
  renderDetailChart(mount, ascending, type);

  mount.querySelector('#period-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    detailState.period = btn.dataset.period;
    mount.querySelectorAll('#period-selector .period-chip').forEach((b) => b.classList.toggle('active', b === btn));
    renderDetailChart(mount, ascending, type);
  });
}

function renderDetailHistory(mount, entries, type) {
  const list = mount.querySelector('#detail-history');
  list.innerHTML = entries.map((e) => `
    <div class="grouped-row">
      <div class="type-caption text-faint">${formatDate(e.date)}</div>
      <div class="type-body num" style="font-weight:600;">
        ${type.bilateral ? `D ${formatNumber(e.valueRight, 1)} / I ${formatNumber(e.valueLeft, 1)}` : formatNumber(e.value, 1)} ${type.unit}
      </div>
    </div>
  `).join('');
}

function renderDetailChart(mount, ascendingEntries, type) {
  const filtered = filterByPeriodGeneric(ascendingEntries, detailState.period);
  const canvas = mount.querySelector('#detail-chart');
  const trendLabel = mount.querySelector('#trend-label');
  const values = filtered.map((e) => measurementValue(e));
  const direction = trendDirection(values);
  trendLabel.textContent = direction === 'up' ? '↑ al alza' : direction === 'down' ? '↓ a la baja' : '→ estable';

  if (chartInstance) chartInstance.destroy();
  if (!filtered.length) return;

  const colors = getChartThemeColors();
  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: filtered.map((e) => formatDateShort(e.date)),
      datasets: [{
        data: values,
        borderColor: colors.accent,
        backgroundColor: colors.accentSoft,
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: colors.ticks, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: colors.ticks }, grid: { color: colors.grid } },
      },
    },
  });
}
