-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql trigger functions between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 443: CKRI K4 -- RESEARCH AND PUBLICATION WORKSPACE
--
-- COMPETEN-KNOWLEDGE-RESEARCH-01 (owner GO, 2026-10-25) sections 6, 7 and 8 (K4). Development and staging only.
-- Design: docs/COMPETEN-KNOWLEDGE-RESEARCH-01-ckri-foundation.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Seven new tables, eleven functions, nine triggers (one more on the 440 project, which
-- leaves the 440 guard itself unchanged), one capability and one position. No existing row is changed. Re-running it is a
-- no-op. OPS-001 s8: proposed Medium (new trigger functions), with a rollback rehearsal. Depends on 440 and 441.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It holds the protocol of a research project, team, approved aggregate datasets, statistical outputs, independent review,
-- publication approval and corrections, so that nobody gets row-level student data, nothing is published without
-- independent review and the integrity record, and every correction or withdrawal is kept.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   ckri_research_document   proposal, protocol, analysis plan, manuscript. Versioned, hash by the database, frozen by
--                            the team. A frozen document never changes. Only the proposer or an active lead or analyst
--                            writes. A PROTOCOL must record population, selection criteria, instruments and versions,
--                            scoring, missing data, statistical methods, limitations and generalisability (CHECK).
--   ckri_research_member     a team appointment: lead, analyst, reviewer or external collaborator. Access is
--                            aggregate_only and nothing else is representable. An external member needs an agreement
--                            reference. A governor who is not the member appoints. No member is active before the
--                            project is approved. No account is created here: a member is an existing profile.
--   ckri_research_dataset    an APPROVED DATASET is a named 441 snapshot, never rows. A governor approves it, for an
--                            approved or recruiting project, and its retention is extended to the project date.
--   ckri_research_output     a statistical output built only from the project datasets, with its integrity record
--                            (population, selection, provenance, instrument version, scoring, missing data,
--                            uncertainty, methods, limitations, generalisability, reproducibility -- all required).
--                            Using AI-marked measures requires stating they are not validated measurements.
--   ckri_research_review     independent scientific review of a frozen manuscript or output by a holder of
--                            hq.quality.research.review who is not on the team and not the proposer.
--   ckri_publication         a request to publish a frozen manuscript. Approval needs a governor who is not on the
--                            team, at least one independent endorsement of that exact manuscript, and the integrity
--                            attestation (no patient-outcome claim from Scholar performance, AI evaluation not
--                            presented as validated). Corrections and withdrawal are events, never edits.
--   ckri_publication_event   every request, decision, publication, correction and withdrawal. Trigger-written only.
--   ckri_research_project_k4_guard  on the 440 project: submission needs a frozen protocol and a frozen analysis plan.
--
-- AUTHORITY. hq.quality.research.review goes to the new position research_scientific_reviewer. Govern and propose
-- are the 440 rights.
--
-- RLS: on for all seven tables, no policy. The server writes through the service role.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CKRI/ROLLBACK-443.sql drops everything here and the extra project trigger.
-- ====================================================================================================


-- ---- 1. authority ----------------------------------------------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.quality.research.review', 'quality', 'Independent scientific review',
   'Review the frozen manuscripts and statistical outputs of research projects the reviewer is not part of')
on conflict (code) do nothing;
insert into hq_position (code, space, name, description) values
  ('research_scientific_reviewer', 'quality', 'Research Scientific Reviewer', 'Independently reviews research outputs and manuscripts')
on conflict (code) do nothing;
insert into hq_position_capability (position_code, capability_code, source)
select p.code, p.cap, 'position_default'
from (values ('research_scientific_reviewer', 'hq.quality.research.review'), ('research_scientific_reviewer', 'hq.platform.home.view')) as p(code, cap)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = p.cap)
  and not exists (select 1 from hq_position_capability x where x.position_code = p.code and x.capability_code = p.cap and x.effective_to is null);


-- ---- 2. a helper: every named key holds at least three characters of text ------------------------------------

create or replace function public.ckri_keys_present(p jsonb, p_keys text[])
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(bool_and(coalesce(char_length(btrim(p ->> k)), 0) >= 3), false) from unnest(p_keys) k
$$;


-- ---- 2b. the team --------------------------------------------------------------------------------------------

create table if not exists ckri_research_member (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references ckri_research_project(id) on delete cascade,
  person_id      uuid not null references profiles(id) on delete cascade,
  role           text not null,
  external       boolean not null default false,
  agreement_ref  text,
  access         text not null default 'aggregate_only',
  status         text not null default 'proposed',
  appointed_by   uuid references profiles(id),
  appointed_at   timestamptz,
  ended_at       timestamptz,
  created_at     timestamptz not null default now()
);
alter table ckri_research_member drop constraint if exists ckri_research_member_check;
alter table ckri_research_member add constraint ckri_research_member_check
  check (role in ('lead', 'analyst', 'reviewer', 'external_collaborator')
     and access = 'aggregate_only'
     and (role <> 'external_collaborator' or external)
     and (not external or char_length(btrim(coalesce(agreement_ref, ''))) >= 5)
     and status in ('proposed', 'active', 'ended')
     and (status = 'proposed') = (appointed_at is null)
     and (status = 'proposed' or appointed_by is not null)
     and (status = 'ended') = (ended_at is not null));
create unique index if not exists ux_ckri_research_member on ckri_research_member(project_id, person_id, role);
alter table ckri_research_member enable row level security;

-- Is this person on the project team (active), or its proposer?
create or replace function public.ckri_on_team(p_project uuid, p_person uuid, p_roles text[])
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (select 1 from ckri_research_project p where p.id = p_project and p.proposed_by = p_person)
      or exists (select 1 from ckri_research_member m where m.project_id = p_project and m.person_id = p_person and m.status = 'active' and m.role = any(p_roles))
$$;
revoke all on function public.ckri_on_team(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.ckri_on_team(uuid, uuid, text[]) to service_role;

create or replace function public.ckri_research_member_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.status = 'proposed' then return old; end if;
    raise exception 'ckri_research_member: an appointment is the record. End it instead';
  end if;
  if tg_op = 'UPDATE' and (new.project_id is distinct from old.project_id or new.person_id is distinct from old.person_id or new.role is distinct from old.role
     or new.external is distinct from old.external or new.agreement_ref is distinct from old.agreement_ref or new.created_at is distinct from old.created_at) then
    raise exception 'ckri_research_member: an appointment cannot be moved to another person, project, role or agreement';
  end if;
  if tg_op = 'INSERT' and new.status <> 'proposed' then
    raise exception 'ckri_research_member: an appointment starts proposed';
  end if;
  if tg_op = 'UPDATE' and old.status = 'ended' then
    raise exception 'ckri_research_member: an ended appointment stays ended';
  end if;
  if tg_op = 'UPDATE' and new.status = 'active' and old.status = 'proposed' then
    select status into v_status from ckri_research_project where id = new.project_id;
    if v_status not in ('approved', 'recruiting') then
      raise exception 'ckri_research_member: nobody joins a team before the project is approved';
    end if;
    if new.appointed_by is null or new.appointed_by = new.person_id or not ckri_holds_capability(new.appointed_by, 'hq.quality.research.govern') then
      raise exception 'ckri_research_member: not authorised. A governor who is not the member appoints';
    end if;
    new.appointed_at := now();
  end if;
  if tg_op = 'UPDATE' and new.status = 'ended' and old.status <> 'ended' then
    new.ended_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_research_member_guard on ckri_research_member;
create trigger ckri_research_member_guard before insert or update or delete on ckri_research_member for each row execute function public.ckri_research_member_guard();


-- ---- 3. documents: proposal, protocol, analysis plan, manuscript -----------------------------------------------

create table if not exists ckri_research_document (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references ckri_research_project(id) on delete cascade,
  kind          text not null,
  version_no    integer not null,
  content       jsonb not null,
  content_hash  text not null default 'computed-by-trigger',
  state         text not null default 'draft',
  authored_by   uuid not null references profiles(id),
  frozen_by     uuid references profiles(id),
  frozen_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table ckri_research_document drop constraint if exists ckri_research_document_check;
alter table ckri_research_document add constraint ckri_research_document_check
  check (kind in ('proposal', 'protocol', 'analysis_plan', 'manuscript') and version_no >= 1
     and jsonb_typeof(content) = 'object' and octet_length(content::text) <= 200000
     and state in ('draft', 'frozen') and (state = 'frozen') = (frozen_at is not null and frozen_by is not null)
     and (kind <> 'protocol' or ckri_keys_present(content, array['population', 'selection_criteria', 'instruments', 'scoring', 'missing_data', 'statistical_methods', 'limitations', 'generalisability'])));
create unique index if not exists ux_ckri_research_document on ckri_research_document(project_id, kind, version_no);
alter table ckri_research_document enable row level security;

create or replace function public.ckri_research_document_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.state = 'draft' then return old; end if;
    raise exception 'ckri_research_document: a frozen document is the record and cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then raise exception 'ckri_research_document: a document starts as a draft'; end if;
    if not ckri_on_team(new.project_id, new.authored_by, array['lead', 'analyst']) then
      raise exception 'ckri_research_document: not authorised. Only the proposer or an active lead or analyst writes project documents';
    end if;
    new.content_hash := md5(new.content::text);
    return new;
  end if;
  if new.project_id is distinct from old.project_id or new.kind is distinct from old.kind or new.version_no is distinct from old.version_no
     or new.authored_by is distinct from old.authored_by or new.created_at is distinct from old.created_at then
    raise exception 'ckri_research_document: a document identity cannot be rewritten';
  end if;
  if old.state = 'frozen' then
    raise exception 'ckri_research_document: a frozen document never changes. Write a new version';
  end if;
  if new.state = 'frozen' then
    if new.frozen_by is null or not ckri_on_team(new.project_id, new.frozen_by, array['lead']) then
      raise exception 'ckri_research_document: only the proposer or an active lead freezes a document';
    end if;
    new.frozen_at := now();
  end if;
  new.content_hash := md5(new.content::text);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_research_document_guard on ckri_research_document;
create trigger ckri_research_document_guard before insert or update or delete on ckri_research_document for each row execute function public.ckri_research_document_guard();

-- On the 440 project, beside its own guard: a project goes to review only with a frozen protocol and analysis plan.
create or replace function public.ckri_research_project_k4_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    if not exists (select 1 from ckri_research_document d where d.project_id = new.id and d.kind = 'protocol' and d.state = 'frozen')
       or not exists (select 1 from ckri_research_document d where d.project_id = new.id and d.kind = 'analysis_plan' and d.state = 'frozen') then
      raise exception 'ckri_research_project: a project is submitted only with a frozen protocol and a frozen analysis plan';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_research_project_k4_guard on ckri_research_project;
create trigger ckri_research_project_k4_guard before update on ckri_research_project for each row execute function public.ckri_research_project_k4_guard();


-- ---- 4. approved datasets: named aggregate snapshots, never rows ---------------------------------------------------

create table if not exists ckri_research_dataset (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references ckri_research_project(id) on delete cascade,
  snapshot_id   uuid not null references ckri_snapshot(id),
  label         text not null,
  approved_by   uuid not null references profiles(id),
  approved_at   timestamptz not null default now()
);
alter table ckri_research_dataset drop constraint if exists ckri_research_dataset_check;
alter table ckri_research_dataset add constraint ckri_research_dataset_check check (char_length(btrim(label)) between 2 and 200);
create unique index if not exists ux_ckri_research_dataset on ckri_research_dataset(project_id, snapshot_id);
alter table ckri_research_dataset enable row level security;

create or replace function public.ckri_research_dataset_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  p ckri_research_project%rowtype;
  s ckri_snapshot%rowtype;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ckri_research_dataset: an approved dataset is the record';
  end if;
  if tg_op = 'UPDATE' then raise exception 'ckri_research_dataset: an approved dataset cannot be rewritten'; end if;
  select * into p from ckri_research_project where id = new.project_id;
  if p.status not in ('approved', 'recruiting') then
    raise exception 'ckri_research_dataset: datasets are approved only for an approved or recruiting project';
  end if;
  if not ckri_holds_capability(new.approved_by, 'hq.quality.research.govern') or ckri_on_team(new.project_id, new.approved_by, array['lead', 'analyst', 'reviewer', 'external_collaborator']) then
    raise exception 'ckri_research_dataset: not authorised. A governor who is not on the project approves its datasets';
  end if;
  select * into s from ckri_snapshot where id = new.snapshot_id;
  if s.min_cohort < p.min_cohort then
    raise exception 'ckri_research_dataset: the snapshot suppresses below the project minimum cohort of %', p.min_cohort;
  end if;
  if s.retain_until < p.retain_until then
    update ckri_snapshot set retain_until = p.retain_until where id = s.id;
  end if;
  new.approved_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_research_dataset_guard on ckri_research_dataset;
create trigger ckri_research_dataset_guard before insert or update or delete on ckri_research_dataset for each row execute function public.ckri_research_dataset_guard();


-- ---- 5. statistical outputs, with their integrity record --------------------------------------------------------

create table if not exists ckri_research_output (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references ckri_research_project(id) on delete cascade,
  dataset_ids   uuid[] not null,
  title         text not null,
  results       jsonb not null,
  integrity     jsonb not null,
  uses_ai_marked boolean not null default false,
  state         text not null default 'draft',
  authored_by   uuid not null references profiles(id),
  frozen_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table ckri_research_output drop constraint if exists ckri_research_output_check;
alter table ckri_research_output add constraint ckri_research_output_check
  check (cardinality(dataset_ids) between 1 and 50 and char_length(btrim(title)) between 2 and 300
     and jsonb_typeof(results) = 'object' and octet_length(results::text) <= 200000 and jsonb_typeof(integrity) = 'object'
     and ckri_keys_present(integrity, array['population', 'selection', 'provenance', 'instrument_version', 'scoring', 'missing_data', 'uncertainty', 'methods', 'limitations', 'generalisability', 'reproducibility'])
     and (not uses_ai_marked or coalesce(integrity ->> 'ai_marked_statement', '') ilike '%not validated%')
     and state in ('draft', 'frozen') and (state = 'frozen') = (frozen_at is not null));
alter table ckri_research_output enable row level security;

create or replace function public.ckri_research_output_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.state = 'draft' then return old; end if;
    raise exception 'ckri_research_output: a frozen output is the record';
  end if;
  if tg_op = 'UPDATE' and old.state = 'frozen' then
    raise exception 'ckri_research_output: a frozen output never changes';
  end if;
  if tg_op = 'UPDATE' and (new.project_id is distinct from old.project_id or new.authored_by is distinct from old.authored_by) then
    raise exception 'ckri_research_output: an output identity cannot be rewritten';
  end if;
  if not ckri_on_team(new.project_id, new.authored_by, array['lead', 'analyst']) then
    raise exception 'ckri_research_output: not authorised. Only the proposer or an active lead or analyst writes outputs';
  end if;
  if exists (select 1 from unnest(new.dataset_ids) d(id) where not exists (select 1 from ckri_research_dataset x where x.id = d.id and x.project_id = new.project_id)) then
    raise exception 'ckri_research_output: an output is built only from the approved datasets of its own project';
  end if;
  if not new.uses_ai_marked and exists (select 1 from ckri_research_dataset x join ckri_snapshot s on s.id = x.snapshot_id
                                        where x.id = any(new.dataset_ids) and s.measure = 'reasoning_difficulty') then
    raise exception 'ckri_research_output: a reasoning-difficulty dataset carries AI-marked figures, so the output must say so';
  end if;
  if new.state = 'frozen' and (tg_op = 'INSERT' or old.state = 'draft') then new.frozen_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_research_output_guard on ckri_research_output;
create trigger ckri_research_output_guard before insert or update or delete on ckri_research_output for each row execute function public.ckri_research_output_guard();


-- ---- 6. independent scientific review -----------------------------------------------------------------------------

create table if not exists ckri_research_review (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references ckri_research_project(id) on delete cascade,
  document_id   uuid references ckri_research_document(id) on delete cascade,
  output_id     uuid references ckri_research_output(id) on delete cascade,
  reviewed_hash text not null default 'set-by-trigger',
  reviewer_id   uuid not null references profiles(id),
  decision      text not null,
  comments      text not null,
  created_at    timestamptz not null default now()
);
alter table ckri_research_review drop constraint if exists ckri_research_review_check;
alter table ckri_research_review add constraint ckri_research_review_check
  check (((document_id is null) <> (output_id is null)) and decision in ('endorse', 'revise', 'reject') and char_length(btrim(comments)) between 10 and 20000);
create unique index if not exists ux_ckri_research_review on ckri_research_review(reviewer_id, document_id, output_id);
alter table ckri_research_review enable row level security;

create or replace function public.ckri_research_review_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_hash text;
  v_state text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op <> 'INSERT' then raise exception 'ckri_research_review is append-only'; end if;
  if new.document_id is not null then
    select project_id, content_hash, state into v_project, v_hash, v_state from ckri_research_document where id = new.document_id;
  else
    select project_id, md5(results::text || integrity::text), state into v_project, v_hash, v_state from ckri_research_output where id = new.output_id;
  end if;
  if v_project is distinct from new.project_id or v_state <> 'frozen' then
    raise exception 'ckri_research_review: only a frozen manuscript or output of this project is reviewed';
  end if;
  if not ckri_holds_capability(new.reviewer_id, 'hq.quality.research.review') then
    raise exception 'ckri_research_review: not authorised. Scientific review needs hq.quality.research.review';
  end if;
  if ckri_on_team(new.project_id, new.reviewer_id, array['lead', 'analyst', 'reviewer', 'external_collaborator']) then
    raise exception 'ckri_research_review: not independent. A team member or the proposer cannot review the project';
  end if;
  new.reviewed_hash := v_hash;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_research_review_guard on ckri_research_review;
create trigger ckri_research_review_guard before insert or update or delete on ckri_research_review for each row execute function public.ckri_research_review_guard();


-- ---- 7. publication, corrections and withdrawal -------------------------------------------------------------------

create table if not exists ckri_publication (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references ckri_research_project(id) on delete cascade,
  manuscript_id         uuid not null references ckri_research_document(id),
  venue                 text not null,
  status                text not null default 'requested',
  integrity_attested    boolean not null default false,
  requested_by          uuid not null references profiles(id),
  changed_by            uuid not null references profiles(id),
  decided_by            uuid references profiles(id),
  decided_at            timestamptz,
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table ckri_publication drop constraint if exists ckri_publication_check;
alter table ckri_publication add constraint ckri_publication_check
  check (char_length(btrim(venue)) between 2 and 300
     and status in ('requested', 'approved', 'rejected', 'published', 'withdrawn')
     and (status not in ('approved', 'published') or (integrity_attested and decided_by is not null and decided_at is not null))
     and (status <> 'rejected' or char_length(btrim(coalesce(note, ''))) >= 2)
     and (note is null or char_length(note) <= 4000));
alter table ckri_publication enable row level security;

create table if not exists ckri_publication_event (
  id              uuid primary key default gen_random_uuid(),
  publication_id  uuid not null references ckri_publication(id) on delete cascade,
  event           text not null,
  actor_id        uuid not null,
  note            text,
  created_at      timestamptz not null default clock_timestamp()
);
alter table ckri_publication_event drop constraint if exists ckri_publication_event_check;
alter table ckri_publication_event add constraint ckri_publication_event_check
  check (event in ('requested', 'approved', 'rejected', 'published', 'corrected', 'withdrawn')
     and (event not in ('corrected', 'withdrawn', 'rejected') or char_length(btrim(coalesce(note, ''))) >= 10));
create index if not exists idx_ckri_publication_event on ckri_publication_event(publication_id, created_at);
alter table ckri_publication_event enable row level security;

create or replace function public.ckri_publication_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  d ckri_research_document%rowtype;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ckri_publication: a publication record is kept. Withdraw it instead';
  end if;
  select * into d from ckri_research_document where id = new.manuscript_id;
  if tg_op = 'INSERT' then
    if d.kind <> 'manuscript' or d.state <> 'frozen' or d.project_id <> new.project_id then
      raise exception 'ckri_publication: only a frozen manuscript of this project can be put forward';
    end if;
    if not ckri_on_team(new.project_id, new.requested_by, array['lead']) then
      raise exception 'ckri_publication: only the proposer or an active lead requests publication';
    end if;
    if new.status <> 'requested' then raise exception 'ckri_publication: a publication starts as a request'; end if;
    new.changed_by := new.requested_by;
    return new;
  end if;
  if new.project_id is distinct from old.project_id or new.manuscript_id is distinct from old.manuscript_id or new.requested_by is distinct from old.requested_by
     or new.venue is distinct from old.venue or new.created_at is distinct from old.created_at then
    raise exception 'ckri_publication: a publication request cannot be rewritten. Withdraw it and request again';
  end if;
  if old.status in ('rejected', 'withdrawn') then raise exception 'ckri_publication: a % publication is final', old.status; end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'requested' and new.status in ('approved', 'rejected', 'withdrawn'))
         or (old.status = 'approved' and new.status in ('published', 'withdrawn'))
         or (old.status = 'published' and new.status = 'withdrawn')) then
      raise exception 'ckri_publication: % cannot become %', old.status, new.status;
    end if;
    if new.status in ('approved', 'rejected') then
      if new.decided_by is null or new.decided_by <> new.changed_by or not ckri_holds_capability(new.decided_by, 'hq.quality.research.govern')
         or ckri_on_team(new.project_id, new.decided_by, array['lead', 'analyst', 'reviewer', 'external_collaborator']) then
        raise exception 'ckri_publication: not authorised. A governor who is not on the project decides publication';
      end if;
      new.decided_at := now();
    end if;
    if new.status = 'approved' then
      if not new.integrity_attested then
        raise exception 'ckri_publication: approval needs the integrity attestation';
      end if;
      if not exists (select 1 from ckri_research_review r where r.document_id = new.manuscript_id and r.decision = 'endorse' and r.reviewed_hash = d.content_hash)
         or exists (select 1 from ckri_research_review r where r.document_id = new.manuscript_id and r.decision = 'reject') then
        raise exception 'ckri_publication: approval needs an independent endorsement of this exact manuscript and no rejection';
      end if;
    end if;
    if new.status = 'published' and not ckri_on_team(new.project_id, new.changed_by, array['lead']) then
      raise exception 'ckri_publication: only the proposer or an active lead records publication';
    end if;
    if new.status = 'withdrawn' and not (ckri_on_team(new.project_id, new.changed_by, array['lead']) or ckri_holds_capability(new.changed_by, 'hq.quality.research.govern')) then
      raise exception 'ckri_publication: only a lead or a governor withdraws a publication';
    end if;
    if new.status = 'withdrawn' and char_length(btrim(coalesce(new.note, ''))) < 10 then
      raise exception 'ckri_publication: a withdrawal says why';
    end if;
  elsif new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
    raise exception 'ckri_publication: a decision is written only with its status change';
  end if;
  if new.integrity_attested is distinct from old.integrity_attested and old.status <> 'requested' then
    raise exception 'ckri_publication: the integrity attestation is made before the decision, never after';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_publication_guard on ckri_publication;
create trigger ckri_publication_guard before insert or update or delete on ckri_publication for each row execute function public.ckri_publication_guard();

create or replace function public.ckri_publication_record()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into ckri_publication_event (publication_id, event, actor_id, note)
    values (new.id, new.status, new.changed_by, case when new.status in ('rejected', 'withdrawn') then new.note else null end);
  end if;
  return null;
end;
$$;
drop trigger if exists ckri_publication_record on ckri_publication;
create trigger ckri_publication_record after insert or update on ckri_publication for each row execute function public.ckri_publication_record();

-- A correction of a published output is an event with its reason, recorded by a lead or a governor. Never an edit.
create or replace function public.ckri_publication_correct(p_publication uuid, p_actor uuid, p_note text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v ckri_publication%rowtype;
begin
  select * into v from ckri_publication where id = p_publication;
  if not found or v.status <> 'published' then raise exception 'ckri_publication: only a published output is corrected'; end if;
  if not (ckri_on_team(v.project_id, p_actor, array['lead']) or ckri_holds_capability(p_actor, 'hq.quality.research.govern')) then
    raise exception 'ckri_publication: only a lead or a governor records a correction';
  end if;
  perform set_config('ckri.publication_event', 'on', true);
  insert into ckri_publication_event (publication_id, event, actor_id, note) values (p_publication, 'corrected', p_actor, p_note);
  perform set_config('ckri.publication_event', '', true);
end;
$$;
revoke all on function public.ckri_publication_correct(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ckri_publication_correct(uuid, uuid, text) to service_role;

create or replace function public.ckri_publication_event_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() > 1 or coalesce(current_setting('ckri.publication_event', true), '') = 'on' then return new; end if;
    raise exception 'ckri_publication_event: written only by its record trigger or the correction function';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'ckri_publication_event is append-only';
end;
$$;
drop trigger if exists ckri_publication_event_guard on ckri_publication_event;
create trigger ckri_publication_event_guard before insert or update or delete on ckri_publication_event for each row execute function public.ckri_publication_event_guard();


-- Verification: RLS on, no policy, and the grant.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ckri_research_member', 'ckri_research_document', 'ckri_research_dataset', 'ckri_research_output', 'ckri_research_review', 'ckri_publication', 'ckri_publication_event')
 order by c.relname;

notify pgrst, 'reload schema';
