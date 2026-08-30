// Puente de solo-red hacia el backend REAL de Pegasus Nutrition — mismo
// proyecto Supabase que usa Tracker para su propia cuenta/sync (ver
// supabase-client.js), pero un esquema ajeno (tablas nutrition_macro_plan,
// nutrition_mesociclo, nutrition_semana, nutrition_measurement, gestionado
// por esa otra app). A propósito NO pasa por repository.js/Dexie: estos
// datos nunca se guardan en local, siempre viven en Supabase y se leen en
// vivo — así no hay que replicar aquí la sincronización offline-first del
// resto de Tracker para un esquema que no es nuestro.
//
// Alcance actual: solo nutrition_macro_plan (macros). Periodización
// (mesociclo/semana) y nutrition_measurement quedan fuera — se crean/editan
// filas con semanaId=null, válido según el esquema real (columna nullable,
// ON DELETE SET NULL).
import { getSupabaseClient } from './supabase-client.js';
import { getUser } from './auth.js';

const TABLE = 'nutrition_macro_plan';

async function requireUser() {
  const user = await getUser();
  if (!user) {
    const err = new Error('No has iniciado sesión');
    err.code = 'no-session';
    throw err;
  }
  return user;
}

// Lecturas: sin sesión o sin red, se tratan como "no hay datos todavía" (la
// vista ya distingue "sin sesión" comprobando getUser() aparte) en vez de
// propagar un error — son estados esperados, no fallos de la app.
export async function pegasusListMacroPlans() {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('userId', user.id)
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.warn('No se pudo cargar nutrition_macro_plan', err);
    return [];
  }
}

export async function pegasusGetLatestMacroPlan() {
  const rows = await pegasusListMacroPlans();
  return rows[0] ?? null;
}

// Escrituras: a diferencia de las lecturas, sí lanzan en error — son
// acciones explícitas del usuario y debe enterarse si no se guardaron.
export async function pegasusCreateMacroPlan(fields) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('La sincronización no está configurada');
  const user = await requireUser();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...fields, userId: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function pegasusUpdateMacroPlan(id, changes) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('La sincronización no está configurada');
  await requireUser();
  const { data, error } = await supabase
    .from(TABLE)
    .update(changes)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function pegasusDeleteMacroPlan(id) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('La sincronización no está configurada');
  await requireUser();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
