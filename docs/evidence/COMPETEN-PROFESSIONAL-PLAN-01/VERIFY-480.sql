-- VERIFY 480 (read-only). COMPETEN-PROFESSIONAL-PLAN-01, Professional Stage 3. Every query only reads.

-- 1. the 18 Stage 3 columns on the goal, and target_date now optional (expect 18, YES)
select (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'individual_professional_goal'
            and column_name in ('goal_type_code', 'goal_type_label', 'motivation', 'intended_outcome', 'priority_code', 'priority_label',
              'expected_evidence', 'start_date', 'review_date', 'template_code', 'template_label', 'template_answers', 'created_from',
              'source_framework_competency_id', 'source_learning_offering_id', 'aspiration_item_id', 'reflection_id', 'reviewed_at')) as goal_columns,
       (select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'individual_professional_goal' and column_name = 'target_date') as target_date_nullable;

-- 2. the eight new tables: RLS on, exactly one policy, a SELECT one (expect 8 rows, each true, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c
 where c.relkind = 'r' and c.relname in ('individual_professional_goal_history', 'individual_professional_activity',
   'individual_professional_activity_goal', 'individual_professional_activity_history', 'individual_professional_milestone',
   'individual_professional_plan_competency', 'individual_professional_goal_evidence', 'individual_professional_goal_review')
 order by c.relname;

-- 3. the eight triggers (expect 8)
select tgname from pg_trigger
 where tgname in ('trg_individual_professional_goal_history', 'trg_individual_professional_goal_history_append_only',
   'trg_individual_professional_activity_record_cleared',
   'trg_individual_professional_activity_history', 'trg_individual_professional_activity_history_append_only',
   'trg_individual_professional_plan_competency_guard', 'trg_individual_professional_goal_evidence_guard',
   'trg_individual_professional_goal_review_append_only')
 order by tgname;

-- 4. the five functions (expect 5)
select proname from pg_proc
 where proname in ('individual_professional_stage3_append_only', 'individual_professional_goal_history_write',
   'individual_professional_activity_record_cleared',
   'individual_professional_activity_history_write', 'individual_professional_stage3_link_guard')
 order by proname;

-- 5. one history snapshot per existing goal at least (expect goals_without_history 0)
select (select count(*) from individual_professional_goal) as goals,
       (select count(*) from individual_professional_goal g
         where not exists (select 1 from individual_professional_goal_history h where h.goal_id = g.id)) as goals_without_history;

-- 6. no scope, verified, score or deficiency column on the goal or the new tables (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name in ('individual_professional_goal', 'individual_professional_goal_history',
   'individual_professional_activity', 'individual_professional_activity_goal', 'individual_professional_activity_history',
   'individual_professional_milestone', 'individual_professional_plan_competency', 'individual_professional_goal_evidence',
   'individual_professional_goal_review')
   and (column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id') or column_name like '%verif%'
     or column_name like '%defici%' or column_name like '%score%');

-- 7. the widened status CHECK (expect 1 row naming deferred)
select pg_get_constraintdef(oid) from pg_constraint where conname = 'individual_professional_goal_status_check';

-- 8. the two (id, user_id) indexes the composite keys need (expect 2)
select indexname from pg_indexes
 where schemaname = 'public' and indexname in ('ux_individual_professional_cpd_id_user', 'ux_individual_professional_evidence_id_user')
 order by indexname;
