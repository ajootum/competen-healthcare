-- VERIFY 530 (read-only). COMPETEN-PROFESSIONAL-EVALUATION-01, Professional Stage 6. Every query only reads.

-- 1. the four new tables: RLS on, exactly one policy, a SELECT one (expect 4 rows, each true, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c
 where c.relkind = 'r' and c.relname in ('individual_professional_evaluation', 'individual_professional_evaluation_annotation',
   'individual_professional_evaluation_decision', 'individual_professional_share_evaluation')
 order by c.relname;

-- 2. the three append-only triggers (expect 3)
select tgname from pg_trigger
 where tgname in ('trg_individual_professional_evaluation_append_only', 'trg_individual_professional_evaluation_annotation_append_only',
   'trg_individual_professional_evaluation_decision_append_only')
 order by tgname;

-- 3. the one function, with the cascade path (expect 1 row, true)
select proname, prosrc like '%pg_trigger_depth() > 1%' as cascade_path from pg_proc
 where proname = 'individual_professional_stage6_append_only';

-- 4. no score, percentage, verified, competent, deficiency or scope column on the new tables (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name in ('individual_professional_evaluation', 'individual_professional_evaluation_annotation',
   'individual_professional_evaluation_decision', 'individual_professional_share_evaluation')
   and (column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id') or column_name like '%score%' or column_name like '%percent%'
     or column_name like '%verif%' or column_name like '%competent%' or column_name like '%defici%');

-- 5. the six separate dimensions are required by the snapshot CHECK (expect 1 row, true)
select pg_get_constraintdef(oid) like '%development_activity%independent_verification%evidence_confidence%' as six_dimensions
  from pg_constraint where conname = 'individual_professional_evaluation_shape';

-- 6. the composite keys the links need (expect 3)
select indexname from pg_indexes where schemaname = 'public'
   and indexname in ('ux_individual_professional_evaluation_id_user', 'ux_individual_professional_evaluation_annotation_id_user', 'ux_individual_professional_share_token_user')
 order by indexname;
