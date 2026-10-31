-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 720 (staging, or production only with an owner GO). Restores the two 417 mode CHECKs byte for byte, and
-- drops the two OSCE practice tables with their indexes and policies.
--
-- IT REFUSES while any row depends on 720:
--   an OSCE practice station or attempt (dropping the tables would delete learner practice history), or
--   an adaptive revision set or session (the 417 CHECK would reject it).
-- To roll back anyway, the owner first decides to remove them, then runs, in one transaction, before this file:
--   delete from individual_scholar_osce_station
--   delete from individual_scholar_revision_session where mode = 'adaptive'
--   delete from individual_scholar_revision_set where mode = 'adaptive'
-- The station delete also removes every attempt by cascade. The session delete leaves its attempts (417) with
-- revision_session_id cleared. The set delete leaves sessions made from it with set_id cleared.
-- ====================================================================================================

do $$
declare
  n_station int := 0;
  n_attempt int := 0;
  n_set int;
  n_session int;
begin
  if to_regclass('public.individual_scholar_osce_station') is not null then
    execute 'select count(*) from individual_scholar_osce_station' into n_station;
  end if;
  if to_regclass('public.individual_scholar_osce_attempt') is not null then
    execute 'select count(*) from individual_scholar_osce_attempt' into n_attempt;
  end if;
  select count(*) into n_set from individual_scholar_revision_set where mode = 'adaptive';
  select count(*) into n_session from individual_scholar_revision_session where mode = 'adaptive';
  if n_station + n_attempt + n_set + n_session > 0 then
    raise exception 'ROLLBACK 720 refused: % OSCE station(s), % OSCE attempt(s), % adaptive set(s), % adaptive session(s) depend on 720. See the header of this file for what to remove first.', n_station, n_attempt, n_set, n_session;
  end if;
end;
$$;

drop table if exists individual_scholar_osce_attempt;
drop table if exists individual_scholar_osce_station;

alter table individual_scholar_revision_set drop constraint if exists individual_scholar_revision_set_check;
alter table individual_scholar_revision_set add constraint individual_scholar_revision_set_check
  check (char_length(title) between 1 and 120
     and mode in ('today', 'quick', 'spaced', 'weak', 'mock', 'flashcards', 'custom')
     and jsonb_typeof(scope) = 'object' and octet_length(scope::text) <= 4000
     and jsonb_typeof(formats) = 'array' and jsonb_array_length(formats) between 1 and 7
     and formats <@ '["mcq", "case", "mrq", "short", "flashcard", "match", "sequence"]'::jsonb
     and quantity between 1 and 50
     and difficulty in ('any', 'easy', 'standard', 'harder')
     and feedback in ('immediate', 'end'));

alter table individual_scholar_revision_session drop constraint if exists individual_scholar_revision_session_check;
alter table individual_scholar_revision_session add constraint individual_scholar_revision_session_check
  check (mode in ('today', 'quick', 'spaced', 'weak', 'mock', 'flashcards', 'custom')
     and feedback in ('immediate', 'end')
     and status in ('active', 'completed')
     and total between 1 and 50
     and position between 0 and total
     and ((status = 'completed') = (completed_at is not null)));

notify pgrst, 'reload schema';
