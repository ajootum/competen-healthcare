-- VERIFY-994 (My Search History, seeing the notice is not a grant). APPLY THIS FILE WHOLE (it holds a DO block). STAGING ONLY.
-- Raises on the first failure. Every probe is written inside a sub-block that is then undone (raise, caught), so nothing is kept.
-- Passing = the runner says Committed. Red before 994.
do $$
declare
  u uuid;
  ai_before text;
  rows_before bigint;
  refused boolean;
begin
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'individual_scholar_consent_status_check') not like '%notified%' then
    raise exception 'VERIFY-994: the status CHECK does not hold notified';
  end if;
  if not exists (select 1 from pg_constraint c where c.conname = 'individual_scholar_consent_grant_meaning') then
    raise exception 'VERIFY-994: the grant meaning CHECK is missing';
  end if;

  select c.user_id into u from individual_scholar_consent c where c.feature = 'ai_processing_uploads' order by c.user_id limit 1;
  if u is null then raise exception 'VERIFY-994: no AI consent on staging to test beside'; end if;
  rows_before := (select count(*) from individual_scholar_consent);
  ai_before := (select c.status || '|' || c.notice_version || '|' || c.granted_at::text || '|' || c.updated_at::text from individual_scholar_consent c where c.user_id = u and c.feature = 'ai_processing_uploads');

  begin
    delete from individual_scholar_consent where user_id = u and feature = 'scholar_search_history';

    -- Seeing the notice: a row with no grant time.
    insert into individual_scholar_consent (user_id, feature, status, notice_version) values (u, 'scholar_search_history', 'notified', 'scholar-search-history-notice-v2');
    -- A notified row cannot carry a grant time.
    refused := false;
    begin
      update individual_scholar_consent set granted_at = now() where user_id = u and feature = 'scholar_search_history';
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'VERIFY-994: a notified row took a grant time'; end if;
    -- A grant cannot exist without a grant time.
    refused := false;
    begin
      update individual_scholar_consent set status = 'granted' where user_id = u and feature = 'scholar_search_history';
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'VERIFY-994: a grant with no grant time was accepted'; end if;
    -- Keep it on: a real grant, with its time.
    update individual_scholar_consent set status = 'granted', granted_at = now() where user_id = u and feature = 'scholar_search_history';
    -- Turning it off from notified, never having granted it: allowed, with no grant time.
    delete from individual_scholar_consent where user_id = u and feature = 'scholar_search_history';
    insert into individual_scholar_consent (user_id, feature, status, notice_version, revoked_at) values (u, 'scholar_search_history', 'revoked', 'scholar-search-history-notice-v2', now());

    -- Another feature cannot be notified, and cannot lose its grant time.
    refused := false;
    begin
      update individual_scholar_consent set status = 'notified', granted_at = null where user_id = u and feature = 'ai_processing_uploads';
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'VERIFY-994: the AI consent could be set to notified'; end if;
    refused := false;
    begin
      update individual_scholar_consent set granted_at = null where user_id = u and feature = 'ai_processing_uploads';
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'VERIFY-994: the AI consent could lose its grant time'; end if;
    if (select c.status || '|' || c.notice_version || '|' || c.granted_at::text || '|' || c.updated_at::text from individual_scholar_consent c where c.user_id = u and c.feature = 'ai_processing_uploads') <> ai_before then
      raise exception 'VERIFY-994: the AI consent row changed';
    end if;
    raise exception 'undo behaviour';
  exception
    when others then if sqlerrm <> 'undo behaviour' then raise; end if;
  end;

  if (select count(*) from individual_scholar_consent) <> rows_before then raise exception 'VERIFY-994: a probe row was kept'; end if;
  raise notice 'VERIFY-994: PASS (notified has no grant time, a grant must have one, off without a grant allowed, AI consent cannot be notified or lose its grant time and is unchanged)';
end $$;
