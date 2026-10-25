-- VERIFY 470 (read-only). COMPETEN-PROFESSIONAL-NEEDS-01, Professional Stage 2. Every query only reads.

-- 1. the 15 Stage 2 columns on the need (expect 15)
select count(*) as need_columns from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_professional_need'
   and column_name in ('stage_code', 'priority_code', 'priority_label', 'category_code', 'category_label', 'motivation_code', 'motivation_label',
     'why_it_matters', 'professional_context', 'development_interests', 'source_note', 'created_via', 'reflection_id', 'aspiration_item_id', 'reviewed_at');

-- 2. the five new tables: RLS on, exactly one policy, a SELECT one (expect 5 rows, each true, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c
 where c.relkind = 'r' and c.relname in ('individual_professional_reflection', 'individual_professional_need_history',
   'individual_professional_need_competency', 'individual_professional_goal_need', 'individual_professional_need_suggestion')
 order by c.relname;

-- 3. the four triggers (expect 4)
select tgname from pg_trigger
 where tgname in ('trg_individual_professional_need_stage_sync', 'trg_individual_professional_need_history',
   'trg_individual_professional_need_history_append_only', 'trg_individual_professional_need_competency_guard')
 order by tgname;

-- 4. every need has a stage, and stage and status agree (expect needs = staged, mismatched 0)
select (select count(*) from individual_professional_need) as needs,
       (select count(*) from individual_professional_need where stage_code is not null) as staged,
       (select count(*) from individual_professional_need where status <> case when stage_code = 'addressed' then 'met'
          when stage_code in ('deferred', 'retired') then 'closed' else 'open' end) as mismatched;

-- 5. one history snapshot per existing need at least (expect needs_without_history 0)
select count(*) as needs_without_history from individual_professional_need n
 where not exists (select 1 from individual_professional_need_history h where h.need_id = n.id);

-- 6. no scope, verified or deficiency column on the new tables (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name in ('individual_professional_reflection', 'individual_professional_need_history',
   'individual_professional_need_competency', 'individual_professional_goal_need', 'individual_professional_need_suggestion')
   and (column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id') or column_name like '%verif%' or column_name like '%defici%');

-- 7. the widened origin CHECK (expect 1 row naming scholar_learning)
select pg_get_constraintdef(oid) from pg_constraint where conname = 'individual_professional_need_origin_check';
