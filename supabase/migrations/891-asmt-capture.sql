-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 891: UNIVERSAL ASSESSMENT ENGINE, CAPTURE (Checklist Studio, slice S1a)
--
-- Owner-approved Checklist Studio (2 Nov 2026). Design of record: the coordinator design for Assessment Studio
-- Phase 1 (3 Nov 2026), section 2 migration 891, with the owner multi-field addendum of 3 Nov 2026.
-- Staging first. Production needs its own owner GO and is applied by the owner by hand.
--
-- UNIVERSAL BY RULE. A subject is a kind (text) and an id. A respondent has a role. Nothing here names a
-- profession or a framework. The one call into an existing authority is competency_appointment_holds, which
-- checks that a named appointment holds a named capability for a named person.
--
-- DEPENDS ON 890 (definitions and governance), 641 (individual_holds_capability and
-- competency_appointment_holds) and 281 (plat_product_line). APPLY AFTER 890. Additive. Re-running it is a
-- no-op.
--
-- WHAT IT ADDS.
--   asmt_respondent_grant   who may assess or audit which subject with which definition. A grant is made by a
--                           holder of the assign capability (never for oneself, never to oneself), is live
--                           only once accepted, can be ended by either party and is never reopened.
--   asmt_instance           one use of a published version on one subject by one respondent. The attestation is
--                           fixed by the respondent role: self_reported or ai_assisted_formative only for a self
--                           respondent, assessor_evaluated only for an assessor, auditor_recorded only for an auditor. There is
--                           no verified value anywhere in the core. A non-self respondent needs a live grant
--                           and a current appointment holding the assess capability.
--   asmt_instance_layout    the layout versions pinned at start. Immutable.
--   asmt_response           one row per (instance, item, field_key). field_key primary is the item scored
--                           field. Other keys are the extra fields of the item and are never scored. The
--                           trigger validates the value against the response type and COMPUTES satisfactory.
--                           A writer cannot set it. A state (not assessed, not observed, not applicable,
--                           unable to demonstrate, unable to determine) is separate from any value. A not
--                           applicable state can require a reason, kept inside the json answer.
--   asmt_evidence, asmt_comment   append-only. Evidence takes a provenance snapshot by trigger.
--   asmt_outcome            append-only. One per instance. A database backstop forces the outcome class: a
--                           failed critical item gives a negative outcome and a missing or not assessed
--                           mandatory item gives an incomplete one, whatever the engine sent.
--   asmt_submit_instance    the one transaction that records the outcome and closes the instance.
--   RLS: every table on, one own-row SELECT policy on the person tables.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): PENDING-39/ROLLBACK-891.sql
-- ====================================================================================================


-- ---- 1. grants -----------------------------------------------------------------------------------------

create table if not exists asmt_respondent_grant (
  id              uuid primary key default gen_random_uuid(),
  instrument_id   uuid not null references asmt_instrument(id),
  subject_kind    text not null,
  subject_id      uuid not null,
  subject_user_id uuid references profiles(id) on delete cascade,
  respondent_id   uuid not null references profiles(id) on delete cascade,
  respondent_role text not null,
  appointment_id  uuid not null references ogs_office_appointments(id) on delete cascade,
  granted_by      uuid not null,
  reason          text not null,
  valid_from      timestamptz not null default now(),
  valid_until     timestamptz,
  accepted_at     timestamptz,
  accepted_by     uuid,
  ended_at        timestamptz,
  ended_by        uuid,
  end_reason      text,
  created_at      timestamptz not null default now(),
  unique (id, subject_user_id),
  constraint asmt_respondent_grant_kind_check check (subject_kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_respondent_grant_person_check check ((subject_kind = 'person') = (subject_user_id is not null and subject_id = subject_user_id)),
  constraint asmt_respondent_grant_role_check check (respondent_role in ('assessor', 'auditor')),
  constraint asmt_respondent_grant_apart_check check (
    respondent_id is distinct from subject_user_id and granted_by <> respondent_id and granted_by is distinct from subject_user_id),
  constraint asmt_respondent_grant_window_check check (valid_until is null or valid_until > valid_from),
  constraint asmt_respondent_grant_reason_check check (char_length(btrim(reason)) between 3 and 1000),
  constraint asmt_respondent_grant_accept_check check ((accepted_at is null) = (accepted_by is null)),
  constraint asmt_respondent_grant_end_check check (
    (ended_at is null) = (ended_by is null) and (ended_at is null or char_length(btrim(coalesce(end_reason, ''))) between 3 and 1000))
);
create index if not exists idx_asmt_respondent_grant_respondent on asmt_respondent_grant (respondent_id);
create index if not exists idx_asmt_respondent_grant_subject on asmt_respondent_grant (subject_user_id);
alter table asmt_respondent_grant enable row level security;


-- ---- 2. instances ----------------------------------------------------------------------------------------

create table if not exists asmt_instance (
  id                    uuid primary key default gen_random_uuid(),
  instrument_version_id uuid not null references asmt_instrument_version(id),
  subject_kind          text not null,
  subject_id            uuid not null,
  subject_user_id       uuid references profiles(id) on delete cascade,
  respondent_role       text not null,
  respondent_id         uuid references profiles(id) on delete set null,
  respondent_snapshot   jsonb not null default '{}',
  grant_id              uuid references asmt_respondent_grant(id),
  owner_scope           text not null,
  owner_product_line    text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id         uuid references profiles(id),
  owner_instrument_id   uuid references asmt_instrument(id),
  context_product_line  text references plat_product_line(code),
  status                text not null default 'in_progress',
  attestation           text not null,
  amends_instance_id    uuid references asmt_instance(id),
  started_at            timestamptz not null default now(),
  submitted_at          timestamptz,
  unique (id, subject_user_id),
  unique (id, instrument_version_id),
  constraint asmt_instance_kind_check check (subject_kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_instance_person_check check ((subject_kind = 'person') = (subject_user_id is not null and subject_id = subject_user_id)),
  constraint asmt_instance_role_check check (respondent_role in ('self', 'assessor', 'auditor')),
  constraint asmt_instance_attestation_check check (
    attestation in ('self_reported', 'ai_assisted_formative', 'assessor_evaluated', 'auditor_recorded')
    and (respondent_role = 'self') = (attestation in ('self_reported', 'ai_assisted_formative'))
    and (respondent_role = 'assessor') = (attestation = 'assessor_evaluated')
    and (respondent_role = 'auditor') = (attestation = 'auditor_recorded')),
  constraint asmt_instance_self_check check (respondent_role <> 'self' or (respondent_id = subject_user_id and grant_id is null)),
  constraint asmt_instance_status_check check (status in ('in_progress', 'submitted', 'withdrawn') and ((status = 'submitted') = (submitted_at is not null))),
  constraint asmt_instance_snapshot_check check (jsonb_typeof(respondent_snapshot) = 'object'),
  constraint asmt_instance_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual', 'instrument')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)
         or (owner_scope = 'instrument' and owner_instrument_id is not null)))
);
create index if not exists idx_asmt_instance_subject on asmt_instance (subject_user_id, status);
create index if not exists idx_asmt_instance_respondent on asmt_instance (respondent_id, status);
create index if not exists idx_asmt_instance_version on asmt_instance (instrument_version_id);
alter table asmt_instance enable row level security;

create table if not exists asmt_instance_layout (
  instance_id       uuid not null references asmt_instance(id) on delete cascade,
  layout_version_id uuid not null references asmt_layout_template_version(id),
  is_primary        boolean not null default false,
  created_at        timestamptz not null default now(),
  primary key (instance_id, layout_version_id)
);
create unique index if not exists ux_asmt_instance_layout_one_primary
  on asmt_instance_layout (instance_id, (case when is_primary then 1 end));
alter table asmt_instance_layout enable row level security;


-- ---- 3. responses, evidence, comments, outcomes --------------------------------------------------------------

create table if not exists asmt_response (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null,
  version_id      uuid not null,
  item_id         uuid not null,
  field_key       text not null default 'primary',
  value           jsonb not null,
  level_code      text,
  state           text,
  satisfactory    boolean,
  revision        int not null default 1,
  subject_user_id uuid,
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (instance_id, item_id, field_key),
  foreign key (instance_id, version_id) references asmt_instance (id, instrument_version_id) on delete cascade,
  foreign key (item_id, version_id) references asmt_item (id, version_id),
  foreign key (instance_id, subject_user_id) references asmt_instance (id, subject_user_id) on delete cascade,
  constraint asmt_response_key_check check (field_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_response_state_check check (state is null or state in (
    'not_assessed', 'not_observed', 'not_applicable', 'unable_to_demonstrate', 'unable_to_determine')),
  constraint asmt_response_value_check check (jsonb_typeof(value) = 'object'),
  constraint asmt_response_primary_only_check check (field_key = 'primary' or satisfactory is null)
);
create index if not exists idx_asmt_response_instance on asmt_response (instance_id);
alter table asmt_response enable row level security;

create table if not exists asmt_evidence (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null,
  version_id      uuid not null,
  subject_user_id uuid,
  item_id         uuid,
  kind            text not null,
  ref_kind        text,
  ref_id          uuid,
  storage_path    text,
  note            text,
  provenance      jsonb not null default '{}',
  added_by        uuid,
  created_at      timestamptz not null default now(),
  foreign key (instance_id, version_id) references asmt_instance (id, instrument_version_id) on delete cascade,
  foreign key (item_id, version_id) references asmt_item (id, version_id),
  foreign key (instance_id, subject_user_id) references asmt_instance (id, subject_user_id) on delete cascade,
  constraint asmt_evidence_kind_check check (kind in ('upload', 'note', 'record_ref')),
  constraint asmt_evidence_shape_check check (
    (kind = 'upload' and storage_path is not null)
    or (kind = 'note' and char_length(btrim(coalesce(note, ''))) between 1 and 4000)
    or (kind = 'record_ref' and ref_kind is not null and ref_id is not null)),
  constraint asmt_evidence_provenance_check check (jsonb_typeof(provenance) = 'object')
);
create index if not exists idx_asmt_evidence_instance on asmt_evidence (instance_id);
alter table asmt_evidence enable row level security;

create table if not exists asmt_comment (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null,
  version_id      uuid not null,
  subject_user_id uuid,
  item_id         uuid,
  kind            text not null default 'comment',
  body            text not null,
  author_id       uuid,
  created_at      timestamptz not null default now(),
  foreign key (instance_id, version_id) references asmt_instance (id, instrument_version_id) on delete cascade,
  foreign key (item_id, version_id) references asmt_item (id, version_id),
  foreign key (instance_id, subject_user_id) references asmt_instance (id, subject_user_id) on delete cascade,
  constraint asmt_comment_kind_check check (kind in ('comment', 'safety_concern', 'strength', 'recommendation')),
  constraint asmt_comment_body_check check (char_length(btrim(body)) between 1 and 4000)
);
create index if not exists idx_asmt_comment_instance on asmt_comment (instance_id);
alter table asmt_comment enable row level security;

create table if not exists asmt_outcome (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null,
  version_id      uuid not null,
  subject_user_id uuid,
  engine_version  text not null,
  rules_hash      text,
  outcome_code    text not null,
  outcome_class   text not null,
  group_outcomes  jsonb not null default '{}',
  aggregates      jsonb not null default '{}',
  trace           jsonb not null default '{}',
  trace_hash      text,
  backstop_applied boolean not null default false,
  backstop_detail jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  unique (instance_id),
  unique (id, subject_user_id),
  foreign key (instance_id, version_id) references asmt_instance (id, instrument_version_id) on delete cascade,
  foreign key (instance_id, subject_user_id) references asmt_instance (id, subject_user_id) on delete cascade,
  constraint asmt_outcome_class_check check (outcome_class in ('positive', 'partial', 'negative', 'incomplete')),
  constraint asmt_outcome_code_check check (btrim(outcome_code) <> '' and btrim(engine_version) <> '')
);
alter table asmt_outcome enable row level security;


-- ---- 4. functions ------------------------------------------------------------------------------------------

create or replace function public.asmt_grant_is_live(p_grant uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from asmt_respondent_grant g
     where g.id = p_grant and g.accepted_at is not null and g.ended_at is null
       and g.valid_from <= now() and (g.valid_until is null or g.valid_until > now()))
$$;

-- Validates one value against its response type and computes satisfactory. problem is null when sound.
create or replace function public.asmt_response_evaluate(p_type text, p_scale uuid, p_config jsonb,
  p_level text, p_state text, p_value jsonb, p_reason text,
  out problem text, out satisfactory boolean)
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_level record;
  v_num numeric;
  v_opt jsonb;
  v_sel jsonb;
  v_code text;
  v_all_true boolean := true;
  v_any_false boolean := false;
  v_n int := 0;
  v_ts timestamptz;
  v_cfg jsonb := coalesce(p_config, '{}'::jsonb);
  v_raw jsonb;
begin
  problem := null;
  satisfactory := null;

  if p_state is not null then
    if p_level is not null or (p_value is not null and jsonb_typeof(p_value) <> 'null') then
      problem := 'a state carries no level and no value';
      return;
    end if;
    if p_state <> 'not_assessed'
       and not (coalesce(v_cfg -> 'allowedStates', '[]'::jsonb) ? p_state)
       and not (p_type = 'rating_scale' and exists (
              select 1 from asmt_response_scale_state s where s.version_id = p_scale and s.state = p_state)) then
      problem := 'the state ' || p_state || ' is not allowed for this field';
      return;
    end if;
    if p_state = 'not_applicable' and coalesce((v_cfg ->> 'naReasonRequired')::boolean, false)
       and btrim(coalesce(p_reason, '')) = '' then
      problem := 'a not applicable answer to this field needs a reason';
      return;
    end if;
    -- unable to demonstrate is a failure to meet the item. Every other state says nothing about it.
    satisfactory := case when p_state = 'unable_to_demonstrate' then false else null end;
    return;
  end if;

  if p_type <> 'rating_scale' and p_level is not null then
    problem := 'only a rating scale field carries a level';
    return;
  end if;

  if p_type = 'rating_scale' then
    if p_level is null or (p_value is not null and jsonb_typeof(p_value) <> 'null') then
      problem := 'a rating scale answer is a level and nothing else';
      return;
    end if;
    select l.satisfactory as sat into v_level from asmt_response_scale_level l where l.version_id = p_scale and l.code = p_level;
    if not found then
      problem := 'the level ' || p_level || ' is not on the scale';
      return;
    end if;
    satisfactory := v_level.sat;
  elsif p_type = 'yes_no' then
    if p_value is null or jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('yes', 'no') then
      problem := 'a yes or no answer is the text yes or no'; return;
    end if;
    satisfactory := ((p_value #>> '{}') = coalesce(v_cfg ->> 'satisfactoryValue', 'yes'));
  elsif p_type = 'pass_fail' then
    if p_value is null or jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('pass', 'fail') then
      problem := 'a pass or fail answer is the text pass or fail'; return;
    end if;
    satisfactory := ((p_value #>> '{}') = coalesce(v_cfg ->> 'satisfactoryValue', 'pass'));
  elsif p_type = 'achieved' then
    if p_value is null or jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('achieved', 'not_achieved') then
      problem := 'an achieved answer is the text achieved or not_achieved'; return;
    end if;
    satisfactory := ((p_value #>> '{}') = coalesce(v_cfg ->> 'satisfactoryValue', 'achieved'));
  elsif p_type in ('numeric_rating', 'measurement') then
    v_raw := p_value;
    if p_type = 'measurement' and p_value is not null and jsonb_typeof(p_value) = 'object' then
      v_raw := p_value -> 'value';
    end if;
    if v_raw is null or jsonb_typeof(v_raw) <> 'number' then problem := 'a numeric answer is a number'; return; end if;
    v_num := (v_raw #>> '{}')::numeric;
    if v_cfg ? 'min' and v_num < (v_cfg ->> 'min')::numeric then problem := 'the value is below the minimum'; return; end if;
    if v_cfg ? 'max' and v_num > (v_cfg ->> 'max')::numeric then problem := 'the value is above the maximum'; return; end if;
    if v_cfg ? 'satisfactoryMin' or v_cfg ? 'satisfactoryMax' then
      satisfactory := (not (v_cfg ? 'satisfactoryMin') or v_num >= (v_cfg ->> 'satisfactoryMin')::numeric)
                  and (not (v_cfg ? 'satisfactoryMax') or v_num <= (v_cfg ->> 'satisfactoryMax')::numeric);
    end if;
  elsif p_type = 'multiple_choice' then
    if coalesce(v_cfg ->> 'select', 'single') = 'multi' then
      if p_value is null or jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) < 1 then
        problem := 'a multiple selection is a non-empty list of option codes'; return;
      end if;
      for v_sel in select jsonb_array_elements(p_value) loop
        if jsonb_typeof(v_sel) <> 'string' then problem := 'each selection is an option code'; return; end if;
        v_code := v_sel #>> '{}';
        select o into v_opt from jsonb_array_elements(v_cfg -> 'options') o where o ->> 'code' = v_code limit 1;
        if v_opt is null then problem := 'the option ' || v_code || ' does not exist'; return; end if;
        v_n := v_n + 1;
        if (v_opt ->> 'satisfactory') is distinct from 'true' then v_all_true := false; end if;
        if (v_opt ->> 'satisfactory') = 'false' then v_any_false := true; end if;
      end loop;
      if v_n <> (select count(distinct x) from jsonb_array_elements_text(p_value) x) then
        problem := 'an option is selected twice'; return;
      end if;
      satisfactory := case when v_any_false then false when v_all_true then true else null end;
    else
      if p_value is null or jsonb_typeof(p_value) <> 'string' then problem := 'a single choice is one option code'; return; end if;
      v_code := p_value #>> '{}';
      select o into v_opt from jsonb_array_elements(v_cfg -> 'options') o where o ->> 'code' = v_code limit 1;
      if v_opt is null then problem := 'the option ' || v_code || ' does not exist'; return; end if;
      satisfactory := (v_opt ->> 'satisfactory')::boolean;
    end if;
  elsif p_type = 'free_text' then
    if p_value is null or jsonb_typeof(p_value) <> 'string' or char_length(btrim(p_value #>> '{}')) < 1 then
      problem := 'a text answer is non-empty text'; return;
    end if;
    if char_length(p_value #>> '{}') > coalesce((v_cfg ->> 'maxLength')::numeric, 10000) then
      problem := 'the text is longer than allowed'; return;
    end if;
  elsif p_type = 'datetime' then
    if p_value is null or jsonb_typeof(p_value) <> 'string' then problem := 'a date and time answer is text'; return; end if;
    begin
      v_ts := (p_value #>> '{}')::timestamptz;
    exception when others then
      problem := 'that is not a date and time'; return;
    end;
  elsif p_type = 'evidence' then
    -- the answer is the number of attachments. The item is satisfied when the count reaches minCount (default 1).
    if p_value is null or jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0 then
      problem := 'an evidence answer is the number of attachments'; return;
    end if;
    satisfactory := ((p_value #>> '{}')::numeric >= coalesce((v_cfg ->> 'minCount')::numeric, 1));
  elsif p_type = 'na' then
    if p_value is null or jsonb_typeof(p_value) = 'null' then problem := 'this answer needs a value'; return; end if;
  else
    problem := 'unknown response type ' || coalesce(p_type, 'null');
  end if;
end;
$$;

-- What the database forces whatever the engine sent. Primary fields only.
create or replace function public.asmt_submit_backstop(p_instance uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_version uuid;
  v_critical jsonb;
  v_missing jsonb;
begin
  select instrument_version_id into v_version from asmt_instance where id = p_instance;
  select coalesce(jsonb_agg(i.stable_key order by i.position, i.id), '[]'::jsonb) into v_critical
    from asmt_item i
    join asmt_response r on r.item_id = i.id and r.instance_id = p_instance and r.field_key = 'primary'
   where i.version_id = v_version and i.critical
     and (((cardinality(i.critical_requirements) = 0 or i.critical_requirements @> array['must_be_satisfactory'] or i.critical_requirements @> array['auto_fail'])
           and r.satisfactory = false)
          or (i.critical_requirements @> array['must_be_observed'] and r.state = 'not_observed'));
  select coalesce(jsonb_agg(i.stable_key order by i.position, i.id), '[]'::jsonb) into v_missing
    from asmt_item i
   where i.version_id = v_version and i.mandatory
     and (not exists (select 1 from asmt_response r where r.instance_id = p_instance and r.item_id = i.id and r.field_key = 'primary')
          or exists (select 1 from asmt_response r where r.instance_id = p_instance and r.item_id = i.id and r.field_key = 'primary' and r.state = 'not_assessed'));
  return jsonb_build_object('criticalFailed', v_critical, 'mandatoryMissing', v_missing);
end;
$$;

create or replace function public.asmt_respondent_grant_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v record;
  v_assess text;
  v_assign text;
  v_allowed text[];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'asmt_respondent_grant: a grant is kept as history. End it instead of deleting it';
  end if;

  if tg_op = 'INSERT' then
    if new.accepted_at is not null or new.ended_at is not null then
      raise exception 'asmt_respondent_grant: a new grant is neither accepted nor ended';
    end if;
    select assess_capability, assign_capability, respondent_roles into v
      from asmt_instrument_version
     where instrument_id = new.instrument_id and state = 'published'
     order by version_no desc limit 1;
    if not found then
      raise exception 'asmt_respondent_grant: the definition has no published version';
    end if;
    if not (new.respondent_role = any(v.respondent_roles)) then
      raise exception 'asmt_respondent_grant: the definition does not allow a % respondent', new.respondent_role;
    end if;
    v_assess := coalesce(v.assess_capability, 'hq.assessment.instrument.assess');
    v_assign := coalesce(v.assign_capability, 'hq.assessment.assessor.assign');
    if new.respondent_id = new.subject_user_id or new.granted_by = new.respondent_id or new.granted_by is not distinct from new.subject_user_id then
      raise exception 'asmt_respondent_grant: not independent. Nobody grants themselves authority and nobody grants authority over themselves';
    end if;
    if not public.individual_holds_capability(new.granted_by, v_assign) then
      raise exception 'asmt_respondent_grant: not authorised. Granting needs %', v_assign;
    end if;
    if not public.competency_appointment_holds(new.appointment_id, new.respondent_id, v_assess) then
      raise exception 'asmt_respondent_grant: the respondent appointment does not hold %', v_assess;
    end if;
    return new;
  end if;

  -- UPDATE: accept, or end. Nothing else changes and an ended grant never reopens.
  if old.ended_at is not null then
    raise exception 'asmt_respondent_grant: an ended grant is history and is never reopened';
  end if;
  if old.accepted_at is null and new.accepted_at is not null then
    if new.accepted_by is distinct from coalesce(old.subject_user_id, old.respondent_id) then
      raise exception 'asmt_respondent_grant: a grant is accepted by the subject person, or by the respondent when the subject is not a person';
    end if;
    new.accepted_at := now();
    v_allowed := array['accepted_at', 'accepted_by'];
  elsif new.ended_at is not null then
    if new.ended_by is null or not (new.ended_by = old.respondent_id or new.ended_by is not distinct from old.subject_user_id
         or new.ended_by = old.granted_by
         or public.individual_holds_capability(new.ended_by, coalesce(
              (select assign_capability from asmt_instrument_version where instrument_id = old.instrument_id and state = 'published' order by version_no desc limit 1),
              'hq.assessment.assessor.assign'))) then
      raise exception 'asmt_respondent_grant: a grant is ended by the subject, the respondent, the granter or a holder of the assign capability';
    end if;
    new.ended_at := now();
    v_allowed := array['ended_at', 'ended_by', 'end_reason'];
  else
    raise exception 'asmt_respondent_grant: only accepting and ending change a grant';
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'asmt_respondent_grant: this step changes nothing but its own columns';
  end if;
  return new;
end;
$$;

create or replace function public.asmt_instance_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v record;
  g record;
  v_cap text;
  v_allowed text[];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.status <> 'submitted' then
      return old;
    end if;
    raise exception 'asmt_instance: a submitted instance is kept as history';
  end if;

  if tg_op = 'INSERT' then
    select state, instrument_id, respondent_roles, assess_capability into v from asmt_instrument_version where id = new.instrument_version_id;
    if not found or v.state <> 'published' then
      raise exception 'asmt_instance: an instance starts only from a published version';
    end if;
    if not (new.respondent_role = any(v.respondent_roles)) then
      raise exception 'asmt_instance: the definition does not allow a % respondent', new.respondent_role;
    end if;
    new.status := 'in_progress';
    new.submitted_at := null;
    if new.amends_instance_id is not null and not exists (
         select 1 from asmt_instance a where a.id = new.amends_instance_id and a.status = 'submitted'
            and a.subject_kind = new.subject_kind and a.subject_id = new.subject_id) then
      raise exception 'asmt_instance: an amendment follows a submitted instance of the same subject';
    end if;
    if new.respondent_role <> 'self' then
      if new.respondent_id is null or new.respondent_id is not distinct from new.subject_user_id then
        raise exception 'asmt_instance: not independent. A non-self respondent is somebody other than the subject';
      end if;
      select * into g from asmt_respondent_grant where id = new.grant_id;
      if not found or g.instrument_id <> v.instrument_id or g.respondent_id <> new.respondent_id
         or g.subject_kind <> new.subject_kind or g.subject_id <> new.subject_id or g.respondent_role <> new.respondent_role then
        raise exception 'asmt_instance: the grant does not match this definition, respondent and subject';
      end if;
      if not public.asmt_grant_is_live(g.id) then
        raise exception 'asmt_instance: the grant is not live (it must be accepted, not ended and within its dates)';
      end if;
      v_cap := coalesce(v.assess_capability, 'hq.assessment.instrument.assess');
      if not public.competency_appointment_holds(g.appointment_id, new.respondent_id, v_cap) then
        raise exception 'asmt_instance: the respondent appointment does not hold % now', v_cap;
      end if;
      new.respondent_snapshot := jsonb_build_object(
        'grantId', g.id, 'appointmentId', g.appointment_id, 'capability', v_cap, 'capturedAt', now(),
        'positionCode', (select a.role from ogs_office_appointments a where a.id = g.appointment_id));
    end if;
    return new;
  end if;

  -- UPDATE
  if pg_trigger_depth() > 1 and new.respondent_id is null and old.respondent_id is not null
     and (to_jsonb(new) - 'respondent_id') = (to_jsonb(old) - 'respondent_id') then
    return new;
  end if;
  if old.status <> 'in_progress' then
    raise exception 'asmt_instance: a % instance is final', old.status;
  end if;
  if new.status = 'submitted' then
    if not exists (select 1 from asmt_outcome o where o.instance_id = old.id) then
      raise exception 'asmt_instance: an instance is submitted only with its outcome (use asmt_submit_instance)';
    end if;
    new.submitted_at := now();
    v_allowed := array['status', 'submitted_at'];
  elsif new.status = 'withdrawn' then
    v_allowed := array['status'];
  else
    raise exception 'asmt_instance: only submission or withdrawal changes an instance';
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'asmt_instance: this step changes nothing but its status';
  end if;
  return new;
end;
$$;

create or replace function public.asmt_instance_layout_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_inst record;
  v_layout_state text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'asmt_instance_layout: the pinned layouts of an instance never change';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'asmt_instance_layout: the pinned layouts of an instance never change';
  end if;
  select i.status, i.instrument_version_id, v.default_layout_version_id into v_inst
    from asmt_instance i join asmt_instrument_version v on v.id = i.instrument_version_id where i.id = new.instance_id;
  if not found or v_inst.status <> 'in_progress' then
    raise exception 'asmt_instance_layout: layouts are pinned only at the start of an instance in progress';
  end if;
  select state into v_layout_state from asmt_layout_template_version where id = new.layout_version_id;
  if v_layout_state is distinct from 'published' then
    raise exception 'asmt_instance_layout: only a published layout version can be pinned';
  end if;
  if new.layout_version_id is distinct from v_inst.default_layout_version_id
     and not exists (select 1 from asmt_version_layout l where l.version_id = v_inst.instrument_version_id and l.layout_version_id = new.layout_version_id) then
    raise exception 'asmt_instance_layout: that layout is not one the definition allows';
  end if;
  return new;
end;
$$;

create or replace function public.asmt_response_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_inst record;
  v_item record;
  v_field record;
  v_type text;
  v_scale uuid;
  v_config jsonb;
  v_res record;
  v_n int;
begin
  if tg_op = 'DELETE' then
    select status into v_inst from asmt_instance where id = old.instance_id;
    if not found or v_inst.status = 'in_progress' then
      return old;
    end if;
    raise exception 'asmt_response: the answers of a % instance are final', v_inst.status;
  end if;

  select status, subject_user_id into v_inst from asmt_instance where id = new.instance_id;
  if not found or v_inst.status <> 'in_progress' then
    raise exception 'asmt_response: answers change only while the instance is in progress';
  end if;
  if tg_op = 'UPDATE' then
    if new.instance_id <> old.instance_id or new.item_id <> old.item_id or new.version_id <> old.version_id or new.field_key <> old.field_key then
      raise exception 'asmt_response: an answer never moves to another item or field';
    end if;
    new.revision := old.revision + 1;
  else
    new.revision := 1;
  end if;

  select response_type, scale_version_id, config into v_item from asmt_item where id = new.item_id;
  if new.field_key = 'primary' then
    v_type := v_item.response_type; v_scale := v_item.scale_version_id; v_config := v_item.config;
  else
    select response_type, scale_version_id, config into v_field from asmt_item_field where item_id = new.item_id and field_key = new.field_key;
    if not found then
      raise exception 'asmt_response: the item has no field %', new.field_key;
    end if;
    v_type := v_field.response_type; v_scale := v_field.scale_version_id; v_config := v_field.config;
  end if;

  -- the answer is ONE json object: exactly one of level_code, state or value, and an optional reason
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception 'asmt_response: the answer is a json object';
  end if;
  if (select count(*) from jsonb_object_keys(new.value) k where k not in ('level_code', 'state', 'value', 'reason')) > 0 then
    raise exception 'asmt_response: the answer holds only level_code, state, value and reason';
  end if;
  v_n := (case when new.value ? 'level_code' then 1 else 0 end) + (case when new.value ? 'state' then 1 else 0 end) + (case when new.value ? 'value' then 1 else 0 end);
  if v_n <> 1 then
    raise exception 'asmt_response: the answer holds exactly one of level_code, state or value';
  end if;
  if new.value ? 'reason' and jsonb_typeof(new.value -> 'reason') not in ('string', 'null') then
    raise exception 'asmt_response: the reason is text';
  end if;
  if (new.value ? 'level_code' and jsonb_typeof(new.value -> 'level_code') <> 'string') or (new.value ? 'state' and jsonb_typeof(new.value -> 'state') <> 'string') then
    raise exception 'asmt_response: level_code and state are text';
  end if;
  new.level_code := new.value ->> 'level_code';
  new.state := new.value ->> 'state';
  select * into v_res from public.asmt_response_evaluate(v_type, v_scale, v_config, new.level_code, new.state, new.value -> 'value', new.value ->> 'reason');
  if v_res.problem is not null then
    raise exception 'asmt_response: %', v_res.problem;
  end if;
  new.satisfactory := case when new.field_key = 'primary' then v_res.satisfactory else null end;
  new.subject_user_id := v_inst.subject_user_id;
  new.updated_at := now();
  return new;
end;
$$;

-- Evidence and comments take their subject and version from the instance.
create or replace function public.asmt_note_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_inst record;
  v_stable uuid;
begin
  select i.status, i.subject_user_id, i.instrument_version_id into v_inst from asmt_instance i where i.id = new.instance_id;
  if not found then
    raise exception '%: the instance does not exist', tg_table_name;
  end if;
  if tg_table_name = 'asmt_evidence' and v_inst.status <> 'in_progress' then
    raise exception 'asmt_evidence: evidence is added only while the instance is in progress';
  end if;
  if tg_table_name = 'asmt_comment' and v_inst.status = 'withdrawn' then
    raise exception 'asmt_comment: a withdrawn instance takes no comment';
  end if;
  if new.version_id is not null and new.version_id <> v_inst.instrument_version_id then
    raise exception '%: the version is not the version of the instance', tg_table_name;
  end if;
  new.version_id := v_inst.instrument_version_id;
  new.subject_user_id := v_inst.subject_user_id;
  if tg_table_name = 'asmt_evidence' then
    if new.item_id is not null then
      select stable_key into v_stable from asmt_item where id = new.item_id;
    end if;
    new.provenance := coalesce(new.provenance, '{}'::jsonb) || jsonb_build_object(
      'capturedAt', now(), 'instrumentVersionId', v_inst.instrument_version_id, 'itemStableKey', v_stable);
  end if;
  return new;
end;
$$;

-- One outcome per instance. The database backstop decides the class when the engine and the facts disagree.
create or replace function public.asmt_outcome_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_inst record;
  v_ver record;
  v_back jsonb;
  v_gate text;
  v_class text;
begin
  select i.status, i.subject_user_id, i.instrument_version_id into v_inst from asmt_instance i where i.id = new.instance_id;
  if not found or v_inst.status <> 'in_progress' then
    raise exception 'asmt_outcome: an outcome is recorded once, for an instance in progress';
  end if;
  select scoring, scoring_hash into v_ver from asmt_instrument_version where id = v_inst.instrument_version_id;
  if new.rules_hash is distinct from v_ver.scoring_hash then
    raise exception 'asmt_outcome: the scoring rules hash does not match the published version';
  end if;
  new.version_id := v_inst.instrument_version_id;
  new.subject_user_id := v_inst.subject_user_id;

  v_back := public.asmt_submit_backstop(new.instance_id);
  v_class := null;
  if jsonb_array_length(v_back -> 'criticalFailed') > 0 and new.outcome_class <> 'negative' then
    v_class := 'negative'; v_gate := v_ver.scoring -> 'gates' ->> 'criticalFail';
  elsif jsonb_array_length(v_back -> 'mandatoryMissing') > 0 and jsonb_array_length(v_back -> 'criticalFailed') = 0
        and new.outcome_class not in ('incomplete', 'negative') then
    v_class := 'incomplete'; v_gate := v_ver.scoring -> 'gates' ->> 'mandatoryMissing';
  end if;
  if v_class is not null then
    if v_gate is null or not exists (
         select 1 from jsonb_array_elements(coalesce(v_ver.scoring -> 'outcomes', '[]'::jsonb)) o
          where o ->> 'code' = v_gate and o ->> 'class' = v_class) then
      raise exception 'asmt_outcome: the facts force a % outcome but the scoring rules declare no gate outcome of that class', v_class;
    end if;
    new.backstop_detail := v_back || jsonb_build_object('engineOutcomeCode', new.outcome_code, 'engineOutcomeClass', new.outcome_class);
    new.outcome_code := v_gate;
    new.outcome_class := v_class;
    new.backstop_applied := true;
  end if;
  return new;
end;
$$;

-- The one transaction that records the outcome and closes the instance.
create or replace function public.asmt_submit_instance(p_instance uuid, p_actor uuid, p_outcome jsonb, p_engine text, p_hash text)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  i record;
  v record;
  g record;
  v_cap text;
  v_id uuid;
begin
  select * into i from asmt_instance where id = p_instance for update;
  if not found then
    raise exception 'asmt_submit_instance: no such instance';
  end if;
  if i.status <> 'in_progress' then
    raise exception 'asmt_submit_instance: the instance is %', i.status;
  end if;
  if p_actor is null or i.respondent_id is distinct from p_actor then
    raise exception 'asmt_submit_instance: only the respondent submits an instance';
  end if;
  select state, instrument_id, assess_capability, scoring_hash into v from asmt_instrument_version where id = i.instrument_version_id;
  if v.state not in ('published', 'retired') then
    raise exception 'asmt_submit_instance: the version is not published';
  end if;
  if p_hash is distinct from v.scoring_hash then
    raise exception 'asmt_submit_instance: the scoring rules hash does not match the published version';
  end if;
  if i.respondent_role <> 'self' then
    select * into g from asmt_respondent_grant where id = i.grant_id;
    if not found or not public.asmt_grant_is_live(g.id) then
      raise exception 'asmt_submit_instance: the grant is no longer live';
    end if;
    v_cap := coalesce(v.assess_capability, 'hq.assessment.instrument.assess');
    if not public.competency_appointment_holds(g.appointment_id, p_actor, v_cap) then
      raise exception 'asmt_submit_instance: the respondent appointment no longer holds %', v_cap;
    end if;
  end if;
  insert into asmt_outcome (instance_id, version_id, subject_user_id, engine_version, rules_hash, outcome_code, outcome_class,
                            group_outcomes, aggregates, trace, trace_hash)
  values (p_instance, i.instrument_version_id, i.subject_user_id, p_engine, p_hash,
          p_outcome ->> 'outcomeCode', p_outcome ->> 'outcomeClass',
          coalesce(p_outcome -> 'groupOutcomes', '{}'::jsonb), coalesce(p_outcome -> 'aggregates', '{}'::jsonb),
          coalesce(p_outcome -> 'trace', '{}'::jsonb), p_outcome ->> 'traceHash')
  returning id into v_id;
  update asmt_instance set status = 'submitted' where id = p_instance;
  return v_id;
end;
$$;

revoke all on function public.asmt_grant_is_live(uuid) from public, anon, authenticated;
revoke all on function public.asmt_response_evaluate(text, uuid, jsonb, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.asmt_submit_backstop(uuid) from public, anon, authenticated;
revoke all on function public.asmt_respondent_grant_guard() from public, anon, authenticated;
revoke all on function public.asmt_instance_guard() from public, anon, authenticated;
revoke all on function public.asmt_instance_layout_guard() from public, anon, authenticated;
revoke all on function public.asmt_response_guard() from public, anon, authenticated;
revoke all on function public.asmt_note_guard() from public, anon, authenticated;
revoke all on function public.asmt_outcome_guard() from public, anon, authenticated;
revoke all on function public.asmt_submit_instance(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.asmt_grant_is_live(uuid) to service_role;
grant execute on function public.asmt_response_evaluate(text, uuid, jsonb, text, text, jsonb, text) to service_role;
grant execute on function public.asmt_submit_backstop(uuid) to service_role;
grant execute on function public.asmt_submit_instance(uuid, uuid, jsonb, text, text) to service_role;


-- ---- 5. triggers ---------------------------------------------------------------------------------------------

drop trigger if exists asmt_respondent_grant_guard on asmt_respondent_grant;
create trigger asmt_respondent_grant_guard before insert or update or delete on asmt_respondent_grant
  for each row execute function public.asmt_respondent_grant_guard();
drop trigger if exists asmt_instance_guard on asmt_instance;
create trigger asmt_instance_guard before insert or update or delete on asmt_instance
  for each row execute function public.asmt_instance_guard();
drop trigger if exists asmt_instance_layout_guard on asmt_instance_layout;
create trigger asmt_instance_layout_guard before insert or update or delete on asmt_instance_layout
  for each row execute function public.asmt_instance_layout_guard();
drop trigger if exists asmt_response_guard on asmt_response;
create trigger asmt_response_guard before insert or update or delete on asmt_response
  for each row execute function public.asmt_response_guard();

drop trigger if exists asmt_evidence_note on asmt_evidence;
create trigger asmt_evidence_note before insert on asmt_evidence
  for each row execute function public.asmt_note_guard();
drop trigger if exists asmt_evidence_append_only on asmt_evidence;
create trigger asmt_evidence_append_only before update or delete on asmt_evidence
  for each row execute function public.asmt_append_only_guard();
drop trigger if exists asmt_comment_note on asmt_comment;
create trigger asmt_comment_note before insert on asmt_comment
  for each row execute function public.asmt_note_guard();
drop trigger if exists asmt_comment_append_only on asmt_comment;
create trigger asmt_comment_append_only before update or delete on asmt_comment
  for each row execute function public.asmt_append_only_guard();
drop trigger if exists asmt_outcome_guard on asmt_outcome;
create trigger asmt_outcome_guard before insert on asmt_outcome
  for each row execute function public.asmt_outcome_guard();
drop trigger if exists asmt_outcome_append_only on asmt_outcome;
create trigger asmt_outcome_append_only before update or delete on asmt_outcome
  for each row execute function public.asmt_append_only_guard();


-- ---- 6. privacy: RLS on, the person reads their own ----------------------------------------------------------

drop policy if exists asmt_respondent_grant_read_own on asmt_respondent_grant;
create policy asmt_respondent_grant_read_own on asmt_respondent_grant for select to authenticated using (auth.uid() = subject_user_id);
drop policy if exists asmt_instance_read_own on asmt_instance;
create policy asmt_instance_read_own on asmt_instance for select to authenticated using (auth.uid() = subject_user_id);
drop policy if exists asmt_response_read_own on asmt_response;
create policy asmt_response_read_own on asmt_response for select to authenticated using (auth.uid() = subject_user_id);
drop policy if exists asmt_evidence_read_own on asmt_evidence;
create policy asmt_evidence_read_own on asmt_evidence for select to authenticated using (auth.uid() = subject_user_id);
drop policy if exists asmt_comment_read_own on asmt_comment;
create policy asmt_comment_read_own on asmt_comment for select to authenticated using (auth.uid() = subject_user_id);
drop policy if exists asmt_outcome_read_own on asmt_outcome;
create policy asmt_outcome_read_own on asmt_outcome for select to authenticated using (auth.uid() = subject_user_id);


-- Verification: the seven capture tables with RLS on and the six own-row read policies.
select count(*) as capture_tables from pg_class
 where relnamespace = 'public'::regnamespace and relname in ('asmt_respondent_grant', 'asmt_instance', 'asmt_instance_layout',
   'asmt_response', 'asmt_evidence', 'asmt_comment', 'asmt_outcome') and relrowsecurity;

select tablename, policyname from pg_policies where schemaname = 'public' and policyname like 'asmt\_%\_read\_own' order by tablename;

notify pgrst, 'reload schema';
