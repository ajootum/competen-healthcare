-- VERIFY 452 (read-only). COMPETEN-PROFESSIONAL-PROFILE-01 part B, reminders. Every query only reads.

-- 1. the ledger: RLS on, one SELECT policy (expect true, 1, 1)
select c.relrowsecurity, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c where c.relname = 'individual_professional_reminder_log' and c.relkind = 'r';

-- 2. the once-only key is a FULL unique index on (item_id, expires_on, offset_days) (expect 1 row, no WHERE)
select indexdef from pg_indexes where indexname = 'ux_individual_professional_reminder_log_once';

-- 3. no scope column (expect 0), and no rows yet (expect 0)
select count(*) as scope_columns from information_schema.columns where table_name = 'individual_professional_reminder_log'
   and column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id');
select count(*) as rows from individual_professional_reminder_log;
