-- Pegasus Tracker — migración incremental 002
-- Añade: relación entrenador-cliente (trainer_links), rutinas de solo
-- lectura para un cliente vinculado, visibilidad de progreso/entreno
-- realizado para el entrenador vinculado, el módulo de Nutrición completo
-- (macros/dieta/histórico) y una tabla pequeña de preferencias de usuario
-- sincronizadas (hoy solo los toggles de Nutrición en Personalizar).
--
-- Cómo aplicar: pega ESTE ARCHIVO COMPLETO en el SQL Editor de Supabase,
-- en el mismo proyecto donde ya está schema.sql. Es seguro ejecutarlo más
-- de una vez (usa IF NOT EXISTS / DROP POLICY IF EXISTS en todo).
--
-- Diseño: ver el plan "Módulo Nutrición + relación entrenador-cliente" para
-- el razonamiento completo. Resumen del modelo de permisos:
--   - Una fila de rutina/nutrición asignada por un entrenador vive bajo
--     user_id = <entrenador> (el trigger existente ya lo fuerza así) y
--     assigned_to_client_id = <cliente> — el cliente la ve por la política
--     ampliada de abajo, nunca puede escribirla (ni desde la UI ni desde la
--     API directamente: el bloqueo real está en el `with check` de RLS).
--   - Progreso/entreno realizado siguen siendo 100% del cliente; solo se
--     amplía el SELECT para que el entrenador vinculado también los vea.

-- =======================================================================
-- 1. trainer_links — la relación en sí. Solo Pegasus Nutrition inserta
--    (envía la invitación); Tracker únicamente lee y actualiza el status
--    (aceptar: pending->active; desvincular: ->revoked).
-- =======================================================================
create table if not exists trainer_links (
  id uuid primary key,
  trainer_user_id uuid not null references auth.users(id) on delete cascade,
  client_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Tras crearse la fila, trainer_user_id/client_user_id quedan inmutables —
-- sin esto, la policy de update (que solo exige "ser una de las dos partes")
-- dejaría a cualquiera de ellas reasignar el vínculo a otra cuenta. También
-- refresca updated_at (esta tabla no usa pegasus_set_owner_and_timestamps,
-- porque aquí quien inserta es el entrenador, no el dueño de la fila).
create or replace function pegasus_lock_trainer_link_parties()
returns trigger
language plpgsql
security definer
as $$
begin
  new.trainer_user_id := old.trainer_user_id;
  new.client_user_id := old.client_user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_lock_trainer_link_parties on trainer_links;
create trigger trg_lock_trainer_link_parties before update on trainer_links
  for each row execute function pegasus_lock_trainer_link_parties();

alter table trainer_links enable row level security;
drop policy if exists trainer_links_select on trainer_links;
create policy trainer_links_select on trainer_links for select
  using (auth.uid() in (trainer_user_id, client_user_id));
drop policy if exists trainer_links_insert on trainer_links;
create policy trainer_links_insert on trainer_links for insert
  with check (auth.uid() = trainer_user_id);
drop policy if exists trainer_links_update on trainer_links;
create policy trainer_links_update on trainer_links for update
  using (auth.uid() in (trainer_user_id, client_user_id));
create index if not exists idx_trainer_links_trainer on trainer_links(trainer_user_id);
create index if not exists idx_trainer_links_client on trainer_links(client_user_id);

-- =======================================================================
-- 2. templates / template_exercises — solo lectura para el cliente asignado.
--    Sustituye la política única "pegasus_owner_all" (for all) por 3
--    políticas separadas: el select se amplía, insert/update siguen siendo
--    solo del dueño (quien creó la fila).
-- =======================================================================
alter table templates add column if not exists assigned_to_client_id uuid references auth.users(id);

drop policy if exists pegasus_owner_all on templates;
drop policy if exists templates_select on templates;
drop policy if exists templates_write on templates;
drop policy if exists templates_update on templates;
create policy templates_select on templates for select using (
  auth.uid() = user_id
  or (assigned_to_client_id = auth.uid()
      and exists (select 1 from trainer_links tl
                  where tl.trainer_user_id = templates.user_id
                    and tl.client_user_id = templates.assigned_to_client_id
                    and tl.status = 'active'))
);
create policy templates_write on templates for insert with check (auth.uid() = user_id);
create policy templates_update on templates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists pegasus_owner_all on template_exercises;
drop policy if exists template_exercises_select on template_exercises;
drop policy if exists template_exercises_write on template_exercises;
drop policy if exists template_exercises_update on template_exercises;
create policy template_exercises_select on template_exercises for select using (
  exists (select 1 from templates t where t.id = template_exercises.template_id and (
    t.user_id = auth.uid()
    or (t.assigned_to_client_id = auth.uid() and exists (
        select 1 from trainer_links tl
        where tl.trainer_user_id = t.user_id and tl.client_user_id = t.assigned_to_client_id and tl.status = 'active'
    ))
  ))
);
create policy template_exercises_write on template_exercises for insert with check (auth.uid() = user_id);
create policy template_exercises_update on template_exercises for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =======================================================================
-- 3. Progreso / entreno realizado — el entrenador vinculado puede LEER,
--    nunca escribir (insert/update sin cambios, solo el dueño).
-- =======================================================================
do $$
declare t text;
begin
  foreach t in array array['exercises','workouts','workout_exercises','sets','body_weight','measurements','skinfold_entries']
  loop
    execute format('drop policy if exists pegasus_owner_all on %I;', t);
    execute format('drop policy if exists %I on %I;', t || '_select', t);
    execute format('drop policy if exists %I on %I;', t || '_write', t);
    execute format('drop policy if exists %I on %I;', t || '_update', t);
    execute format(
      'create policy %I on %I for select using (auth.uid() = user_id or exists (select 1 from trainer_links tl where tl.trainer_user_id = auth.uid() and tl.client_user_id = %I.user_id and tl.status = ''active''));',
      t || '_select', t, t
    );
    execute format('create policy %I on %I for insert with check (auth.uid() = user_id);', t || '_write', t);
    execute format('create policy %I on %I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t || '_update', t);
  end loop;
end $$;

-- =======================================================================
-- 4. Nutrición — mismo patrón dueño=entrenador/asignado=cliente. El
--    "histórico" (punto 12 del encargo) sale gratis: cada versión nueva del
--    entrenador es una fila nueva (effective_date nueva), nunca un UPDATE
--    en sitio, así que el pasado queda intacto sin tabla aparte.
-- =======================================================================
create table if not exists nutrition_macro_targets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_to_client_id uuid references auth.users(id),
  device_id text,
  -- 'training' | 'rest' — entrenamiento y descanso son versionados/histórico
  -- COMPLETAMENTE independientes entre sí (ver punto 3 del encargo): "vigente"
  -- significa la fila más reciente por effective_date PARA ESE day_type.
  day_type text not null default 'training' check (day_type in ('training', 'rest')),
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  effective_date date not null,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists diet_plans (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_to_client_id uuid references auth.users(id),
  device_id text,
  day_type text not null default 'training' check (day_type in ('training', 'rest')),
  name text not null,
  description text default '',
  effective_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists diet_meals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  diet_plan_id uuid not null references diet_plans(id) on delete cascade,
  name text not null,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists diet_foods (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  meal_id uuid not null references diet_meals(id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text default 'g',
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  notes text default '',
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Por si esta migración se aplica por segunda vez sobre tablas ya creadas en
-- una pasada previa (create table if not exists no añade columnas nuevas).
alter table nutrition_macro_targets add column if not exists day_type text not null default 'training';
alter table diet_plans add column if not exists day_type text not null default 'training';

do $$
declare t text;
begin
  foreach t in array array['nutrition_macro_targets','diet_plans','diet_meals','diet_foods']
  loop
    execute format(
      'drop trigger if exists trg_owner_timestamps on %I; ' ||
      'create trigger trg_owner_timestamps before insert or update on %I ' ||
      'for each row execute function pegasus_set_owner_and_timestamps();',
      t, t
    );
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

drop policy if exists nutrition_macro_targets_select on nutrition_macro_targets;
create policy nutrition_macro_targets_select on nutrition_macro_targets for select using (
  auth.uid() = user_id
  or (assigned_to_client_id = auth.uid() and exists (
      select 1 from trainer_links tl
      where tl.trainer_user_id = nutrition_macro_targets.user_id
        and tl.client_user_id = nutrition_macro_targets.assigned_to_client_id
        and tl.status = 'active'
  ))
);
drop policy if exists nutrition_macro_targets_write on nutrition_macro_targets;
create policy nutrition_macro_targets_write on nutrition_macro_targets for insert with check (auth.uid() = user_id);
drop policy if exists nutrition_macro_targets_update on nutrition_macro_targets;
create policy nutrition_macro_targets_update on nutrition_macro_targets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists diet_plans_select on diet_plans;
create policy diet_plans_select on diet_plans for select using (
  auth.uid() = user_id
  or (assigned_to_client_id = auth.uid() and exists (
      select 1 from trainer_links tl
      where tl.trainer_user_id = diet_plans.user_id
        and tl.client_user_id = diet_plans.assigned_to_client_id
        and tl.status = 'active'
  ))
);
drop policy if exists diet_plans_write on diet_plans;
create policy diet_plans_write on diet_plans for insert with check (auth.uid() = user_id);
drop policy if exists diet_plans_update on diet_plans;
create policy diet_plans_update on diet_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists diet_meals_select on diet_meals;
create policy diet_meals_select on diet_meals for select using (
  exists (select 1 from diet_plans p where p.id = diet_meals.diet_plan_id and (
    p.user_id = auth.uid()
    or (p.assigned_to_client_id = auth.uid() and exists (
        select 1 from trainer_links tl
        where tl.trainer_user_id = p.user_id and tl.client_user_id = p.assigned_to_client_id and tl.status = 'active'
    ))
  ))
);
drop policy if exists diet_meals_write on diet_meals;
create policy diet_meals_write on diet_meals for insert with check (auth.uid() = user_id);
drop policy if exists diet_meals_update on diet_meals;
create policy diet_meals_update on diet_meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists diet_foods_select on diet_foods;
create policy diet_foods_select on diet_foods for select using (
  exists (select 1 from diet_meals m join diet_plans p on p.id = m.diet_plan_id where m.id = diet_foods.meal_id and (
    p.user_id = auth.uid()
    or (p.assigned_to_client_id = auth.uid() and exists (
        select 1 from trainer_links tl
        where tl.trainer_user_id = p.user_id and tl.client_user_id = p.assigned_to_client_id and tl.status = 'active'
    ))
  ))
);
drop policy if exists diet_foods_write on diet_foods;
create policy diet_foods_write on diet_foods for insert with check (auth.uid() = user_id);
drop policy if exists diet_foods_update on diet_foods;
create policy diet_foods_update on diet_foods for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =======================================================================
-- 5. user_preferences — solo lo nuevo que necesita viajar con la cuenta
--    (hoy: los toggles de Nutrición en Personalizar). El resto de Ajustes
--    sigue siendo local por dispositivo, sin cambios.
-- =======================================================================
create table if not exists user_preferences (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  key text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists idx_user_preferences_user_key on user_preferences(user_id, key) where deleted_at is null;

drop trigger if exists trg_owner_timestamps on user_preferences;
create trigger trg_owner_timestamps before insert or update on user_preferences
  for each row execute function pegasus_set_owner_and_timestamps();
alter table user_preferences enable row level security;
drop policy if exists user_preferences_all on user_preferences;
create policy user_preferences_all on user_preferences for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =======================================================================
-- 6. Índices para el pull incremental, igual criterio que schema.sql.
-- =======================================================================
create index if not exists idx_nutrition_macro_targets_user_updated on nutrition_macro_targets(user_id, updated_at);
create index if not exists idx_diet_plans_user_updated on diet_plans(user_id, updated_at);
create index if not exists idx_diet_meals_user_updated on diet_meals(user_id, updated_at);
create index if not exists idx_diet_meals_plan on diet_meals(diet_plan_id);
create index if not exists idx_diet_foods_user_updated on diet_foods(user_id, updated_at);
create index if not exists idx_diet_foods_meal on diet_foods(meal_id);
create index if not exists idx_user_preferences_user_updated on user_preferences(user_id, updated_at);
