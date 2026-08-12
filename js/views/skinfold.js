import * as repo from '../db/repository.js';
import { estimateBodyFatJP7 } from '../core/stats.js';
import { todayISO, formatDate, formatDateShort } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { openSheet, openConfirmSheet, getChartThemeColors } from '../core/ui.js';
import { toast } from '../core/store.js';
import { SKINFOLD_POINTS_JP7 } from '../core/skinfold-points.js';

let sumChartInstance = null;

async function seedDefaultsIfEmpty() {
  const seeded = await repo.getSetting('skinfoldSeeded', false);
  if (seeded) return;
  const existing = await repo.listSkinfoldSites();
  if (!existing.length) {
    for (const p of SKINFOLD_POINTS_JP7) {
      await repo.createSkinfoldSite({ name: p.name, instructions: p.instructions });
    }
  }
  await repo.setSetting('skinfoldSeeded', true);
}

export async function renderSkinfold(mount) {
  await seedDefaultsIfEmpty();
  const sites = await repo.listSkinfoldSites();
  const byDate = await repo.listSkinfoldEntriesByDate();
  const dates = Object.keys(byDate).sort();

  const sums = dates.map((date) => ({
    date,
    sum: byDate[date].reduce((s, e) => s + e.valueMm, 0),
    count: byDate[date].length,
  }));
  const currentSum = sums.length ? sums[sums.length - 1] : null;
  const prevSum = sums.length > 1 ? sums[sums.length - 2] : null;
  const bodyFatEstimate = currentSum && currentSum.count === 7 ? estimateBodyFatJP7(currentSum.sum) : null;

  mount.innerHTML = `
    <div class="row" style="margin-bottom:var(--space-5);">
      <button class="btn btn-ghost btn-sm" id="manage-sites" style="padding-left:0;">Configurar puntos</button>
      <button class="btn btn-secondary btn-sm" id="bulk-entry">+ Registro completo</button>
    </div>

    ${!sites.length ? `<div class="empty-state">Configura primero los puntos que utilizas con "Configurar puntos".</div>` : `
      <div class="section-label">Puntos</div>
      <div class="grouped-list" id="points-list" style="margin-bottom:var(--space-5);"></div>

      <div class="stat-hero">
        <div class="type-caption text-dim">Suma de pliegues</div>
        <div class="stat-hero-value">
          <span class="type-hero">${currentSum ? currentSum.sum : '—'}</span>
          ${currentSum ? '<span class="type-headline text-dim">mm</span>' : ''}
        </div>
        <div class="type-caption text-faint">
          ${currentSum ? `${currentSum.count} punto${currentSum.count === 1 ? '' : 's'} · ${formatDate(currentSum.date)}` : 'Sin registros aún'}
          ${currentSum && prevSum ? ` · ${arrowFor(currentSum.sum - prevSum.sum)} ${formatSigned(currentSum.sum - prevSum.sum)} mm` : ''}
        </div>
      </div>

      ${bodyFatEstimate != null ? `
        <div class="card" style="margin-bottom:var(--space-5);">
          <div class="type-caption text-dim" style="margin-bottom:2px;">% graso estimado</div>
          <div class="type-title" style="font-size:26px;">${bodyFatEstimate.toFixed(1)}%</div>
          <div class="type-caption text-faint">Estimación orientativa (Jackson &amp; Pollock, 7 pliegues) — no es una medición médica.</div>
        </div>
      ` : ''}

      <div class="chart-container" style="height:180px; margin-bottom:var(--space-5);"><canvas id="sum-chart"></canvas></div>

      <div class="section-label">Historial</div>
      <div id="entry-list" class="list"></div>
    `}
  `;

  mount.querySelector('#manage-sites').addEventListener('click', () => openSitesManager(mount));
  mount.querySelector('#bulk-entry')?.addEventListener('click', () => openBulkEntrySheet(mount, sites));

  if (!sites.length) return;

  const points = sites.map((site, i) => ({
    site,
    name: site.name,
    instructions: site.instructions || SKINFOLD_POINTS_JP7[i]?.instructions || '',
  }));
  const latestBySite = {};
  if (currentSum) {
    for (const e of byDate[currentSum.date]) latestBySite[e.siteId] = e.valueMm;
  }

  mount.querySelector('#points-list').innerHTML = points.map((p, i) => `
    <div class="grouped-row" data-index="${i}" style="cursor:pointer;">
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <span class="icon-badge icon-badge--sm">${i + 1}</span>
        <span class="type-body" style="font-weight:600;">${escapeHtml(p.name)}</span>
      </div>
      <span class="type-caption text-faint">${latestBySite[p.site.id] != null ? `${latestBySite[p.site.id]} mm` : 'Sin dato'} ›</span>
    </div>
  `).join('');
  mount.querySelectorAll('#points-list [data-index]').forEach((row) => {
    row.addEventListener('click', () => {
      const p = points[Number(row.dataset.index)];
      openPointSheet(mount, p.site, p);
    });
  });

  renderSumChart(mount, sums);
  renderEntryList(mount, dates, byDate, sites);
}

function arrowFor(n) {
  if (n == null || Math.abs(n) < 0.5) return '→';
  return n > 0 ? '↑' : '↓';
}
function formatSigned(n) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}`;
}

function renderSumChart(mount, sums) {
  const canvas = mount.querySelector('#sum-chart');
  if (sumChartInstance) sumChartInstance.destroy();
  if (!sums.length) return;
  const colors = getChartThemeColors();
  sumChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: sums.map((s) => formatDateShort(s.date)),
      datasets: [{
        data: sums.map((s) => s.sum),
        borderColor: colors.accent,
        backgroundColor: colors.accentSoft,
        tension: 0.3, fill: true, pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: colors.ticks, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: colors.ticks }, grid: { color: colors.grid } },
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
        <div class="row" style="margin-bottom:8px;">
          <div class="type-body" style="font-weight:600;">${formatDate(date)}</div>
          <div class="type-caption text-faint">Suma: ${sum} mm</div>
        </div>
        ${entries.map((e) => {
          const site = sites.find((s) => s.id === e.siteId);
          return `<div class="row" style="font-size:14px; padding:4px 0;">
            <span class="text-dim">${escapeHtml(site?.name || '—')}</span>
            <span style="display:flex; align-items:center; gap:6px;">${e.valueMm} mm <button class="icon-btn sf-delete" data-id="${e.id}" style="width:26px;height:26px;font-size:13px;">✕</button></span>
          </div>`;
        }).join('')}
      </div>
    `;
  }).join('');

  list.querySelectorAll('.sf-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await openConfirmSheet('¿Eliminar este registro de pliegue?', { confirmLabel: 'Eliminar' });
      if (!ok) return;
      await repo.deleteSkinfoldEntry(btn.dataset.id);
      await renderSkinfold(mount);
    });
  });
}

// Sheet de un punto individual — nombre, instrucciones, último valor, campo nuevo.
async function openPointSheet(mount, site, meta) {
  const entries = await repo.listSkinfoldEntriesBySite(site.id);
  const last = entries[entries.length - 1];

  openSheet(`
    <h3 class="type-headline" style="margin-bottom:4px;">${escapeHtml(meta.name)}</h3>
    ${meta.instructions ? `<p class="type-caption text-dim" style="margin-bottom:16px;">${escapeHtml(meta.instructions)}</p>` : ''}
    ${last ? `<div class="type-caption text-faint" style="margin-bottom:12px;">Último valor: ${last.valueMm} mm · ${formatDate(last.date)}</div>` : ''}
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="p-date" value="${todayISO()}" />
    </div>
    <div class="field">
      <label class="label">Valor (mm)</label>
      <input type="number" inputmode="decimal" step="0.5" id="p-value" autofocus />
    </div>
    <button class="btn btn-primary btn-block" id="p-save">Guardar</button>
  `, {
    onMount: (sheet, close) => {
      sheet.querySelector('#p-save').addEventListener('click', async () => {
        const date = sheet.querySelector('#p-date').value;
        const value = sheet.querySelector('#p-value').value;
        if (!date || value === '') { toast('Fecha y valor son obligatorios'); return; }
        await repo.addSkinfoldEntry({ siteId: site.id, date, valueMm: Number(value) });
        close();
        await renderSkinfold(mount);
      });
    },
  });
}

function openSitesManager(mount) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:20px;">Puntos configurados</h3>
    <div id="sites-list" class="list" style="margin-bottom:var(--space-4);"></div>
    <div class="field">
      <label class="label">Nuevo punto</label>
      <input type="text" id="new-site-name" placeholder="Ej. Bíceps" />
    </div>
    <button class="btn btn-primary btn-block" id="add-site">Añadir punto</button>
  `, {
    onMount: async (sheet) => {
      async function refresh() {
        const sites = await repo.listSkinfoldSites();
        sheet.querySelector('#sites-list').innerHTML = sites.length
          ? `<div class="grouped-list">${sites.map((s, i) => `
              <div class="grouped-row" data-id="${s.id}">
                <span class="type-body">${i + 1}. ${escapeHtml(s.name)}</span>
                <button class="icon-btn site-delete" aria-label="Eliminar">✕</button>
              </div>
            `).join('')}</div>`
          : '<div class="type-body text-dim">Sin puntos configurados.</div>';
        sheet.querySelectorAll('.site-delete').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const ok = await openConfirmSheet('¿Eliminar este punto y su historial?', { confirmLabel: 'Eliminar' });
            if (!ok) return;
            await repo.deleteSkinfoldSite(btn.closest('[data-id]').dataset.id);
            await refresh();
            await renderSkinfold(mount);
          });
        });
      }
      sheet.querySelector('#add-site').addEventListener('click', async () => {
        const name = sheet.querySelector('#new-site-name').value.trim();
        if (!name) { toast('El nombre es obligatorio'); return; }
        await repo.createSkinfoldSite({ name });
        sheet.querySelector('#new-site-name').value = '';
        await refresh();
        await renderSkinfold(mount);
      });
      await refresh();
    },
  });
}

// Registro completo (los N puntos a la vez) — alternativa rápida a tocar
// cada punto individualmente en la silueta.
function openBulkEntrySheet(mount, sites) {
  openSheet(`
    <h3 class="type-headline" style="margin-bottom:16px;">Registro completo</h3>
    <div class="field">
      <label class="label">Fecha</label>
      <input type="date" id="f-date" value="${todayISO()}" />
    </div>
    ${sites.map((s) => `
      <div class="field">
        <label class="label">${escapeHtml(s.name)} (mm)</label>
        <input type="number" inputmode="decimal" step="0.5" class="site-input" data-site="${s.id}" />
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
