// Puente de solo lectura hacia el catálogo global de ejercicios
// (exercise_catalog, mismo proyecto Supabase que usa Tracker para su propia
// cuenta/sync) — ver Pegasus_Coach/supabase/migrations/0014_catalogo_ejercicios.sql
// y Pegasus_Coach/scripts/import-exercise-catalog.mjs. Tabla de SOLO LECTURA
// para toda la app (RLS: sin policy de escritura para el cliente, se rellena
// una única vez con ese script). A propósito NO pasa por repository.js/Dexie
// ni por la cola de sync — se lee en vivo, igual que pegasus-nutrition.js.
import { getSupabaseClient } from './supabase-client.js';

const TABLE = 'exercise_catalog';

function fromRow(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    equipment: r.equipment,
    instructions: r.instructions,
  };
}

// Sin sesión o sin red: se trata como "catálogo vacío" (la UI ya muestra un
// estado vacío razonable) en vez de propagar un error.
export async function searchExerciseCatalog(query, limit = 40) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    let q = supabase
      .from(TABLE)
      .select('id, name, category, equipment, instructions')
      .order('name', { ascending: true })
      .limit(limit);
    const texto = (query || '').trim();
    if (texto) q = q.ilike('name', `%${texto}%`);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(fromRow);
  } catch (err) {
    console.warn('No se pudo cargar el catálogo de ejercicios', err);
    return [];
  }
}
