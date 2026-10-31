-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 740 (SCHOLAR-SESSION-AI-02). Staging rehearsal, or production only with a separate owner GO.
-- It REFUSES while anything depends on 740: a connected session, a session with a last space, an outcome or a
-- free-text objective, or any study link. Those are learner data. Remove them first, then run it again.
-- The 414 sessions and every 414 column are left exactly as they were.
do $$
declare
  n_connected int := 0;
  n_space int := 0;
  n_outcome int := 0;
  n_text int := 0;
  n_links int := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'connected') then
    execute 'select count(*) from individual_scholar_learning_session where connected' into n_connected;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'last_space') then
    execute 'select count(*) from individual_scholar_learning_session where last_space is not null' into n_space;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'objective_outcome') then
    execute 'select count(*) from individual_scholar_learning_session where objective_outcome is not null' into n_outcome;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'objective_text') then
    execute 'select count(*) from individual_scholar_learning_session where objective_text is not null' into n_text;
  end if;
  if to_regclass('public.individual_scholar_study_link') is not null then
    execute 'select count(*) from individual_scholar_study_link' into n_links;
  end if;
  if n_connected + n_space + n_outcome + n_text + n_links > 0 then
    raise exception 'ROLLBACK 740 refused: % connected session(s), % with a last space, % with an outcome, % with a free-text objective, % study link(s) depend on 740.',
      n_connected, n_space, n_outcome, n_text, n_links;
  end if;
end;
$$;

drop table if exists individual_scholar_study_link;
drop trigger if exists individual_scholar_learning_session_outcome_follows on individual_scholar_learning_session;
drop function if exists public.individual_scholar_learning_session_outcome_follows();
alter table individual_scholar_learning_session drop constraint if exists individual_scholar_learning_session_study_check;
alter table individual_scholar_learning_session drop column if exists objective_text;
alter table individual_scholar_learning_session drop column if exists objective_outcome;
alter table individual_scholar_learning_session drop column if exists last_space;
alter table individual_scholar_learning_session drop column if exists connected;

notify pgrst, 'reload schema';
