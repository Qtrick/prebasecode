-- Hybrid web-context quota: metadata-only. Query text and result bodies are never persisted.
alter table public.web_search_usage
  add column if not exists operation_kind text not null default 'search',
  add column if not exists enriched_count integer,
  add column if not exists linkup_ops integer,
  add column if not exists firecrawl_search_ops integer,
  add column if not exists firecrawl_scrape_ops integer;

alter table public.web_search_usage drop constraint if exists web_search_usage_operation_kind_check;
alter table public.web_search_usage
  add constraint web_search_usage_operation_kind_check
  check (operation_kind in ('search', 'fetch'));

create or replace function public.reserve_web_search_quota(
  p_user_id uuid,
  p_request_id text,
  p_depth text,
  p_operation text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  requested_units integer := case
    when p_operation = 'fetch' then 2
    when p_depth = 'fast' then 3
    when p_depth = 'standard' then 5
    when p_depth = 'deep' then 16
    else 0
  end;
  recent_requests integer;
  daily_units integer;
begin
  if requested_units = 0 or length(p_request_id) > 128 or p_operation not in ('search', 'fetch') then
    raise exception 'invalid quota request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select count(*) into recent_requests
  from public.web_search_usage where user_id = p_user_id and created_at >= timezone('utc', now()) - interval '60 seconds';
  if recent_requests >= 12 then raise exception 'rate limit exceeded'; end if;
  select coalesce(sum(units), 0) into daily_units
  from public.web_search_usage where user_id = p_user_id and created_at >= date_trunc('day', timezone('utc', now()));
  if daily_units + requested_units > 80 then raise exception 'daily quota exceeded'; end if;
  insert into public.web_search_usage (user_id, request_id, depth, units, operation_kind)
  values (p_user_id, p_request_id, p_depth, requested_units, p_operation);
end;
$$;

create or replace function public.reserve_web_search_quota(p_user_id uuid, p_request_id text, p_depth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.reserve_web_search_quota(p_user_id, p_request_id, p_depth, 'search');
end;
$$;

revoke all on function public.reserve_web_search_quota(uuid, text, text) from public, anon, authenticated;
revoke all on function public.reserve_web_search_quota(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_web_search_quota(uuid, text, text) to service_role;
grant execute on function public.reserve_web_search_quota(uuid, text, text, text) to service_role;
