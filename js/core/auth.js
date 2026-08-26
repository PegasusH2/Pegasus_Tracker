// Autenticación de cuenta (email + contraseña) sobre Supabase Auth. Pegasus
// sigue funcionando sin cuenta ("modo local") — estas funciones solo se usan
// desde la pantalla Ajustes > Cuenta y sincronización; ninguna otra parte de
// la app depende de que exista sesión.
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client.js';

export { isSupabaseConfigured };

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

// cb(session|null) — se llama de inmediato con el estado actual y luego en
// cada cambio (login, logout, refresh de token). Devuelve una función para
// des-suscribirse.
export function onAuthStateChange(cb) {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
