-- Advisor: public.rls_auto_enable() is SECURITY DEFINER and executable by anon/authenticated.
-- Revoke EXECUTE so it cannot be called via PostgREST /rest/v1/rpc/rls_auto_enable.
-- Function may exist only on hosted projects (Supabase advisor); skip when absent.

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    revoke all on function public.rls_auto_enable() from public;
    revoke all on function public.rls_auto_enable() from anon;
    revoke all on function public.rls_auto_enable() from authenticated;
  end if;
end
$$;
