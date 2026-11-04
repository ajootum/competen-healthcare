-- VERIFY-975-prod (SALE-2026-11 R3, the learning workspace). STRUCTURE ONLY: reads the catalogue, writes nothing,
-- reads no learner row. For the owner to run in the production SQL editor AFTER applying 975 (separate owner GO).
-- APPLY THIS FILE WHOLE (it holds a DO block). Passing = "Success. No rows returned" with the notice VERIFY-975-prod: PASS.
do $$
declare
  def text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'individual_learning_plan_event_check'
            and conrelid = 'public.individual_learning_plan_event'::regclass);
  if def is null or def not like '%next_action%' or def not like '%proposal%' or def not like '%topic_postponed%'
     or def not like '%recommendation_declined%' or def not like '%reflection%' or def not like '%settings_change%'
     or def not like '%auto_adjust%' or def not like '%8000%' or def not like '%undone%' then
    raise exception 'VERIFY-975-prod: the plan event CHECK does not carry next_action beside every 840 kind, status and budget';
  end if;
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'individual_scholar_note_kind_check'
            and conrelid = 'public.individual_scholar_note'::regclass);
  if def is null or def not like '%summary%' or def not like '%bookmark%' or def not like '%highlight%' or def not like '%500%' or def not like '%4000%' then
    raise exception 'VERIFY-975-prod: the note kind CHECK does not carry summary beside the 820 kinds';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_note'::regclass and contype = 'c') <> 2 then
    raise exception 'VERIFY-975-prod: expected exactly two CHECK constraints on individual_scholar_note';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_learning_plan_event'::regclass and contype = 'c') <> 1 then
    raise exception 'VERIFY-975-prod: expected exactly one CHECK constraint on individual_learning_plan_event';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'individual_scholar_workspace_975' and not p.prosecdef and p.provolatile = 's') then
    raise exception 'VERIFY-975-prod: marker function missing, security definer or not stable';
  end if;
  if not has_function_privilege('service_role', 'public.individual_scholar_workspace_975()', 'execute')
     or has_function_privilege('anon', 'public.individual_scholar_workspace_975()', 'execute')
     or has_function_privilege('authenticated', 'public.individual_scholar_workspace_975()', 'execute') then
    raise exception 'VERIFY-975-prod: marker execute must be service_role only';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.individual_scholar_note'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.individual_learning_plan_event'::regclass) then
    raise exception 'VERIFY-975-prod: RLS is not enabled on both tables';
  end if;
  raise notice 'VERIFY-975-prod: PASS';
end $$;
