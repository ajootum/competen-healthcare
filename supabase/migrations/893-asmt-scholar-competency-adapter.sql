-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 893: SCHOLAR COMPETENCY ADAPTER, DATABASE PART (Checklist Studio, slice S3a)
--
-- Owner-approved Checklist Studio. Design of record: the coordinator design for Assessment Studio Phase 1
-- (3 Nov 2026), section 2 "Migration 893", sections 3 and 10, and the AS BUILT contract (section 12).
-- Staging first. Production needs its own owner GO and is applied by the owner by hand.
--
-- THIS IS THE ONE PLACE THE UNIVERSAL ASSESSMENT CORE (890, 891, 892) MEETS THE COMPETENCY WORLD. The core
-- knows no profession, framework or proficiency model. Here every competency literal lives: the registry
-- rows the Scholar adapter needs, the import of a scoring scale and its stage mapping as response scales,
-- the pre-fill of groups from the assessment components, the guard that refuses to put a checklist forward
-- when a criterion it assesses has drifted or is not clinically approved, the criterion picker read and the
-- erasure of the assessment rows of a learner.
--
-- DEPENDS ON 890, 891 (the erase function deletes capture rows), 892 (progression decisions), and the
-- existing competency substrate: 007 (competency_skills, scoring_scales, scoring_levels), 660 (components,
-- stages and the stage mapping), 670 (component_code and competency_content_hash, replaced by 761), 466
-- (competency_clinically_approved) and 641 (individual_holds_capability). APPLY AFTER 892. Additive. Re-running
-- it is a no-op. It appoints NOBODY, changes no framework, scale, mapping or approval, and writes no
-- capability or grant.
--
-- WHAT IT ADDS.
--   1. Registry rows (on conflict do nothing): five mapping kinds, six methods, five purposes. The purpose
--      verification is NOT publishable: a checklist can never be formal verification (it would be a second
--      verification path beside the Passport one).
--   2. asmt_scholar_import_scale(scale, mapping, actor): a scoring scale (and optionally its published stage
--      mapping) becomes DRAFT response scale versions, so they go through the normal lifecycle and somebody
--      else publishes them. asmt_scholar_import_stage_scale does the stage half. asmt_scholar_stage_band holds
--      the bands, and asmt_scholar_stage_scale reads them back as the engine stage scale in ONE call.
--   3. asmt_scholar_prefill_groups(version, actor): the active assessment components become groups.
--   4. asmt_scholar_mapping_check(version) and the guard trigger asmt_instrument_version_scholar_check.
--      When a version is put forward for review or published, every competency_criterion mapping that
--      ASSESSES must still point at an active criterion whose wording and component equal the frozen
--      snapshot, whose competency still has the content hash that was mapped, and whose competency holds a
--      CURRENT clinical approval. The purpose verification is refused.
--   5. asmt_scholar_criteria(framework code): the read behind the criterion picker.
--   6. asmt_scholar_erase_user(user): the Scholar owner erasure of assessment rows. See section 6 below for
--      why a receipt table drives it.
--
-- WHY THE STAGE BANDS ARE A TABLE. The engine stage scale is { stages: [{code, label, ordinal}], bands:
-- [{stage, from_ordinal, to_ordinal}] } where a band maps a range of RATING level ordinals to a stage. The
-- stage scale version (scale_kind stage) already holds the stages as its levels. The bands belong to that
-- version, so asmt_scholar_stage_band(scale_version_id, stage_code, from_ordinal, to_ordinal) holds one row
-- per band, frozen with the version. The bands are not part of the version content hash (890 hashes levels and
-- states), but they cannot change once the version leaves draft, so what a reviewer approved is what is used.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last. RLS on every new table, no policy (service role only).
--
-- ROLLBACK (staging): PENDING-39/ROLLBACK-893.sql
-- ====================================================================================================


-- ---- 0. what must already exist --------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.asmt_instrument_version') is null or to_regclass('public.asmt_progression_decision') is null
     or to_regclass('public.asmt_instance') is null then
    raise exception '893 needs 890, 891 and 892 applied first';
  end if;
  if to_regclass('public.competency_skills') is null or to_regclass('public.competency_assessment_component') is null
     or to_regclass('public.competency_stage_mapping') is null or to_regclass('public.competency_stage_mapping_band') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'competency_skills' and column_name = 'component_code') then
    raise exception '893 needs 660 and 670 applied first (components, stages, stage mapping, component_code)';
  end if;
  if to_regprocedure('public.competency_clinically_approved(uuid)') is null or to_regprocedure('public.competency_content_hash(uuid)') is null then
    raise exception '893 needs 466 (competency_clinically_approved) and the content hash function applied first';
  end if;
end;
$$;


-- ---- 1. registry rows ------------------------------------------------------------------------------------

insert into asmt_mapping_kind (code, label) values
  ('competency_criterion', 'Competency criterion'),
  ('competency', 'Competency'),
  ('framework', 'Framework'),
  ('programme_framework', 'Programme framework'),
  ('qualification_level', 'Qualification level')
on conflict (code) do nothing;

insert into asmt_method (code, label) values
  ('self_assessment', 'Self-assessment'),
  ('direct_observation', 'Direct observation'),
  ('knowledge_examination', 'Knowledge examination'),
  ('simulation_osce', 'Simulation or OSCE'),
  ('case_based', 'Case-based assessment'),
  ('portfolio_review', 'Portfolio review')
on conflict (code) do nothing;

insert into asmt_purpose (code, label, publishable) values
  ('practice', 'Practice', true),
  ('diagnostic', 'Diagnostic', true),
  ('formative', 'Formative', true),
  ('summative', 'Summative', true),
  ('verification', 'Verification', false)
on conflict (code) do nothing;


-- ---- 2. stage bands, and the receipt of an erasure -------------------------------------------------------

create table if not exists asmt_scholar_stage_band (
  scale_version_id        uuid not null references asmt_response_scale_version(id) on delete cascade,
  stage_code              text not null,
  from_ordinal            int not null,
  to_ordinal              int not null,
  rating_scale_version_id uuid references asmt_response_scale_version(id),
  updated_by              uuid,
  primary key (scale_version_id, from_ordinal),
  foreign key (scale_version_id, stage_code) references asmt_response_scale_level (version_id, code) on delete cascade,
  constraint asmt_scholar_stage_band_range_check check (from_ordinal <= to_ordinal)
);
create index if not exists idx_asmt_scholar_stage_band_rating on asmt_scholar_stage_band (rating_scale_version_id);
alter table asmt_scholar_stage_band enable row level security;

-- One row per Scholar erasure. It holds counts only and no content. Inserting a row IS the erasure (the
-- before insert trigger deletes the rows), see section 6.
create table if not exists asmt_scholar_erasure (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  erased_at timestamptz not null default now(),
  counts    jsonb not null default '{}',
  constraint asmt_scholar_erasure_counts_check check (jsonb_typeof(counts) = 'object')
);
create index if not exists idx_asmt_scholar_erasure_user on asmt_scholar_erasure (user_id);
alter table asmt_scholar_erasure enable row level security;


-- ---- 3. response scales from the scoring scales ------------------------------------------------------------

-- A scale code for a name. Upper case, letters, digits and hyphens, 3 to 41 characters, starting with a letter.
create or replace function public.asmt_scholar_scale_code(p_name text, p_suffix text)
returns text
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v text := btrim(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z0-9]+', '-', 'g'), '-');
begin
  if v !~ '^[A-Z]' then
    v := 'SC-' || v;
  end if;
  v := left(v, 41 - length(coalesce(p_suffix, ''))) || coalesce(p_suffix, '');
  if length(v) < 3 then
    v := rpad(v, 3, 'X');
  end if;
  return v;
end;
$$;

-- The stage half. A published stage mapping of the scale of an imported rating version becomes a DRAFT stage
-- scale version: the stages are the levels (ordinal from the stage sort order) and the bands map rating level
-- ordinals (the scores) to stages, runs of equal stage collapsed. Idempotent per mapping.
create or replace function public.asmt_scholar_import_stage_scale(p_rating_version uuid, p_mapping_id uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_rating record;
  v_map record;
  v_name text;
  v_def uuid;
  v_stage uuid;
  v_code text;
begin
  if p_actor is null or not public.individual_holds_capability(p_actor, 'hq.assessment.instrument.author') then
    raise exception 'asmt_scholar_import_stage_scale: not authorised. Importing needs the author capability';
  end if;
  select state, scale_kind, source_kind, source_ref into v_rating from asmt_response_scale_version where id = p_rating_version;
  if not found or v_rating.scale_kind <> 'rating' or v_rating.source_kind is distinct from 'scoring_scale' then
    raise exception 'asmt_scholar_import_stage_scale: % is not an imported rating scale version', p_rating_version;
  end if;
  select * into v_map from competency_stage_mapping where id = p_mapping_id;
  if not found or v_map.status <> 'published' then
    raise exception 'asmt_scholar_import_stage_scale: a stage scale is built only from a published stage mapping';
  end if;
  if v_map.scale_id is distinct from v_rating.source_ref then
    raise exception 'asmt_scholar_import_stage_scale: the mapping belongs to another scoring scale';
  end if;

  perform pg_advisory_xact_lock(hashtext('asmt_scholar_import_stage'), hashtext(p_mapping_id::text));
  select v.id into v_stage from asmt_response_scale_version v
   where v.scale_kind = 'stage' and v.source_kind = 'competency_stage_mapping' and v.source_ref = p_mapping_id and v.state <> 'retired'
   order by v.version_no desc limit 1;
  if v_stage is not null then
    return v_stage;
  end if;

  select name into v_name from scoring_scales where id = v_map.scale_id;
  v_code := public.asmt_scholar_scale_code(v_name, '-STAGES');
  select id into v_def from asmt_response_scale where code = v_code;
  if v_def is null then
    insert into asmt_response_scale (code, name, created_by) values (v_code, v_name || ' stages', p_actor) returning id into v_def;
  end if;
  insert into asmt_response_scale_version (scale_id, authored_by, scale_kind, source_kind, source_ref, description)
    values (v_def, array[p_actor], 'stage', 'competency_stage_mapping', p_mapping_id,
            'Stages of the scoring scale ' || v_name || ', mapping version ' || v_map.version || ' (hash ' || coalesce(v_map.content_hash, 'none') || ')')
    returning id into v_stage;

  insert into asmt_response_scale_level (version_id, code, label, description, ordinal, updated_by)
    select v_stage, st.code, st.label, st.description, st.sort_order, p_actor
      from competency_stage st
     where st.is_active
        or st.code in (select mb.stage_code from competency_stage_mapping_band mb where mb.mapping_id = p_mapping_id)
     order by st.sort_order;

  insert into asmt_scholar_stage_band (scale_version_id, stage_code, from_ordinal, to_ordinal, rating_scale_version_id, updated_by)
    select v_stage, x.stage_code, min(x.score), max(x.score), p_rating_version, p_actor
      from (
        select l.score, mb.stage_code,
               l.score - row_number() over (partition by mb.stage_code order by l.score) as run
          from competency_stage_mapping_band mb
          join scoring_levels l on l.id = mb.level_id
         where mb.mapping_id = p_mapping_id) x
     group by x.stage_code, x.run;
  return v_stage;
end;
$$;

-- A scoring scale (and, when a published mapping is named, its stages) as DRAFT response scale versions.
-- Returns the RATING version id. The stage version is found with asmt_scholar_import_stage_scale (same
-- arguments, idempotent) or by asmt_scholar_stage_band.rating_scale_version_id. Idempotent per scale and mapping.
create or replace function public.asmt_scholar_import_scale(p_scale_id uuid, p_mapping_id uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_scale record;
  v_map record;
  v_def uuid;
  v_ver uuid;
begin
  if p_actor is null or not public.individual_holds_capability(p_actor, 'hq.assessment.instrument.author') then
    raise exception 'asmt_scholar_import_scale: not authorised. Importing needs the author capability';
  end if;
  select * into v_scale from scoring_scales where id = p_scale_id;
  if not found then
    raise exception 'asmt_scholar_import_scale: the scoring scale % does not exist', p_scale_id;
  end if;
  if p_mapping_id is not null then
    select * into v_map from competency_stage_mapping where id = p_mapping_id;
    if not found or v_map.status <> 'published' then
      raise exception 'asmt_scholar_import_scale: the stage mapping must be a published mapping';
    end if;
    if v_map.scale_id <> p_scale_id then
      raise exception 'asmt_scholar_import_scale: the stage mapping belongs to another scoring scale';
    end if;
  end if;
  if not exists (select 1 from scoring_levels where scale_id = p_scale_id) then
    raise exception 'asmt_scholar_import_scale: the scoring scale has no levels';
  end if;

  perform pg_advisory_xact_lock(hashtext('asmt_scholar_import_scale'), hashtext(p_scale_id::text));
  select v.id into v_ver from asmt_response_scale_version v
   where v.scale_kind = 'rating' and v.source_kind = 'scoring_scale' and v.source_ref = p_scale_id
     and v.state in ('draft', 'in_review', 'approved', 'published')
   order by v.version_no desc limit 1;

  if v_ver is null then
    select id into v_def from asmt_response_scale where code = public.asmt_scholar_scale_code(v_scale.name, '');
    if v_def is null then
      insert into asmt_response_scale (code, name, created_by)
        values (public.asmt_scholar_scale_code(v_scale.name, ''), v_scale.name, p_actor) returning id into v_def;
    end if;
    insert into asmt_response_scale_version (scale_id, authored_by, scale_kind, source_kind, source_ref, description)
      values (v_def, array[p_actor], 'rating', 'scoring_scale', p_scale_id, 'Imported from the scoring scale ' || v_scale.name)
      returning id into v_ver;
    insert into asmt_response_scale_level (version_id, code, label, description, ordinal, numeric_value, satisfactory, source_level_id, updated_by)
      select v_ver, l.score::text, l.label, l.description, l.score, l.score, l.is_passing, l.id, p_actor
        from scoring_levels l where l.scale_id = p_scale_id order by l.score;
    insert into asmt_response_scale_state (version_id, state, label, updated_by) values
      (v_ver, 'not_assessed', 'Not answered', p_actor),
      (v_ver, 'not_observed', 'Not observed', p_actor),
      (v_ver, 'not_applicable', 'Not applicable', p_actor),
      (v_ver, 'unable_to_demonstrate', 'Unable to demonstrate', p_actor),
      (v_ver, 'unable_to_determine', 'Unable to judge', p_actor);
  end if;

  if p_mapping_id is not null then
    perform public.asmt_scholar_import_stage_scale(v_ver, p_mapping_id, p_actor);
  end if;
  return v_ver;
end;
$$;

-- The engine stage scale of a stage scale version, in ONE read: { stages: [{code, label, ordinal}], bands:
-- [{stage, from_ordinal, to_ordinal}] }. Null when the version is not a stage scale version.
create or replace function public.asmt_scholar_stage_scale(p_stage_version uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from asmt_response_scale_version where id = p_stage_version and scale_kind = 'stage') then
    return null;
  end if;
  return jsonb_build_object(
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'label', l.label, 'ordinal', l.ordinal) order by l.ordinal), '[]'::jsonb)
                 from asmt_response_scale_level l where l.version_id = p_stage_version),
    'bands', (select coalesce(jsonb_agg(jsonb_build_object('stage', b.stage_code, 'from_ordinal', b.from_ordinal, 'to_ordinal', b.to_ordinal) order by b.from_ordinal), '[]'::jsonb)
                from asmt_scholar_stage_band b where b.scale_version_id = p_stage_version));
end;
$$;

-- Bands are written only while the stage scale version is a draft, never overlap, and bring in their editor.
create or replace function public.asmt_scholar_stage_band_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_vid uuid := case when tg_op = 'DELETE' then old.scale_version_id else new.scale_version_id end;
  v_state text;
  v_kind text;
  v_self int;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  select state, scale_kind into v_state, v_kind from asmt_response_scale_version where id = v_vid;
  if v_state is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'asmt_scholar_stage_band: the stage scale version does not exist';
  end if;
  if v_state <> 'draft' then
    raise exception 'asmt_scholar_stage_band: the stage scale version is % and its bands are frozen. Make a new draft with asmt_duplicate_version', v_state;
  end if;
  if tg_op = 'UPDATE' and new.scale_version_id is distinct from old.scale_version_id then
    raise exception 'asmt_scholar_stage_band: a band never moves to another version';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if v_kind <> 'stage' then
    raise exception 'asmt_scholar_stage_band: bands belong to a stage scale version';
  end if;
  if new.rating_scale_version_id is not null and not exists (
       select 1 from asmt_response_scale_version r where r.id = new.rating_scale_version_id and r.scale_kind = 'rating') then
    raise exception 'asmt_scholar_stage_band: the bands map the levels of a rating scale version';
  end if;
  if tg_op = 'UPDATE' then
    v_self := old.from_ordinal;
  end if;
  if exists (select 1 from asmt_scholar_stage_band b
              where b.scale_version_id = new.scale_version_id and b.from_ordinal is distinct from v_self
                and b.from_ordinal <= new.to_ordinal and b.to_ordinal >= new.from_ordinal) then
    raise exception 'asmt_scholar_stage_band: bands of one stage scale never overlap';
  end if;
  if new.updated_by is not null then
    update asmt_response_scale_version
       set last_edited_by = new.updated_by,
           edited_by = case when new.updated_by = any(authored_by) or new.updated_by = any(edited_by) then edited_by else edited_by || new.updated_by end
     where id = new.scale_version_id and not (new.updated_by = any(authored_by) or new.updated_by = any(edited_by));
  end if;
  return new;
end;
$$;


-- ---- 4. groups from the assessment components ---------------------------------------------------------------

create or replace function public.asmt_scholar_prefill_groups(p_version uuid, p_actor uuid)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_state text;
  n int;
begin
  if p_actor is null or not public.individual_holds_capability(p_actor, 'hq.assessment.instrument.author') then
    raise exception 'asmt_scholar_prefill_groups: not authorised. Pre-filling needs the author capability';
  end if;
  select state into v_state from asmt_instrument_version where id = p_version;
  if not found then
    raise exception 'asmt_scholar_prefill_groups: version % not found', p_version;
  end if;
  if v_state <> 'draft' then
    raise exception 'asmt_scholar_prefill_groups: the version is % and its content is frozen', v_state;
  end if;
  insert into asmt_group (version_id, code, label, weight, position, source_ref, updated_by)
    select p_version, c.code, c.label, 1, c.sort_order, 'assessment_component:' || c.code, p_actor
      from competency_assessment_component c
     where c.is_active and c.code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$'
       and not exists (select 1 from asmt_group g where g.version_id = p_version and g.code = c.code)
     order by c.sort_order;
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ---- 5. the mapping check and the guard ----------------------------------------------------------------------

-- { ok, problems: [{ item, reason, message }] }. item is the item code (or the section title, or null for the
-- whole version). reason is one of: purpose_not_allowed, skill_missing, skill_inactive, wording_changed,
-- component_changed, competency_changed, hash_stale, not_clinically_approved.
create or replace function public.asmt_scholar_mapping_check(p_version uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v record;
  m record;
  sk record;
  v_problems jsonb := '[]'::jsonb;
  v_label text;
  v_hash text;
begin
  select purpose_code into v from asmt_instrument_version where id = p_version;
  if not found then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array(
      jsonb_build_object('item', null, 'reason', 'version_missing', 'message', 'The checklist version does not exist.')));
  end if;
  if v.purpose_code = 'verification' then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', null, 'reason', 'purpose_not_allowed',
      'message', 'The purpose verification is not available. A checklist is never formal verification.'));
  end if;

  for m in
    select mp.id, mp.ref_id, mp.ref_hash, mp.ref_snapshot,
           coalesce(i.code, case when i.id is not null then 'item ' || (i.position + 1)::text end,
                    case when s.id is not null then 'section ' || left(s.title, 30) end) as label
      from asmt_mapping mp
      left join asmt_item i on i.id = mp.item_id
      left join asmt_section s on s.id = mp.section_id
     where mp.version_id = p_version and mp.kind = 'competency_criterion' and mp.relation = 'assesses'
     order by i.position nulls last, mp.id
  loop
    v_label := m.label;
    select k.id, k.name, k.description, k.component_code, k.competency_id, k.is_active into sk from competency_skills k where k.id = m.ref_id;
    if m.ref_id is null or not found then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', v_label, 'reason', 'skill_missing',
        'message', coalesce(v_label, 'A mapping') || ': the criterion it assesses no longer exists.'));
      continue;
    end if;
    if sk.is_active is false then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', v_label, 'reason', 'skill_inactive',
        'message', coalesce(v_label, 'A mapping') || ': the criterion it assesses has been retired.'));
      continue;
    end if;
    if (m.ref_snapshot ->> 'wording') is distinct from sk.name
       or (m.ref_snapshot ? 'description' and coalesce(m.ref_snapshot ->> 'description', '') is distinct from coalesce(sk.description, '')) then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', v_label, 'reason', 'wording_changed',
        'message', coalesce(v_label, 'A mapping') || ': the criterion wording differs from the wording that was mapped.'));
    end if;
    if coalesce(m.ref_snapshot ->> 'component_code', '') is distinct from coalesce(sk.component_code, '') then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', v_label, 'reason', 'component_changed',
        'message', coalesce(v_label, 'A mapping') || ': the assessment component of the criterion differs from the one that was mapped.'));
    end if;
    if m.ref_snapshot ? 'competency_id' and (m.ref_snapshot ->> 'competency_id') is distinct from sk.competency_id::text then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', v_label, 'reason', 'competency_changed',
        'message', coalesce(v_label, 'A mapping') || ': the criterion now belongs to another competency.'));
    end if;
    v_hash := public.competency_content_hash(sk.competency_id);
    if m.ref_hash is distinct from v_hash then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', v_label, 'reason', 'hash_stale',
        'message', coalesce(v_label, 'A mapping') || ': the competency content changed since the criterion was mapped (stale content hash).'));
    end if;
    if not public.competency_clinically_approved(sk.competency_id) then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('item', v_label, 'reason', 'not_clinically_approved',
        'message', coalesce(v_label, 'A mapping') || ': the competency has no current clinical approval.'));
    end if;
  end loop;

  return jsonb_build_object('ok', jsonb_array_length(v_problems) = 0, 'problems', v_problems);
end;
$$;

create or replace function public.asmt_scholar_mapping_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_check jsonb := public.asmt_scholar_mapping_check(new.id);
  v_msg text;
  v_n int := jsonb_array_length(v_check -> 'problems');
begin
  if (v_check ->> 'ok')::boolean then
    return new;
  end if;
  select string_agg(p ->> 'message', ' ' order by ord) into v_msg
    from (select p, ord from jsonb_array_elements(v_check -> 'problems') with ordinality as t(p, ord) order by ord limit 3) s;
  raise exception 'asmt_instrument_version: the competency mappings are not ready (% problem(s)). %', v_n, v_msg;
end;
$$;


-- ---- 6. the criterion picker read ------------------------------------------------------------------------------

create or replace function public.asmt_scholar_criteria(p_framework_code text)
returns table (
  competency_id uuid, competency_code text, competency_name text, domain_name text, skill_id uuid, sort_order int,
  component_code text, wording text, framework_code text, framework_version text, framework_pub_status text,
  competency_hash text, clinically_approved boolean)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.id, c.code, c.name, d.name, s.id, s.sort_order, s.component_code, s.name, f.code,
         coalesce(f.version_major, 0)::text || '.' || coalesce(f.version_minor, 0)::text || '.' || coalesce(f.version_revision, 0)::text,
         f.pub_status, public.competency_content_hash(c.id), public.competency_clinically_approved(c.id)
    from frameworks f
    join framework_domains d on d.framework_id = f.id
    join framework_competencies c on c.domain_id = d.id
    join competency_skills s on s.competency_id = c.id
   where f.code = p_framework_code and f.hospital_id is null and s.is_active is not false
   order by d.sort_order, d.id, c.sort_order, c.id, s.sort_order, s.id
$$;


-- ---- 7. Scholar erasure of assessment rows ------------------------------------------------------------------------
--
-- The capture tables refuse to lose rows: a submitted instance is history, and the append-only trails refuse
-- DELETE unless it arrives through a cascade (pg_trigger_depth() greater than 1). The owner erasure of a
-- learner own data must still work without deleting the learner profile. So the erasure runs inside a trigger:
-- inserting a receipt row (counts only) fires asmt_scholar_erase_run, whose deletes then run one trigger level
-- deep and pass the cascade allowance. The guards of 890, 891 and 892 are not touched, and a plain DELETE of a
-- submitted instance is still refused. The Scholar erase route calls asmt_scholar_erase_user (service role).

create or replace function public.asmt_scholar_erase_run()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_counts jsonb;
  n_dec int;
  n_inst int;
  n_grant int;
begin
  v_counts := jsonb_build_object(
    'responses', (select count(*) from asmt_response where subject_user_id = new.user_id),
    'evidence', (select count(*) from asmt_evidence where subject_user_id = new.user_id),
    'comments', (select count(*) from asmt_comment where subject_user_id = new.user_id),
    'outcomes', (select count(*) from asmt_outcome where subject_user_id = new.user_id));
  delete from asmt_progression_decision where subject_user_id = new.user_id;
  get diagnostics n_dec = row_count;
  delete from asmt_instance where subject_user_id = new.user_id;
  get diagnostics n_inst = row_count;
  delete from asmt_respondent_grant where subject_user_id = new.user_id;
  get diagnostics n_grant = row_count;
  new.counts := v_counts || jsonb_build_object('progression_decisions', n_dec, 'instances', n_inst, 'grants', n_grant);
  return new;
end;
$$;

create or replace function public.asmt_scholar_erase_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_paths text[];
  v_counts jsonb;
begin
  if p_user is null or not exists (select 1 from profiles where id = p_user) then
    raise exception 'asmt_scholar_erase_user: unknown person';
  end if;
  select coalesce(array_agg(distinct e.storage_path), '{}') into v_paths
    from asmt_evidence e where e.subject_user_id = p_user and e.storage_path is not null;
  insert into asmt_scholar_erasure (user_id) values (p_user) returning counts into v_counts;
  return jsonb_build_object('counts', v_counts, 'storage_paths', to_jsonb(v_paths));
end;
$$;


-- ---- 8. execute rights: service role only -------------------------------------------------------------------------

revoke all on function public.asmt_scholar_scale_code(text, text) from public, anon, authenticated;
revoke all on function public.asmt_scholar_import_stage_scale(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.asmt_scholar_import_scale(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.asmt_scholar_stage_scale(uuid) from public, anon, authenticated;
revoke all on function public.asmt_scholar_stage_band_guard() from public, anon, authenticated;
revoke all on function public.asmt_scholar_prefill_groups(uuid, uuid) from public, anon, authenticated;
revoke all on function public.asmt_scholar_mapping_check(uuid) from public, anon, authenticated;
revoke all on function public.asmt_scholar_mapping_guard() from public, anon, authenticated;
revoke all on function public.asmt_scholar_criteria(text) from public, anon, authenticated;
revoke all on function public.asmt_scholar_erase_run() from public, anon, authenticated;
revoke all on function public.asmt_scholar_erase_user(uuid) from public, anon, authenticated;
grant execute on function public.asmt_scholar_scale_code(text, text) to service_role;
grant execute on function public.asmt_scholar_import_stage_scale(uuid, uuid, uuid) to service_role;
grant execute on function public.asmt_scholar_import_scale(uuid, uuid, uuid) to service_role;
grant execute on function public.asmt_scholar_stage_scale(uuid) to service_role;
grant execute on function public.asmt_scholar_prefill_groups(uuid, uuid) to service_role;
grant execute on function public.asmt_scholar_mapping_check(uuid) to service_role;
grant execute on function public.asmt_scholar_criteria(text) to service_role;
grant execute on function public.asmt_scholar_erase_user(uuid) to service_role;


-- ---- 9. triggers ---------------------------------------------------------------------------------------------------

drop trigger if exists asmt_scholar_stage_band_guard on asmt_scholar_stage_band;
create trigger asmt_scholar_stage_band_guard before insert or update or delete on asmt_scholar_stage_band
  for each row execute function public.asmt_scholar_stage_band_guard();

-- Named so that it fires AFTER asmt_instrument_version_lifecycle (triggers fire in name order): the lifecycle
-- guard refuses an illegal transition first, then this one checks the competency mappings.
drop trigger if exists asmt_instrument_version_scholar_check on asmt_instrument_version;
create trigger asmt_instrument_version_scholar_check before update on asmt_instrument_version
  for each row when (new.state is distinct from old.state and new.state in ('in_review', 'published'))
  execute function public.asmt_scholar_mapping_guard();

drop trigger if exists asmt_scholar_erasure_run on asmt_scholar_erasure;
create trigger asmt_scholar_erasure_run before insert on asmt_scholar_erasure
  for each row execute function public.asmt_scholar_erase_run();
drop trigger if exists asmt_scholar_erasure_append_only on asmt_scholar_erasure;
create trigger asmt_scholar_erasure_append_only before update or delete on asmt_scholar_erasure
  for each row execute function public.asmt_append_only_guard();


-- ---- Verification: the registry rows this adds, and the stage bands of any imported stage scale ------------------------

select 'mapping_kinds' as item, count(*)::text as value from asmt_mapping_kind
  where code in ('competency_criterion', 'competency', 'framework', 'programme_framework', 'qualification_level')
union all select 'methods', count(*)::text from asmt_method
  where code in ('self_assessment', 'direct_observation', 'knowledge_examination', 'simulation_osce', 'case_based', 'portfolio_review')
union all select 'purposes', count(*)::text from asmt_purpose where code in ('practice', 'diagnostic', 'formative', 'summative', 'verification')
union all select 'verification_publishable', coalesce((select publishable::text from asmt_purpose where code = 'verification'), 'missing')
union all select 'stage_bands', count(*)::text from asmt_scholar_stage_band;

notify pgrst, 'reload schema';
