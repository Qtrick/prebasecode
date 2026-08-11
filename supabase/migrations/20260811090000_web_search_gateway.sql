-- Server-written, metadata-only LinkUp search quota ledger. Query text and result bodies are never persisted.
create table public.web_search_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id text not null unique,
  depth text not null check (depth in ('fast', 'standard', 'deep')),
  units integer not null check (units > 0),
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'failed')),
  source_count integer,
  created_at timestamptz not null default timezone('utc', now())
);

create index web_search_usage_user_created_idx on public.web_search_usage (user_id, created_at desc);
alter table public.web_search_usage enable row level security;
revoke all on table public.web_search_usage from anon, authenticated;

create or replace function public.reserve_web_search_quota(p_user_id uuid, p_request_id text, p_depth text)
returns void language plpgsql security definer set search_path = public as $$
declare
  requested_units integer := case p_depth when 'fast' then 1 when 'standard' then 2 when 'deep' then 8 else 0 end;
  recent_requests integer;
  daily_units integer;
begin
  if requested_units = 0 or length(p_request_id) > 128 then raise exception 'invalid quota request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select count(*), coalesce(sum(units), 0) into recent_requests, daily_units
  from public.web_search_usage where user_id = p_user_id and created_at >= timezone('utc', now()) - interval '60 seconds';
  if recent_requests >= 12 then raise exception 'rate limit exceeded'; end if;
  select coalesce(sum(units), 0) into daily_units from public.web_search_usage where user_id = p_user_id and created_at >= date_trunc('day', timezone('utc', now()));
  if daily_units + requested_units > 80 then raise exception 'daily quota exceeded'; end if;
  insert into public.web_search_usage (user_id, request_id, depth, units) values (p_user_id, p_request_id, p_depth, requested_units);
end;
$$;

revoke all on function public.reserve_web_search_quota(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_web_search_quota(uuid, text, text) to service_role;
