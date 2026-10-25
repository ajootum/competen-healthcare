-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 461: COMPETEN LEARNING ON THE ONE HOLDINGS CLINICAL-APPROVAL PROCESS -- REVIEW, PUBLICATION, DELIVERY
--
-- COMPETEN-LEARNING-01 Phase 2 S1 (owner GO 2026-10-25, D1 and D8). "Reuse the established Case Library versioning,
-- approval and delivery patterns. Only published and appropriately approved content may be delivered. External
-- listings must clearly distinguish listing approval from clinical endorsement."
--
-- APPLY ON STAGING FIRST, AND ONLY AFTER 442. ADDITIVE OR WIDENING. One new column on clinical_content_version
-- (every existing row keeps its kind and values), its subject CHECK widened to a fourth kind, the two review guards
-- REPLACED (their competency, case and resource branches byte-identical to 442, a learning branch added), and six
-- functions. Re-running it is a no-op. OPS-001 s8: proposed Medium (replaced shared guard functions), with a rollback
-- rehearsal. Depends on 395, 422, 442 and 460.
--
-- ORDER WITH 442 (CKRI K3). Both 442 and this file replace the same two guards and the same CHECK, so the one applied
-- LAST decides them. This file carries every 442 branch unchanged, so applying it after 442 loses nothing. Applying 442
-- after this file would drop the learning branch: 442 must then be re-based on this file, not re-applied as it is.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets the same Holdings clinical-approval process that approves competencies, cases and knowledge resources
-- approve the exact version of hosted learning, keeps an external listing on its own listing route that never reads
-- as clinical endorsement, and makes publication a separate act by someone who did not write the version.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
--   clinical_content_version   + learning_version_id. Kind learning: the exact submitted learning version.
--   clinical_content_version_guard   REPLACED. Learning: the hash and the content snapshot are the database's own for
--                              the exact SUBMITTED learning version on the clinical route.
--   clinical_review_decision_guard   REPLACED. Learning: in scope only if an active scope of the appointment covers
--                              EVERY CFCA competency the version serves, and stale if its hash no longer matches.
--   learning_offering_submit   Freezes a draft. Clinical route: puts it forward through 395 with the governed count.
--                              Listing route: freezes it for listing publication, and writes no 395 record.
--   learning_offering_approved True only for the clinical route, when a 395 record of the exact hash has its
--                              approvals and no rejection.
--   learning_offering_publish  A separate act. Clinical route: requires learning_offering_approved. Listing route:
--                              the listing approval itself. Either way the publisher wrote nothing of the version
--                              (460 CHECK), and the previously published version is superseded.
--   learning_offering_deliverable  The one check delivery uses: offering active, version published, and approved for
--                              this exact version when its route is clinical.
--   learning_offering_retire   Retires an offering and its live versions. The record stays.
--
-- RLS: unchanged. Execute on the functions: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-461.sql restores the 442 guards and CHECK and drops the column and functions. It refuses
--   once a learning review record exists.
-- ====================================================================================================


-- ---- 1. 395 generalised to a fourth kind: a learning version ----------------------------------------

alter table clinical_content_version add column if not exists learning_version_id uuid references learning_offering_version(id) on delete cascade;
alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and competency_id is not null and case_version_id is null and knowledge_version_id is null and learning_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null and knowledge_version_id is null and learning_version_id is null)
      or (content_kind = 'resource' and knowledge_version_id is not null and competency_id is null and case_version_id is null and learning_version_id is null)
      or (content_kind = 'learning' and learning_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null));
create unique index if not exists ux_clinical_content_version_learning_hash on clinical_content_version(learning_version_id, content_hash);

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
  -- A learning version (461): the database's hash and content of the exact learning version, submitted on the clinical route.
  if new.content_kind = 'learning' then
    select lv.content_hash, lv.content into v_case_hash, v_case_content from learning_offering_version lv
     where lv.id = new.learning_version_id and lv.state = 'submitted' and lv.review_route = 'clinical';
    if not found then
      raise exception 'clinical_content_version: learning is put forward for review only as a submitted version on the clinical route';
    end if;
    new.competency_id := null;
    new.content_hash := v_case_hash;
    new.content_snapshot := v_case_content;
    new.created_at := now();
    return new;
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
  if v_version.content_kind = 'learning' then
    -- Learning (461) is in scope only when an active scope of the appointment covers EVERY competency the version serves.
    if not exists (select 1 from learning_offering_version_outcome l where l.version_id = v_version.learning_version_id) then
      raise exception 'clinical_review_decision: out of scope. The learning names no CFCA competency, so no scope can cover it';
    end if;
    if exists (select 1 from learning_offering_version_outcome l where l.version_id = v_version.learning_version_id and not clinical_scope_covers(new.appointment_id, l.competency_id)) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers every competency the learning serves';
    end if;
    if (select lv.content_hash from learning_offering_version lv where lv.id = v_version.learning_version_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  elsif v_version.content_kind = 'resource' then
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


-- ---- 2. submission, approval, publication, delivery, retirement --------------------------------------

-- Freeze a draft. Only an author or editor submits. The clinical route needs named CFCA competencies and puts the
-- version forward through 395 with the governed count (the caller reads it). The listing route writes no 395 record.
create or replace function public.learning_offering_submit(p_version uuid, p_submitter uuid, p_required int)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v learning_offering_version%rowtype;
  o learning_offering%rowtype;
  v_ccv uuid;
begin
  select * into v from learning_offering_version where id = p_version for update;
  if not found then raise exception 'learning_offering_submit: unknown version'; end if;
  select * into o from learning_offering where id = v.offering_id;
  if o.status <> 'active' then raise exception 'learning_offering_submit: the offering is retired'; end if;
  if v.state <> 'draft' then raise exception 'learning_offering_submit: only a draft is submitted (this one is %)', v.state; end if;
  if p_submitter is null or not (p_submitter = any(v.authored_by)) then
    raise exception 'learning_offering_submit: only an author or editor of the version may submit it';
  end if;
  if v.delivery_provider_id is null or v.content_owner_id is null then
    raise exception 'learning_offering_submit: name the content owner and the delivery provider first';
  end if;
  if o.delivery = 'external' and v.external_url is null then
    raise exception 'learning_offering_submit: an external listing needs its secure (https) link';
  end if;
  if v.review_route = 'clinical' then
    if not exists (select 1 from learning_offering_version_outcome where version_id = v.id) then
      raise exception 'learning_offering_submit: name the CFCA competencies the learning serves first';
    end if;
    if p_required is null or p_required < 1 or p_required > 5 then raise exception 'learning_offering_submit: the required approvals must be 1 to 5'; end if;
  end if;
  perform set_config('competen.learning', 'on', true);
  update learning_offering_version set state = 'submitted', submitted_by = p_submitter, submitted_at = now() where id = v.id;
  perform set_config('competen.learning', 'off', true);
  if v.review_route = 'clinical' then
    insert into clinical_content_version (content_kind, learning_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
      values ('learning', v.id, 'computed-by-trigger', '{}'::jsonb, v.authored_by, p_submitter, p_required, v.risk || ' risk learning')
      returning id into v_ccv;
  end if;
  return v_ccv;
end;
$$;

-- Approved: the clinical route only. A 395 record of this version's exact hash, with its approvals and no rejection.
create or replace function public.learning_offering_approved(p_version uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_content_version ccv
      join learning_offering_version lv on lv.id = ccv.learning_version_id
     where ccv.content_kind = 'learning' and ccv.learning_version_id = p_version and ccv.content_hash = lv.content_hash
       and lv.review_route = 'clinical'
       and not exists (select 1 from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'rejected')
       and (select count(*) from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'approved') >= ccv.required_approvals
  )
$$;

-- Publish: a separate governed act by someone who wrote nothing of the version (the 460 CHECK refuses an author).
-- Clinical route: only an approved version. Listing route: this act IS the listing approval, and only that.
create or replace function public.learning_offering_publish(p_version uuid, p_publisher uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v learning_offering_version%rowtype;
  o learning_offering%rowtype;
begin
  select * into v from learning_offering_version where id = p_version for update;
  if not found then raise exception 'learning_offering_publish: unknown version'; end if;
  select * into o from learning_offering where id = v.offering_id for update;
  if o.status <> 'active' then raise exception 'learning_offering_publish: the offering is retired'; end if;
  if v.state <> 'submitted' then raise exception 'learning_offering_publish: only a submitted version is published (this one is %)', v.state; end if;
  if p_publisher is null then raise exception 'learning_offering_publish: a publisher is required'; end if;
  if p_publisher = any(v.authored_by) then raise exception 'learning_offering_publish: not independent. An author or editor cannot publish the version'; end if;
  if v.review_route = 'clinical' and not learning_offering_approved(v.id) then
    raise exception 'learning_offering_publish: this exact version is not clinically approved';
  end if;
  perform set_config('competen.learning', 'on', true);
  update learning_offering_version set state = 'superseded', superseded_at = now() where offering_id = v.offering_id and state = 'published' and id <> v.id;
  update learning_offering_version set state = 'published', published_by = p_publisher, published_at = now() where id = v.id;
  perform set_config('competen.learning', 'off', true);
end;
$$;

-- The one check delivery uses.
create or replace function public.learning_offering_deliverable(p_version uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from learning_offering_version lv join learning_offering o on o.id = lv.offering_id
     where lv.id = p_version and lv.state = 'published' and o.status = 'active'
       and (lv.review_route = 'listing' or learning_offering_approved(lv.id))
  )
$$;

-- Retire an offering: no longer offered. Its versions, review records and every learner record stay.
create or replace function public.learning_offering_retire(p_offering uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform 1 from learning_offering where id = p_offering for update;
  if not found then raise exception 'learning_offering_retire: unknown offering'; end if;
  perform set_config('competen.learning', 'on', true);
  update learning_offering_version set state = 'retired', retired_at = now() where offering_id = p_offering and state in ('published', 'submitted');
  update learning_offering set status = 'retired' where id = p_offering;
  perform set_config('competen.learning', 'off', true);
end;
$$;

revoke all on function public.learning_offering_submit(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.learning_offering_approved(uuid) from public, anon, authenticated;
revoke all on function public.learning_offering_publish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.learning_offering_deliverable(uuid) from public, anon, authenticated;
revoke all on function public.learning_offering_retire(uuid) from public, anon, authenticated;
grant execute on function public.learning_offering_submit(uuid, uuid, int) to service_role;
grant execute on function public.learning_offering_approved(uuid) to service_role;
grant execute on function public.learning_offering_publish(uuid, uuid) to service_role;
grant execute on function public.learning_offering_deliverable(uuid) to service_role;
grant execute on function public.learning_offering_retire(uuid) to service_role;


-- Verification: the generalised subject CHECK names four kinds, the new column exists, and the kinds in use.
select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'clinical_content_version'
   and column_name in ('content_kind', 'competency_id', 'case_version_id', 'knowledge_version_id', 'learning_version_id') order by 1;

select content_kind, count(*) from clinical_content_version group by content_kind order by content_kind;

select proname from pg_proc where proname like 'learning_offering_%' order by proname;

notify pgrst, 'reload schema';
