-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql trigger functions between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 440: CKRI K1 -- RESEARCH GOVERNANCE FOUNDATION
--
-- COMPETEN-KNOWLEDGE-RESEARCH-01 (owner GO, 2026-10-25) section 3 (K1). Development and staging only.
-- Design: docs/COMPETEN-KNOWLEDGE-RESEARCH-01-ckri-foundation.md. Coordinator range claimed 440-449.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Five new tables, six functions, six triggers, two capabilities and two
-- positions. No existing row is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (new trigger functions), so it carries a staging rollback rehearsal.
-- Depends on 264 (hq_capability, hq_position, hq_position_capability), 117 (ogs_office_appointments, ogs_offices)
-- and profiles.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It records, in a form the database itself checks, WHICH purposes collective learning evidence may serve, WHO
-- has chosen to take part in each of the two optional CKRI permissions, and WHICH research projects an
-- independent governor has approved, so that no aggregate and no study can exist without a recorded basis.
--
-- ----------------------------------------------------------------------------------------------------
-- THE FOUR PERMISSIONS ARE FOUR RECORDS, NEVER ONE.
--
--   1 personal AI learning           individual_scholar_consent (372). Unchanged, not referenced here.
--   2 collective educational analytics   ckri_participation, permission collective_analytics, one per person.
--   3 specific educational content   case_candidacy (423), per offered item, owner-disabled. Unchanged and NOT
--                                    representable here: the permission CHECK below has no content value.
--   4 an identified research study   ckri_participation, permission research_study, one per person per project,
--                                    only while that project is recruiting.
--
-- Nothing in Scholar reads ckri_participation to decide access. Declining or withdrawing removes no learning.
--
-- THE PIECES.
--
--   ckri_purpose              a permitted purpose: its code, which optional permission it rests on, its wording,
--                             and whether it needs ethical review (always, for a research study). Draft, then
--                             active (by a governor who did not write it), then retired. Wording is frozen once
--                             active. Configuration, never code: nothing here names nursing.
--   ckri_participation        the current choice of a person for permission 2 or 4: granted or withdrawn, and the
--                             notice version they were shown. Read-own RLS.
--   ckri_participation_event  every grant and withdrawal, written ONLY by the trigger on ckri_participation, so a
--                             change cannot skip its record. Append-only. Read-own RLS.
--   ckri_research_project     a project: purpose, sponsor (platform, or institution with its agreement),
--                             ethics record, minimum cohort (never below 5), data access (aggregate only -- no
--                             other value is representable), and its status. The trigger enforces the lifecycle,
--                             that the decider is an authorised governor who is not the proposer, that recruiting
--                             needs an active purpose, the ethics record where required, and the agreement for an
--                             institution sponsor.
--   ckri_research_project_event  every status change with who made it. Trigger-written only. Append-only.
--   ckri_holds_capability     true when a person holds a capability through an active appointment (the 395 join).
--
-- AUTHORITY, THROUGH EXISTING POSITIONS. hq.quality.research.govern (purposes, policy, project decisions, ethics
-- record) goes to the new position research_governance_officer and to quality_council_member.
-- hq.quality.research.propose (propose and manage a project) goes to the new position research_lead.
--
-- RLS: on for all five tables. Participation and its events: read-own policy only. The rest: no policy. The
-- server writes through the service role. A cascade from a parent still deletes (pg_trigger_depth() > 1), so a
-- erasure of a person removes their participation and its trail.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CKRI/ROLLBACK-440.sql drops the triggers, functions, tables, grants,
--   positions and capabilities. It refuses while any participation row exists.
-- ====================================================================================================


-- ---- 1. authority: does a person hold a capability through an active appointment -----------------------

create or replace function public.ckri_holds_capability(p_person uuid, p_capability text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select p_person is not null and exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.person_id = p_person
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = p_capability
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
  )
$$;
revoke all on function public.ckri_holds_capability(uuid, text) from public, anon, authenticated;
grant execute on function public.ckri_holds_capability(uuid, text) to service_role;


-- ---- 2. permitted purposes ------------------------------------------------------------------------------

create table if not exists ckri_purpose (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  permission       text not null,
  label            text not null,
  description      text not null,
  requires_ethics  boolean not null default true,
  status           text not null default 'draft',
  created_by       uuid not null references profiles(id),
  activated_by     uuid references profiles(id),
  activated_at     timestamptz,
  retired_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table ckri_purpose drop constraint if exists ckri_purpose_check;
alter table ckri_purpose add constraint ckri_purpose_check
  check (code ~ '^[a-z][a-z0-9_]{2,60}$'
     and permission in ('collective_analytics', 'research_study')
     and char_length(btrim(label)) between 2 and 200
     and char_length(btrim(description)) between 20 and 2000
     and status in ('draft', 'active', 'retired')
     and (status = 'draft') = (activated_by is null and activated_at is null)
     and (status = 'retired') = (retired_at is not null)
     and (permission <> 'research_study' or requires_ethics));
create unique index if not exists ux_ckri_purpose_code on ckri_purpose(code);
alter table ckri_purpose enable row level security;

create or replace function public.ckri_purpose_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ckri_purpose: a purpose is the record. Retire it instead';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'ckri_purpose: a purpose starts as a draft';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.code is distinct from old.code or new.permission is distinct from old.permission
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'ckri_purpose: a purpose code, permission and author cannot be rewritten';
  end if;
  if old.status <> 'draft' and (new.label is distinct from old.label or new.description is distinct from old.description
     or new.requires_ethics is distinct from old.requires_ethics) then
    raise exception 'ckri_purpose: an active purpose wording is frozen. Retire it and draft another';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'ckri_purpose: a retired purpose stays retired';
  end if;
  if old.status = 'draft' and new.status = 'retired' then
    raise exception 'ckri_purpose: a draft is never retired. It was never in force';
  end if;
  if old.status = 'draft' and new.status = 'active' then
    if new.activated_by is null or not ckri_holds_capability(new.activated_by, 'hq.quality.research.govern') then
      raise exception 'ckri_purpose: not authorised. Activation needs an appointment holding hq.quality.research.govern';
    end if;
    if new.activated_by = new.created_by then
      raise exception 'ckri_purpose: not independent. The author of a purpose cannot activate it';
    end if;
    new.activated_at := now();
  end if;
  if old.status <> 'draft' and (new.activated_by is distinct from old.activated_by or new.activated_at is distinct from old.activated_at) then
    raise exception 'ckri_purpose: an activation record cannot be rewritten';
  end if;
  if old.status = 'active' and new.status = 'retired' then
    new.retired_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_purpose_guard on ckri_purpose;
create trigger ckri_purpose_guard before insert or update or delete on ckri_purpose for each row execute function public.ckri_purpose_guard();


-- ---- 3. research projects: the approval core (K4 adds the workspace around it) --------------------------

create table if not exists ckri_research_project (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  title              text not null,
  purpose_code       text not null references ckri_purpose(code),
  sponsor            text not null,
  institution_ref    uuid,
  agreement_ref      text,
  ethics_body        text,
  ethics_ref         text,
  ethics_decided_at  timestamptz,
  data_access        text not null default 'aggregate_only',
  min_cohort         integer not null default 10,
  status             text not null default 'draft',
  proposed_by        uuid not null references profiles(id),
  changed_by         uuid not null references profiles(id),
  decided_by         uuid references profiles(id),
  decided_at         timestamptz,
  decision_note      text,
  opened_at          timestamptz,
  closed_at          timestamptz,
  retain_until       date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table ckri_research_project drop constraint if exists ckri_research_project_check;
alter table ckri_research_project add constraint ckri_research_project_check
  check (code ~ '^[a-z][a-z0-9_-]{2,60}$'
     and char_length(btrim(title)) between 4 and 300
     and sponsor in ('platform', 'institution')
     and (sponsor <> 'institution' or (institution_ref is not null and char_length(btrim(coalesce(agreement_ref, ''))) >= 5))
     and (sponsor <> 'platform' or institution_ref is null)
     and data_access = 'aggregate_only'
     and min_cohort between 5 and 1000
     and status in ('draft', 'submitted', 'approved', 'rejected', 'recruiting', 'closed', 'withdrawn')
     and (status not in ('approved', 'rejected', 'recruiting', 'closed') or (decided_by is not null and decided_at is not null))
     and (status <> 'rejected' or char_length(btrim(coalesce(decision_note, ''))) >= 2)
     and (status not in ('recruiting', 'closed') or opened_at is not null)
     and (status = 'closed') = (closed_at is not null)
     and (status not in ('approved', 'recruiting', 'closed') or retain_until is not null)
     and ((ethics_ref is null) = (ethics_decided_at is null))
     and (ethics_ref is null or (char_length(btrim(ethics_ref)) >= 3 and char_length(btrim(coalesce(ethics_body, ''))) >= 2))
     and (decision_note is null or char_length(decision_note) <= 2000));
create unique index if not exists ux_ckri_research_project_code on ckri_research_project(code);
create index if not exists idx_ckri_research_project_status on ckri_research_project(status, updated_at desc);
alter table ckri_research_project enable row level security;

create table if not exists ckri_research_project_event (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references ckri_research_project(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  actor_id     uuid not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ckri_research_project_event on ckri_research_project_event(project_id, created_at);
alter table ckri_research_project_event enable row level security;

create or replace function public.ckri_research_project_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_purpose ckri_purpose%rowtype;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ckri_research_project: a project is the record. Withdraw or close it instead';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'ckri_research_project: a project starts as a draft';
    end if;
    select * into v_purpose from ckri_purpose where code = new.purpose_code;
    if not found or v_purpose.status <> 'active' then
      raise exception 'ckri_research_project: the purpose must be active';
    end if;
    if not ckri_holds_capability(new.proposed_by, 'hq.quality.research.propose') then
      raise exception 'ckri_research_project: not authorised. Proposing needs an appointment holding hq.quality.research.propose';
    end if;
    new.changed_by := new.proposed_by;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.code is distinct from old.code or new.purpose_code is distinct from old.purpose_code or new.sponsor is distinct from old.sponsor
     or new.institution_ref is distinct from old.institution_ref or new.proposed_by is distinct from old.proposed_by
     or new.created_at is distinct from old.created_at then
    raise exception 'ckri_research_project: a project identity, purpose, sponsor and proposer cannot be rewritten';
  end if;
  if old.status in ('rejected', 'closed', 'withdrawn') then
    raise exception 'ckri_research_project: a % project is final', old.status;
  end if;
  if old.status <> 'draft' and (new.title is distinct from old.title or new.agreement_ref is distinct from old.agreement_ref
     or new.min_cohort is distinct from old.min_cohort or new.data_access is distinct from old.data_access) then
    raise exception 'ckri_research_project: a submitted project is frozen. Return it to draft or propose another';
  end if;
  if old.status in ('recruiting') and (new.ethics_ref is distinct from old.ethics_ref or new.ethics_decided_at is distinct from old.ethics_decided_at
     or new.ethics_body is distinct from old.ethics_body) then
    raise exception 'ckri_research_project: the ethics record of a recruiting project cannot be rewritten';
  end if;
  if (new.ethics_ref is distinct from old.ethics_ref or new.ethics_decided_at is distinct from old.ethics_decided_at)
     and new.ethics_ref is not null and not ckri_holds_capability(new.changed_by, 'hq.quality.research.govern') then
    raise exception 'ckri_research_project: not authorised. Recording an ethics decision needs hq.quality.research.govern';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('submitted', 'withdrawn'))
         or (old.status = 'submitted' and new.status in ('draft', 'approved', 'rejected', 'withdrawn'))
         or (old.status = 'approved' and new.status in ('recruiting', 'withdrawn'))
         or (old.status = 'recruiting' and new.status in ('closed', 'withdrawn'))) then
      raise exception 'ckri_research_project: % cannot become %', old.status, new.status;
    end if;
    if new.status = 'submitted' and new.changed_by <> new.proposed_by then
      raise exception 'ckri_research_project: only the proposer submits a project';
    end if;
    if new.status in ('draft', 'withdrawn') and new.changed_by <> new.proposed_by
       and not ckri_holds_capability(new.changed_by, 'hq.quality.research.govern') then
      raise exception 'ckri_research_project: only the proposer or a governor returns or withdraws a project';
    end if;
    if new.status in ('approved', 'rejected') then
      if new.decided_by is null or new.decided_by <> new.changed_by or not ckri_holds_capability(new.decided_by, 'hq.quality.research.govern') then
        raise exception 'ckri_research_project: not authorised. A decision needs an appointment holding hq.quality.research.govern';
      end if;
      if new.decided_by = new.proposed_by then
        raise exception 'ckri_research_project: not independent. The proposer cannot decide their own project';
      end if;
      new.decided_at := now();
    end if;
    if new.status = 'recruiting' then
      if not ckri_holds_capability(new.changed_by, 'hq.quality.research.govern') then
        raise exception 'ckri_research_project: not authorised. Opening recruitment needs hq.quality.research.govern';
      end if;
      select * into v_purpose from ckri_purpose where code = new.purpose_code;
      if v_purpose.status <> 'active' then
        raise exception 'ckri_research_project: the purpose is no longer active';
      end if;
      if v_purpose.requires_ethics and new.ethics_ref is null then
        raise exception 'ckri_research_project: this purpose needs a recorded ethics approval before recruitment';
      end if;
      new.opened_at := now();
    end if;
    if new.status = 'closed' then
      new.closed_at := now();
    end if;
  elsif new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
     or new.opened_at is distinct from old.opened_at or new.closed_at is distinct from old.closed_at then
    raise exception 'ckri_research_project: decision and lifecycle times are written only by a status change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_research_project_guard on ckri_research_project;
create trigger ckri_research_project_guard before insert or update or delete on ckri_research_project for each row execute function public.ckri_research_project_guard();

create or replace function public.ckri_research_project_record()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into ckri_research_project_event (project_id, from_status, to_status, actor_id, note)
    values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status, new.changed_by,
            case when new.status in ('approved', 'rejected') then new.decision_note else null end);
  end if;
  return null;
end;
$$;
drop trigger if exists ckri_research_project_record on ckri_research_project;
create trigger ckri_research_project_record after insert or update on ckri_research_project for each row execute function public.ckri_research_project_record();


-- ---- 4. participation: permission 2 and permission 4, each its own record ---------------------------------

create table if not exists ckri_participation (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  permission      text not null,
  scope_key       text not null,
  project_id      uuid references ckri_research_project(id) on delete cascade,
  status          text not null,
  notice_version  text not null,
  granted_at      timestamptz not null default now(),
  withdrawn_at    timestamptz,
  updated_at      timestamptz not null default now()
);
alter table ckri_participation drop constraint if exists ckri_participation_check;
alter table ckri_participation add constraint ckri_participation_check
  check (permission in ('collective_analytics', 'research_study')
     and status in ('granted', 'withdrawn')
     and (status = 'withdrawn') = (withdrawn_at is not null)
     and char_length(btrim(notice_version)) between 1 and 60
     and ((permission = 'collective_analytics' and project_id is null and scope_key = 'all')
       or (permission = 'research_study' and project_id is not null and scope_key = project_id::text)));
create unique index if not exists ux_ckri_participation on ckri_participation(user_id, permission, scope_key);
create index if not exists idx_ckri_participation_scope on ckri_participation(permission, scope_key, status);
alter table ckri_participation enable row level security;
drop policy if exists ckri_participation_read_own on ckri_participation;
create policy ckri_participation_read_own on ckri_participation for select using (auth.uid() = user_id);

create table if not exists ckri_participation_event (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  permission      text not null,
  scope_key       text not null,
  event           text not null,
  notice_version  text not null,
  created_at      timestamptz not null default now()
);
alter table ckri_participation_event drop constraint if exists ckri_participation_event_check;
alter table ckri_participation_event add constraint ckri_participation_event_check check (event in ('granted', 'withdrawn'));
create index if not exists idx_ckri_participation_event_user on ckri_participation_event(user_id, created_at desc);
alter table ckri_participation_event enable row level security;
drop policy if exists ckri_participation_event_read_own on ckri_participation_event;
create policy ckri_participation_event_read_own on ckri_participation_event for select using (auth.uid() = user_id);

create or replace function public.ckri_participation_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_project ckri_research_project%rowtype;
  v_permission text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ckri_participation: a choice is withdrawn, not deleted. Erasure of the person removes it';
  end if;
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.permission is distinct from old.permission
     or new.scope_key is distinct from old.scope_key or new.project_id is distinct from old.project_id) then
    raise exception 'ckri_participation: a choice cannot be moved to another person, permission or project';
  end if;
  if new.status = 'granted' and (tg_op = 'INSERT' or old.status <> 'granted' or new.notice_version is distinct from old.notice_version) then
    if new.permission = 'research_study' then
      select * into v_project from ckri_research_project where id = new.project_id;
      select permission into v_permission from ckri_purpose where code = v_project.purpose_code;
      if v_project.id is null or v_project.status <> 'recruiting' or v_permission <> 'research_study' then
        raise exception 'ckri_participation: a study can be joined only while it is recruiting under a research-study purpose';
      end if;
    end if;
    new.granted_at := now();
    new.withdrawn_at := null;
  end if;
  if new.status = 'withdrawn' and (tg_op = 'INSERT' or old.status <> 'withdrawn') then
    new.withdrawn_at := now();
  end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.notice_version is not distinct from old.notice_version then
    new.granted_at := old.granted_at;
    new.withdrawn_at := old.withdrawn_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_participation_guard on ckri_participation;
create trigger ckri_participation_guard before insert or update or delete on ckri_participation for each row execute function public.ckri_participation_guard();

create or replace function public.ckri_participation_record()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.notice_version is distinct from old.notice_version then
    insert into ckri_participation_event (user_id, permission, scope_key, event, notice_version)
    values (new.user_id, new.permission, new.scope_key, new.status, new.notice_version);
  end if;
  return null;
end;
$$;
drop trigger if exists ckri_participation_record on ckri_participation;
create trigger ckri_participation_record after insert or update on ckri_participation for each row execute function public.ckri_participation_record();

-- Both trails: written only from their record trigger, never edited, deleted only by a cascade.
create or replace function public.ckri_trail_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() > 1 then return new; end if;
    raise exception '%: written only by its record trigger', tg_table_name;
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception '% is append-only', tg_table_name;
end;
$$;
drop trigger if exists ckri_participation_event_guard on ckri_participation_event;
create trigger ckri_participation_event_guard before insert or update or delete on ckri_participation_event for each row execute function public.ckri_trail_guard();
drop trigger if exists ckri_research_project_event_guard on ckri_research_project_event;
create trigger ckri_research_project_event_guard before insert or update or delete on ckri_research_project_event for each row execute function public.ckri_trail_guard();


-- ---- 5. authority, through the existing position model -------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.quality.research.govern', 'quality', 'Research governance',
   'Activate and retire permitted purposes, publish the CKRI policy, decide research projects and record ethics approvals'),
  ('hq.quality.research.propose', 'quality', 'Research proposal',
   'Propose a research project on aggregate learning intelligence and manage it through review')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('research_governance_officer', 'quality', 'Research Governance Officer',
   'Governs the purposes, policy and approvals of Competen Knowledge and Research Intelligence'),
  ('research_lead', 'quality', 'Research Lead',
   'Proposes and leads approved research projects on aggregate learning intelligence')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, p.cap, 'position_default'
from (values ('research_governance_officer', 'hq.quality.research.govern'), ('research_governance_officer', 'hq.platform.home.view'),
             ('research_lead', 'hq.quality.research.propose'), ('research_lead', 'hq.platform.home.view'),
             ('quality_council_member', 'hq.quality.research.govern')) as p(code, cap)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = p.cap)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = p.cap and x.effective_to is null
  );


-- Verification: RLS and policies, the triggers, the grants, and no rows.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('ckri_purpose', 'ckri_research_project', 'ckri_research_project_event', 'ckri_participation', 'ckri_participation_event')
 order by c.relname;

select position_code, capability_code from hq_position_capability
 where capability_code like 'hq.quality.research.%' and effective_to is null
 order by capability_code, position_code;

notify pgrst, 'reload schema';
