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
  { key: 'all', label: 'Todo' },
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
    <div class="grid-2" style="margin-bottom:var(--space-5);">
      <button class="btn btn-primary" id="register-btn">+ Registrar</button>
      <button class="btn btn-secondary" id="configure-btn">Configurar medidas</button>
    </div>
    ${!types.length ? `<div class="empty-state">Activa al menos una medida con "Configurar medidas".</div>` : `
      <div class="section-label">Resumen</div>
      <div class="list" id="summary-list" style="margin-bottom:var(--space-5);"></div>
      <div class="section-label">Historial</div>
      <div id="history-table" style="margin-bottom:var(--space-5);"></div>
    `}
  `;

  mount.querySelector('#register-btn').addEventListener('click', () => openRegisterSheet(mount, types));
  mount.querySelector('#configure-btn').addEventListener('click', () => openConfigureSheet(mount));

  if (!types.length) return;
  await renderSummaryList(mount, types);
  await renderHistoryTable(mount, types);
}

async function renderSummaryList(mount, types) {
  const list = mount.querySelector('#summary-list');
  const cards = [];
  for (const type of types) {
    const entries = await repo.listMeasurementsByType(type.id); // desc
    if (!entries.length) continue;
    const current = measurementValue(entries[0]);
    const initial = measurementValue(entries[entries.length - 1]);
    const { abs } = changeSinceFirst(current, initial);
    cards.push({ type, latest: entries[0], abs });
  }
  if (!cards.length) {
    list.innerHTML = `<div class="empty-state">Todavía no has registrado ninguna medida.</div>`;
    return;
  }
  list.innerHTML = cards.map(({ type, latest, abs }) => `
    <div class="card row" data-id="${type.id}" style="cursor:pointer;">
      <div>
        <div class="type-caption text-dim">${escapeHtml(type.name)}</div>
        <div class="type-headline" style="font-size:20px;">
          ${type.bilateral
            ? `D ${formatNumber(latest.valueRight, 1)} / I ${formatNumber(latest.valueLeft, 1)} ${type.unit}`
            : `${formatNumber(latest.value, 1)} ${type.unit}`}
        </div>
      </div>
      <span class="badge badge-neutral">${arrowFor(abs)} ${abs != null ? formatSigned(abs) : '—'} ${type.unit} desde inicio</span>
    </div>
  `).join('');
  list.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => navigate(`/progreso/medidas/${el.dataset.id}`));
  });
}

async function renderHistoryTable(mount, types) {
  const container = mount.querySelector('#history-table');
  const perType = [];
  const dateSet = new Set();
  for (const type of types) {
    const entries = await repo.listMeasurementsByType(type.id); // desc
    if (!entries.length) continue;
    perType.push({ type, byDate: Object.fromEntries(entries.map((e) => [e.date, e])) });
    entries.forEach((e) => dateSet.add(e.date));
  }
  if (!perType.length) { container.innerHTML = ''; return; }
  const dates = Array.from(dateSet).sort().slice(-12);

  container.innerHTML = `
    <div class="card" style="overflow-x:auto; padding:var(--space-3);">
      <table style="border-collapse:collapse; font-size:13px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:4px 14px 8px 0; position:sticky; left:0; background:var(--surface); color:var(--text-tertiary); font-size:11px; text-transform:uppercase;">Medida</th>
            ${dates.map((d) => `<th style="padding:4px 14px 8px; text-align:right; color:var(--text-tertiary); font-size:11px; white-space:nowrap;">${formatDateShort(d)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${perType.map(({ type, byDate }) => `
            <tr style="border-top:0.5px solid var(--border);">
              <td style="padding:8px 14px 8px 0; font-weight:600; position:sticky; left:0; background:var(--surface); white-space:nowrap;">${escapeHtml(type.name)}</td>
              ${dates.map((d) => {
                const e = byDate[d];
                const v = e ? measurementValue(e) : null;
                return `<td style="padding:8px 14px; text-align:right; white-space:nowrap; color:${v != null ? 'var(--text)' : 'var(--text-tertiary)'};">${v != null ? formatNumber(v, 1) : '–'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function arrowFor(n) {
  if (n == null || Math.abs(n) < 0.05) return '→';
  return n > 0 ? '↑' : '↓';
}
function formatSigned(n) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, 1)}`;
}

function openConfigureSheet(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:6px;">Configurar medidas</h3>
    <p class="type-caption text-dim" style="margin-bottom:14px;">Activa solo las medidas que quieras controlar.</p>
    <div id="types-chips" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:var(--space-5);"></div>
    <div class="field">
      <label class="label">Nueva medida personalizada</label>
      <input type="text" id="new-type-name" placeholder="Ej. Antebrazo" />
    </div>
    <label class="checkbox-row" style="padding:4px 0 var(--space-4);">
      <span class="type-body">Medida bilateral (izquierda/derecha)</span>
      <input type="checkbox" id="new-type-bilateral" />
    </label>
    <button class="btn btn-secondary btn-block" id="add-type-btn">+ Añadir medida</button>
  `, {
    onMount: async (sheet) => {
      async function refresh() {
        const all = await repo.listMeasurementTypes({ includeDisabled: true });
        sheet.querySelector('#types-chips').innerHTML = all.map((t) => `
          <span class="subtab ${t.enabled !== false ? 'active' : ''}" style="display:inline-flex; align-items:center; gap:6px; padding-right:8px;">
            <span class="chip-toggle" data-id="${t.id}" style="cursor:pointer;">${t.enabled !== false ? '✓ ' : ''}${escapeHtml(t.name)}</span>
            <span class="chip-delete" data-id="${t.id}" style="cursor:pointer; opacity:0.6;">✕</span>
          </span>
        `).join('');
        sheet.querySelectorAll('.chip-toggle').forEach((chip) => {
          chip.addEventListener('click', async () => {
            const t = all.find((x) => x.id === chip.dataset.id);
            await repo.setMeasurementTypeEnabled(t.id, t.enabled === false);
            await refresh();
            await renderMeasurements(mount);
          });
        });
        sheet.querySelectorAll('.chip-delete').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const t = all.find((x) => x.id === btn.dataset.id);
            const ok = await openConfirmSheet(`¿Eliminar "${t.name}" y todo su histórico? Esta acción no se puede deshacer.`, { confirmLabel: 'Eliminar' });
            if (!ok) return;
            await repo.deleteMeasurementType(t.id);
            await refresh();
            await renderMeasurements(mount);
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
    <button class="btn btn-primary btn-block" id="r-save" style="margin-top:var(--space-2);">Guardar</button>
  `, {
    onMount: async (sheet, close) => {
      const fieldsBox = sheet.querySelector('#r-fields');
      const lastByType = {};
      for (const type of types) {
        const entries = await repo.listMeasurementsByType(type.id);
        lastByType[type.id] = entries[0] || null;
      }
      fieldsBox.innerHTML = types.map((type) => {
        const last = lastByType[type.id];
        if (type.bilateral) {
          return `
            <div class="field">
              <label class="label">${escapeHtml(type.name)} (${type.unit})</label>
              <div class="grid-2">
                <div>
                  <div class="type-caption text-faint" style="margin-bottom:4px;">Derecho${last?.valueRight != null ? ` · anterior ${formatNumber(last.valueRight, 1)}` : ''}</div>
                  <input type="number" inputmode="decimal" step="0.1" class="m-input" data-type="${type.id}" data-side="right" />
                </div>
                <div>
                  <div class="type-caption text-faint" style="margin-bottom:4px;">Izquierdo${last?.valueLeft != null ? ` · anterior ${formatNumber(last.valueLeft, 1)}` : ''}</div>
                  <input type="number" inputmode="decimal" step="0.1" class="m-input" data-type="${type.id}" data-side="left" />
                </div>
              </div>
            </div>
          `;
        }
        return `
          <div class="field">
            <label class="label">${escapeHtml(type.name)} (${type.unit})${last?.value != null ? ` · anterior ${formatNumber(last.value, 1)}` : ''}</label>
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
