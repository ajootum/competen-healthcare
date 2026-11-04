-- PRECHECK-992 (read only). Whether 992 is present, and the row counts it must never change.
select to_regclass('public.individual_scholar_search_history') as history_table,
       (select count(*) from pg_proc where proname in ('individual_scholar_search_history_list', 'individual_scholar_search_history_clear')) as history_functions,
       (select count(*) from individual_scholar_artefact) as artefacts,
       (select count(*) from individual_scholar_learning_session) as sessions,
       (select count(*) from individual_scholar_learning_event) as events,
       (select count(*) from individual_scholar_note) as notes,
       (select count(*) from individual_scholar_attempt) as attempts,
       (select count(*) from individual_scholar_material) as materials;
