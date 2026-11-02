-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 892: UNIVERSAL ASSESSMENT ENGINE, PROGRESSION (Checklist Studio, slice S1a)
--
-- Owner-approved Checklist Studio (2 Nov 2026). Design of record: the coordinator design for Assessment Studio
-- Phase 1 (3 Nov 2026), section 2 migration 892 and section 7. Staging first. Production needs its own owner GO
-- and is applied by the owner by hand.
--
-- PROGRESSION IS NOT SCORING. A score says how one instance went. A progression decision says where the
-- evidence of several instances places a subject on a stage scale, under a versioned rule set. A stage is
-- never an average and never comes from one assessment unless an approved rule permits it. Every decision
-- stores the rule version, the rule hash and the outcomes it rests on. Decisions are append-only.
--
-- UNIVERSAL BY RULE. A rule set targets a kind of thing (text) and an id. The stage scale is an ordinary
-- scale version of kind stage from 890. Nothing here names a profession or a framework.
--
-- DEPENDS ON 890 and 891. APPLY AFTER 891. Additive. Re-running it is a no-op.
--
-- WHAT IT ADDS.
--   asmt_progression_rule_set       the definition (owner and visibility like every definition).
--   asmt_progression_rule_version   a version with the same lifecycle and guards as every other version
--                                   table (the 890 generic guard is attached here too). It pins a stage scale
--                                   version, which must be a published scale of kind stage when the rule
--                                   version is put forward for review.
--   asmt_progression_decision       append-only. The standing is always evidence_supported (CHECK), never
--                                   verified. A staged decision rests on at least one outcome and never on a
--                                   self reported one. Every evidence id must be a submitted outcome of that
--                                   same subject. The rule version must be published and the hash must match.
--   asmt_record_progression         the service role entry point. It only forwards to the insert, so the guard
--                                   is the same for any writer.
--   RLS: own-row SELECT.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): PENDING-39/ROLLBACK-892.sql
-- ====================================================================================================


create table if not exists asmt_progression_rule_set (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  target_kind   text not null,
  target_ref    uuid,
  owner_scope   text not null default 'holdings',
  owner_product_line text references plat_product_line(code),
  owner_organisation_id uuid references organisations(id),
  owner_user_id uuid references profiles(id),
  owner_instrument_id uuid references asmt_instrument(id),
  visibility    text not null default 'owner',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint asmt_progression_rule_set_code_check check (code ~ '^[A-Z][A-Z0-9-]{2,40}$'),
  constraint asmt_progression_rule_set_name_check check (btrim(name) <> ''),
  constraint asmt_progression_rule_set_target_check check (target_kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint asmt_progression_rule_set_visibility_check check (visibility in ('private', 'owner', 'adoptable')),
  constraint asmt_progression_rule_set_owner_check check (
    owner_scope in ('holdings', 'product', 'organisation', 'individual', 'instrument')
    and num_nonnulls(owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id) = case when owner_scope = 'holdings' then 0 else 1 end
    and (owner_scope = 'holdings'
         or (owner_scope = 'product' and owner_product_line is not null)
         or (owner_scope = 'organisation' and owner_organisation_id is not null)
         or (owner_scope = 'individual' and owner_user_id is not null)
         or (owner_scope = 'instrument' and owner_instrument_id is not null)))
);
alter table asmt_progression_rule_set enable row level security;

create table if not exists asmt_progression_rule_version (
  id            uuid primary key default gen_random_uuid(),
  rule_set_id   uuid not null references asmt_progression_rule_set(id),
  version_no    int not null,
  state         text not null default 'draft',
  content_hash  text,
  authored_by   uuid[] not null,
  edited_by     uuid[] not null default '{}',
  last_edited_by uuid,
  submitted_by  uuid,
  submitted_at  timestamptz,
  published_by  uuid,
  published_at  timestamptz,
  retired_by    uuid,
  retired_at    timestamptz,
  duplicated_from_version_id uuid,
  adopted_from_version_id uuid,
  created_at    timestamptz not null default now(),
  rules         jsonb not null default '{}',
  rules_hash    text,
  stage_scale_version_id uuid not null references asmt_response_scale_version(id),
  tests         jsonb not null default '[]',
  description   text,
  unique (rule_set_id, version_no),
  constraint asmt_progression_rule_version_life_check check (
    state in ('draft', 'in_review', 'approved', 'published', 'retired')
    and cardinality(authored_by) >= 1
    and version_no >= 1
    and (state = 'draft' or (submitted_by is not null and content_hash is not null))
    and (state not in ('published', 'retired') or (published_by is not null and published_at is not null))
    and (state in ('published', 'retired') or (published_by is null and published_at is null))
    and (state <> 'retired' or (retired_by is not null and retired_at is not null))
    and (state = 'retired' or (retired_by is null and retired_at is null))),
  constraint asmt_progression_rule_version_shape_check check (jsonb_typeof(rules) = 'object' and jsonb_typeof(tests) = 'array')
);
alter table asmt_progression_rule_version enable row level security;

create table if not exists asmt_progression_decision (
  id                  uuid primary key default gen_random_uuid(),
  subject_user_id     uuid not null references profiles(id) on delete cascade,
  rule_version_id     uuid not null references asmt_progression_rule_version(id),
  rule_hash           text not null,
  engine_version      text not null,
  state               text not null,
  stage_code          text,
  target_stage_code   text,
  outstanding         jsonb not null default '[]',
  evidence_outcome_ids uuid[] not null default '{}',
  trace               jsonb not null default '{}',
  trigger_event       text not null,
  valid_until         timestamptz,
  standing            text not null default 'evidence_supported',
  supersedes_id       uuid references asmt_progression_decision(id),
  computed_at         timestamptz not null default now(),
  constraint asmt_progression_decision_state_check check (state in ('unassessed', 'not_staged', 'staged')),
  constraint asmt_progression_decision_stage_check check ((state = 'staged') = (stage_code is not null)),
  constraint asmt_progression_decision_trigger_check check (trigger_event in ('instance_submitted', 'rules_published', 'evidence_expired')),
  constraint asmt_progression_decision_standing_check check (standing = 'evidence_supported'),
  constraint asmt_progression_decision_engine_check check (btrim(engine_version) <> '' and btrim(rule_hash) <> ''),
  constraint asmt_progression_decision_staged_evidence_check check (state <> 'staged' or cardinality(evidence_outcome_ids) >= 1)
);
create index if not exists idx_asmt_progression_decision_subject on asmt_progression_decision (subject_user_id, computed_at desc);
create index if not exists idx_asmt_progression_decision_rule on asmt_progression_decision (rule_version_id);
alter table asmt_progression_decision enable row level security;


-- ---- functions and triggers ----------------------------------------------------------------------------------

-- The pinned stage scale is a published scale of kind stage when the rule version is put forward.
create or replace function public.asmt_progression_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_kind text;
  v_state text;
begin
  select scale_kind, state into v_kind, v_state from asmt_response_scale_version where id = new.stage_scale_version_id;
  if v_kind is distinct from 'stage' then
    raise exception 'asmt_progression_rule_version: the pinned scale must be a scale of kind stage';
  end if;
  if tg_op = 'UPDATE' and old.state = 'draft' and new.state = 'in_review' and v_state is distinct from 'published' then
    raise exception 'asmt_progression_rule_version: the stage scale must be a published scale version';
  end if;
  return new;
end;
$$;

create or replace function public.asmt_progression_decision_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v record;
  v_found int;
  v_ids uuid[];
  v_set uuid;
  v_prev record;
begin
  select rv.state, rv.rules_hash, rv.stage_scale_version_id, rv.rule_set_id into v
    from asmt_progression_rule_version rv where rv.id = new.rule_version_id;
  if v.state is distinct from 'published' then
    raise exception 'asmt_progression_decision: a decision is computed only under a published rule version';
  end if;
  if new.rule_hash is distinct from v.rules_hash then
    raise exception 'asmt_progression_decision: the rule hash does not match the published rule version';
  end if;
  if new.stage_code is not null and not exists (
       select 1 from asmt_response_scale_level l where l.version_id = v.stage_scale_version_id and l.code = new.stage_code) then
    raise exception 'asmt_progression_decision: stage % is not on the pinned stage scale', new.stage_code;
  end if;
  if new.target_stage_code is not null and not exists (
       select 1 from asmt_response_scale_level l where l.version_id = v.stage_scale_version_id and l.code = new.target_stage_code) then
    raise exception 'asmt_progression_decision: target stage % is not on the pinned stage scale', new.target_stage_code;
  end if;

  select array_agg(distinct x) into v_ids from unnest(new.evidence_outcome_ids) x;
  if v_ids is not null then
    select count(*) into v_found
      from asmt_outcome o join asmt_instance i on i.id = o.instance_id
     where o.id = any(v_ids) and o.subject_user_id = new.subject_user_id and i.status = 'submitted';
    if v_found <> cardinality(v_ids) then
      raise exception 'asmt_progression_decision: every evidence id must be a submitted outcome of this same subject';
    end if;
    if new.state = 'staged' and exists (
         select 1 from asmt_outcome o join asmt_instance i on i.id = o.instance_id
          where o.id = any(v_ids) and i.respondent_role = 'self') then
      raise exception 'asmt_progression_decision: self reported or self led evidence never supports a stage';
    end if;
  end if;

  if new.supersedes_id is null then
    select d.id into v_prev from asmt_progression_decision d
      join asmt_progression_rule_version rv on rv.id = d.rule_version_id
     where d.subject_user_id = new.subject_user_id and rv.rule_set_id = v.rule_set_id
     order by d.computed_at desc, d.id limit 1;
    new.supersedes_id := v_prev.id;
  elsif not exists (select 1 from asmt_progression_decision d where d.id = new.supersedes_id and d.subject_user_id = new.subject_user_id) then
    raise exception 'asmt_progression_decision: a decision supersedes only an earlier decision of the same subject';
  end if;
  new.computed_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.asmt_record_progression(p_subject uuid, p_rule_version uuid, p_state text, p_stage text,
  p_target text, p_outstanding jsonb, p_evidence uuid[], p_trace jsonb, p_engine text, p_trigger text, p_valid_until timestamptz)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_hash text;
begin
  select rules_hash into v_hash from asmt_progression_rule_version where id = p_rule_version;
  insert into asmt_progression_decision (subject_user_id, rule_version_id, rule_hash, engine_version, state, stage_code,
    target_stage_code, outstanding, evidence_outcome_ids, trace, trigger_event, valid_until)
  values (p_subject, p_rule_version, coalesce(v_hash, ''), p_engine, p_state, p_stage, p_target,
    coalesce(p_outstanding, '[]'::jsonb), coalesce(p_evidence, '{}'::uuid[]), coalesce(p_trace, '{}'::jsonb), p_trigger, p_valid_until)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.asmt_progression_version_guard() from public, anon, authenticated;
revoke all on function public.asmt_progression_decision_guard() from public, anon, authenticated;
revoke all on function public.asmt_record_progression(uuid, uuid, text, text, text, jsonb, uuid[], jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.asmt_record_progression(uuid, uuid, text, text, text, jsonb, uuid[], jsonb, text, text, timestamptz) to service_role;

drop trigger if exists asmt_progression_rule_version_lifecycle on asmt_progression_rule_version;
create trigger asmt_progression_rule_version_lifecycle
  before insert or update or delete on asmt_progression_rule_version
  for each row execute function public.asmt_version_lifecycle_guard();
drop trigger if exists asmt_progression_rule_version_after on asmt_progression_rule_version;
create trigger asmt_progression_rule_version_after
  after insert or update on asmt_progression_rule_version
  for each row execute function public.asmt_version_after_guard();
drop trigger if exists asmt_progression_rule_version_scale on asmt_progression_rule_version;
create trigger asmt_progression_rule_version_scale
  before insert or update on asmt_progression_rule_version
  for each row execute function public.asmt_progression_version_guard();
drop trigger if exists asmt_progression_rule_set_definition_guard on asmt_progression_rule_set;
create trigger asmt_progression_rule_set_definition_guard before update on asmt_progression_rule_set
  for each row execute function public.asmt_definition_guard();
drop trigger if exists asmt_progression_decision_guard on asmt_progression_decision;
create trigger asmt_progression_decision_guard before insert on asmt_progression_decision
  for each row execute function public.asmt_progression_decision_guard();
drop trigger if exists asmt_progression_decision_append_only on asmt_progression_decision;
create trigger asmt_progression_decision_append_only before update or delete on asmt_progression_decision
  for each row execute function public.asmt_append_only_guard();

drop policy if exists asmt_progression_decision_read_own on asmt_progression_decision;
create policy asmt_progression_decision_read_own on asmt_progression_decision for select to authenticated using (auth.uid() = subject_user_id);


-- Verification: the three progression tables with RLS on and the one own-row read policy.
select count(*) as progression_tables from pg_class
 where relnamespace = 'public'::regnamespace and relname in ('asmt_progression_rule_set', 'asmt_progression_rule_version',
   'asmt_progression_decision') and relrowsecurity;

select tablename, policyname from pg_policies where schemaname = 'public' and policyname = 'asmt_progression_decision_read_own';

notify pgrst, 'reload schema';
