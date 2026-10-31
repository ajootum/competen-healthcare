-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK-771 (STAGING ONLY). It restores six function bodies verbatim from 770 and the three
-- foreign keys of framework_revision_competency, and drops what 771 added. It refuses (nothing changed) while anything
-- 771 stores exists (a proposed framework label, or any revision domain, practice or CPU), because it would be lost.
-- Restored verbatim from 770: framework_revision_competency_guard, clinical_scope_covers_domain, clinical_content_version_sod_floor, clinical_review_decision_sod_guard, framework_revision_problem, frameworks_revision_apply_on_publish.
-- ====================================================================================================

do $pre$
begin
  if to_regclass('public.framework_revision_domain') is not null and (exists (select 1 from framework_revision_domain)
       or exists (select 1 from framework_revision_practice) or exists (select 1 from framework_revision_cpu)) then
    raise exception 'ROLLBACK-771: revision domains, practices or CPUs exist. Nothing was changed';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'framework_revision' and column_name = 'framework_proposed')
     and exists (select 1 from framework_revision where framework_proposed) then
    raise exception 'ROLLBACK-771: a proposed framework label exists. Nothing was changed';
  end if;
end
$pre$;

drop trigger if exists framework_revision_structure_guard on framework_revision_domain;
drop trigger if exists framework_revision_structure_guard on framework_revision_practice;
drop trigger if exists framework_revision_structure_guard on framework_revision_cpu;
drop trigger if exists framework_revision_proposal_guard on framework_revision;

-- 770 body
create or replace function public.framework_revision_competency_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_fw uuid;
  v_rev uuid := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  select r.framework_id into v_fw from framework_revision r where r.id = v_rev and r.status = 'open';
  if not found then
    raise exception 'framework_revision_competency: the revision is not open';
  end if;
  if tg_op = 'DELETE' then
    if old.origin_competency_id is not null then
      raise exception 'framework_revision_competency: a published competency stays in its revision. Discard the revision to drop its changes';
    end if;
    if exists (select 1 from framework_revision_criterion k where k.revision_id = old.revision_id and k.competency_id = old.competency_id and k.origin_skill_id is not null) then
      raise exception 'framework_revision_competency: a published criterion was moved into this new competency. Move it back first';
    end if;
    update framework_revision set updated_at = now() where id = old.revision_id;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.revision_id is distinct from old.revision_id or new.competency_id is distinct from old.competency_id
       or new.origin_competency_id is distinct from old.origin_competency_id or new.base_hash is distinct from old.base_hash
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'framework_revision_competency: which competency this is, and its starting point, never change';
    end if;
  else
    if new.origin_competency_id is not null then
      if not exists (select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id
                      where c.id = new.origin_competency_id and d.framework_id = v_fw) then
        raise exception 'framework_revision_competency: the competency is not of the framework of this revision';
      end if;
      new.base_hash := public.competency_content_hash(new.origin_competency_id);
    else
      if exists (select 1 from framework_competencies c where c.id = new.competency_id)
         or exists (select 1 from framework_revision_competency x where x.competency_id = new.competency_id) then
        raise exception 'framework_revision_competency: a new competency takes a new id';
      end if;
      new.base_hash := null;
    end if;
    new.created_at := now();
  end if;
  if new.origin_competency_id is null and not exists (select 1 from framework_domains d where d.id = new.domain_id and d.framework_id = v_fw) then
    raise exception 'framework_revision_competency: a new competency is proposed in a domain of the framework of this revision';
  end if;
  new.updated_at := now();
  update framework_revision set updated_at = now() where id = new.revision_id;
  return new;
end;
$$;

-- 770 body
create or replace function public.clinical_scope_covers_domain(p_appointment uuid, p_domain uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_reviewer_scope s
      join framework_domains d on d.id = p_domain
      join frameworks f on f.id = d.framework_id
     where s.appointment_id = p_appointment
       and s.ended_at is null
       and ((s.scope_kind = 'profession' and s.scope_ref = f.profession_term_id)
         or (s.scope_kind = 'specialty' and s.scope_ref = f.specialty_term_id)
         or (s.scope_kind = 'framework' and s.scope_ref = f.id)
         or (s.scope_kind = 'domain' and s.scope_ref = d.id))
  )
$$;

-- 770 body
create or replace function public.clinical_content_version_sod_floor()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_risk text;
  v_floor int;
begin
  if new.content_kind = 'competency' and new.revision_id is not null then
    -- 770: a revision version is reviewed at the risk it PROPOSES (its own risk category, else its proposed CPU).
    select case when rc.risk_category = 'high' or u.risk_category = 'high' then 'high' else 'standard' end into v_risk
      from framework_revision_competency rc left join clinical_practice_units u on u.id = rc.cpu_id
     where rc.revision_id = new.revision_id and rc.competency_id = coalesce(new.competency_id, new.proposed_competency_id);
  elsif new.content_kind = 'competency' then
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

-- 770 body
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
       and ((v.content_kind = 'competency' and coalesce(o.competency_id, o.proposed_competency_id) = coalesce(v.competency_id, v.proposed_competency_id))
         or (v.content_kind = 'case' and o.case_version_id in (select cv.id from case_library_version cv
               where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)))
         or (v.content_kind = 'resource' and o.knowledge_version_id in (select kv.id from ckri_knowledge_version kv
               where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)))
         or (v.content_kind = 'learning' and o.learning_version_id in (select lv.id from learning_offering_version lv
               where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)))));

  if not v_conflict and v.content_kind = 'competency' then
    -- The audit trail of the competency and its framework, as authorsOf reads it (src/lib/competency/clinical-review.ts).
    select d.framework_id into v_parent from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = v.competency_id;
    -- 770: a new competency of a revision has no live row yet. Its framework is the revision framework.
    if v_parent is null and v.revision_id is not null then
      select r.framework_id into v_parent from framework_revision r where r.id = v.revision_id;
    end if;
    v_conflict := exists (
      select 1 from audit_log a
       where a.actor_id = new.reviewer_id and a.entity_id in (coalesce(v.competency_id, v.proposed_competency_id), v_parent)
         and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
           'catalogue_entry_add', 'catalogue_entry_status', 'catalogue_entry_remove', 'catalogue_entry_review',
           'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set',
           'reorder_layout', 'create_area', 'rename_area', 'delete_area', 'reorder_areas', 'set_domain_area', 'move_competency_domain'));
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

-- 770 body
create or replace function public.framework_revision_problem(p_revision uuid)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_fw uuid;
  v_name text;
begin
  select framework_id into v_fw from framework_revision where id = p_revision;
  if not found then
    return 'the revision does not exist';
  end if;
  select coalesce(c.code, c.name) into v_name from framework_revision_competency rc join framework_competencies c on c.id = rc.origin_competency_id
   where rc.revision_id = p_revision
     and not exists (select 1 from framework_domains d where d.id = c.domain_id and d.framework_id = v_fw) limit 1;
  if found then
    return format('the competency %s is no longer in this framework', v_name);
  end if;
  select coalesce(c.code, c.name) into v_name from framework_revision_competency rc join framework_competencies c on c.id = rc.origin_competency_id
   where rc.revision_id = p_revision and public.competency_content_hash(c.id) is distinct from rc.base_hash limit 1;
  if found then
    return format('the published content of %s changed after the revision started', v_name);
  end if;
  select coalesce(c.code, c.name) into v_name from framework_revision_competency rc join framework_competencies c on c.id = rc.origin_competency_id
   where rc.revision_id = p_revision
     and exists (select 1 from competency_skills s where s.competency_id = c.id
                  and not exists (select 1 from framework_revision_criterion k where k.revision_id = p_revision and k.origin_skill_id = s.id)) limit 1;
  if found then
    return format('a criterion was added to %s after the revision started', v_name);
  end if;
  if exists (select 1 from framework_revision_criterion k join competency_skills s on s.id = k.origin_skill_id
              where k.revision_id = p_revision
                and not exists (select 1 from framework_revision_competency rc where rc.revision_id = p_revision and rc.origin_competency_id = s.competency_id)) then
    return 'a criterion of the revision was moved to another competency after the revision started';
  end if;
  if exists (select 1 from framework_revision_competency rc where rc.revision_id = p_revision and rc.origin_competency_id is null
              and (exists (select 1 from framework_competencies c where c.id = rc.competency_id)
                or not exists (select 1 from framework_domains d where d.id = rc.domain_id and d.framework_id = v_fw))) then
    return 'a new competency has lost its domain or its id';
  end if;
  if exists (select 1 from framework_revision_criterion k where k.revision_id = p_revision and k.origin_skill_id is null
              and exists (select 1 from competency_skills s where s.id = k.skill_id)) then
    return 'a new criterion has lost its id';
  end if;
  return null;
end;
$$;

-- 770 body
create or replace function public.frameworks_revision_apply_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_rev uuid;
  v_problem text;
  v_total integer;
  v_unapproved integer;
begin
  -- Defence in depth (the WHEN clause already says so): only a publication.
  if new.pub_status is distinct from 'published'
     or (old.pub_status is not distinct from 'published'
         and new.version_major is not distinct from old.version_major and new.version_minor is not distinct from old.version_minor
         and new.version_revision is not distinct from old.version_revision) then
    return new;
  end if;
  select id into v_rev from framework_revision where framework_id = new.id and status = 'open' for update;
  if not found then
    return new;
  end if;

  v_problem := public.framework_revision_problem(v_rev);
  if v_problem is not null then
    raise exception 'framework revision at publication: the revision can no longer be applied, %. Nothing was published and the revision is kept. Discard it and start again, then put the framework forward again', v_problem;
  end if;

  update framework_revision set status = 'applying' where id = v_rev;

  -- Existing competencies: the content fields and the code, by id. Their domain and order stay the layout draft own.
  update framework_competencies c
     set code = rc.code, name = rc.name, description = rc.description, learning_outcomes = rc.learning_outcomes,
         expected_level_id = rc.expected_level_id, practice_id = rc.practice_id, cpu_id = rc.cpu_id, risk_category = rc.risk_category
    from framework_revision_competency rc
   where rc.revision_id = v_rev and rc.origin_competency_id = c.id
     and (c.code, c.name, c.description, c.learning_outcomes, c.expected_level_id, c.practice_id, c.cpu_id, c.risk_category)
         is distinct from (rc.code, rc.name, rc.description, rc.learning_outcomes, rc.expected_level_id, rc.practice_id, rc.cpu_id, rc.risk_category);

  -- New competencies, with the ids their reviews named.
  insert into framework_competencies (id, domain_id, sort_order, code, name, description, learning_outcomes, expected_level_id, practice_id, cpu_id, risk_category)
    select rc.competency_id, rc.domain_id, rc.sort_order, rc.code, rc.name, rc.description, rc.learning_outcomes, rc.expected_level_id,
           rc.practice_id, rc.cpu_id, rc.risk_category
      from framework_revision_competency rc where rc.revision_id = v_rev and rc.origin_competency_id is null;

  -- Existing criteria, by id: text, section, competency, source, order and retirement. Never deleted.
  update competency_skills s
     set competency_id = k.competency_id, name = k.name, component_code = k.component_code, source_ref = k.source_ref,
         sort_order = k.sort_order, is_active = k.is_active
    from framework_revision_criterion k
   where k.revision_id = v_rev and k.origin_skill_id = s.id
     and (s.competency_id, s.name, s.component_code, s.source_ref, s.sort_order, s.is_active)
         is distinct from (k.competency_id, k.name, k.component_code, k.source_ref, k.sort_order, k.is_active);

  -- New criteria, with their ids.
  insert into competency_skills (id, competency_id, name, component_code, source_ref, sort_order, is_active)
    select k.skill_id, k.competency_id, k.name, k.component_code, k.source_ref, k.sort_order, k.is_active
      from framework_revision_criterion k where k.revision_id = v_rev and k.origin_skill_id is null;

  -- The reviews of new competencies now name them.
  update clinical_content_version set competency_id = proposed_competency_id
   where revision_id = v_rev and competency_id is null and proposed_competency_id is not null;

  -- Exactly what was reviewed: every competency of the revision now hashes as its proposal did.
  if exists (select 1 from framework_revision_competency rc where rc.revision_id = v_rev
              and public.competency_content_hash(rc.competency_id) is distinct from public.framework_revision_competency_hash(v_rev, rc.competency_id)) then
    raise exception 'framework revision at publication: the applied content does not hash as the revision did. Nothing was published';
  end if;
  -- The 466 predicate over the applied content, here too: 466 fires on an update OF pub_status only, so a statement that
  -- changes the version alone must not apply content that is not clinically approved.
  select count(*), count(*) filter (where not public.competency_clinically_approved(c.id)) into v_total, v_unapproved
    from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = new.id;
  if v_unapproved > 0 then
    raise exception 'cfca publication: % of % competencies are not clinically approved at their current content', v_unapproved, v_total;
  end if;
  return new;
end;
$$;

do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'framework_revision_competency_domain_id_fkey') then
    alter table framework_revision_competency add constraint framework_revision_competency_domain_id_fkey foreign key (domain_id) references framework_domains(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'framework_revision_competency_practice_id_fkey') then
    alter table framework_revision_competency add constraint framework_revision_competency_practice_id_fkey foreign key (practice_id) references practices(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'framework_revision_competency_cpu_id_fkey') then
    alter table framework_revision_competency add constraint framework_revision_competency_cpu_id_fkey foreign key (cpu_id) references clinical_practice_units(id) on delete set null;
  end if;
end
$fk$;

drop table if exists framework_revision_cpu;
drop table if exists framework_revision_practice;
drop table if exists framework_revision_domain;
drop function if exists public.framework_revision_structure_guard();
drop function if exists public.framework_revision_proposal_guard();
drop function if exists public.framework_revision_domain_known(uuid, uuid);
drop function if exists public.framework_revision_practice_known(uuid, uuid);
alter table framework_revision drop constraint if exists framework_revision_proposal_check;
alter table framework_revision drop column if exists proposed_description;
alter table framework_revision drop column if exists proposed_name;
alter table framework_revision drop column if exists framework_proposed;

revoke execute on function public.clinical_scope_covers_domain(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_problem(uuid) from public, anon, authenticated;
revoke execute on function public.frameworks_revision_apply_on_publish() from public, anon, authenticated;
grant execute on function public.framework_revision_problem(uuid) to service_role;

notify pgrst, 'reload schema';
