-- PreBase: Agent gateway quota and rate-limiting function (server-side only)

create or replace function public.reserve_agent_quota(
  p_user_id uuid,
  p_request_id text,
  p_model text,
  p_estimated_units bigint default 1000
)
returns void language plpgsql security definer set search_path = public as $$
declare
  recent_requests integer;
  daily_requests integer;
begin
  if length(p_request_id) > 128 or length(p_model) > 64 then
    raise exception 'invalid quota request';
  end if;

  -- Atomic serialization per user to prevent concurrency races
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  -- Sliding window rate limit: max 30 requests per minute
  select count(*) into recent_requests
  from public.agent_usage
  where user_id = p_user_id
    and created_at >= timezone('utc', now()) - interval '60 seconds';

  if recent_requests >= 30 then
    raise exception 'rate limit exceeded';
  end if;

  -- Daily request limit: max 500 requests per day for hosted gateway
  select count(*) into daily_requests
  from public.agent_usage
  where user_id = p_user_id
    and created_at >= date_trunc('day', timezone('utc', now()));

  if daily_requests >= 500 then
    raise exception 'daily quota exceeded';
  end if;

  -- Record initial usage entry with 'recorded' status
  insert into public.agent_usage (
    user_id,
    request_id,
    model,
    input_units,
    output_units,
    status
  ) values (
    p_user_id,
    p_request_id,
    p_model,
    coalesce(p_estimated_units, 0),
    0,
    'recorded'
  );
end;
$$;

revoke all on function public.reserve_agent_quota(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.reserve_agent_quota(uuid, text, text, bigint) to service_role;
