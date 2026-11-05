-- VERIFY-994-prod (My Search History, seeing the notice is not a grant). STRUCTURE AND COUNTS ONLY: writes nothing and reads no learner's
-- words. For the owner to run in the production SQL editor AFTER applying 994 (separate owner GO).
-- APPLY THIS FILE WHOLE (it holds a DO block). Passing = "Success. No rows returned" with the notice VERIFY-994-prod: PASS.
do $$
declare
  st text;
  gm text;
begin
  select pg_get_constraintdef(c.oid) into st from pg_constraint c
   where c.conrelid = 'public.individual_scholar_consent'::regclass and c.conname = 'individual_scholar_consent_status_check';
  if st is null or st not like '%notified%' or st not like '%granted%' or st not like '%revoked%' then
    raise exception 'VERIFY-994-prod: the status CHECK does not hold granted, revoked and notified';
  end if;
  select pg_get_constraintdef(c.oid) into gm from pg_constraint c
   where c.conrelid = 'public.individual_scholar_consent'::regclass and c.conname = 'individual_scholar_consent_grant_meaning';
  if gm is null or gm not like '%granted_at%' or gm not like '%scholar_search_history%' then
    raise exception 'VERIFY-994-prod: the grant meaning CHECK is missing';
  end if;
  if (select a.attnotnull from pg_attribute a where a.attrelid = 'public.individual_scholar_consent'::regclass and a.attname = 'granted_at') then
    raise exception 'VERIFY-994-prod: granted_at is still NOT NULL';
  end if;
  if exists (select 1 from public.individual_scholar_consent where feature <> 'scholar_search_history' and granted_at is null) then
    raise exception 'VERIFY-994-prod: a consent of another feature has no grant time';
  end if;
  raise notice 'VERIFY-994-prod: PASS';
end $$;
