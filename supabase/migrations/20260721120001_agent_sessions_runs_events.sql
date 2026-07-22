-- PreBase: agent sessions, runs, events (opt-in cloud sync)

-- ---------------------------------------------------------------------------
-- agent_sessions
-- ---------------------------------------------------------------------------

create table public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  default_model text,
  default_mode text,
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index agent_sessions_user_id_idx on public.agent_sessions (user_id);
create index agent_sessions_updated_at_idx on public.agent_sessions (updated_at);

create trigger agent_sessions_set_updated_at
  before update on public.agent_sessions
  for each row
  execute function private.set_updated_at();

alter table public.agent_sessions enable row level security;

create policy agent_sessions_select_own
  on public.agent_sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy agent_sessions_insert_own
  on public.agent_sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy agent_sessions_update_own
  on public.agent_sessions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy agent_sessions_delete_own
  on public.agent_sessions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.agent_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_text text not null default '',
  mode text,
  model text,
  status text not null default 'pending',
  verification_status text,
  started_at timestamptz,
  completed_at timestamptz,
  error_summary text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint agent_runs_status_check check (
    status in ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);

create index agent_runs_session_id_idx on public.agent_runs (session_id);
create index agent_runs_user_id_idx on public.agent_runs (user_id);
create index agent_runs_updated_at_idx on public.agent_runs (updated_at);

create trigger agent_runs_set_updated_at
  before update on public.agent_runs
  for each row
  execute function private.set_updated_at();

alter table public.agent_runs enable row level security;

create policy agent_runs_select_own
  on public.agent_runs
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = agent_runs.session_id
        and s.user_id = (select auth.uid())
    )
  );

create policy agent_runs_insert_own
  on public.agent_runs
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = session_id
        and s.user_id = (select auth.uid())
    )
  );

create policy agent_runs_update_own
  on public.agent_runs
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = agent_runs.session_id
        and s.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = session_id
        and s.user_id = (select auth.uid())
    )
  );

create policy agent_runs_delete_own
  on public.agent_runs
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = agent_runs.session_id
        and s.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- agent_events (opt-in sync)
-- ---------------------------------------------------------------------------

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.agent_sessions (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  sequence_number bigint not null,
  event_type text not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_events_session_sequence_unique unique (session_id, sequence_number)
);

create index agent_events_session_id_idx on public.agent_events (session_id);
create index agent_events_user_id_idx on public.agent_events (user_id);
create index agent_events_run_id_idx on public.agent_events (run_id);

alter table public.agent_events enable row level security;

create policy agent_events_select_own
  on public.agent_events
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = agent_events.session_id
        and s.user_id = (select auth.uid())
    )
  );

create policy agent_events_insert_own
  on public.agent_events
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = session_id
        and s.user_id = (select auth.uid())
    )
    and (
      run_id is null
      or exists (
        select 1
        from public.agent_runs r
        where r.id = run_id
          and r.session_id = session_id
          and r.user_id = (select auth.uid())
      )
    )
  );

create policy agent_events_update_own
  on public.agent_events
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = agent_events.session_id
        and s.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = session_id
        and s.user_id = (select auth.uid())
    )
    and (
      run_id is null
      or exists (
        select 1
        from public.agent_runs r
        where r.id = run_id
          and r.session_id = session_id
          and r.user_id = (select auth.uid())
      )
    )
  );

create policy agent_events_delete_own
  on public.agent_events
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_sessions s
      where s.id = agent_events.session_id
        and s.user_id = (select auth.uid())
    )
  );
