-- =========================================================================
-- Petra Partnership Dashboard — initial schema for institutions, departments,
-- and agreements. Designed for Supabase (Postgres 15+).
--
-- After applying:
--   1. Run scripts/import_to_supabase.mjs to seed rows from data/*.json
--   2. Set js/supabase-client.js to use the project URL + anon key
--   3. The browser app subscribes to realtime events on `agreements`
-- =========================================================================

-- Lookup tables ------------------------------------------------------------

create table if not exists public.institutions (
  id                 text primary key,
  name               text not null,
  canonical_name     text,
  type               text,
  kind               text,
  country            text,
  city               text,
  address            text,
  institution_types  text[] default '{}',
  created_at         timestamptz not null default now()
);

create table if not exists public.departments (
  id          text primary key,
  short       text not null,
  name        text not null,
  is_faculty  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Agreements ---------------------------------------------------------------

create table if not exists public.agreements (
  id                   text primary key,
  code                 text,
  source_no            integer,
  kind                 text,
  title                text not null,
  type                 text not null default 'MoU',
  status               text not null default 'Drafting',
  institution_id       text references public.institutions(id) on delete set null,
  department_id        text references public.departments(id)  on delete set null,
  pic_user_id          uuid,
  implementing_unit    text,
  units                text[] default '{}',
  unit_department_ids  text[] default '{}',
  scope                text,
  scope_tags           text[] default '{}',
  institution_type     text[] default '{}',
  start_date           date,
  end_date             date,
  end_date_kind        text,
  end_date_raw         text,
  renewal_date         date,
  renewal_info_raw     text,
  realization          text,
  degree_program       jsonb,
  non_degree_program   jsonb,
  description          text,
  notes                text,
  tags                 text[] default '{}',
  new_partner          boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists agreements_status_idx        on public.agreements (status);
create index if not exists agreements_end_date_idx      on public.agreements (end_date);
create index if not exists agreements_institution_idx   on public.agreements (institution_id);
create index if not exists agreements_department_idx    on public.agreements (department_id);
create index if not exists agreements_type_idx          on public.agreements (type);

-- Auto-bump updated_at on every UPDATE -------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agreements_touch on public.agreements;
create trigger agreements_touch
  before update on public.agreements
  for each row execute function public.touch_updated_at();

-- Realtime publication -----------------------------------------------------
-- Supabase ships with a publication named `supabase_realtime`. Adding tables
-- to it streams INSERT/UPDATE/DELETE events to subscribed clients.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- agreements is the table the dashboard cares about most
    begin
      execute 'alter publication supabase_realtime add table public.agreements';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.institutions';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.departments';
    exception when duplicate_object then null;
    end;
  end if;
end$$;

-- Row Level Security -------------------------------------------------------
--
-- Read: open to everyone (matches the existing public guest dashboard).
-- Write: any signed-in (authenticated) user can write. Tighten this with a
-- roles table once you have multiple admins with different permissions.

alter table public.institutions enable row level security;
alter table public.departments  enable row level security;
alter table public.agreements   enable row level security;

drop policy if exists "read institutions"   on public.institutions;
drop policy if exists "read departments"    on public.departments;
drop policy if exists "read agreements"     on public.agreements;
drop policy if exists "write institutions"  on public.institutions;
drop policy if exists "write departments"   on public.departments;
drop policy if exists "write agreements"    on public.agreements;

create policy "read institutions"  on public.institutions for select using (true);
create policy "read departments"   on public.departments  for select using (true);
create policy "read agreements"    on public.agreements   for select using (true);

create policy "write institutions" on public.institutions
  for all to authenticated using (true) with check (true);

create policy "write departments"  on public.departments
  for all to authenticated using (true) with check (true);

create policy "write agreements"   on public.agreements
  for all to authenticated using (true) with check (true);
