-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 442: CKRI K3 -- EDUCATOR KNOWLEDGE IMPROVEMENT ON THE ONE CLINICAL-APPROVAL PROCESS
--
-- COMPETEN-KNOWLEDGE-RESEARCH-01 (owner GO, 2026-10-25) section 5 (K3). Development and staging only.
-- Design: docs/COMPETEN-KNOWLEDGE-RESEARCH-01-ckri-foundation.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE OR WIDENING. Four new tables, one new column on clinical_content_version (every
-- existing row keeps its kind and values), its subject CHECK widened to a third kind, the two 422 review guards REPLACED
-- (their competency and case branches byte-identical, a resource branch added), seven functions, two capabilities, one
-- position. Re-running it is a no-op. OPS-001 s8: proposed Medium (replaced shared guard functions), with a rollback
-- rehearsal. Depends on 395, 422, 440 and 441.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets an authorised educator turn a learning need seen in a suppressed aggregate into an explanation, a revision
-- question or a targeted resource that reaches learners only after independent clinical approval of its exact content
-- and a separate publication, while recording whether it began as an AI draft or as writing by the educator.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   ckri_learning_need          a need an educator raises FROM ONE REPORTED (unsuppressed) snapshot cell. The trigger
--                               copies the figures of the cell as evidence (never sent by a writer) and refuses a suppressed
--                               or unknown cell. It is answered by an existing governed path: a knowledge resource
--                               (below), a clinical case (422 case_library_case) or a competency improvement (395
--                               clinical_content_version of kind competency). The trigger checks the answer exists.
--   ckri_knowledge_resource     a resource identity: code, kind (explanation, revision_question, targeted_resource),
--                               title, active or retired, and the need it answers, if any.
--   ckri_knowledge_version      its content, with a database-computed hash. origin (educator or ai_draft) is frozen
--                               at creation, and an ai_draft carries its model and prompt version. Editing a draft
--                               clears its educator review, because a review is bound to the content hash. Draft,
--                               submitted, published, superseded, retired, exactly as 422 cases.
--   ckri_knowledge_version_competency  the CFCA competencies it teaches. Frozen from submission.
--   clinical_content_version    + knowledge_version_id. Kind resource: the exact resource version.
--   the two review guards       REPLACED. Competency and case branches unchanged from 422. Resource: the hash and
--                               content are computed by the database. Scope covers EVERY competency it teaches, as cases.
--
--   THREE STATES ARE NEVER MERGED. AI-generated (origin ai_draft), educator-reviewed (educator_reviewed_by on the
--   exact hash) and clinically approved (ckri_knowledge_approved, from 395 decisions) are three separate facts.
--   Submission needs the educator review. Publication needs clinical approval and hq.quality.knowledge.publish.
--
--   NOTHING STUDENT-UPLOADED CAN BECOME A RESOURCE. No table here has a column that can reference a student, their
--   material or their private case. Contribution of student content stays case_candidacy (423), owner-disabled.
--
-- AUTHORITY. hq.learning.ckri.educator (educator views, needs, resource drafts, review and submission) goes to the new
-- position knowledge_educator. hq.quality.knowledge.publish (publish and retire resources) goes to quality_council_member.
--
-- RLS: on for the four tables, no policy. Execute on the functions: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CKRI/ROLLBACK-442.sql restores the two 422 guards byte for byte and the two-kind
--   CHECK, and drops the rest. It refuses while any clinical_content_version of kind resource exists.
-- ====================================================================================================


-- ---- 1. authority ----------------------------------------------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.learning.ckri.educator', 'learning', 'Educator learning intelligence',
   'See released aggregate learning measures, raise learning needs, and draft, review and submit knowledge resources'),
  ('hq.quality.knowledge.publish', 'quality', 'Knowledge resource publication',
   'Publish and retire clinically approved knowledge resources')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('knowledge_educator', 'learning', 'Knowledge Educator',
   'Develops educator-reviewed learning resources from aggregate learning needs')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, p.cap, 'position_default'
from (values ('knowledge_educator', 'hq.learning.ckri.educator'), ('knowledge_educator', 'hq.platform.home.view'),
             ('quality_council_member', 'hq.quality.knowledge.publish')) as p(code, cap)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = p.cap)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = p.cap and x.effective_to is null
  );


-- ---- 2. knowledge resources -------------------------------------------------------------------------------

create table if not exists ckri_knowledge_resource (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  kind        text not null,
  title       text not null,
  status      text not null default 'active',
  need_id     uuid,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table ckri_knowledge_resource drop constraint if exists ckri_knowledge_resource_check;
alter table ckri_knowledge_resource add constraint ckri_knowledge_resource_check
  check (code ~ '^[a-z][a-z0-9_-]{2,60}$' and kind in ('explanation', 'revision_question', 'targeted_resource')
     and char_length(btrim(title)) between 2 and 200 and status in ('active', 'retired'));
create unique index if not exists ux_ckri_knowledge_resource_code on ckri_knowledge_resource(code);
alter table ckri_knowledge_resource enable row level security;

create table if not exists ckri_knowledge_version (
  id                     uuid primary key default gen_random_uuid(),
  resource_id            uuid not null references ckri_knowledge_resource(id) on delete cascade,
  version_no             integer not null,
  content                jsonb not null,
  content_hash           text not null default 'computed-by-trigger',
  origin                 text not null,
  ai_provenance          jsonb,
  risk                   text not null default 'standard',
  state                  text not null default 'draft',
  authored_by            uuid[] not null,
  educator_reviewed_by   uuid references profiles(id),
  educator_reviewed_hash text,
  educator_reviewed_at   timestamptz,
  submitted_by           uuid,
  submitted_at           timestamptz,
  published_by           uuid,
  published_at           timestamptz,
  superseded_at          timestamptz,
  retired_at             timestamptz,
  parent_version_id      uuid references ckri_knowledge_version(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table ckri_knowledge_version drop constraint if exists ckri_knowledge_version_check;
alter table ckri_knowledge_version add constraint ckri_knowledge_version_check
  check (version_no >= 1 and jsonb_typeof(content) = 'object' and octet_length(content::text) <= 32000
     and origin in ('educator', 'ai_draft')
     and ((origin = 'ai_draft') = (ai_provenance is not null))
     and (ai_provenance is null or (jsonb_typeof(ai_provenance) = 'object' and ai_provenance ? 'model' and ai_provenance ? 'prompt_version'))
     and risk in ('standard', 'high')
     and state in ('draft', 'submitted', 'published', 'superseded', 'retired')
     and cardinality(authored_by) >= 1
     and ((educator_reviewed_by is null) = (educator_reviewed_hash is null)) and ((educator_reviewed_by is null) = (educator_reviewed_at is null))
     and (state = 'draft') = (submitted_at is null)
     and (state = 'draft' or (submitted_by is not null and submitted_by = any(authored_by) and educator_reviewed_hash = content_hash))
     and (state not in ('published', 'superseded') or (published_at is not null and published_by is not null)));
create unique index if not exists ux_ckri_knowledge_version_no on ckri_knowledge_version(resource_id, version_no);
alter table ckri_knowledge_version enable row level security;

create table if not exists ckri_knowledge_version_competency (
  version_id    uuid not null references ckri_knowledge_version(id) on delete cascade,
  competency_id uuid not null references framework_competencies(id),
  primary key (version_id, competency_id)
);
alter table ckri_knowledge_version_competency enable row level security;

-- The shape of each kind. A revision question is four options, one correct, with a rationale.
create or replace function public.ckri_knowledge_content_ok(p_kind text, p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_kind
    when 'explanation' then jsonb_typeof(p -> 'body') = 'string' and char_length(p ->> 'body') between 20 and 20000
    when 'targeted_resource' then jsonb_typeof(p -> 'body') = 'string' and char_length(p ->> 'body') between 20 and 20000
      and (p -> 'links' is null or (jsonb_typeof(p -> 'links') = 'array' and jsonb_array_length(p -> 'links') <= 20))
    when 'revision_question' then jsonb_typeof(p -> 'stem') = 'string' and char_length(p ->> 'stem') between 10 and 2000
      and jsonb_typeof(p -> 'options') = 'array' and jsonb_array_length(p -> 'options') = 4
      and jsonb_typeof(p -> 'correct_index') = 'number' and (p ->> 'correct_index')::int between 0 and 3
      and jsonb_typeof(p -> 'rationale') = 'string' and char_length(p ->> 'rationale') between 10 and 4000
    else false end
$$;

create or replace function public.ckri_knowledge_resource_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ckri_knowledge_resource: a resource is the record. Retire it instead';
  end if;
  if tg_op = 'INSERT' then
    if not ckri_holds_capability(new.created_by, 'hq.learning.ckri.educator') then
      raise exception 'ckri_knowledge_resource: not authorised. Creating a resource needs hq.learning.ckri.educator';
    end if;
    if new.status <> 'active' then raise exception 'ckri_knowledge_resource: a resource starts active'; end if;
    return new;
  end if;
  if new.code is distinct from old.code or new.kind is distinct from old.kind or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.need_id is distinct from old.need_id then
    raise exception 'ckri_knowledge_resource: a resource code, kind, author and need cannot be rewritten';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'ckri_knowledge_resource: a retired resource stays retired';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_knowledge_resource_guard on ckri_knowledge_resource;
create trigger ckri_knowledge_resource_guard before insert or update or delete on ckri_knowledge_resource for each row execute function public.ckri_knowledge_resource_guard();

-- The hash is computed by the database. A draft is editable, and editing it clears its educator review. From submission the
-- content, links, risk and authorship are frozen, and the state moves only through the functions below.
create or replace function public.ckri_knowledge_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_kind text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.state = 'draft' then return old; end if;
    raise exception 'ckri_knowledge_version: a submitted version is the record and cannot be deleted';
  end if;
  select kind into v_kind from ckri_knowledge_resource where id = new.resource_id;
  if not ckri_knowledge_content_ok(v_kind, new.content) then
    raise exception 'ckri_knowledge_version: the content does not have the shape of a %', v_kind;
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then raise exception 'ckri_knowledge_version: a version starts as a draft'; end if;
    if not ckri_holds_capability(new.authored_by[1], 'hq.learning.ckri.educator') then
      raise exception 'ckri_knowledge_version: not authorised. Drafting needs hq.learning.ckri.educator';
    end if;
    new.content_hash := md5(new.content::text);
    new.educator_reviewed_by := null;
    new.educator_reviewed_hash := null;
    new.educator_reviewed_at := null;
    new.submitted_by := null;
    new.submitted_at := null;
    new.published_by := null;
    new.published_at := null;
    return new;
  end if;
  if new.resource_id is distinct from old.resource_id or new.version_no is distinct from old.version_no or new.created_at is distinct from old.created_at
     or new.origin is distinct from old.origin or new.ai_provenance is distinct from old.ai_provenance or new.parent_version_id is distinct from old.parent_version_id then
    raise exception 'ckri_knowledge_version: a version identity and provenance cannot be rewritten. An edited AI draft stays an AI draft';
  end if;
  if coalesce(current_setting('competen.ckri_knowledge', true), '') <> 'on' then
    if old.state <> 'draft' or new.state <> 'draft' then
      raise exception 'ckri_knowledge_version: only a draft is edited directly. Review, submission, publication and retirement go through their functions';
    end if;
    new.content_hash := md5(new.content::text);
    if new.content_hash is distinct from old.content_hash or new.educator_reviewed_by is distinct from old.educator_reviewed_by then
      new.educator_reviewed_by := null;
      new.educator_reviewed_hash := null;
      new.educator_reviewed_at := null;
    end if;
  elsif new.content is distinct from old.content or new.authored_by is distinct from old.authored_by or new.risk is distinct from old.risk then
    raise exception 'ckri_knowledge_version: a submitted version content cannot change. Make a new version, which needs renewed approval';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_knowledge_version_guard on ckri_knowledge_version;
create trigger ckri_knowledge_version_guard before insert or update or delete on ckri_knowledge_version for each row execute function public.ckri_knowledge_version_guard();

create or replace function public.ckri_knowledge_version_competency_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if (select state from ckri_knowledge_version where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end) <> 'draft' then
    raise exception 'ckri_knowledge_version_competency: the competencies of a submitted version are frozen';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists ckri_knowledge_version_competency_guard on ckri_knowledge_version_competency;
create trigger ckri_knowledge_version_competency_guard before insert or update or delete on ckri_knowledge_version_competency for each row execute function public.ckri_knowledge_version_competency_guard();


-- ---- 3. learning needs: raised from a reported cell, answered by a governed path ---------------------------

create table if not exists ckri_learning_need (
  id              uuid primary key default gen_random_uuid(),
  snapshot_id     uuid references ckri_snapshot(id) on delete set null,
  measure         text not null default 'set-by-trigger',
  subject_kind    text not null,
  subject_ref     uuid not null,
  cohort_value    text not null,
  period_start    date not null,
  evidence        jsonb not null default '{}'::jsonb,
  summary         text not null,
  response_kind   text not null,
  status          text not null default 'open',
  raised_by       uuid not null references profiles(id),
  changed_by      uuid not null references profiles(id),
  response_ref    uuid,
  response_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table ckri_learning_need drop constraint if exists ckri_learning_need_check;
alter table ckri_learning_need add constraint ckri_learning_need_check
  check (char_length(btrim(summary)) between 10 and 2000
     and response_kind in ('knowledge_resource', 'clinical_case', 'competency_improvement')
     and status in ('open', 'in_progress', 'addressed', 'declined')
     and (status <> 'addressed' or response_ref is not null)
     and (status <> 'declined' or char_length(btrim(coalesce(response_note, ''))) >= 2)
     and (response_note is null or char_length(response_note) <= 2000));
create index if not exists idx_ckri_learning_need_status on ckri_learning_need(status, updated_at desc);
alter table ckri_learning_need enable row level security;
alter table ckri_knowledge_resource drop constraint if exists ckri_knowledge_resource_need_fk;
alter table ckri_knowledge_resource add constraint ckri_knowledge_resource_need_fk foreign key (need_id) references ckri_learning_need(id);

create or replace function public.ckri_learning_need_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_cell ckri_snapshot_cell%rowtype;
  v_measure text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ckri_learning_need: a need is the record. Decline it instead';
  end if;
  -- A purged snapshot sets the reference null by cascade. The copied evidence stays.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.snapshot_id is null and old.snapshot_id is not null then
    return new;
  end if;
  if not ckri_holds_capability(new.changed_by, 'hq.learning.ckri.educator') then
    raise exception 'ckri_learning_need: not authorised. Needs are raised and answered with hq.learning.ckri.educator';
  end if;
  if tg_op = 'INSERT' then
    select * into v_cell from ckri_snapshot_cell c
     where c.snapshot_id = new.snapshot_id and c.subject_kind = new.subject_kind and c.subject_ref = new.subject_ref
       and c.cohort_value = new.cohort_value and c.period_start = new.period_start;
    if not found or v_cell.suppressed then
      raise exception 'ckri_learning_need: a need is raised from one reported cell of a snapshot, never from a suppressed or unknown one';
    end if;
    select measure into v_measure from ckri_snapshot where id = new.snapshot_id;
    new.measure := v_measure;
    new.evidence := jsonb_build_object('participants', v_cell.participants, 'events', v_cell.events, 'rate', v_cell.rate, 'rate_b', v_cell.rate_b, 'rate_c', v_cell.rate_c);
    new.raised_by := new.changed_by;
    if new.status <> 'open' or new.response_ref is not null then raise exception 'ckri_learning_need: a need starts open'; end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.snapshot_id is distinct from old.snapshot_id and new.snapshot_id is not null then
    raise exception 'ckri_learning_need: the evidence a need was raised from cannot be rewritten';
  end if;
  if new.measure is distinct from old.measure or new.subject_kind is distinct from old.subject_kind or new.subject_ref is distinct from old.subject_ref
     or new.cohort_value is distinct from old.cohort_value or new.period_start is distinct from old.period_start or new.evidence is distinct from old.evidence
     or new.raised_by is distinct from old.raised_by or new.created_at is distinct from old.created_at or new.response_kind is distinct from old.response_kind then
    raise exception 'ckri_learning_need: the evidence a need was raised from cannot be rewritten';
  end if;
  if old.status in ('addressed', 'declined') and new.status is distinct from old.status then
    raise exception 'ckri_learning_need: an % need is final', old.status;
  end if;
  if new.status = 'addressed' and old.status <> 'addressed' then
    if not ((new.response_kind = 'knowledge_resource' and exists (select 1 from ckri_knowledge_resource r where r.id = new.response_ref))
         or (new.response_kind = 'clinical_case' and exists (select 1 from case_library_case c where c.id = new.response_ref))
         or (new.response_kind = 'competency_improvement' and exists (select 1 from clinical_content_version v where v.id = new.response_ref and v.content_kind = 'competency'))) then
      raise exception 'ckri_learning_need: the answer must be an existing % record', new.response_kind;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_learning_need_guard on ckri_learning_need;
create trigger ckri_learning_need_guard before insert or update or delete on ckri_learning_need for each row execute function public.ckri_learning_need_guard();


-- ---- 4. 395 generalised to a third kind: a knowledge resource version ----------------------------------------

alter table clinical_content_version add column if not exists knowledge_version_id uuid references ckri_knowledge_version(id) on delete cascade;
alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and competency_id is not null and case_version_id is null and knowledge_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null and knowledge_version_id is null)
      or (content_kind = 'resource' and knowledge_version_id is not null and competency_id is null and case_version_id is null));
create unique index if not exists ux_clinical_content_version_resource_hash on clinical_content_version(knowledge_version_id, content_hash);

create or replace function public.clinical_content_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_hospital uuid;
  v_case_hash text;
  v_case_content jsonb;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'clinical_content_version is append-only: put forward a new version instead';
  end if;
  -- A knowledge resource version (442): the database's hash and content of the exact resource version, which must be submitted.
  if new.content_kind = 'resource' then
    select kv.content_hash, kv.content into v_case_hash, v_case_content from ckri_knowledge_version kv where kv.id = new.knowledge_version_id and kv.state = 'submitted';
    if not found then
      raise exception 'clinical_content_version: a knowledge resource is put forward for review only as a submitted resource version';
    end if;
    new.competency_id := null;
    new.content_hash := v_case_hash;
    new.content_snapshot := v_case_content;
    new.created_at := now();
    return new;
  end if;
  -- A case version (422): the database's hash and content of the exact case version, which must be submitted.
  if new.content_kind = 'case' then
    select cv.content_hash, cv.content into v_case_hash, v_case_content from case_library_version cv where cv.id = new.case_version_id and cv.state = 'submitted';
    if not found then
      raise exception 'clinical_content_version: a case is put forward for review only as a submitted case version';
    end if;
    new.competency_id := null;
    new.content_hash := v_case_hash;
    new.content_snapshot := v_case_content;
    new.created_at := now();
    return new;
  end if;
  select f.hospital_id into v_hospital
    from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
   where c.id = new.competency_id;
  if not found then
    raise exception 'clinical_content_version: unknown competency';
  end if;
  if v_hospital is not null then
    raise exception 'clinical_content_version: only competencies of shared frameworks are clinically reviewed here';
  end if;
  new.content_hash := competency_content_hash(new.competency_id);
  new.content_snapshot := (
    select jsonb_build_object('name', c.name, 'description', c.description, 'learning_outcomes', c.learning_outcomes,
      'expected_level_id', c.expected_level_id, 'practice_id', c.practice_id, 'cpu_id', c.cpu_id, 'risk_category', c.risk_category,
      'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb))
      from framework_competencies c where c.id = new.competency_id);
  new.created_at := now();
  return new;
end;
$$;

create or replace function public.clinical_review_decision_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_version clinical_content_version%rowtype;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'clinical_review_decision is append-only: record a new decision on a new version instead';
  end if;
  select * into v_version from clinical_content_version where id = new.version_id;
  if not found then
    raise exception 'clinical_review_decision: unknown version';
  end if;
  if new.reviewer_id = v_version.submitted_by or new.reviewer_id = any(v_version.authored_by) then
    raise exception 'clinical_review_decision: not independent. The author, an editor or the submitter of a version cannot review it';
  end if;
  if not exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.id = new.appointment_id
       and a.person_id = new.reviewer_id
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = 'hq.quality.clinical.approve'
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
  ) then
    raise exception 'clinical_review_decision: not authorised. The appointment must be the reviewer''s own, active, and hold hq.quality.clinical.approve';
  end if;
  if v_version.content_kind = 'resource' then
    -- A knowledge resource (442) is in scope only when an active scope of the appointment covers EVERY competency it teaches.
    if not exists (select 1 from ckri_knowledge_version_competency l where l.version_id = v_version.knowledge_version_id) then
      raise exception 'clinical_review_decision: out of scope. The resource names no CFCA competency, so no scope can cover it';
    end if;
    if exists (select 1 from ckri_knowledge_version_competency l where l.version_id = v_version.knowledge_version_id and not clinical_scope_covers(new.appointment_id, l.competency_id)) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers every competency the resource teaches';
    end if;
    if (select kv.content_hash from ckri_knowledge_version kv where kv.id = v_version.knowledge_version_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  elsif v_version.content_kind = 'case' then
    -- A case is in scope only when an active scope of the appointment covers EVERY CFCA competency it teaches.
    if not exists (select 1 from case_library_version_competency l where l.version_id = v_version.case_version_id) then
      raise exception 'clinical_review_decision: out of scope. The case names no CFCA competency, so no scope can cover it';
    end if;
    if exists (select 1 from case_library_version_competency l where l.version_id = v_version.case_version_id and not clinical_scope_covers(new.appointment_id, l.competency_id)) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers every competency the case teaches';
    end if;
    if (select cv.content_hash from case_library_version cv where cv.id = v_version.case_version_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  else
    if not clinical_scope_covers(new.appointment_id, v_version.competency_id) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers the competency';
    end if;
    if competency_content_hash(v_version.competency_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  end if;
  new.created_at := now();
  return new;
end;
$$;


-- ---- 5. review, submission, approval, publication, retirement -------------------------------------------------

-- An educator attests they reviewed THIS content (its hash). For an AI draft this is required before submission.
create or replace function public.ckri_knowledge_review(p_version uuid, p_educator uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v ckri_knowledge_version%rowtype;
begin
  select * into v from ckri_knowledge_version where id = p_version for update;
  if not found then raise exception 'ckri_knowledge_review: unknown version'; end if;
  if v.state <> 'draft' then raise exception 'ckri_knowledge_review: only a draft is reviewed'; end if;
  if not ckri_holds_capability(p_educator, 'hq.learning.ckri.educator') then
    raise exception 'ckri_knowledge_review: not authorised. Educator review needs hq.learning.ckri.educator';
  end if;
  perform set_config('competen.ckri_knowledge', 'on', true);
  update ckri_knowledge_version set educator_reviewed_by = p_educator, educator_reviewed_hash = v.content_hash, educator_reviewed_at = now() where id = v.id;
  perform set_config('competen.ckri_knowledge', 'off', true);
end;
$$;

create or replace function public.ckri_knowledge_submit(p_version uuid, p_submitter uuid, p_required int)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v ckri_knowledge_version%rowtype;
  v_ccv uuid;
begin
  select * into v from ckri_knowledge_version where id = p_version for update;
  if not found then raise exception 'ckri_knowledge_submit: unknown version'; end if;
  if v.state <> 'draft' then raise exception 'ckri_knowledge_submit: only a draft is submitted (this one is %)', v.state; end if;
  if p_submitter is null or not (p_submitter = any(v.authored_by)) then
    raise exception 'ckri_knowledge_submit: only an author or editor of the version may submit it';
  end if;
  if v.educator_reviewed_hash is distinct from v.content_hash then
    raise exception 'ckri_knowledge_submit: an educator must review this exact content before it is submitted';
  end if;
  if not exists (select 1 from ckri_knowledge_version_competency where version_id = v.id) then
    raise exception 'ckri_knowledge_submit: name the CFCA competencies the resource teaches first';
  end if;
  if p_required is null or p_required < 1 or p_required > 5 then raise exception 'ckri_knowledge_submit: the required approvals must be 1 to 5'; end if;
  perform set_config('competen.ckri_knowledge', 'on', true);
  update ckri_knowledge_version set state = 'submitted', submitted_by = p_submitter, submitted_at = now() where id = v.id;
  perform set_config('competen.ckri_knowledge', 'off', true);
  insert into clinical_content_version (content_kind, knowledge_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
    values ('resource', v.id, 'computed-by-trigger', '{}'::jsonb, v.authored_by, p_submitter, p_required, v.risk || ' risk knowledge resource')
    returning id into v_ccv;
  return v_ccv;
end;
$$;

create or replace function public.ckri_knowledge_approved(p_version uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_content_version ccv
      join ckri_knowledge_version kv on kv.id = ccv.knowledge_version_id
     where ccv.content_kind = 'resource' and ccv.knowledge_version_id = p_version and ccv.content_hash = kv.content_hash
       and not exists (select 1 from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'rejected')
       and (select count(*) from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'approved') >= ccv.required_approvals
  )
$$;

create or replace function public.ckri_knowledge_publish(p_version uuid, p_publisher uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v ckri_knowledge_version%rowtype;
  r ckri_knowledge_resource%rowtype;
begin
  select * into v from ckri_knowledge_version where id = p_version for update;
  if not found then raise exception 'ckri_knowledge_publish: unknown version'; end if;
  select * into r from ckri_knowledge_resource where id = v.resource_id for update;
  if r.status <> 'active' then raise exception 'ckri_knowledge_publish: the resource is retired'; end if;
  if v.state <> 'submitted' then raise exception 'ckri_knowledge_publish: only a submitted, clinically approved version is published (this one is %)', v.state; end if;
  if not ckri_knowledge_approved(v.id) then raise exception 'ckri_knowledge_publish: this exact version is not clinically approved'; end if;
  if not ckri_holds_capability(p_publisher, 'hq.quality.knowledge.publish') then
    raise exception 'ckri_knowledge_publish: not authorised. Publication needs hq.quality.knowledge.publish';
  end if;
  perform set_config('competen.ckri_knowledge', 'on', true);
  update ckri_knowledge_version set state = 'superseded', superseded_at = now() where resource_id = v.resource_id and state = 'published' and id <> v.id;
  update ckri_knowledge_version set state = 'published', published_by = p_publisher, published_at = now() where id = v.id;
  perform set_config('competen.ckri_knowledge', 'off', true);
end;
$$;

create or replace function public.ckri_knowledge_retire(p_resource uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform 1 from ckri_knowledge_resource where id = p_resource for update;
  if not found then raise exception 'ckri_knowledge_retire: unknown resource'; end if;
  perform set_config('competen.ckri_knowledge', 'on', true);
  update ckri_knowledge_version set state = 'retired', retired_at = now() where resource_id = p_resource and state in ('published', 'submitted');
  update ckri_knowledge_resource set status = 'retired' where id = p_resource;
  perform set_config('competen.ckri_knowledge', 'off', true);
end;
$$;

revoke all on function public.ckri_knowledge_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ckri_knowledge_submit(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.ckri_knowledge_approved(uuid) from public, anon, authenticated;
revoke all on function public.ckri_knowledge_publish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ckri_knowledge_retire(uuid) from public, anon, authenticated;
grant execute on function public.ckri_knowledge_review(uuid, uuid) to service_role;
grant execute on function public.ckri_knowledge_submit(uuid, uuid, int) to service_role;
grant execute on function public.ckri_knowledge_approved(uuid) to service_role;
grant execute on function public.ckri_knowledge_publish(uuid, uuid) to service_role;
grant execute on function public.ckri_knowledge_retire(uuid) to service_role;


-- Verification: RLS, the widened CHECK, the grants.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ckri_knowledge_resource', 'ckri_knowledge_version', 'ckri_knowledge_version_competency', 'ckri_learning_need') order by c.relname;

select content_kind, count(*) from clinical_content_version group by content_kind order by content_kind;

notify pgrst, 'reload schema';
