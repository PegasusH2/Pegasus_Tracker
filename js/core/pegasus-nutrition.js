// Puente de solo-red hacia el backend REAL de Pegasus Nutrition — mismo
// proyecto Supabase que usa Tracker para su propia cuenta/sync (ver
// supabase-client.js), pero un esquema ajeno (tablas nutrition_macro_plan,
// nutrition_closed_diet_plan/_item, profiles, trainer_client_links,
// nutrition_mesociclo, nutrition_semana, nutrition_measurement, gestionado
// por esa otra app). A propósito NO pasa por repository.js/Dexie: estos
// datos nunca se guardan en local, siempre viven en Supabase y se leen en
// vivo — así no hay que replicar aquí la sincronización offline-first del
// resto de Tracker para un esquema que no es nuestro.
//
// Alcance actual: profiles.tipoDieta (para saber qué modo mostrar/permitir),
// nutrition_macro_plan y nutrition_closed_diet_plan/_item (los dos modelos
// nutricionales, mutuamente excluyentes según tipoDieta), y lectura de
// trainer_client_links (solo para saber si el usuario tiene un entrenador
// vinculado — Tracker nunca gestiona el vínculo en sí, eso vive en
// Nutrition). Periodización (mesociclo/semana) y nutrition_measurement
// siguen fuera de alcance — se crean/editan filas con semanaId=null, válido
// según el esquema real (columna nullable, ON DELETE SET NULL).
import { getSupabaseClient } from './supabase-client.js';
import { getUser } from './auth.js';

const TABLE = 'nutrition_macro_plan';
const CLOSED_DIET_PLAN_TABLE = 'nutrition_closed_diet_plan';
const CLOSED_DIET_ITEM_TABLE = 'nutrition_closed_diet_item';

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

// ---------------------------------------------------------------------
// Tipo de nutrición (profiles.tipoDieta) — decide si esta cuenta usa
// Macros o Dieta cerrada. Ambos modelos son excluyentes: solo uno está
// "activo" a la vez, aunque los datos históricos de ambos se conserven.
// ---------------------------------------------------------------------
export async function pegasusGetTipoDieta() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('tipoDieta, dietaCerradaDistingueDias')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { tipoDieta: data.tipoDieta, dietaCerradaDistingueDias: data.dietaCerradaDistingueDias };
  } catch (err) {
    console.warn('No se pudo cargar profiles.tipoDieta', err);
    return null;
  }
}

// Lanza si Supabase rechaza el cambio (p.ej. el trigger de Nutrition al
// tener un entrenador vinculado gestionando la nutrición) — la UI debe
// mostrar ese error, no tragárselo en silencio.
export async function pegasusUpdateTipoDieta(tipoDieta, dietaCerradaDistingueDias) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('La sincronización no está configurada');
  const user = await requireUser();
  const { error } = await supabase
    .from('profiles')
    .update({ tipoDieta, dietaCerradaDistingueDias })
    .eq('id', user.id);
  if (error) throw error;
}

// Vínculo aceptado donde el usuario actual es el CLIENTE — es decir, si
// tiene un entrenador que gestiona su nutrición. Nunca lanza: si falla o no
// hay sesión, se trata como "sin entrenador" (la RLS del lado de Nutrition
// es la protección real, esto solo decide qué UI mostrar).
export async function pegasusGetTrainerLink() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  try {
    const { data, error } = await supabase
      .from('trainer_client_links')
      .select('trainerId')
      .eq('clientId', user.id)
      .eq('status', 'accepted')
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  } catch (err) {
    console.warn('No se pudo comprobar trainer_client_links', err);
    return null;
  }
}

// ---------------------------------------------------------------------
// Dieta cerrada — mismo patrón que los macros: lecturas silenciosas,
// escrituras que lanzan. planId/items usan las columnas exactas del
// esquema real de Nutrition (ver nutrition_closed_diet_plan/_item).
// ---------------------------------------------------------------------
export async function pegasusListClosedDietPlans() {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  try {
    const { data, error } = await supabase
      .from(CLOSED_DIET_PLAN_TABLE)
      .select('*')
      .eq('userId', user.id)
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.warn('No se pudo cargar nutrition_closed_diet_plan', err);
    return [];
  }
}

export async function pegasusGetLatestClosedDietPlan() {
  const rows = await pegasusListClosedDietPlans();
  return rows[0] ?? null;
}

export async function pegasusCreateClosedDietPlan(fields) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('La sincronización no está configurada');
  const user = await requireUser();
  const { data, error } = await supabase
    .from(CLOSED_DIET_PLAN_TABLE)
    .insert({ ...fields, userId: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function pegasusDeleteClosedDietPlan(id) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('La sincronización no está configurada');
  await requireUser();
  const { error } = await supabase.from(CLOSED_DIET_PLAN_TABLE).delete().eq('id', id);
  if (error) throw error;
}

export async function pegasusListClosedDietItems(planId) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from(CLOSED_DIET_ITEM_TABLE)
      .select('*')
      .eq('planId', planId)
      .order('orden', { ascending: true });
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.warn('No se pudo cargar nutrition_closed_diet_item', err);
    return [];
  }
}

// Único método de escritura para los alimentos, igual que en Nutrition:
// borra todos los del plan y guarda la lista completa (reemplazo total).
export async function pegasusReplaceClosedDietItems(planId, items) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('La sincronización no está configurada');
  await requireUser();
  const { error: deleteError } = await supabase.from(CLOSED_DIET_ITEM_TABLE).delete().eq('planId', planId);
  if (deleteError) throw deleteError;
  if (items.length === 0) return;
  const { error: insertError } = await supabase
    .from(CLOSED_DIET_ITEM_TABLE)
    .insert(items.map((item) => ({ ...item, planId })));
  if (insertError) throw insertError;
}
