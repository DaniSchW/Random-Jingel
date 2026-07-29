-- Random Jingle – Supabase schema (Phase 2 sync + Phase 3 language setting)
-- Run this once in your project's SQL editor (Supabase Dashboard -> SQL Editor).
-- Safe to re-run: every statement is idempotent. The SQL editor runs a pasted
-- script as a single transaction, so ANY non-idempotent statement failing
-- (e.g. a plain "alter publication ... add table" on a second run) rolls
-- back the entire script, including everything below it — that is why the
-- realtime publication changes are wrapped in existence checks rather than
-- run directly.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- Ids are client-generated UUIDs (crypto.randomUUID()) so the same id is used
-- in IndexedDB and in Supabase, which keeps sync a simple upsert-by-id.
-- updated_at is set and trusted client-side (device clock) on purpose: it is
-- the timestamp Last-Write-Wins compares against. There is no server trigger
-- overriding it.

create table if not exists public.categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jingles (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  color text,
  storage_path text,
  mime_type text,
  file_name text,
  sort_order integer not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per user: their preferred UI language (Phase 3). Same
-- client-timestamp-trusted updated_at / Last-Write-Wins convention as
-- categories/jingles.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'de',
  updated_at timestamptz not null default now()
);

create index if not exists categories_user_id_idx on public.categories (user_id);
create index if not exists jingles_user_id_idx on public.jingles (user_id);
create index if not exists jingles_category_id_idx on public.jingles (category_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: every user can only see/change their own rows.
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.jingles enable row level security;

drop policy if exists categories_select_own on public.categories;
create policy categories_select_own on public.categories
  for select using (auth.uid() = user_id);

drop policy if exists categories_insert_own on public.categories;
create policy categories_insert_own on public.categories
  for insert with check (auth.uid() = user_id);

drop policy if exists categories_update_own on public.categories;
create policy categories_update_own on public.categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists categories_delete_own on public.categories;
create policy categories_delete_own on public.categories
  for delete using (auth.uid() = user_id);

drop policy if exists jingles_select_own on public.jingles;
create policy jingles_select_own on public.jingles
  for select using (auth.uid() = user_id);

drop policy if exists jingles_insert_own on public.jingles;
create policy jingles_insert_own on public.jingles
  for insert with check (auth.uid() = user_id);

drop policy if exists jingles_update_own on public.jingles;
create policy jingles_update_own on public.jingles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists jingles_delete_own on public.jingles;
create policy jingles_delete_own on public.jingles
  for delete using (auth.uid() = user_id);

alter table public.user_settings enable row level security;

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private bucket for jingle audio, one folder per user
-- (path convention: "<user_id>/<jingle_id>.<ext>").
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('jingle-audio', 'jingle-audio', false)
on conflict (id) do nothing;

drop policy if exists jingle_audio_select_own on storage.objects;
create policy jingle_audio_select_own on storage.objects
  for select using (
    bucket_id = 'jingle-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists jingle_audio_insert_own on storage.objects;
create policy jingle_audio_insert_own on storage.objects
  for insert with check (
    bucket_id = 'jingle-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists jingle_audio_update_own on storage.objects;
create policy jingle_audio_update_own on storage.objects
  for update using (
    bucket_id = 'jingle-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists jingle_audio_delete_own on storage.objects;
create policy jingle_audio_delete_own on storage.objects
  for delete using (
    bucket_id = 'jingle-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- Realtime: let clients subscribe to postgres_changes for cross-device sync.
-- Placed last, with an explicit existence check, so a table already being a
-- publication member (which plain "add table" errors on) can never roll
-- back the tables/RLS/storage setup above.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table public.categories;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jingles'
  ) then
    alter publication supabase_realtime add table public.jingles;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin roles (Phase 4): every user gets a profile row with role='user' by
-- default. The admin dashboard is only reachable for role='admin', and that
-- is enforced here, server-side — the frontend hiding the nav button/route
-- is a UX nicety, not the security boundary. Nothing lets a client insert or
-- update its own profiles row (no insert/update policy below), so a normal
-- user cannot self-grant admin by calling the REST API directly.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- Auto-provision a profile row whenever a new auth user is created, so every
-- signed-up user has a role without any client-side insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: users created before this migration existed also get a profile.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- SECURITY DEFINER so it can read public.profiles regardless of the caller's
-- own row visibility. Used inside the profiles RLS policy and the RPC below
-- without recursion (a normal RLS-checked query on profiles from within a
-- profiles policy would recurse into itself; SECURITY DEFINER bypasses RLS
-- for this function's own internal query only).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (public.is_admin());

-- Admin dashboard data (Phase 4): a dedicated RPC instead of widening
-- jingles'/categories' RLS to "admins can read everything", so an admin
-- session only ever gets the specific aggregate the dashboard needs (email,
-- signup date, jingle count) — never raw per-user jingle rows (file names,
-- storage paths, ...). Re-checks is_admin() itself; do not rely on the
-- caller having already been screened by the frontend.
create or replace function public.admin_user_stats()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  jingle_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.' using errcode = '42501';
  end if;

  return query
    select
      p.id as user_id,
      p.email,
      p.created_at,
      count(j.id) filter (where j.deleted = false) as jingle_count
    from public.profiles p
    left join public.jingles j on j.user_id = p.id
    group by p.id, p.email, p.created_at
    order by p.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- One-time: promote a specific account to admin. Safe to re-run — it is a
-- plain UPDATE keyed on email, and a no-op if that email hasn't signed up
-- yet (0 rows affected; re-run this line after they sign in once).
-- ---------------------------------------------------------------------------
update public.profiles set role = 'admin' where email = 'service@web-schwarz.de';
