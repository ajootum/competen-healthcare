-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It restores two functions of migrations 500 and 580 between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 640 (STAGING). Restores the 580 position-level pairs (all 15 blocked again) and the 500 grant guard,
-- removes the 640 guards, configuration and columns, and removes the unappointed Scholar Clinical Lead.
-- It REFUSES while the Scholar Clinical Lead has ever been appointed or linked to a seat, and while any other
-- position or person would hold a 580 pair (end those first). Roll the app back to a build without 640 code
-- first only if it has been deployed. The app tolerates the absent columns, so this is belt and braces.
-- Production: not to be run without the owner. Fix forward instead.

do $$
begin
  if exists (select 1 from ogs_office_appointments where role = 'scholar_clinical_lead')
     or exists (select 1 from hq_gov_seat where authority_position_code = 'scholar_clinical_lead') then
    raise exception 'rollback 640 refused: scholar_clinical_lead has been appointed or linked to a seat. Fix forward instead';
  end if;
  if exists (
    select 1 from hq_sod_pair_policy p
     where exists (select 1 from hq_position_capability g1 join hq_position_capability g2 on g2.position_code = g1.position_code
                    where g1.position_code <> 'scholar_clinical_lead'
                      and g1.capability_code = p.capability_a and g2.capability_code = p.capability_b
                      and (g1.effective_to is null or g1.effective_to > now()) and (g2.effective_to is null or g2.effective_to > now()))) then
    raise exception 'rollback 640 refused: a position other than scholar_clinical_lead holds a 580 pair. End one grant first';
  end if;
  if exists (
    select 1 from (select distinct ap.person_id from ogs_office_appointments ap join ogs_offices o on o.id = ap.office_id
                    where ap.status = 'active' and ap.person_id is not null and o.office_type like 'hq\_%') x
      join hq_sod_pair_policy p
        on array[p.capability_a, p.capability_b] <@ hq_sod_caps_of_positions(array(select hq_sod_person_positions(x.person_id, null)))) then
    raise exception 'rollback 640 refused: a person holds a 580 pair across their appointments. End one appointment first';
  end if;
end;
$$;

drop trigger if exists trg_hq_sod_appointment_guard on ogs_office_appointments;
drop trigger if exists clinical_review_decision_sod_guard on clinical_review_decision;
drop trigger if exists case_library_version_sod_publication on case_library_version;
drop trigger if exists ckri_knowledge_version_sod_publication on ckri_knowledge_version;
drop trigger if exists learning_offering_version_sod_publication on learning_offering_version;
drop trigger if exists trg_frameworks_sod_publication_guard on frameworks;
drop trigger if exists clinical_reviewer_scope_sod_guard on clinical_reviewer_scope;
drop trigger if exists wce_clinical_count_guard on workspace_config_overrides;
drop trigger if exists clinical_content_version_sod_floor on clinical_content_version;

delete from hq_position_capability where position_code = 'scholar_clinical_lead';
delete from hq_position where code = 'scholar_clinical_lead';

create or replace function hq_capability_exclusions()
returns table (capability_a text, capability_b text, reason text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    ('hq.quality.clinical.approve', 'hq.quality.competency.author', 'a competency author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.quality.case.author', 'a case author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.learning.course.author', 'a course author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.learning.ckri.educator', 'a knowledge educator cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'a clinical reviewer cannot set reviewer scopes'),
    ('hq.quality.case.author', 'hq.quality.case.publish', 'a case author cannot publish cases'),
    ('hq.learning.course.author', 'hq.learning.course.publish', 'a course author cannot publish courses'),
    ('hq.learning.ckri.educator', 'hq.quality.knowledge.publish', 'a knowledge educator cannot publish knowledge resources'),
    ('hq.quality.research.propose', 'hq.quality.research.review', 'a research proposer cannot review research'),
    ('hq.quality.research.propose', 'hq.quality.research.govern', 'a research proposer cannot govern research'),
    ('hq.competency.verification.assess', 'hq.quality.clinical.approve', 'a competency assessor cannot hold clinical content approval'),
    ('hq.competency.verification.assess', 'hq.quality.clinical.govern', 'a competency assessor cannot govern clinical reviewer scopes'),
    ('hq.competency.verification.assess', 'hq.quality.competency.author', 'a competency assessor cannot author competency content'),
    ('hq.competency.verification.assess', 'hq.competency.verification.manage', 'a competency assessor cannot set assessment criteria, scopes or assignments'),
    ('hq.quality.competency.author', 'hq.quality.competency.publish', 'a competency author cannot publish competency frameworks')
  ) as t(capability_a, capability_b, reason)
$$;

create or replace function hq_position_capability_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conflict record;
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
  return new;
end;
$$;

drop function if exists hq_sod_admin_set_pair(uuid, text, text, text, text, boolean, text);
drop function if exists hq_sod_admin_set_settings(uuid, text, text, boolean, boolean, text);
drop function if exists hq_sod_admin_set_content_rule(uuid, text, text, text, boolean, text);
drop function if exists hq_sod_appointment_guard();
drop function if exists hq_sod_pair_holder(text, text);
drop function if exists hq_sod_conflict(text[]);
drop function if exists hq_sod_caps_of_positions(text[]);
drop function if exists hq_sod_person_positions(uuid, uuid);
drop function if exists public.clinical_review_decision_sod_guard();
drop function if exists public.hq_sod_publication_guard();
drop function if exists public.frameworks_sod_publication_guard();
drop function if exists public.clinical_reviewer_scope_sod_guard();
drop function if exists public.wce_clinical_count_guard();
drop function if exists public.clinical_content_version_sod_floor();
drop function if exists hq_sod_required_approvals(text);
drop function if exists hq_sod_count_value(jsonb);

drop table if exists hq_sod_pair_policy;
drop table if exists hq_sod_content_rule;
drop function if exists hq_sod_policy_guard();

alter table hq_config drop column if exists sod_strict_positions;
alter table hq_config drop column if exists multiple_appointments;
alter table hq_config drop column if exists sod_updated_at;
alter table hq_config drop column if exists sod_updated_by;
alter table workspace_config_overrides drop column if exists published_by;
alter table frameworks drop column if exists published_by;

notify pgrst, 'reload schema';
