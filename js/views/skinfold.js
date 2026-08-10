import * as repo from '../db/repository.js';
import { todayISO, formatDate, formatDateShort } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet } from '../core/ui.js';
import { toast, confirmDialog } from '../core/store.js';

let sumChartInstance = null;
let siteChartInstance = null;
const state = { selectedSiteId: null };

export async function renderSkinfold(mount) {
  const sites = await repo.listSkinfoldSites();
  const byDate = await repo.listSkinfoldEntriesByDate();
  const dates = Object.keys(byDate).sort();

  if (!state.selectedSiteId && sites.length) state.selectedSiteId = sites[0].id;
  if (state.selectedSiteId && !sites.find((s) => s.id === state.selectedSiteId)) {
    state.selectedSiteId = sites[0]?.id ?? null;
  }

  const sums = dates.map((date) => ({
    date,
    sum: byDate[date].reduce((s, e) => s + e.valueMm, 0),
    count: byDate[date].length,
  }));
  const currentSum = sums.length ? sums[sums.length - 1] : null;

  mount.innerHTML = `
    <div class="row" style="margin-bottom:16px;">
      <button class="btn btn-secondary btn-sm" id="manage-sites">Configurar pliegues</button>
      <button class="btn btn-primary btn-sm" id="add-entry">+ Nuevo registro</button>
    </div>

    ${!sites.length ? `<div class="empty-state">Configura primero los pliegues que utilizas con "Configurar pliegues".</div>` : `
      <div class="card" style="margin-bottom:20px;">
        <div class="row">
          <div class="last-session-title">Suma de pliegues</div>
          <div class="stat-value" style="font-size:20px;">${currentSum ? currentSum.sum + ' mm' : '—'}</div>
        </div>
        <div class="text-dim" style="font-size:13px; margin-bottom:8px;">${currentSum ? `${currentSum.count} pliegues · ${formatDate(currentSum.date)}` : 'Sin registros aún'}</div>
        <div class="chart-container" style="height:180px;"><canvas id="sum-chart"></canvas></div>
      </div>

      <div class="row" style="margin-bottom:8px;">
        <div class="last-session-title">Evolución individual</div>
      </div>
      <div class="subtabs" id="site-tabs">
        ${sites.map((s) => `<button class="subtab ${s.id === state.selectedSiteId ? 'active' : ''}" data-site="${s.id}">${escapeHtml(s.name)}</button>`).join('')}
      </div>
      <div class="card" style="margin-bottom:20px;">
        <div class="chart-container"><canvas id="site-chart"></canvas></div>
      </div>

      <div class="last-session-title" style="margin-bottom:8px;">Historial</div>
      <div id="entry-list" class="list"></div>
    `}
  `;

  mount.querySelector('#manage-sites').addEventListener('click', () => openSitesManager(mount));
  mount.querySelector('#add-entry')?.addEventListener('click', () => openEntryForm(mount, sites));
  mount.querySelector('#site-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-site]');
    if (!btn) return;
    state.selectedSiteId = btn.dataset.site;
    renderSkinfold(mount);
  });

  if (!sites.length) return;

  renderSumChart(mount, sums);
  await renderSiteChart(mount, state.selectedSiteId);
  renderEntryList(mount, dates, byDate, sites);
}

function renderSumChart(mount, sums) {
  const canvas = mount.querySelector('#sum-chart');
  if (sumChartInstance) sumChartInstance.destroy();
  if (!sums.length) return;
  sumChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: sums.map((s) => formatDateShort(s.date)),
      datasets: [{
        data: sums.map((s) => s.sum),
        borderColor: '#39ff88',
        backgroundColor: 'rgba(57,255,136,0.12)',
        tension: 0.3, fill: true, pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9a9ea5', maxRotation: 0 }, grid: { color: '#2a2c30' } },
        y: { ticks: { color: '#9a9ea5' }, grid: { color: '#2a2c30' } },
      },
    },
  });
}

async function renderSiteChart(mount, siteId) {
  const canvas = mount.querySelector('#site-chart');
  if (siteChartInstance) siteChartInstance.destroy();
  if (!siteId) return;
  const entries = await repo.listSkinfoldEntriesBySite(siteId);
  if (!entries.length) return;
  siteChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: entries.map((e) => formatDateShort(e.date)),
      datasets: [{
        data: entries.map((e) => e.valueMm),
        borderColor: '#39ff88',
        backgroundColor: 'rgba(57,255,136,0.12)',
        tension: 0.3, fill: true, pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9a9ea5', maxRotation: 0 }, grid: { color: '#2a2c30' } },
        y: { ticks: { color: '#9a9ea5' }, grid: { color: '#2a2c30' } },
      },
    },
  });
}

function renderEntryList(mount, dates, byDate, sites) {
  const list = mount.querySelector('#entry-list');
  const sortedDates = dates.slice().sort().reverse();
  if (!sortedDates.length) {
    list.innerHTML = `<div class="empty-state">Sin registros todavía.</div>`;
    return;
  }
  list.innerHTML = sortedDates.map((date) => {
    const entries = byDate[date];
    const sum = entries.reduce((s, e) => s + e.valueMm, 0);
    return `
      <div class="card" data-date="${date}">
        <div class="row" style="margin-bottom:6px;">
          <div style="font-weight:600;">${formatDate(date)}</div>
          <div class="text-dim">Suma: ${sum} mm</div>
        </div>
        ${entries.map((e) => {
          const site = sites.find((s) => s.id === e.siteId);
          return `<div class="row" style="font-size:14px; padding:2px 0;">
            <span class="text-dim">${escapeHtml(site?.name || '—')}</span>
            <span>${e.valueMm} mm <button class="btn btn-ghost btn-sm sf-delete" data-id="${e.id}">✕</button></span>
          </div>`;
        }).join('')}
      </div>
    `;
  }).join('');

  list.querySelectorAll('.sf-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDialog('¿Eliminar este registro de pliegue?')) return;
      await repo.deleteSkinfoldEntry(btn.dataset.id);
      await renderSkinfold(mount);
    });
  });
}

function openSitesManager(mount) {
  openSheet(`
    <h3 style="margin-bottom:16px;">Pliegues configurados</h3>
    <div id="sites-list" class="list" style="margin-bottom:16px;"></div>
    <div class="field">
      <label class="label">Nuevo pliegue</label>
      <input type="text" id="new-site-name" placeholder="Ej. Abdominal" />
    </div>
    <button class="btn btn-primary btn-block" id="add-site">Añadir pliegue</button>
  `, {
    onMount: async (sheet, close) => {
      async function refresh() {
        const sites = await repo.listSkinfoldSites();
        sheet.querySelector('#sites-list').innerHTML = sites.map((s) => `
          <div class="row" data-id="${s.id}">
            <span>${escapeHtml(s.name)}</span>
            <button class="btn btn-danger btn-sm site-delete">Eliminar</button>
          </div>
        `).join('') || '<div class="text-dim">Sin pliegues configurados.</div>';
        sheet.querySelectorAll('.site-delete').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirmDialog('¿Eliminar este pliegue y su historial?')) return;
            await repo.deleteSkinfoldSite(btn.closest('[data-id]').dataset.id);
            state.selectedSiteId = null;
            await refresh();
            await renderSkinfold(mount);
          });
        });
      }
      sheet.querySelector('#add-site').addEventListener('click', async () => {
        const name = sheet.querySelector('#new-site-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        await repo.createSkinfoldSite(name);
        sheet.querySelector('#new-site-name').value = '';
        await refresh();
        await renderSkinfold(mount);
      });
      await refresh();
    },
  });
}

function openEntryForm(mount, sites) {
  openSheet(`
    <h3 style="margin-bottom:16px;">Nuevo registro de pliegues</h3>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="f-date" value="${todayISO()}" />
    </div>
    ${sites.map((s) => `
      <div class="field">
        <label class="label">${escapeHtml(s.name)} (mm)</label>
        <input type="number" inputmode="decimal" step="0.1" class="site-input" data-site="${s.id}" />
      </div>
    `).join('')}
    <button class="btn btn-primary btn-block" id="f-save">Guardar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#f-save').addEventListener('click', async () => {
        const date = sheet.querySelector('#f-date').value;
        if (!date) { toast('La fecha es obligatoria'); return; }
        const inputs = sheet.querySelectorAll('.site-input');
        let any = false;
        for (const input of inputs) {
          const value = input.value;
          if (value === '') continue;
          any = true;
          await repo.addSkinfoldEntry({ siteId: input.dataset.site, date, valueMm: Number(value) });
        }
        if (!any) { toast('Introduce al menos un valor'); return; }
        close();
        await renderSkinfold(mount);
      });
    },
  });
}
