-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 780 (SCHOLAR-COMPANION-01 study plan). Staging rehearsal, or production only with a separate owner GO.
-- It REFUSES while any study plan row exists, because a row is the learner own settings. Remove them first
-- (or tell the learners), then run it again. Nothing else is touched.
do $$
declare
  n int := 0;
begin
  if to_regclass('public.individual_scholar_study_plan') is not null then
    execute 'select count(*) from individual_scholar_study_plan' into n;
  end if;
  if n > 0 then
    raise exception 'ROLLBACK 780 refused: % study plan row(s) hold learner settings.', n;
  end if;
end;
$$;

drop table if exists individual_scholar_study_plan;

notify pgrst, 'reload schema';
