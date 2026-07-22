-- PreBase: agent usage ledger (server-written; clients read own rows only)

create table public.agent_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id text not null,
  model text not null,
  input_units bigint not null default 0,
  output_units bigint not null default 0,
  estimated_cost numeric(12, 6),
  status text not null default 'recorded',
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_usage_request_id_unique unique (request_id),
  constraint agent_usage_status_check check (
    status in ('recorded', 'adjusted', 'voided')
  )
);

create index agent_usage_user_id_idx on public.agent_usage (user_id);
create index agent_usage_created_at_idx on public.agent_usage (created_at);

alter table public.agent_usage enable row level security;

-- Authenticated users may read their own usage rows only (no client writes).
create policy agent_usage_select_own
  on public.agent_usage
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
