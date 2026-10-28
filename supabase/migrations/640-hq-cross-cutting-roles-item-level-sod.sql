-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 640: CONFIGURABLE CROSS-CUTTING HQ ROLES WITH MANDATORY ITEM-LEVEL SEPARATION OF DUTIES
--
-- Owner GO HQ-SOD-CROSSCUT-01 (28 Oct 2026). A small team: one person may hold authoring, review, clinical
-- approval, governance and publishing together. Independence is enforced on each content item, version and
-- governance action, never by forbidding the combination on a position. The protections below are not
-- switchable. Stricter position-level separation stays one switch away for when the organisation grows.
-- This revises the frozen PLAT-GOV rule "exactly one active appointment decides authorization" by owner
-- decision. Staging first. Production needs its own owner GO and is applied by the owner by hand.
-- Build record: docs/evidence/HQ-SOD-CROSSCUT-01/640-build-record.md
--
-- DEPENDS ON 264 (hq_config, hq_position, hq_position_capability), 076 (workspace_config_overrides), 116/117
-- (ogs_office_appointments), 395 + 422 + 442 + 460 + 461 (clinical approval, cases, knowledge, learning), 440
-- (ckri_holds_capability), 465, 466, 500 + 511 + 580 (positions, the exclusion pairs and their guard) and 610
-- (hq_gov seats, whose appointment guard reads hq_capability_exclusions). APPLY AFTER 630. Additive or
-- widening. Re-running it is a no-op. It appoints NOBODY and ends NO grant.
--
-- ----------------------------------------------------------------------------------------------------
-- 1. CONFIGURATION (the existing HQ config, plus two small tables).
--   hq_config.sod_strict_positions   OFF. When ON every pair below is blocked on positions again.
--   hq_config.multiple_appointments  ON. A person may hold several live HQ appointments. When OFF the
--                                    database refuses a second one.
--   hq_sod_pair_policy               the 15 pairs of 580, each allowed or blocked. A pair may be allowed only
--                                    when it is liftable, which this migration sets (never the screen) and
--                                    only where an equal or stronger item-level safeguard exists. The
--                                    competency assessor pairs and the research pairs are NOT liftable.
--   hq_sod_content_rule              extra separation per content type, stricter only: publisher_not_approver
--                                    (the publisher may not be one of the clinical approvers of the version).
--   hq_capability_exclusions()       now returns the pairs that are effectively blocked. The 500 grant guard
--                                    and the 610 seat guard read it unchanged.
--   Writes: hq_sod_admin_set_pair, hq_sod_admin_set_settings, hq_sod_admin_set_content_rule. Owner only,
--   a reason, the audit_log row FIRST, one transaction (the 500 pattern). Blocking a pair, turning strict
--   separation on, or turning multiple appointments off is refused while somebody would be left in breach.
--
-- 2. MULTIPLE APPOINTMENTS. Effective capabilities are the union over a person's valid appointments (the app
--   resolves it within one governance context). The database refuses an appointment or a grant that would
--   leave one person holding a blocked pair across ALL their HQ appointments and governance seats.
--
-- 3. NON-SWITCHABLE ITEM-LEVEL SAFEGUARDS.
--   a. clinical_review_decision_sod_guard   no reviewer decides content they or any EARLIER VERSION of it
--      authored, edited or submitted (competency: every version and its audit trail, case: every version of
--      the case, knowledge: every version including its reviewing educator, learning: every version). So a
--      resubmission, reassignment, delegation, second appointment or new version is no way round it.
--   b. hq_sod_publication_guard             an author, editor, submitter or reviewing educator of a case,
--      knowledge or learning version never publishes it (422 had no such check, verified before lifting).
--      frameworks_sod_publication_guard      a shared CFCA framework is published only with a recorded
--      publisher who is not the submitter and not a contributor in the audit trail (580 moved into the DB).
--   c. clinical_reviewer_scope_sod_guard    nobody sets or widens their own reviewer scope, a scope is granted
--      only by a holder of clinical governance or the owner, and an ended scope is never reopened.
--   d. wce_clinical_count_guard             lowering the number of independent approvals needs the owner.
--      clinical_content_version_sod_floor   a version never needs fewer approvals than the governed count.
--   e. Grants (500) and appointments stay owner-only, and the pair guards cover every writer.
--   f. Version-exact approval and re-approval after a change stay as 395/422/442/461 made them.
--   g. Full audit: the admin functions write audit_log first, and every guard refuses rather than repairs.
--
-- 4. SCHOLAR. One cross-cutting position, scholar_clinical_lead, with competency and case authoring, clinical
--   approval and governance, and competency and case publication. NOBODY is appointed.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/HQ-SOD-CROSSCUT-01/ROLLBACK-640.sql
-- ====================================================================================================


-- ---- 1. configuration -----------------------------------------------------------------------------

alter table hq_config add column if not exists sod_strict_positions boolean not null default false;
alter table hq_config add column if not exists multiple_appointments boolean not null default true;
alter table hq_config add column if not exists sod_updated_at timestamptz;
alter table hq_config add column if not exists sod_updated_by uuid references profiles(id) on delete set null;

create table if not exists hq_sod_pair_policy (
  capability_a    text not null,
  capability_b    text not null,
  reason          text not null,
  liftable        boolean not null,
  item_safeguard  text,
  allowed         boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id) on delete set null,
  primary key (capability_a, capability_b)
);
alter table hq_sod_pair_policy drop constraint if exists hq_sod_pair_policy_check;
alter table hq_sod_pair_policy add constraint hq_sod_pair_policy_check
  check (capability_a <> capability_b
     and (liftable = (item_safeguard is not null))
     and (allowed = false or liftable = true));
alter table hq_sod_pair_policy enable row level security;

create table if not exists hq_sod_content_rule (
  content_kind            text primary key,
  label                   text not null,
  publisher_not_approver  boolean not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references profiles(id) on delete set null
);
alter table hq_sod_content_rule drop constraint if exists hq_sod_content_rule_kind_check;
alter table hq_sod_content_rule add constraint hq_sod_content_rule_kind_check
  check (content_kind in ('competency_framework', 'case', 'resource', 'learning'));
alter table hq_sod_content_rule enable row level security;

-- Which pairs exist and which may be lifted are this migration's. Only allowed, and who changed it, may change.
create or replace function hq_sod_policy_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'hq_sod history: a separation rule is never deleted. Allow or block it instead';
  end if;
  -- Nested, not joined by AND: a record field of the other table must never be evaluated.
  if tg_table_name = 'hq_sod_pair_policy' then
    if new.capability_a is distinct from old.capability_a or new.capability_b is distinct from old.capability_b
       or new.reason is distinct from old.reason or new.liftable is distinct from old.liftable
       or new.item_safeguard is distinct from old.item_safeguard then
      raise exception 'hq_sod invalid: only whether a pair is allowed can change. Which pairs exist and which may be lifted are set by migration';
    end if;
  else
    if new.content_kind is distinct from old.content_kind or new.label is distinct from old.label then
      raise exception 'hq_sod invalid: only the separation requirements of a content type can change';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hq_sod_pair_policy_guard on hq_sod_pair_policy;
create trigger trg_hq_sod_pair_policy_guard
  before update or delete on hq_sod_pair_policy
  for each row execute function hq_sod_policy_guard();
drop trigger if exists trg_hq_sod_content_rule_guard on hq_sod_content_rule;
create trigger trg_hq_sod_content_rule_guard
  before update or delete on hq_sod_content_rule
  for each row execute function hq_sod_policy_guard();

-- The 15 pairs of 580, in its order. Allowed exactly where liftable. Mirrored by HQ_CAPABILITY_PAIRS in
-- src/lib/hq/positions.ts, and positions.test.ts reads THIS file to prove the two agree.
insert into hq_sod_pair_policy (capability_a, capability_b, reason, liftable, item_safeguard, allowed) values
  ('hq.quality.clinical.approve', 'hq.quality.competency.author', 'a competency author cannot hold clinical approval', true,
   'No reviewer decides a competency version that they, or any earlier version, authored, edited or submitted, read from every version and the audit trail (395, 640)', true),
  ('hq.quality.clinical.approve', 'hq.quality.case.author', 'a case author cannot hold clinical approval', true,
   'No reviewer decides a version of a case when they authored, edited or submitted any version of that case (422, 640)', true),
  ('hq.quality.clinical.approve', 'hq.learning.course.author', 'a course author cannot hold clinical approval', true,
   'No reviewer decides a version of a learning offering when they authored, edited or submitted any version of it (461, 640)', true),
  ('hq.quality.clinical.approve', 'hq.learning.ckri.educator', 'a knowledge educator cannot hold clinical approval', true,
   'No reviewer decides a version of a knowledge resource when they authored, submitted or educator-reviewed any version of it (442, 640)', true),
  ('hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'a clinical reviewer cannot set reviewer scopes', true,
   'Nobody sets or widens their own reviewer scope, and lowering the number of independent approvals needs the platform owner (640)', true),
  ('hq.quality.case.author', 'hq.quality.case.publish', 'a case author cannot publish cases', true,
   'An author, editor or submitter of a case version cannot publish it (640, verified absent from 422 before lifting)', true),
  ('hq.learning.course.author', 'hq.learning.course.publish', 'a course author cannot publish courses', true,
   'An author, editor or submitter of a learning version cannot publish it (460, 461, 640)', true),
  ('hq.learning.ckri.educator', 'hq.quality.knowledge.publish', 'a knowledge educator cannot publish knowledge resources', true,
   'An author, submitter or reviewing educator of a knowledge version cannot publish it (640)', true),
  ('hq.quality.research.propose', 'hq.quality.research.review', 'a research proposer cannot review research', false, null, false),
  ('hq.quality.research.propose', 'hq.quality.research.govern', 'a research proposer cannot govern research', false, null, false),
  ('hq.competency.verification.assess', 'hq.quality.clinical.approve', 'a competency assessor cannot hold clinical content approval', false, null, false),
  ('hq.competency.verification.assess', 'hq.quality.clinical.govern', 'a competency assessor cannot govern clinical reviewer scopes', false, null, false),
  ('hq.competency.verification.assess', 'hq.quality.competency.author', 'a competency assessor cannot author competency content', false, null, false),
  ('hq.competency.verification.assess', 'hq.competency.verification.manage', 'a competency assessor cannot set assessment criteria, scopes or assignments', false, null, false),
  ('hq.quality.competency.author', 'hq.quality.competency.publish', 'a competency author cannot publish competency frameworks', true,
   'The publisher of a shared framework is never its submitter or a contributor in its audit trail (580, 640)', true)
on conflict (capability_a, capability_b) do nothing;

insert into hq_sod_content_rule (content_kind, label) values
  ('competency_framework', 'Competency frameworks and catalogues'),
  ('case', 'Clinical cases'),
  ('resource', 'Knowledge resources'),
  ('learning', 'Learning offerings')
on conflict (content_kind) do nothing;

-- The effectively blocked pairs. STABLE now, because it reads configuration. Same columns as 500/511/580.
create or replace function hq_capability_exclusions()
returns table (capability_a text, capability_b text, reason text)
language sql
stable
set search_path = public
as $$
  select p.capability_a, p.capability_b, p.reason
    from hq_sod_pair_policy p
   where p.allowed = false
      or coalesce((select c.sod_strict_positions from hq_config c where c.id = 'singleton'), false)
$$;


-- ---- 2. one person across all their appointments ----------------------------------------------------

-- The positions a person holds: live HQ appointments, and the positions linked to their live 610 seats.
create or replace function hq_sod_person_positions(p_person uuid, p_except_appointment uuid)
returns setof text
language sql
stable
set search_path = public
as $$
  select ap.role
    from ogs_office_appointments ap join ogs_offices o on o.id = ap.office_id
   where ap.person_id = p_person and ap.status = 'active' and ap.role is not null
     and o.office_type like 'hq\_%' and o.is_active is not false
     and coalesce(o.status, '') not in ('dissolved', 'archived')
     and ap.id is distinct from p_except_appointment
  union
  select s.authority_position_code
    from hq_gov_seat_appointment a join hq_gov_seat s on s.code = a.seat_code
   where a.person_id = p_person and a.status <> 'ended' and s.authority_position_code is not null
$$;

-- Every live or future grant of those positions. Deactivated positions count too, so reactivating one can
-- never be the way a blocked pair comes back.
create or replace function hq_sod_caps_of_positions(p_positions text[])
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct g.capability_code), '{}')
    from hq_position_capability g
   where g.position_code = any(p_positions)
     and (g.effective_to is null or g.effective_to > now())
$$;

-- The first effectively blocked pair inside a set of capabilities, or null.
create or replace function hq_sod_conflict(p_caps text[])
returns text
language sql
stable
set search_path = public
as $$
  select e.reason || ' (' || e.capability_a || ' with ' || e.capability_b || ')'
    from hq_capability_exclusions() e
   where e.capability_a = any(p_caps) and e.capability_b = any(p_caps)
   limit 1
$$;

-- Who would hold both of a pair, by position or as one person across appointments and seats, or null.
create or replace function hq_sod_pair_holder(p_a text, p_b text)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select 'position ' || g1.position_code
       from hq_position_capability g1
       join hq_position_capability g2 on g2.position_code = g1.position_code
      where g1.capability_code = p_a and g2.capability_code = p_b
        and (g1.effective_to is null or g1.effective_to > now())
        and (g2.effective_to is null or g2.effective_to > now())
      order by g1.position_code limit 1),
    (select 'the person ' || coalesce(pr.full_name, x.person_id::text) || ' across their appointments'
       from (select distinct ap.person_id from ogs_office_appointments ap join ogs_offices o on o.id = ap.office_id
              where ap.status = 'active' and ap.person_id is not null and o.office_type like 'hq\_%'
             union
             select a.person_id from hq_gov_seat_appointment a where a.status <> 'ended' and a.person_id is not null) x
       left join profiles pr on pr.id = x.person_id
      where (select array[p_a, p_b] <@ hq_sod_caps_of_positions(array(select hq_sod_person_positions(x.person_id, null))))
      order by x.person_id limit 1))
$$;

-- An HQ appointment: multiple appointments only where switched on, and no blocked pair across all of them.
create or replace function hq_sod_appointment_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hq boolean;
  v_multi boolean;
  v_conflict text;
begin
  if new.status is distinct from 'active' or new.role is null or new.person_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' and old.role is not distinct from new.role
     and old.person_id is not distinct from new.person_id and old.office_id is not distinct from new.office_id then
    return new;
  end if;
  select o.office_type like 'hq\_%' into v_hq from ogs_offices o where o.id = new.office_id;
  if not coalesce(v_hq, false) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hq_sod_person:' || new.person_id::text, 0));

  select c.multiple_appointments into v_multi from hq_config c where c.id = 'singleton';
  if coalesce(v_multi, true) = false and exists (
      select 1 from ogs_office_appointments ap join ogs_offices o on o.id = ap.office_id
       where ap.person_id = new.person_id and ap.status = 'active' and o.office_type like 'hq\_%' and ap.id <> new.id) then
    raise exception 'hq_sod single_appointment: multiple concurrent HQ appointments are switched off. End the existing appointment first, or use one cross-cutting position';
  end if;

  v_conflict := hq_sod_conflict(hq_sod_caps_of_positions(array(select hq_sod_person_positions(new.person_id, new.id)) || new.role));
  if v_conflict is not null then
    raise exception 'hq_sod separation_of_duties: % across this person''s appointments', v_conflict;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hq_sod_appointment_guard on ogs_office_appointments;
create trigger trg_hq_sod_appointment_guard
  before insert or update on ogs_office_appointments
  for each row execute function hq_sod_appointment_guard();

-- The 500 grant guard, unchanged, plus the same test for every person who holds the position.
create or replace function hq_position_capability_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conflict record;
  v_person uuid;
  v_reason text;
begin
  if tg_op = 'UPDATE' then
    if new.position_code is distinct from old.position_code or new.capability_code is distinct from old.capability_code
       or new.source is distinct from old.source or new.effective_from is distinct from old.effective_from
       or new.granted_by is distinct from old.granted_by or new.grant_reason is distinct from old.grant_reason
       or new.created_at is distinct from old.created_at or new.id is distinct from old.id then
      raise exception 'hq_position_capability history: a grant is never rewritten. Only ending a live grant is allowed';
    end if;
    if old.effective_to is not null then
      raise exception 'hq_position_capability history: this grant already ended and is kept as history. It cannot be reopened or changed';
    end if;
    if new.effective_to is null and (new.ended_by is distinct from old.ended_by or new.end_reason is distinct from old.end_reason) then
      raise exception 'hq_position_capability history: ended_by and end_reason are set only when the grant ends';
    end if;
    return new;
  end if;

  if new.effective_to is not null and new.effective_to <= now() then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hq_position_capability:' || new.position_code, 0));

  select e.reason, g.capability_code into v_conflict
    from hq_position_capability g
    join hq_capability_exclusions() e
      on (e.capability_a = new.capability_code and e.capability_b = g.capability_code)
      or (e.capability_b = new.capability_code and e.capability_a = g.capability_code)
   where g.position_code = new.position_code
     and g.id is distinct from new.id
     and (g.effective_to is null or g.effective_to > now())
   limit 1;
  if found then
    raise exception 'hq_position_capability separation_of_duties: % already holds %, and % (so % is refused)',
      new.position_code, v_conflict.capability_code, v_conflict.reason, new.capability_code;
  end if;

  -- 640: nobody who holds this position may end up holding a blocked pair across their appointments.
  for v_person in
    select ap.person_id from ogs_office_appointments ap join ogs_offices o on o.id = ap.office_id
     where ap.role = new.position_code and ap.status = 'active' and ap.person_id is not null and o.office_type like 'hq\_%'
    union
    select a.person_id from hq_gov_seat_appointment a join hq_gov_seat s on s.code = a.seat_code
     where s.authority_position_code = new.position_code and a.status <> 'ended' and a.person_id is not null
  loop
    v_reason := hq_sod_conflict(hq_sod_caps_of_positions(array(select hq_sod_person_positions(v_person, null))) || new.capability_code);
    if v_reason is not null then
      raise exception 'hq_position_capability separation_of_duties: a holder of % would then hold, across their appointments, %', new.position_code, v_reason;
    end if;
  end loop;
  return new;
end;
$$;


-- ---- 3a. clinical review: independent of every version of the content --------------------------------

create or replace function public.clinical_review_decision_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v clinical_content_version%rowtype;
  v_conflict boolean := false;
  v_parent uuid;
begin
  select * into v from clinical_content_version where id = new.version_id;
  if not found then
    return new;
  end if;
  -- Every version of the same subject, whatever was recorded on this one.
  v_conflict := exists (
    select 1 from clinical_content_version o
     where (new.reviewer_id = o.submitted_by or new.reviewer_id = any(o.authored_by))
       and ((v.content_kind = 'competency' and o.competency_id = v.competency_id)
         or (v.content_kind = 'case' and o.case_version_id in (select cv.id from case_library_version cv
               where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)))
         or (v.content_kind = 'resource' and o.knowledge_version_id in (select kv.id from ckri_knowledge_version kv
               where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)))
         or (v.content_kind = 'learning' and o.learning_version_id in (select lv.id from learning_offering_version lv
               where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)))));

  if not v_conflict and v.content_kind = 'competency' then
    -- The audit trail of the competency and its framework, as authorsOf reads it (src/lib/competency/clinical-review.ts).
    select d.framework_id into v_parent from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = v.competency_id;
    v_conflict := exists (
      select 1 from audit_log a
       where a.actor_id = new.reviewer_id and a.entity_id in (v.competency_id, v_parent)
         and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
           'catalogue_entry_add', 'catalogue_entry_status', 'catalogue_entry_remove', 'catalogue_entry_review',
           'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set'));
  elsif not v_conflict and v.content_kind = 'case' then
    v_conflict := exists (select 1 from case_library_version cv
      where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)
        and (new.reviewer_id = any(cv.authored_by) or new.reviewer_id is not distinct from cv.submitted_by));
  elsif not v_conflict and v.content_kind = 'resource' then
    v_conflict := exists (select 1 from ckri_knowledge_version kv
      where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)
        and (new.reviewer_id = any(kv.authored_by) or new.reviewer_id is not distinct from kv.submitted_by
          or new.reviewer_id is not distinct from kv.educator_reviewed_by));
  elsif not v_conflict and v.content_kind = 'learning' then
    v_conflict := exists (select 1 from learning_offering_version lv
      where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)
        and (new.reviewer_id = any(lv.authored_by) or new.reviewer_id is not distinct from lv.submitted_by));
  end if;

  if v_conflict then
    raise exception 'clinical_review_decision: not independent. The reviewer authored, edited or submitted this content or an earlier version of it';
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_review_decision_sod_guard on clinical_review_decision;
create trigger clinical_review_decision_sod_guard
  before insert on clinical_review_decision
  for each row execute function public.clinical_review_decision_sod_guard();


-- ---- 3b. publication: never by an author, editor, submitter or reviewing educator ---------------------

create or replace function public.hq_sod_publication_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_kind text;
  v_educator text := to_jsonb(new) ->> 'educator_reviewed_by';
begin
  if new.state is distinct from 'published' or old.state is not distinct from 'published' then
    return new;
  end if;
  if new.published_by is null then
    raise exception '%: not independent. A publication must record its publisher', tg_table_name;
  end if;
  if new.published_by = any(new.authored_by) or new.published_by is not distinct from new.submitted_by
     or new.published_by::text is not distinct from v_educator then
    raise exception '%: not independent. An author, editor, submitter or reviewing educator of a version cannot publish it', tg_table_name;
  end if;
  v_kind := case tg_table_name when 'case_library_version' then 'case' when 'ckri_knowledge_version' then 'resource' else 'learning' end;
  if exists (select 1 from hq_sod_content_rule r where r.content_kind = v_kind and r.publisher_not_approver)
     and exists (select 1 from clinical_content_version ccv join clinical_review_decision d on d.version_id = ccv.id
                  where d.reviewer_id = new.published_by and d.decision = 'approved'
                    and ((v_kind = 'case' and ccv.case_version_id = new.id)
                      or (v_kind = 'resource' and ccv.knowledge_version_id = new.id)
                      or (v_kind = 'learning' and ccv.learning_version_id = new.id))) then
    raise exception '%: not independent. For this content type the publisher may not be one of the clinical approvers of the version', tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists case_library_version_sod_publication on case_library_version;
create trigger case_library_version_sod_publication
  before update on case_library_version
  for each row execute function public.hq_sod_publication_guard();
drop trigger if exists ckri_knowledge_version_sod_publication on ckri_knowledge_version;
create trigger ckri_knowledge_version_sod_publication
  before update on ckri_knowledge_version
  for each row execute function public.hq_sod_publication_guard();
drop trigger if exists learning_offering_version_sod_publication on learning_offering_version;
create trigger learning_offering_version_sod_publication
  before update on learning_offering_version
  for each row execute function public.hq_sod_publication_guard();

-- A shared CFCA framework: the publisher is recorded on the row and is independent of its content.
alter table frameworks add column if not exists published_by uuid;

create or replace function public.frameworks_sod_publication_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_ids uuid[];
  v_submitter uuid;
begin
  if new.pub_status is distinct from 'published' then
    -- A publisher is recorded only on a publication, so a stale one can never authorise the next.
    new.published_by := null;
    return new;
  end if;
  if new.hospital_id is not null or new.competency_layer is null then
    return new;
  end if;
  if old.pub_status is not distinct from 'published'
     and new.version_major is not distinct from old.version_major and new.version_minor is not distinct from old.version_minor
     and new.version_revision is not distinct from old.version_revision then
    return new;
  end if;
  if new.published_by is null then
    raise exception 'framework publication: not independent. A publication must record its publisher';
  end if;
  select ca.submitted_by into v_submitter from content_approvals ca
   where ca.framework_id = new.id and ca.status = 'pending' order by ca.submitted_at desc limit 1;
  if v_submitter is not null and v_submitter = new.published_by then
    raise exception 'framework publication: not independent. The person who put the framework forward cannot publish it';
  end if;
  v_ids := array[new.id]
    || coalesce((select array_agg(d.id) from framework_domains d where d.framework_id = new.id), '{}')
    || coalesce((select array_agg(c.id) from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = new.id), '{}');
  -- Contribution, as contributorsOf reads it (src/lib/competency/framework-publication.ts).
  if exists (select 1 from audit_log a where a.actor_id = new.published_by and a.entity_id = any(v_ids)
              and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
                'catalogue_entry_review', 'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added',
                'clinical_scope_ended', 'framework_specialty_set')) then
    raise exception 'framework publication: not independent. The publisher authored or curated content in this framework';
  end if;
  if exists (select 1 from hq_sod_content_rule r where r.content_kind = 'competency_framework' and r.publisher_not_approver)
     and exists (select 1 from clinical_content_version ccv join clinical_review_decision d on d.version_id = ccv.id
                  where d.reviewer_id = new.published_by and d.decision = 'approved' and ccv.competency_id = any(v_ids)) then
    raise exception 'framework publication: not independent. For frameworks the publisher may not be one of the clinical approvers of its competencies';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_frameworks_sod_publication_guard on frameworks;
create trigger trg_frameworks_sod_publication_guard
  before update of pub_status, version_major, version_minor, version_revision on frameworks
  for each row execute function public.frameworks_sod_publication_guard();


-- ---- 3c. reviewer scope: never your own, only by clinical governance or the owner, never reopened ------

create or replace function public.clinical_reviewer_scope_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_person uuid;
begin
  if tg_op = 'UPDATE' then
    if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'clinical_reviewer_scope: an ended scope stays ended. Add a new scope instead';
    end if;
    if new.granted_by is distinct from old.granted_by then
      raise exception 'clinical_reviewer_scope: who granted a scope cannot be rewritten';
    end if;
    return new;
  end if;
  select a.person_id into v_person from ogs_office_appointments a where a.id = new.appointment_id;
  if new.granted_by is null then
    raise exception 'clinical_reviewer_scope: not independent. A scope records who granted it';
  end if;
  if new.granted_by is not distinct from v_person then
    raise exception 'clinical_reviewer_scope: not independent. Nobody sets or widens their own reviewer scope. Another clinical governance holder or the platform owner must';
  end if;
  if not (hq_actor_is_owner(new.granted_by) or ckri_holds_capability(new.granted_by, 'hq.quality.clinical.govern')) then
    raise exception 'clinical_reviewer_scope: not authorised. Only a holder of hq.quality.clinical.govern or the platform owner grants a scope';
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_reviewer_scope_sod_guard on clinical_reviewer_scope;
create trigger clinical_reviewer_scope_sod_guard
  before insert or update on clinical_reviewer_scope
  for each row execute function public.clinical_reviewer_scope_sod_guard();


-- ---- 3d. approval counts: never lowered except by the owner, never undercut at submission -------------

alter table workspace_config_overrides add column if not exists published_by uuid references profiles(id) on delete set null;

-- A published count, as loadRequiredApprovals reads it: {value: n}, 1 to 5, else the default of 1.
create or replace function hq_sod_count_value(p jsonb)
returns int
language sql
immutable
set search_path = public
as $$
  select case when p is not null and (p ->> 'value') ~ '^[0-9]{1,2}$' then least(5, greatest(1, (p ->> 'value')::int)) else 1 end
$$;

create or replace function hq_sod_required_approvals(p_risk text)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce((select hq_sod_count_value(o.published) from workspace_config_overrides o
                    where o.scope_type = 'platform' and o.scope_ref = 'holdings_clinical'
                      and o.config_path = 'holdings.clinical.required_approvals.' || case when p_risk = 'high' then 'high' else 'standard' end
                    limit 1), 1)
$$;

create or replace function public.wce_clinical_count_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_scope_type text;
  v_scope_ref text;
  v_path text;
begin
  if tg_op = 'DELETE' then
    v_scope_type := old.scope_type;
    v_scope_ref := old.scope_ref;
    v_path := old.config_path;
  else
    v_scope_type := new.scope_type;
    v_scope_ref := new.scope_ref;
    v_path := new.config_path;
  end if;
  if v_scope_type is distinct from 'platform' or v_scope_ref is distinct from 'holdings_clinical'
     or v_path not in ('holdings.clinical.required_approvals.standard', 'holdings.clinical.required_approvals.high') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if hq_sod_count_value(old.published) > 1 then
      raise exception 'hq_sod self_reduction: a published approval count is never deleted. Publish a new value instead';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.published is not distinct from old.published then
    return new;
  end if;
  if new.published is not null and not ((new.published ->> 'value') ~ '^[1-5]$') then
    raise exception 'hq_sod invalid: an approval count is a whole number from 1 to 5';
  end if;
  if hq_sod_count_value(new.published) < (case when tg_op = 'UPDATE' then hq_sod_count_value(old.published) else 1 end)
     and not coalesce(hq_actor_is_owner(new.published_by), false) then
    raise exception 'hq_sod self_reduction: lowering the number of independent approvals needs the platform owner. Raising it does not';
  end if;
  return new;
end;
$$;

drop trigger if exists wce_clinical_count_guard on workspace_config_overrides;
create trigger wce_clinical_count_guard
  before insert or update or delete on workspace_config_overrides
  for each row execute function public.wce_clinical_count_guard();

-- At submission: never fewer approvals than the governed count for the content's risk. Raises, never lowers.
create or replace function public.clinical_content_version_sod_floor()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_risk text;
  v_floor int;
begin
  if new.content_kind = 'competency' then
    select case when c.risk_category = 'high' or u.risk_category = 'high' then 'high' else 'standard' end into v_risk
      from framework_competencies c left join clinical_practice_units u on u.id = c.cpu_id where c.id = new.competency_id;
  elsif new.content_kind = 'case' then
    select cv.risk into v_risk from case_library_version cv where cv.id = new.case_version_id;
  elsif new.content_kind = 'resource' then
    select kv.risk into v_risk from ckri_knowledge_version kv where kv.id = new.knowledge_version_id;
  elsif new.content_kind = 'learning' then
    select lv.risk into v_risk from learning_offering_version lv where lv.id = new.learning_version_id;
  end if;
  v_floor := hq_sod_required_approvals(coalesce(v_risk, 'standard'));
  if new.required_approvals is null or new.required_approvals < v_floor then
    new.required_approvals := v_floor;
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_content_version_sod_floor on clinical_content_version;
create trigger clinical_content_version_sod_floor
  before insert on clinical_content_version
  for each row execute function public.clinical_content_version_sod_floor();


-- ---- 4. the screen actions: owner, reason, audit FIRST, then the change -------------------------------

create or replace function hq_sod_admin_set_pair(
  p_actor uuid, p_actor_name text, p_trace text,
  p_capability_a text, p_capability_b text, p_allowed boolean, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v hq_sod_pair_policy%rowtype;
  v_holder text;
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  if p_allowed is null then
    raise exception 'hq_sod invalid: allowed must be true or false';
  end if;
  select * into v from hq_sod_pair_policy
   where (capability_a = p_capability_a and capability_b = p_capability_b)
      or (capability_a = p_capability_b and capability_b = p_capability_a)
   for update;
  if not found then
    raise exception 'hq_sod not_found: no such capability pair';
  end if;
  if v.allowed = p_allowed then
    raise exception 'hq_sod unchanged: the pair is already %', case when p_allowed then 'allowed' else 'blocked' end;
  end if;
  if p_allowed and not v.liftable then
    raise exception 'hq_sod not_liftable: % has no equal or stronger item-level safeguard, so it stays blocked', v.reason;
  end if;
  if not p_allowed then
    v_holder := hq_sod_pair_holder(v.capability_a, v.capability_b);
    if v_holder is not null then
      raise exception 'hq_sod conflict: % holds both. End one of the grants or appointments first', v_holder;
    end if;
  end if;

  v_row := jsonb_build_object('capability_a', v.capability_a, 'capability_b', v.capability_b,
                              'allowed', p_allowed, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_sod_pair_set', 'hq_sod_pair_policy', v.capability_a || ' with ' || v.capability_b,
          jsonb_build_object('allowed', v.allowed), v_row, p_trace);

  update hq_sod_pair_policy set allowed = p_allowed, updated_at = now(), updated_by = p_actor
   where capability_a = v.capability_a and capability_b = v.capability_b;
  return v_row;
end;
$$;

create or replace function hq_sod_admin_set_settings(
  p_actor uuid, p_actor_name text, p_trace text,
  p_strict boolean, p_multiple boolean, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old hq_config%rowtype;
  v_pair record;
  v_holder text;
  v_person record;
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  if p_strict is null or p_multiple is null then
    raise exception 'hq_sod invalid: strict separation and multiple appointments must each be true or false';
  end if;
  select * into v_old from hq_config where id = 'singleton' for update;
  if not found then
    raise exception 'hq_sod not_found: the HQ configuration row is missing (migration 264)';
  end if;
  if v_old.sod_strict_positions = p_strict and v_old.multiple_appointments = p_multiple then
    raise exception 'hq_sod unchanged: the settings are already these';
  end if;
  if p_strict and not v_old.sod_strict_positions then
    for v_pair in select capability_a, capability_b from hq_sod_pair_policy where allowed order by capability_a, capability_b loop
      v_holder := hq_sod_pair_holder(v_pair.capability_a, v_pair.capability_b);
      if v_holder is not null then
        raise exception 'hq_sod conflict: strict separation would leave % holding % and %. End one first', v_holder, v_pair.capability_a, v_pair.capability_b;
      end if;
    end loop;
  end if;
  if not p_multiple and v_old.multiple_appointments then
    select ap.person_id, count(*) as n into v_person
      from ogs_office_appointments ap join ogs_offices o on o.id = ap.office_id
     where ap.status = 'active' and o.office_type like 'hq\_%' and ap.person_id is not null
     group by ap.person_id having count(*) > 1 limit 1;
    if found then
      raise exception 'hq_sod conflict: a person (%) holds % concurrent HQ appointments. End all but one first', v_person.person_id, v_person.n;
    end if;
  end if;

  v_row := jsonb_build_object('sod_strict_positions', p_strict, 'multiple_appointments', p_multiple, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_sod_settings_set', 'hq_config', 'singleton',
          jsonb_build_object('sod_strict_positions', v_old.sod_strict_positions, 'multiple_appointments', v_old.multiple_appointments),
          v_row, p_trace);

  update hq_config set sod_strict_positions = p_strict, multiple_appointments = p_multiple,
         sod_updated_at = now(), sod_updated_by = p_actor
   where id = 'singleton';
  return v_row;
end;
$$;

create or replace function hq_sod_admin_set_content_rule(
  p_actor uuid, p_actor_name text, p_trace text,
  p_content_kind text, p_publisher_not_approver boolean, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old hq_sod_content_rule%rowtype;
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  if p_publisher_not_approver is null then
    raise exception 'hq_sod invalid: the requirement must be true or false';
  end if;
  select * into v_old from hq_sod_content_rule where content_kind = p_content_kind for update;
  if not found then
    raise exception 'hq_sod not_found: no such content type';
  end if;
  if v_old.publisher_not_approver = p_publisher_not_approver then
    raise exception 'hq_sod unchanged: the requirement is already %', case when p_publisher_not_approver then 'on' else 'off' end;
  end if;

  v_row := jsonb_build_object('content_kind', p_content_kind, 'publisher_not_approver', p_publisher_not_approver, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_sod_content_rule_set', 'hq_sod_content_rule', p_content_kind,
          jsonb_build_object('publisher_not_approver', v_old.publisher_not_approver), v_row, p_trace);

  update hq_sod_content_rule set publisher_not_approver = p_publisher_not_approver, updated_at = now(), updated_by = p_actor
   where content_kind = p_content_kind;
  return v_row;
end;
$$;

revoke all on function hq_sod_admin_set_pair(uuid, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function hq_sod_admin_set_settings(uuid, text, text, boolean, boolean, text) from public, anon, authenticated;
revoke all on function hq_sod_admin_set_content_rule(uuid, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function hq_sod_pair_holder(text, text) from public, anon, authenticated;
revoke all on function hq_sod_person_positions(uuid, uuid) from public, anon, authenticated;
grant execute on function hq_sod_admin_set_pair(uuid, text, text, text, text, boolean, text) to service_role;
grant execute on function hq_sod_admin_set_settings(uuid, text, text, boolean, boolean, text) to service_role;
grant execute on function hq_sod_admin_set_content_rule(uuid, text, text, text, boolean, text) to service_role;
grant execute on function hq_sod_pair_holder(text, text) to service_role;
grant execute on function hq_sod_person_positions(uuid, uuid) to service_role;


-- ---- 5. Scholar: one cross-cutting position, nobody appointed -----------------------------------------

insert into hq_position (code, space, name, description) values
  ('scholar_clinical_lead', 'quality', 'Scholar Clinical Lead',
   'Cross-cutting Scholar clinical and governance lead. Authors, clinically approves and publishes competencies and cases, and governs clinical review. Never approves or publishes their own work')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('scholar_clinical_lead')) as p(code)
cross join (values ('hq.platform.home.view'), ('hq.quality.competency.author'), ('hq.quality.case.author'),
                   ('hq.quality.clinical.approve'), ('hq.quality.clinical.govern'),
                   ('hq.quality.competency.publish'), ('hq.quality.case.publish')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code
  );


-- Verification: the policy (15 pairs, 9 allowed, 6 never liftable), the Scholar position with 7 grants and
-- no appointment, and nobody holding an effectively blocked pair by position (expect zero rows).
select count(*) as pairs, count(*) filter (where allowed) as allowed, count(*) filter (where not liftable) as never_liftable
  from hq_sod_pair_policy;

select capability_code from hq_position_capability
 where position_code = 'scholar_clinical_lead' and effective_to is null order by capability_code;

select count(*) as scholar_clinical_lead_appointments from ogs_office_appointments where role = 'scholar_clinical_lead';

select g1.position_code, g1.capability_code, g2.capability_code
  from hq_position_capability g1
  join hq_position_capability g2 on g2.position_code = g1.position_code
  join hq_capability_exclusions() e on e.capability_a = g1.capability_code and e.capability_b = g2.capability_code
 where g1.effective_to is null and g2.effective_to is null;

notify pgrst, 'reload schema';
