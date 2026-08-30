// Relación entrenador-cliente con Pegasus Nutrition — tabla `trainer_links`
// en Supabase (ver supabase/migrations/002_nutrition_trainer_link.sql).
// Deliberadamente NO se espeja en Dexie/sync.js: vincular cuentas es una
// acción rara y exige estar online de todos modos (la invitación la crea
// Pegasus Nutrition, una app aparte), así que se consulta en vivo. Nunca
// hace de "fuente de verdad" para si algo es de solo lectura — eso lo decide
// siempre la fila en sí (assignedToClientId, ver repository.js#isReadOnlyForMe)
// más la política RLS correspondiente; esto solo sirve para el flujo de
// aceptar/ver/desvincular la relación.
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client.js';
import { getUser } from './auth.js';

// { id, trainerUserId, clientUserId, status, createdAt, updatedAt, role: 'trainer'|'client' }
function fromRow(row, myUserId) {
  return {
    id: row.id,
    trainerUserId: row.trainer_user_id,
    clientUserId: row.client_user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.trainer_user_id === myUserId ? 'trainer' : 'client',
  };
}

export async function listMyLinks() {
  if (!isSupabaseConfigured()) return [];
  const user = await getUser();
  if (!user) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('trainer_links')
    .select('*')
    .or(`trainer_user_id.eq.${user.id},client_user_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => fromRow(row, user.id));
}

// Solo el cliente acepta su propia invitación pendiente (pending -> active).
export async function acceptLink(linkId) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('trainer_links').update({ status: 'active' }).eq('id', linkId);
  if (error) throw error;
}

// Cualquiera de las dos partes puede desvincular (active/pending -> revoked).
export async function revokeLink(linkId) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('trainer_links').update({ status: 'revoked' }).eq('id', linkId);
  if (error) throw error;
}

export async function hasActiveTrainer() {
  const links = await listMyLinks();
  return links.some((l) => l.role === 'client' && l.status === 'active');
}
