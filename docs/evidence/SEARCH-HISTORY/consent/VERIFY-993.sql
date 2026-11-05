-- VERIFY-993 (My Search History, the learner choice and material deletion). APPLY THIS FILE WHOLE (it holds a DO block). STAGING ONLY.
-- Raises on the first failure. Every probe, the deleted material and lesson included, happens inside a sub-block that is then undone
-- (raise, caught), so nothing is kept and no stored file is touched. Passing = the runner says Committed. Red before 993.
do $$
declare
  u uuid;
  m uuid;
  s uuid;
  other uuid;
  k1 text := 'c:verify993material01';
  k2 text := 'c:verify993nolink0002';
  k3 text := 'c:verify993session03';
  ai_before text;
  ai_after text;
  rows_before bigint;
  consent_before bigint;
  others_before bigint;
begin
  -- ---- structure ----
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'individual_scholar_consent_feature_check') not like '%scholar_search_history%' then
    raise exception 'VERIFY-993: the consent CHECK does not name scholar_search_history';
  end if;
  if (select c.confdeltype from pg_constraint c where c.conname = 'individual_scholar_search_history_material_fk') <> 'c' then
    raise exception 'VERIFY-993: the material foreign key is not ON DELETE CASCADE';
  end if;
  if (select c.confdeltype from pg_constraint c where c.conname = 'individual_scholar_search_history_session_fk') <> 'c' then
    raise exception 'VERIFY-993: the session foreign key is not ON DELETE CASCADE';
  end if;
  if (select c.confdeltype from pg_constraint c where c.conname = 'individual_scholar_search_history_artefact_fk') <> 'n' then
    raise exception 'VERIFY-993: the artefact foreign key changed';
  end if;

  -- ---- a learner with a lesson that relies on one material only ----
  select st.user_id, st.session_id, min(st.material_id::text)::uuid into u, s, m
    from individual_scholar_learning_step st
   group by st.user_id, st.session_id
  having count(distinct st.material_id) = 1
   order by st.session_id limit 1;
  if u is null then raise exception 'VERIFY-993: no lesson on staging relies on one material'; end if;
  select x.user_id into other from individual_scholar_material x where x.user_id <> u limit 1;

  rows_before := (select count(*) from individual_scholar_search_history);
  consent_before := (select count(*) from individual_scholar_consent);
  others_before := (select count(*) from individual_scholar_search_history where user_id <> u);
  ai_before := (select coalesce(string_agg(c.status || '|' || coalesce(c.notice_version, '') || '|' || coalesce(c.granted_at::text, ''), ','), 'none')
                  from individual_scholar_consent c where c.user_id = u and c.feature = 'ai_processing_uploads');

  begin
    -- ---- the choice is its own record, and an unknown feature is refused ----
    insert into individual_scholar_consent (user_id, feature, status, notice_version, granted_at, updated_at)
      values (u, 'scholar_search_history', 'granted', 'scholar-search-history-notice-v1', now(), now())
      on conflict (user_id, feature) do update set status = 'granted';
    update individual_scholar_consent set status = 'revoked', revoked_at = now() where user_id = u and feature = 'scholar_search_history';
    ai_after := (select coalesce(string_agg(c.status || '|' || coalesce(c.notice_version, '') || '|' || coalesce(c.granted_at::text, ''), ','), 'none')
                   from individual_scholar_consent c where c.user_id = u and c.feature = 'ai_processing_uploads');
    if ai_after <> ai_before then raise exception 'VERIFY-993: the search history choice changed the AI consent'; end if;
    begin
      insert into individual_scholar_consent (user_id, feature, status, notice_version, granted_at) values (u, 'verify_993_unknown', 'granted', 'v', now());
      raise exception 'VERIFY-993: an unknown feature was accepted';
    exception when check_violation then null;
    end;

    -- ---- deleting a material removes what relied on it, and nothing else in the history ----
    insert into individual_scholar_search_history (user_id, origin, activity, query, material_id, request_key) values (u, 'captured', 'ask', 'verify 993 linked to the material', m, k1);
    insert into individual_scholar_search_history (user_id, origin, activity, query, request_key) values (u, 'captured', 'material_search', 'verify 993 no link', k2);
    insert into individual_scholar_search_history (user_id, origin, activity, query, session_id, step, request_key) values (u, 'captured', 'ask', 'verify 993 asked in the lesson', s, 0, k3);
    insert into individual_scholar_search_history (user_id, origin, activity, session_id, request_key, hidden_at) values (u, 'recovered', 'lesson', s, 'lesson:' || s::text, now())
      on conflict (user_id, request_key) do update set hidden_at = now();

    delete from individual_scholar_material where id = m and user_id = u;
    if exists (select 1 from individual_scholar_search_history where user_id = u and request_key = k1) then
      raise exception 'VERIFY-993: the entry linked to the deleted material stayed';
    end if;
    if not exists (select 1 from individual_scholar_search_history where user_id = u and request_key = k2) then
      raise exception 'VERIFY-993: a search with no link went with the material';
    end if;
    if not exists (select 1 from individual_scholar_search_history where user_id = u and request_key = k3) then
      raise exception 'VERIFY-993: the entry asked in the lesson went before the lesson did';
    end if;

    -- ---- the lesson goes (as store.ts pruneEmptySessions does once no step is left), and its entries with it ----
    if exists (select 1 from individual_scholar_learning_step where session_id = s and user_id = u) then
      raise exception 'VERIFY-993: the lesson still has steps after its one material went';
    end if;
    delete from individual_scholar_learning_session where id = s and user_id = u;
    if exists (select 1 from individual_scholar_search_history where user_id = u and request_key = k3) then
      raise exception 'VERIFY-993: the entry asked in the deleted lesson stayed';
    end if;
    if exists (select 1 from individual_scholar_search_history where user_id = u and request_key = 'lesson:' || s::text) then
      raise exception 'VERIFY-993: the mark on the deleted lesson stayed';
    end if;
    if (select count(*) from individual_scholar_search_history where user_id <> u) <> others_before then
      raise exception 'VERIFY-993: another learner history changed';
    end if;

    raise exception 'undo behaviour';
  exception
    when others then if sqlerrm <> 'undo behaviour' then raise; end if;
  end;

  if (select count(*) from individual_scholar_search_history) <> rows_before then raise exception 'VERIFY-993: a probe entry was kept'; end if;
  if (select count(*) from individual_scholar_consent) <> consent_before then raise exception 'VERIFY-993: a probe choice was kept'; end if;
  if not exists (select 1 from individual_scholar_material where id = m and user_id = u) then raise exception 'VERIFY-993: the probe material was not restored'; end if;
  raise notice 'VERIFY-993: PASS (structure, separate choice, AI consent unchanged, unknown feature refused, material and lesson deletion remove linked entries, unlinked entry and other learners unchanged)';
end $$;
