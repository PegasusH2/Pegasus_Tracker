// Cliente Supabase — capa de sincronización cloud, NO sustituye a Dexie/
// IndexedDB (que sigue siendo la fuente de verdad local, ver
// docs/supabase-sync-design.md). `supabase-js` se carga como script global
// vendorizado (js/lib/supabase.min.js), igual que Dexie/Chart.js, para poder
// precachearlo con el Service Worker y que la app siga funcionando offline.
//
// La "anon key" está diseñada por Supabase para ser pública — la protección
// real de los datos es Row Level Security en Postgres (ver
// supabase/schema.sql), NO el secreto de esta clave. Nunca debe usarse aquí
// la "service_role key" (esa sí es secreta y nunca debe salir del backend).
import { supabaseStorageAdapter } from './supabase-storage-adapter.js';

// EDITA ESTOS DOS VALORES tras crear tu proyecto en https://supabase.com y
// ejecutar supabase/schema.sql en su SQL editor (Settings > API > Project
// URL / anon public key). Vacíos por defecto = la app funciona en modo local
// puro (sin cuenta), exactamente igual que antes de esta función.
const DEFAULT_SUPABASE_URL = '';
const DEFAULT_SUPABASE_ANON_KEY = '';

let supabaseUrl = DEFAULT_SUPABASE_URL;
let supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY;
let client = null;

export function isSupabaseConfigured() {
  return !!supabaseUrl && !!supabaseAnonKey;
}

// Permite fijar las credenciales en tiempo de ejecución (usado por los tests
// con un cliente simulado, y disponible por si en el futuro se prefiere
// introducirlas desde Ajustes en vez de hardcodearlas aquí). Cambiar la
// configuración descarta el cliente en caché para que el siguiente
// getSupabaseClient() se cree con los valores nuevos.
export function configureSupabase(url, anonKey) {
  supabaseUrl = url || '';
  supabaseAnonKey = anonKey || '';
  client = null;
}

// Lazy: si no está configurado, ni siquiera se intenta crear el cliente —
// el resto de módulos de sync (auth.js, sync.js) comprueban
// isSupabaseConfigured() antes de llamar a esto y se comportan como "modo
// local" (no-op) si no lo está, en vez de lanzar en cada arranque de la app.
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: supabaseStorageAdapter,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
