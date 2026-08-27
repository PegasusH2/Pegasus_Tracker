// Onboarding de primer acceso — se renderiza directo sobre #app, FUERA del
// router normal (sin bottom-nav). Ver gate en js/app.js: solo se llama a
// runOnboarding() cuando hasExistingUserData() es false y el flag
// onboardingCompleted no existe todavía.
import * as repo from '../db/repository.js';
import * as settings from '../core/settings.js';
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import { toKg } from '../core/units.js';
import { todayISO } from '../core/format.js';
import { escapeHtml } from '../core/escape.js';
import { toast } from '../core/store.js';
import { openSheet } from '../core/ui.js';

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
          ${auth.isSupabaseConfigured() ? '<button class="btn btn-ghost btn-block" id="ob-signin" style="margin-top:8px;">¿Ya tienes cuenta? Iniciar sesión</button>' : ''}
        </div>
      `;
      app.querySelector('#ob-start').addEventListener('click', renderName);
      app.querySelector('#ob-signin')?.addEventListener('click', openSignInSheet);
    }

    // Dispositivo nuevo con una cuenta ya existente: en vez de crear un
    // perfil local vacío (nombre/peso) para luego tener que ir a Ajustes a
    // iniciar sesión a mano, se ofrece aquí mismo — al iniciar sesión se
    // sincronizan directamente los datos ya guardados en la cuenta. Como el
    // onboarding solo se ejecuta cuando el dispositivo no tiene datos locales
    // (ver hasExistingUserData() en app.js), no hace falta preguntar por
    // fusión de datos: no hay nada local que subir.
    function openSignInSheet() {
      openSheet(`
        <h3 class="type-headline" style="margin-bottom:6px;">Iniciar sesión</h3>
        <p class="type-body text-dim" style="margin-bottom:var(--space-4);">
          Tus datos se sincronizarán automáticamente en este dispositivo.
        </p>
        <div class="field">
          <label class="label">Email</label>
          <input type="email" id="ob-signin-email" autocomplete="email" autofocus />
        </div>
        <div class="field">
          <label class="label">Contraseña</label>
          <input type="password" id="ob-signin-password" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary btn-block" id="ob-signin-btn">Iniciar sesión</button>
      `, {
        onMount: (sheet, close) => {
          const btn = sheet.querySelector('#ob-signin-btn');
          const originalLabel = btn.textContent;
          btn.addEventListener('click', async () => {
            const email = sheet.querySelector('#ob-signin-email').value.trim();
            const password = sheet.querySelector('#ob-signin-password').value;
            if (!email || !password) { toast('Escribe email y contraseña'); return; }
            btn.disabled = true;
            btn.textContent = 'Iniciando sesión…';
            try {
              await auth.signIn(email, password);
              close();
              toast('Sincronizando tus datos…');
              await settings.setLocalDataMigrated(true);
              await settings.setOnboardingCompleted(true);
              await sync.syncNow({ manual: true });
              toast('Datos sincronizados');
              resolve();
            } catch (err) {
              toast(auth.authErrorMessage(err));
              btn.disabled = false;
              btn.textContent = originalLabel;
            }
          });
        },
      });
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
      app.querySelector('#ob-finish').addEventListener('click', async (e) => {
        const raw = app.querySelector('#ob-weight').value;
        const weightKg = toKg(raw, state.weightUnit);
        if (!weightKg || weightKg <= 0) { toast('Introduce tu peso para continuar'); return; }

        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await repo.addBodyWeight({ date: todayISO(), weightKg });
          await settings.setUserName(state.name);
          await settings.setOnboardingCompleted(true);
          resolve();
        } catch (err) {
          console.error('Error al finalizar el onboarding', err);
          toast('No se ha podido guardar. Inténtalo de nuevo.');
          btn.disabled = false;
        }
      });
    }
  });
}
