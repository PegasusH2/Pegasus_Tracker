// Autenticación de cuenta (email + contraseña) sobre Supabase Auth. Pegasus
// sigue funcionando sin cuenta ("modo local") — estas funciones solo se usan
// desde la pantalla Ajustes > Cuenta y sincronización; ninguna otra parte de
// la app depende de que exista sesión.
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client.js';
import { emit } from './store.js';
import { WORKER_URL, APP_SHARED_TOKEN } from './ai-import.js';

export { isSupabaseConfigured };

// Mensaje de error legible compartido por cualquier pantalla que use
// email+contraseña (Ajustes > Cuenta y el paso de "iniciar sesión" del
// onboarding en un dispositivo nuevo).
export function authErrorMessage(err) {
  const msg = String(err?.message || err || '');
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos';
  if (/already registered|already exists/i.test(msg)) return 'Ya existe una cuenta con ese email';
  if (/password/i.test(msg) && /(least|short|6)/i.test(msg)) return 'La contraseña es demasiado corta (mínimo 6 caracteres)';
  if (err?.status === 429 || /rate limit|too many requests|security purposes/i.test(msg)) return 'Demasiados intentos — espera un poco antes de volver a intentarlo';
  if (msg === 'SYNC_NOT_CONFIGURED') return 'La sincronización no está configurada';
  if (msg === 'WORKER_NOT_CONFIGURED') return 'Eliminar cuenta no está configurado todavía';
  if (msg === 'RATE_LIMITED') return 'Demasiados intentos — espera un poco antes de volver a intentarlo';
  if (msg === 'NETWORK_ERROR') return 'No se pudo conectar con el servidor';
  if (msg === 'DELETE_FAILED') return 'No se pudo eliminar la cuenta. Inténtalo de nuevo';
  if (msg === 'NO_SESSION') return 'No has iniciado sesión';
  return 'No se pudo completar la operación';
}

export async function signUp(email, password) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('SYNC_NOT_CONFIGURED');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('SYNC_NOT_CONFIGURED');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

// keepLocalData: true (por defecto) — cerrar sesión NUNCA borra datos
// locales por sí solo; borrarlos es una acción aparte y explícita en la UI
// (ver js/views/settings-account.js), nunca un efecto secundario de esto.
export async function signOut() {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Borra la cuenta de Supabase Auth (y en cascada TODOS sus datos remotos, ver
// worker/index.js) a través del Worker propio — el cliente nunca tiene la
// service_role key necesaria para borrar un usuario de Supabase, así que este
// paso no puede hacerse directamente desde aquí. No toca los datos LOCALES de
// este dispositivo: la pantalla que llama a esto decide si también los borra
// (mismo patrón que cerrar sesión, ver js/views/settings-account.js).
export async function deleteAccount() {
  const session = await getSession();
  if (!session) throw new Error('NO_SESSION');
  if (!WORKER_URL) throw new Error('WORKER_NOT_CONFIGURED');

  let res;
  try {
    res = await fetch(`${WORKER_URL}/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': APP_SHARED_TOKEN,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  } catch {
    throw new Error('NETWORK_ERROR');
  }
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (res.status === 503) throw new Error('WORKER_NOT_CONFIGURED');
  if (!res.ok) throw new Error('DELETE_FAILED');

  const supabase = getSupabaseClient();
  if (supabase) {
    // La cuenta ya no existe en el servidor en este punto — signOut aquí solo
    // limpia los tokens guardados localmente, puede fallar sin que importe.
    try { await supabase.auth.signOut(); } catch { /* ya no hay nada que cerrar en el servidor */ }
  }
}

export async function getSession() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

// Envía el email de "restablecer contraseña". Deliberadamente no distingue
// en el resultado si el email existe o no (mismo mensaje siempre en la UI) —
// evita que alguien use este formulario para averiguar qué emails tienen
// cuenta. redirectTo apunta a la raíz de la app (sin hash): Supabase añade
// ahí un "?code=..." que se procesa solo al cargar (ver supabase-client.js).
export async function resetPasswordForEmail(email) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('SYNC_NOT_CONFIGURED');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

// Solo tiene sentido llamarla mientras isPasswordRecoveryPending() es true
// (sesión temporal de recuperación, ver más abajo).
export async function updatePassword(newPassword) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('SYNC_NOT_CONFIGURED');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  passwordRecoveryPending = false;
}

// cb(session|null) — se llama de inmediato con el estado actual y luego en
// cada cambio (login, logout, refresh de token). Devuelve una función para
// des-suscribirse.
export function onAuthStateChange(cb) {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

// ---------- Recuperación de contraseña ----------
// Al volver del enlace del email, Supabase (ya con detectSessionInUrl+PKCE,
// ver supabase-client.js) procesa el "?code=..." de forma asíncrona y
// dispara el evento 'PASSWORD_RECOVERY'. emit('auth:recovery') avisa a
// quien esté escuchando (js/app.js navega a Ajustes > Cuenta; la propia
// pantalla se repinta si ya estaba montada) sea cual sea el momento en que
// realmente llegue el evento.
let passwordRecoveryPending = false;
let listenerInitialized = false;

export function isPasswordRecoveryPending() {
  return passwordRecoveryPending;
}

export function clearPasswordRecoveryPending() {
  passwordRecoveryPending = false;
}

// Se llama explícitamente desde el arranque de la app (js/app.js) — NUNCA
// como efecto secundario a nivel de módulo: en los tests (Node) `window`/
// `window.supabase` todavía no existen en el momento en que este archivo se
// importa, y crear el cliente ahí rompería la suite entera al importar.
export function initAuthListener() {
  if (listenerInitialized) return;
  listenerInitialized = true;
  const supabase = getSupabaseClient();
  if (!supabase) return;
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      passwordRecoveryPending = true;
      emit('auth:recovery');
    }
  });
}
