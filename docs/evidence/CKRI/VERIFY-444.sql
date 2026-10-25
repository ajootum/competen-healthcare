-- VERIFY 444 (READ-ONLY): CKRI governance enforcement. Run after each apply. Writes nothing.
-- Expected after a clean apply: ckri_partner_agreement with RLS on and 0 policies, 6 triggers, the 6 nullable
-- columns, the two CHECKs, the agreement functions not executable by anon or authenticated, and 0 agreements.
-- Existing ckri_purpose and ckri_research_project rows keep null in every new column.

select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname = 'ckri_partner_agreement';

select tgname, tgrelid::regclass as on_table from pg_trigger
 where tgname in ('ckri_purpose_basis_guard', 'ckri_partner_agreement_guard', 'ckri_partner_agreement_end',
                  'ckri_research_member_agreement_guard', 'ckri_research_project_ethics_guard', 'ckri_research_dataset_ethics_guard')
 order by tgname;

select table_name, column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and ((table_name = 'ckri_purpose' and column_name in ('lawful_basis', 'basis_decision_ref'))
    or (table_name = 'ckri_research_project' and column_name like 'ethics_exemption_%'))
 order by table_name, column_name;

select conname from pg_constraint where conname in ('ckri_purpose_basis_check', 'ckri_research_project_exemption_check', 'ckri_partner_agreement_check') order by conname;

select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p where p.proname in ('ckri_agreement_covers', 'ckri_expire_agreements') order by p.proname;

select 'ckri_partner_agreement' as t, count(*) from ckri_partner_agreement
union all select 'purposes with a basis', count(*) from ckri_purpose where lawful_basis is not null
union all select 'projects with an exemption', count(*) from ckri_research_project where ethics_exemption_ref is not null;

select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_name, ordinal_position)) as ckri_444_fingerprint
  from information_schema.columns where table_schema = 'public' and (table_name = 'ckri_partner_agreement'
   or (table_name = 'ckri_purpose' and column_name in ('lawful_basis', 'basis_decision_ref')) or (table_name = 'ckri_research_project' and column_name like 'ethics_exemption_%'));
