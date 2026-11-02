-- ====================================================================================================
-- ASMT STUDIO DB PROOFS (Checklist Studio S2). STAGING ONLY. Run by scripts/assessment-core-harness.ts studio-db, never by hand.
-- ====================================================================================================
-- One transaction. It follows the exact database path the Studio takes (catalogue register, then version 1 as a draft, content written
-- with updated_by, submit, independent review decisions, approval, publication, duplicate) with throwaway people and appointments, checks
-- what the database refuses and allows, and ALWAYS ENDS BY RAISING its RESULT line so everything rolls back and nothing is kept.
-- The harness replaces the marker line below with the statements of one planted violation to prove that each control can fail.
--
-- Expect: RESULT ASMT STUDIO PROOFS pass=<n> fail=0 failed:
create temp table proof (id text, ok boolean, detail text) on commit drop;

create function pg_temp.rec(p_id text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into pg_temp.proof values (p_id, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.try_sql(p_sql text) returns text
language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

create function pg_temp.refused(p_id text, p_sql text, p_pattern text default '%') returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is not null and e ilike p_pattern, coalesce(left(e, 160), 'NOT REFUSED'));
end $$;

create function pg_temp.allowed(p_id text, p_sql text) returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is null, coalesce(left(e, 160), 'ok'));
end $$;

create function pg_temp.appoint(p_office uuid, p_owner uuid, p_person uuid, p_role text) returns void
language plpgsql as $$
begin
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, authorised_by, authorised_at)
  values (p_office, p_person, 'asmt studio proof ' || p_role, p_role, 'active', p_owner, now());
end $$;

do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  owner uuid;
  office uuid;
  ids uuid[];
  u_author uuid; u_editor uuid; u_rev uuid; u_pub uuid; u_out uuid;
  ins uuid; v1 uuid; v2 uuid; sec uuid; item uuid;
  code text;
  hash1 text;
  r record;
  n int;
  n2 int;
  e text;
begin
  -- @@PLANT@@

  select p.id into owner from profiles p where hq_actor_is_owner(p.id) order by p.id limit 1;
  select o.id into office from ogs_offices o where o.office_type = 'hq_quality' limit 1;
  select array_agg(id) into ids from (
    select p.id from profiles p
     where not exists (select 1 from ogs_office_appointments a where a.person_id = p.id) and not hq_actor_is_owner(p.id)
     order by p.id limit 5) s;
  if owner is null or office is null or cardinality(ids) < 5 then
    raise exception 'RESULT ASMT STUDIO PROOFS needs a platform owner, the hq_quality office and 5 profiles without an appointment';
  end if;
  u_author := ids[1]; u_editor := ids[2]; u_rev := ids[3]; u_pub := ids[4]; u_out := ids[5];
  perform pg_temp.appoint(office, owner, u_author, 'assessment_studio_author');
  perform pg_temp.appoint(office, owner, u_editor, 'assessment_studio_author');
  perform pg_temp.appoint(office, owner, u_rev, 'assessment_studio_reviewer');
  perform pg_temp.appoint(office, owner, u_pub, 'assessment_studio_publisher');

  insert into asmt_purpose (code, label, publishable) values ('zzs_formative', 'Formative', true), ('zzs_blocked', 'Blocked', false);
  insert into asmt_method (code, label) values ('zzs_method', 'Method');
  insert into asmt_instrument_family (code, label) values ('ZQS', 'Studio proof family');

  -- ---- S1: the create path (catalogue register, then version 1 as a draft) -------------------------------------------
  perform pg_temp.rec('S0', to_regprocedure('public.asmt_catalogue_register(text,text,text,text,uuid,jsonb)') is not null, 'the catalogue register function is present');
  select public.asmt_catalogue_register('ZQS', 'Studio proof checklist', 'proof', 'assessment', u_author, '[]'::jsonb) into ins;
  select i.code into code from asmt_instrument i where i.id = ins;
  perform pg_temp.rec('S1', code ~ '^ZQS-[0-9]{6}$', 'the catalogue code comes from the family counter: ' || coalesce(code, 'null'));
  select count(*)::int into n from asmt_instrument_version where instrument_id = ins;
  perform pg_temp.rec('S1b', n = 0, 'registering creates the master record and no version');
  insert into asmt_instrument_version (instrument_id, authored_by, title, purpose_code, method_codes, delivery_modes, respondent_roles)
    values (ins, array[u_author], 'Studio proof checklist', 'zzs_formative', array['zzs_method'], '{}', array['self']) returning id into v1;
  select version_no, state into r from asmt_instrument_version where id = v1;
  perform pg_temp.rec('S2', r.version_no = 1 and r.state = 'draft', 'version 1 starts as a draft: ' || r.version_no || ' ' || r.state);
  select count(*)::int into n from asmt_definition_event where subject_table = 'asmt_instrument_version' and subject_id = v1 and event = 'created' and actor_id = u_author;
  perform pg_temp.rec('S2b', n = 1, 'the history records who created it');

  -- ---- S3: content written by a second author names the editor -----------------------------------------------------
  insert into asmt_section (version_id, title, updated_by) values (v1, 'Section one', u_author) returning id into sec;
  insert into asmt_item (version_id, section_id, code, prompt, response_type, mandatory, position, updated_by)
    values (v1, sec, 'I1', 'Is it done', 'yes_no', true, 1, u_author) returning id into item;
  select (u_editor = any(edited_by)) as editor, last_edited_by into r from asmt_instrument_version where id = v1;
  perform pg_temp.rec('S3a', not r.editor, 'a write by an author does not make anybody else an editor');
  update asmt_item set prompt = 'Is it done today', updated_by = u_editor where id = item;
  select (u_editor = any(edited_by)) as editor, last_edited_by into r from asmt_instrument_version where id = v1;
  perform pg_temp.rec('S3', r.editor and r.last_edited_by = u_editor, 'a write by somebody else records them as an editor and as the last editor');
  perform pg_temp.allowed('S3b', format($q$update asmt_instrument_version set scoring = '{"schema":"asmt.rules/1"}'::jsonb, scoring_hash = 'h1', last_edited_by = %L where id = %L$q$, u_author, v1));
  perform pg_temp.refused('S3c', format($q$update asmt_instrument_version set summary = 'x', last_edited_by = null where id = %L$q$, v1), '%must name who edited%');

  -- ---- S4: submit ---------------------------------------------------------------------------------------------------------
  perform pg_temp.refused('S4', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, v1), '%delivery mode%');
  perform pg_temp.allowed('S4b', format($q$update asmt_instrument_version set delivery_modes = array['self_assessment'], last_edited_by = %L where id = %L$q$, u_author, v1));
  perform pg_temp.refused('S4c', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_out, v1), '%author or editor%');
  update asmt_instrument_version set purpose_code = 'zzs_blocked', last_edited_by = u_author where id = v1;
  perform pg_temp.refused('S4d', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, v1), '%cannot be published%');
  update asmt_instrument_version set purpose_code = 'zzs_formative', last_edited_by = u_author where id = v1;
  perform pg_temp.allowed('S5', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, v1));
  select content_hash into hash1 from asmt_instrument_version where id = v1;
  perform pg_temp.rec('S5b', hash1 is not null, 'submitting computes the content hash');
  perform pg_temp.refused('S5c', format($q$update asmt_item set prompt = 'sneaky', updated_by = %L where id = %L$q$, u_author, item), '%frozen%');

  -- ---- S6: independence ------------------------------------------------------------------------------------------------------
  perform pg_temp.refused('S6', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_author, hash1), '%not independent%');
  perform pg_temp.refused('S6b', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_editor, hash1), '%not independent%');
  perform pg_temp.refused('S6c', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_out, hash1), '%not authorised%');
  perform pg_temp.refused('S7', format($q$update asmt_instrument_version set state = 'approved' where id = %L$q$, v1), '%not approved%');
  perform pg_temp.allowed('S8', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_rev, hash1));
  perform pg_temp.allowed('S9', format($q$update asmt_instrument_version set state = 'approved' where id = %L$q$, v1));

  -- ---- S10: publication ---------------------------------------------------------------------------------------------------------
  perform pg_temp.refused('S10', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_author, v1), '%not independent%');
  perform pg_temp.refused('S10b', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_editor, v1), '%not independent%');
  perform pg_temp.refused('S10c', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_rev, v1), '%not authorised%');
  perform pg_temp.allowed('S11', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_pub, v1));
  perform pg_temp.refused('S12', format($q$update asmt_item set prompt = 'after publish', updated_by = %L where id = %L$q$, u_author, item), '%frozen%');
  perform pg_temp.refused('S12b', format($q$update asmt_instrument_version set title = 'after publish', last_edited_by = %L where id = %L$q$, u_author, v1), '%frozen%');

  -- ---- S13: duplicate to a new draft keeps the permanent keys --------------------------------------------------------------------
  select public.asmt_duplicate_version(v1, u_editor) into v2;
  select version_no, state into r from asmt_instrument_version where id = v2;
  perform pg_temp.rec('S13', r.version_no = 2 and r.state = 'draft', 'the duplicate is version 2 as a draft');
  select count(*)::int into n from asmt_item a join asmt_item b on b.stable_key = a.stable_key and b.version_id = v2 where a.version_id = v1;
  perform pg_temp.rec('S13b', n = 1, 'the duplicate keeps the item stable key');
  perform pg_temp.refused('S13c', format($q$select public.asmt_duplicate_version(%L, %L)$q$, v1, u_out), '%not authorised%');
  select count(*)::int into n from asmt_definition_event where subject_table = 'asmt_instrument_version' and subject_id = v2 and event = 'duplicated' and actor_id = u_editor;
  perform pg_temp.rec('S13d', n = 1, 'the history records the duplication');
  -- authors of ANY earlier version stay excluded from reviewing a later one
  update asmt_instrument_version set delivery_modes = array['self_assessment'], last_edited_by = u_editor where id = v2;
  update asmt_instrument_version set state = 'in_review', submitted_by = u_editor where id = v2;
  select content_hash into hash1 from asmt_instrument_version where id = v2;
  perform pg_temp.refused('S14', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v2, u_author, hash1), '%not independent%');
  perform pg_temp.refused('S14b', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'rejected', %L)$q$, v2, u_rev, hash1), '%');
  -- a rejection needs a reason, then blocks approval of that exact content
  perform pg_temp.allowed('S15', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash, rationale) values ('asmt_instrument_version', %L, 'governance', %L, 'changes_requested', %L, 'please reword the prompts')$q$, v2, u_rev, hash1));
  perform pg_temp.refused('S15b', format($q$update asmt_instrument_version set state = 'approved' where id = %L$q$, v2), '%not approved%');

  select count(*) filter (where ok), count(*) filter (where not ok), coalesce(string_agg(id, ' ' order by id) filter (where not ok), '')
    into pass, fail, failed from pg_temp.proof;
  raise exception 'RESULT ASMT STUDIO PROOFS pass=% fail=% failed: %', pass, fail, failed;
end;
$$;
