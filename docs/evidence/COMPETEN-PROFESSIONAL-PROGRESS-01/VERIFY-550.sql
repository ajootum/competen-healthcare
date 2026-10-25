-- VERIFY 550 (read-only). COMPETEN-PROFESSIONAL-PROGRESS-01, Professional Stage 8. Every query only reads.

-- 1. the six new tables: RLS on, exactly one policy, a SELECT one (expect 6 rows, each true, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c
 where c.relkind = 'r' and c.relname in ('individual_professional_progress_preference', 'individual_professional_progress_view',
   'individual_professional_progress_decision', 'individual_professional_progress_snapshot', 'individual_professional_document',
   'individual_professional_document_export')
 order by c.relname;

-- 2. the three append-only triggers (expect 3)
select tgname from pg_trigger
 where tgname in ('trg_individual_professional_progress_decision_append_only', 'trg_individual_professional_progress_snapshot_append_only',
   'trg_individual_professional_document_export_append_only')
 order by tgname;

-- 3. the one function, with the cascade path (expect 1 row, true)
select proname, prosrc like '%pg_trigger_depth() > 1%' as cascade_path from pg_proc
 where proname = 'individual_professional_stage8_append_only';

-- 4. no score, percentage, verified, competent, deficiency or scope column on the new tables (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name in ('individual_professional_progress_preference', 'individual_professional_progress_view',
   'individual_professional_progress_decision', 'individual_professional_progress_snapshot', 'individual_professional_document',
   'individual_professional_document_export')
   and (column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id') or column_name like '%score%' or column_name like '%percent%'
     or column_name like '%verif%' or column_name like '%competent%' or column_name like '%defici%');

-- 5. no file is stored: the export table has no content, file, path or bytes column (expect 0)
select count(*) as file_columns from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_professional_document_export'
   and (column_name like '%path%' or column_name like '%file%' or column_name in ('content', 'bytes', 'data', 'body'));

-- 6. a draft record entry cannot carry copied text (expect 1 row, true)
select pg_get_constraintdef(oid) like '%records%body%' as references_only
  from pg_constraint where conname = 'individual_professional_document_shape';
