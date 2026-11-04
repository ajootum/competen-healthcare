-- PRECHECK-975 (read only): the state 975 changes, recorded before and after application.
select conname, md5(pg_get_constraintdef(oid)) as def_md5, pg_get_constraintdef(oid) like '%next_action%' as has_next_action, pg_get_constraintdef(oid) like '%summary%' as has_summary
  from pg_constraint where conname in ('individual_learning_plan_event_check', 'individual_scholar_note_kind_check') order by conname;
select exists (select 1 from pg_proc where proname = 'individual_scholar_workspace_975') as marker,
       (select count(*) from individual_learning_plan_event) as events, (select count(*) from individual_learning_plan_event where kind = 'next_action') as next_action_events,
       (select count(*) from individual_scholar_note) as notes, (select count(*) from individual_scholar_note where kind = 'summary') as summary_notes;
