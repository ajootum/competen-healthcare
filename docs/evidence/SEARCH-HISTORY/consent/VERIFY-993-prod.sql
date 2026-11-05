-- VERIFY-993-prod (My Search History, the learner choice and material deletion). STRUCTURE ONLY: reads the catalogue, writes
-- nothing, reads no learner row. For the owner to run in the production SQL editor AFTER applying 993 (separate owner GO).
-- APPLY THIS FILE WHOLE (it holds a DO block). Passing = "Success. No rows returned" with the notice VERIFY-993-prod: PASS.
do $$
declare
  chk text;
begin
  select pg_get_constraintdef(c.oid) into chk from pg_constraint c
   where c.conrelid = 'public.individual_scholar_consent'::regclass and c.conname = 'individual_scholar_consent_feature_check';
  if chk is null or chk not like '%ai_processing_uploads%' or chk not like '%ai_cross_experience_context%' or chk not like '%scholar_search_history%' then
    raise exception 'VERIFY-993-prod: the consent feature CHECK does not hold all three features';
  end if;
  if (select c.confdeltype from pg_constraint c where c.conrelid = 'public.individual_scholar_search_history'::regclass
       and c.conname = 'individual_scholar_search_history_material_fk') is distinct from 'c' then
    raise exception 'VERIFY-993-prod: the material foreign key is not ON DELETE CASCADE';
  end if;
  if (select c.confdeltype from pg_constraint c where c.conrelid = 'public.individual_scholar_search_history'::regclass
       and c.conname = 'individual_scholar_search_history_session_fk') is distinct from 'c' then
    raise exception 'VERIFY-993-prod: the session foreign key is not ON DELETE CASCADE';
  end if;
  if (select c.confdeltype from pg_constraint c where c.conrelid = 'public.individual_scholar_search_history'::regclass
       and c.conname = 'individual_scholar_search_history_artefact_fk') is distinct from 'n' then
    raise exception 'VERIFY-993-prod: the artefact foreign key changed';
  end if;
  raise notice 'VERIFY-993-prod: PASS';
end $$;
