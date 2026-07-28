-- Random Jingle – Phase 2 Supabase schema
-- Run this once in your project's SQL editor (Supabase Dashboard -> SQL Editor).
-- Safe to re-run: every statement is idempotent (create-if-not-exists / drop-then-create policy).

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

-- ---------------------------------------------------------------------------
-- Realtime: let clients subscribe to postgres_changes for cross-device sync.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.jingles;

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
