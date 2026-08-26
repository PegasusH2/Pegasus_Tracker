-- Pegasus Tracker — esquema de sincronización cloud (Supabase / Postgres)
--
-- Cómo usar este archivo:
--   1. Crea un proyecto en https://supabase.com (gratis).
--   2. Abre el SQL Editor del proyecto y pega TODO este archivo, de una vez.
--   3. Copia la "Project URL" y la "anon public" key (Settings > API) en
--      js/core/supabase-client.js (SUPABASE_URL / SUPABASE_ANON_KEY).
--   4. NUNCA copies la "service_role" key a ningún archivo del frontend.
--
-- Estas 11 tablas son el espejo remoto de las 11 tablas sincronizables de
-- IndexedDB (ver js/db/schema.js: SYNCED_TABLES, y
-- docs/supabase-sync-design.md para la decisión de alcance). Cada fila usa
-- el MISMO id (uuid) que su fila local en Dexie — no hay remapeo de ids.
--
-- Convenciones comunes a las 11 tablas:
--   id           uuid primary key      — generado en el cliente (crypto.randomUUID())
--   user_id      uuid not null         — forzado por trigger, NUNCA por lo que mande el cliente
--   device_id    text                  — solo informativo/depuración, no forma parte de ninguna decisión de seguridad
--   created_at   timestamptz not null  — asignado por Postgres en el INSERT
--   updated_at   timestamptz not null  — reasignado por Postgres en cada UPDATE (nunca por el reloj del cliente)
--   deleted_at   timestamptz null      — tombstone: NULL = viva, con fecha = borrada (ver punto 13 del diseño)
--
-- Seguridad: Row Level Security se activa en las 11 tablas y es la única
-- barrera real — el cliente JS nunca debe ser el único filtro de "esto es
-- mío". auth.uid() vive en el JWT emitido por Supabase Auth, no lo controla
-- el cliente.

-- ---------------------------------------------------------------------
-- Función y trigger compartidos: fuerza user_id = auth.uid() en INSERT y
-- created_at/updated_at asignados por el servidor, no por el cliente.
-- ---------------------------------------------------------------------
create or replace function pegasus_set_owner_and_timestamps()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' then
    new.user_id := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  elsif TG_OP = 'UPDATE' then
    new.user_id := old.user_id;        -- no se puede "regalar" una fila a otro usuario
    new.created_at := old.created_at;  -- inmutable tras crearse
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

create table if not exists exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  name text not null,
  muscle_group text default '',
  notes text default '',
  load_mode text default 'total',
  equipment_type text default 'other',
  default_bar_id uuid,           -- sin FK: `bars` es local al dispositivo, no se sincroniza
  archived boolean default false,
  is_favorite boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  name text not null,
  icon text default 'pierna',
  description text default '',
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists measurement_types (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  name text not null,
  unit text default 'cm',
  bilateral boolean default false,
  enabled boolean default true,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists skinfold_sites (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  name text not null,
  instructions text default '',
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists workouts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  name text,
  date date not null,
  notes text default '',
  completed boolean default false,
  template_id uuid references templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists workout_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  workout_id uuid not null references workouts(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  sort_order integer default 0,
  notes text default '',
  target_reps integer,
  target_reps_min integer,
  target_reps_max integer,
  target_rir integer,
  target_rest_seconds integer,
  target_reps_sequence jsonb,
  target_weight_sequence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists sets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  workout_exercise_id uuid not null references workout_exercises(id) on delete cascade,
  set_number integer not null,
  weight numeric,
  weight_kg_part numeric,
  weight_lb_part numeric,
  reps integer,
  rir integer,
  rpe integer,
  rest_seconds numeric,
  notes text default '',
  type text default 'normal',
  rest_pause_extra jsonb,
  drop_steps jsonb,
  bar_weight_kg numeric,
  plate_weight_per_side_kg numeric,
  added_weight_kg numeric,
  done boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists template_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  template_id uuid not null references templates(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  sort_order integer default 0,
  target_sets integer default 3,
  target_reps integer,
  target_reps_min integer,
  target_reps_max integer,
  target_rir integer,
  target_rest_seconds integer,
  target_reps_sequence jsonb,
  target_weight_sequence jsonb,
  notes text default '',
  default_set_type text default 'normal',
  default_last_set_only boolean default false,
  default_rest_pause_extra jsonb,
  default_drop_steps jsonb,
  raw_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists body_weight (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  date date not null,
  weight_kg numeric not null,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists measurements (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  type_id uuid not null references measurement_types(id) on delete cascade,
  date date not null,
  value numeric,
  value_left numeric,
  value_right numeric,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists skinfold_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  site_id uuid not null references skinfold_sites(id) on delete cascade,
  date date not null,
  value_mm numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------
-- Triggers (uno por tabla, misma función para todas)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'exercises', 'templates', 'measurement_types', 'skinfold_sites',
    'workouts', 'workout_exercises', 'sets', 'template_exercises',
    'body_weight', 'measurements', 'skinfold_entries'
  ]
  loop
    execute format(
      'drop trigger if exists trg_owner_timestamps on %I; ' ||
      'create trigger trg_owner_timestamps before insert or update on %I ' ||
      'for each row execute function pegasus_set_owner_and_timestamps();',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: cada usuario solo ve/escribe sus propias filas. Se
-- aplica a TODAS las operaciones (select/insert/update) — no hay policy de
-- delete porque el borrado siempre es un UPDATE (deleted_at), nunca un
-- DELETE real desde el cliente (ver punto 13 del diseño; la limpieza física
-- de tombstones antiguos, si se hace algún día, es un job de servidor con
-- privilegios de service_role, fuera del alcance de RLS de cliente).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'exercises', 'templates', 'measurement_types', 'skinfold_sites',
    'workouts', 'workout_exercises', 'sets', 'template_exercises',
    'body_weight', 'measurements', 'skinfold_entries'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists pegasus_owner_all on %I;', t);
    execute format(
      'create policy pegasus_owner_all on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Índices para el pull incremental (updated_at > watermark, por usuario) y
-- para los joins más frecuentes.
-- ---------------------------------------------------------------------
create index if not exists idx_exercises_user_updated on exercises (user_id, updated_at);
create index if not exists idx_templates_user_updated on templates (user_id, updated_at);
create index if not exists idx_measurement_types_user_updated on measurement_types (user_id, updated_at);
create index if not exists idx_skinfold_sites_user_updated on skinfold_sites (user_id, updated_at);
create index if not exists idx_workouts_user_updated on workouts (user_id, updated_at);
create index if not exists idx_workout_exercises_user_updated on workout_exercises (user_id, updated_at);
create index if not exists idx_workout_exercises_workout on workout_exercises (workout_id);
create index if not exists idx_sets_user_updated on sets (user_id, updated_at);
create index if not exists idx_sets_workout_exercise on sets (workout_exercise_id);
create index if not exists idx_template_exercises_user_updated on template_exercises (user_id, updated_at);
create index if not exists idx_template_exercises_template on template_exercises (template_id);
create index if not exists idx_body_weight_user_updated on body_weight (user_id, updated_at);
create index if not exists idx_measurements_user_updated on measurements (user_id, updated_at);
create index if not exists idx_measurements_type on measurements (type_id);
create index if not exists idx_skinfold_entries_user_updated on skinfold_entries (user_id, updated_at);
create index if not exists idx_skinfold_entries_site on skinfold_entries (site_id);
