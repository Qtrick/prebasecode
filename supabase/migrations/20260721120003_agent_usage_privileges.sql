-- Defense in depth: clients may SELECT own usage rows only (RLS); no table-level writes.

revoke insert, update, delete, truncate on public.agent_usage from authenticated;
revoke insert, update, delete, truncate on public.agent_usage from anon;

grant select on public.agent_usage to authenticated;
