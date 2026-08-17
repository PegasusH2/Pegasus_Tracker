// Onboarding de primer acceso — se renderiza directo sobre #app, FUERA del
// router normal (sin bottom-nav). Ver gate en js/app.js: solo se llama a
// runOnboarding() cuando hasExistingUserData() es false y el flag
// onboardingCompleted no existe todavía.
import * as repo from '../db/repository.js';
import * as settings from '../core/settings.js';
import { toKg } from '../core/units.js';
import { todayISO } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { toast } from '../core/store.js';

export async function hasExistingUserData() {
  const [firstWeight, workouts] = await Promise.all([
    repo.getFirstBodyWeight(),
    repo.listWorkouts({ limit: 1 }),
  ]);
  return !!firstWeight || workouts.length > 0;
}

export function runOnboarding() {
  const app = document.getElementById('app');
  const enabledUnits = settings.getWeightUnitsEnabled();
  const defaultUnit = enabledUnits.kg ? 'kg' : 'lb';
  const state = { name: '', weightUnit: defaultUnit };

  return new Promise((resolve) => {
    renderWelcome();

    function renderWelcome() {
      app.innerHTML = `
        <div class="onboarding-screen brand-splash view-enter">
          <div class="onboarding-body brand-intro">
            <img src="icons/icon-512.png" alt="Pegasus Tracker" class="brand-logo" />
            <div class="brand-wordmark">PEGASUS</div>
            <p class="brand-tagline">TRAIN <span class="brand-dot">&bull;</span> TRACK <span class="brand-dot">&bull;</span> PROGRESS</p>
          </div>
          <button class="btn btn-primary btn-block" id="ob-start">Empezar</button>
        </div>
      `;
      app.querySelector('#ob-start').addEventListener('click', renderName);
    }

    function renderName() {
      app.innerHTML = `
        <div class="onboarding-screen view-enter">
          <div class="onboarding-body">
            <div class="type-title" style="margin-bottom:var(--space-5);">¿Cómo te llamas?</div>
            <div class="field">
              <input type="text" id="ob-name" placeholder="Tu nombre" value="${escapeHtml(state.name)}" autofocus />
            </div>
          </div>
          <button class="btn btn-primary btn-block" id="ob-continue">Continuar</button>
        </div>
      `;
      const input = app.querySelector('#ob-name');
      const go = () => {
        const name = input.value.trim();
        if (!name) { toast('Escribe tu nombre para continuar'); return; }
        state.name = name;
        renderWeight();
      };
      app.querySelector('#ob-continue').addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }

    function renderWeight() {
      const showToggle = enabledUnits.kg && enabledUnits.lb;
      app.innerHTML = `
        <div class="onboarding-screen view-enter">
          <div class="onboarding-body">
            <div class="type-title" style="margin-bottom:var(--space-5);">¿Cuál es tu peso actual?</div>
            ${showToggle ? `
              <div class="segmented" id="ob-unit-toggle" style="margin-bottom:var(--space-4);">
                <button type="button" class="seg ${state.weightUnit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
                <button type="button" class="seg ${state.weightUnit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
              </div>
            ` : ''}
            <div class="field row" style="align-items:baseline; gap:var(--space-3);">
              <input type="number" inputmode="decimal" step="0.1" id="ob-weight" placeholder="0" autofocus style="flex:1;" />
              <span class="type-headline text-dim" id="ob-weight-unit">${state.weightUnit}</span>
            </div>
          </div>
          <button class="btn btn-primary btn-block" id="ob-finish">Continuar</button>
        </div>
      `;
      app.querySelector('#ob-unit-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-unit]');
        if (!btn) return;
        state.weightUnit = btn.dataset.unit;
        app.querySelectorAll('#ob-unit-toggle .seg').forEach((b) => b.classList.toggle('active', b === btn));
        app.querySelector('#ob-weight-unit').textContent = state.weightUnit;
      });
      app.querySelector('#ob-finish').addEventListener('click', async () => {
        const raw = app.querySelector('#ob-weight').value;
        const weightKg = toKg(raw, state.weightUnit);
        if (!weightKg || weightKg <= 0) { toast('Introduce tu peso para continuar'); return; }

        await repo.addBodyWeight({ date: todayISO(), weightKg });
        await settings.setUserName(state.name);
        await settings.setOnboardingCompleted(true);
        resolve();
      });
    }
  });
}
