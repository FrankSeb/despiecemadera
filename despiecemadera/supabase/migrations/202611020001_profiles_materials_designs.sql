create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.materials (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  family text not null check (family in ('panel', 'wood')),
  thicknesses numeric[] not null default '{}',
  default_thickness numeric not null,
  sheet_length_mm integer,
  sheet_width_mm integer,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  check (is_shared = (owner_id is null))
);

alter table public.profiles enable row level security;
alter table public.materials enable row level security;

create policy "Users can read their profile"
  on public.profiles for select to authenticated using (id = auth.uid());
create policy "Users can update their profile"
  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Users can read shared and owned materials"
  on public.materials for select to authenticated using (is_shared or owner_id = auth.uid());
create policy "Users can create their own materials"
  on public.materials for insert to authenticated with check (owner_id = auth.uid() and not is_shared);
create policy "Users can update their own materials"
  on public.materials for update to authenticated using (owner_id = auth.uid() and not is_shared)
  with check (owner_id = auth.uid() and not is_shared);
create policy "Users can delete their own materials"
  on public.materials for delete to authenticated using (owner_id = auth.uid() and not is_shared);

create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  furniture_type text not null,
  dimensions jsonb not null,
  structure jsonb not null default '{}'::jsonb,
  parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photo_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  furniture_type text not null,
  dimensions jsonb not null,
  proposal jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.designs enable row level security;
alter table public.photo_analyses enable row level security;

create policy "Users can manage their designs"
  on public.designs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can read their photo analyses"
  on public.photo_analyses for select to authenticated using (user_id = auth.uid());
create policy "Users can create their photo analyses"
  on public.photo_analyses for insert to authenticated with check (user_id = auth.uid());

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.materials to authenticated;
grant select, insert, update, delete on public.designs to authenticated;
grant select, insert on public.photo_analyses to authenticated;

insert into public.materials (id, name, family, thicknesses, default_thickness, is_shared) values
  ('melamine', 'Melamina (aglomerado)', 'panel', array[8,10,12,15,16,18,19,22,25,30,36]::numeric[], 18, true),
  ('particle', 'Aglomerado crudo', 'panel', array[8,10,12,15,16,18,19,22,25,30]::numeric[], 18, true),
  ('mdf', 'MDF', 'panel', array[3,5.5,6,9,12,15,18,25,30]::numeric[], 18, true),
  ('hdf', 'HDF / hardboard', 'panel', array[2.5,3,4,5,6]::numeric[], 4, true),
  ('plywood', 'Contrachapado', 'panel', array[3,4,6,9,12,15,18,21,24]::numeric[], 18, true),
  ('osb', 'OSB', 'panel', array[6,9,11,12,15,18,22,25]::numeric[], 18, true),
  ('wood', 'Madera maciza (genérica)', 'wood', array[10,12,15,18,20,25,30,40,50,60]::numeric[], 20, true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('furniture-photos', 'furniture-photos', false)
on conflict (id) do nothing;

create policy "Users can upload their own furniture photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'furniture-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can read their own furniture photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'furniture-photos' and (storage.foldername(name))[1] = auth.uid()::text);