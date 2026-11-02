create table if not exists public.workspace_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.workspace_states enable row level security;

create policy "Users can read their own workspace"
  on public.workspace_states for select to authenticated using (user_id = auth.uid());
create policy "Users can create their own workspace"
  on public.workspace_states for insert to authenticated with check (user_id = auth.uid());
create policy "Users can update their own workspace"
  on public.workspace_states for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.workspace_states to authenticated;