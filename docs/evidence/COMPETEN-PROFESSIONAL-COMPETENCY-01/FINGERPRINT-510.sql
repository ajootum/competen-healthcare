-- FINGERPRINT 510 + 511. Read-only. Run before applying (PRE), after each application (F1, F2), after a rollback
-- (must equal PRE) and after re-applying (must equal F1). One row: the fingerprint and what it covers.
with t as (
  select unnest(array['competency_verification_method', 'competency_verification_method_version', 'competency_assessor_scope',
    'competency_verification_request', 'competency_verification_evidence', 'competency_verification_event', 'competency_verification_decision']) as name
), cols as (
  select string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), '|' order by c.table_name, c.ordinal_position) as s,
         count(*) as n
    from information_schema.columns c join t on t.name = c.table_name where c.table_schema = 'public'
), cons as (
  select string_agg(r.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid), '|' order by r.relname, k.conname) as s, count(*) as n
    from pg_constraint k join pg_class r on r.oid = k.conrelid join t on t.name = r.relname
), idx as (
  select string_agg(indexdef, '|' order by indexname) as s, count(*) as n from pg_indexes i join t on t.name = i.tablename where i.schemaname = 'public'
), trg as (
  select string_agg(r.relname || '.' || g.tgname, '|' order by r.relname, g.tgname) as s, count(*) as n
    from pg_trigger g join pg_class r on r.oid = g.tgrelid join t on t.name = r.relname where not g.tgisinternal
), pol as (
  select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, ''), '|' order by tablename, policyname) as s, count(*) as n
    from pg_policies p join t on t.name = p.tablename
), fns as (
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc), '|' order by p.proname) as s, count(*) as n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and (p.proname like 'competency_verification%' or p.proname like 'competency_assessor%' or p.proname like 'competency_method%'
         or p.proname = 'competency_appointment_holds' or p.proname in ('hq_capability_exclusions', 'hq_capability_sensitive_class'))
), auth as (
  select coalesce(string_agg(x, '|' order by x), '') as s, count(*) as n from (
    select 'cap:' || code || ':' || space as x from hq_capability where code like 'hq.competency.verification.%'
    union all select 'pos:' || code || ':' || space from hq_position where code in ('competency_verification_administrator', 'competency_assessor')
    union all select 'grant:' || position_code || ':' || capability_code from hq_position_capability
     where effective_to is null and (position_code in ('competency_verification_administrator', 'competency_assessor') or capability_code like 'hq.competency.verification.%')
  ) a
)
select left(md5(concat_ws('#', cols.s, cons.s, idx.s, trg.s, pol.s, fns.s, auth.s)), 8) as fingerprint,
       cols.n as columns, cons.n as constraints, idx.n as indexes, trg.n as triggers, pol.n as policies, fns.n as functions, auth.n as authority_rows,
       (select count(*) from hq_capability_exclusions()) as exclusion_pairs
  from cols, cons, idx, trg, pol, fns, auth;
