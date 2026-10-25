-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 462: COMPETEN LEARNING -- THE ONE AUTHORITATIVE PERSONAL LEARNING RECORD, AND CERTIFICATES
--
-- COMPETEN-LEARNING-01 Phase 2 S2 (owner GO 2026-10-25, D1 and D6). Product definition s10, s11, s12.
--
-- APPLY ON STAGING FIRST, AFTER 460 AND 461. ADDITIVE. Five new tables, their guards and one private storage bucket.
-- It alters no existing table. Re-running it is a no-op. OPS-001 s8: proposed Low (new tables only), with a rollback
-- rehearsal. Depends on 460, 461 (learning_offering_deliverable), profiles, hq_position_capability and the HQ
-- appointment tables. 463 adds the course entitlement reference.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It keeps ONE record of a person taking one version of one offering -- enrolment, activity, results, completion,
-- evidence and certificates -- that Professional, Scholar and the Passport read by reference, that no organisation
-- table or estate analytics ever reads, and that says exactly what was recorded and by whom, never more.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   learning_record            one per person per version. Pinned to the version they enrolled on, so a later
--                              version never rewrites what they did. Hosted: completion is computed by the server from
--                              the version rule (course_completion or assessed_knowledge). External: the person
--                              records completion (external_completion) with an optional document. evidence_class is
--                              GENERATED: platform_recorded (hosted), self_declared or source_linked (external).
--                              There is no verified column: completing learning is never verification of competence.
--   learning_record_activity   lesson and knowledge-check progress inside a hosted record. The resume point.
--   learning_check_attempt     every knowledge-check attempt, append-only.
--   learning_certificate_authorisation  the certificate issuer authority, per version: which outcomes a completed
--                              record of THIS version may be certified for, and by which issuer. A separate act by a
--                              holder of hq.learning.certificate.issue who wrote nothing of the version (D8).
--   learning_certificate       a certificate of one outcome of one completed record, under an active authorisation.
--                              It names the issuer, course, version and evidence. Immutable but revocable.
--   learning-evidence bucket   private, server-mediated, no storage policies. Paths begin with the owner id.
--
-- Actor ids (who authorised, withdrew or revoked) are plain ids, as the case library keeps its authors: a governance
-- record outlives an account, and never blocks deleting one.
--
-- Organisation isolation (ADR-016 D1, ADR-017): no hospital_id, and every table here is outside every estate
-- analytics query. RLS on, read-own policies only. Every write is the service role.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-462.sql drops the five tables and their functions. It refuses once a record exists.
-- ====================================================================================================


-- ---- 1. learning_record ------------------------------------------------------------------------------

create table if not exists learning_record (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references profiles(id) on delete cascade,
  offering_id            uuid not null references learning_offering(id),
  version_id             uuid not null references learning_offering_version(id),
  delivery               text not null,
  access_kind            text not null,
  course_entitlement_id  uuid,
  status                 text not null default 'enrolled',
  enrolled_at            timestamptz not null default now(),
  last_activity_at       timestamptz,
  last_activity_key      text,
  completed_at           timestamptz,
  completion_kind        text,
  completion_basis       jsonb,
  external_completed_on  date,
  external_hours         numeric(5,1),
  reflection             text,
  document_path          text,
  document_name          text,
  document_mime          text,
  document_bytes         integer,
  evidence_class         text generated always as
    (case when delivery = 'hosted' then 'platform_recorded' when document_path is null then 'self_declared' else 'source_linked' end) stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table learning_record drop constraint if exists learning_record_check;
alter table learning_record add constraint learning_record_check
  check (delivery in ('hosted', 'external') and access_kind in ('free', 'entitlement', 'external')
     and (delivery = 'external') = (access_kind = 'external')
     and (access_kind <> 'entitlement' or course_entitlement_id is not null)
     and status in ('enrolled', 'in_progress', 'completed', 'withdrawn')
     and (status = 'completed') = (completed_at is not null)
     and (completion_kind is null or completion_kind in ('course_completion', 'assessed_knowledge', 'external_completion'))
     and (status <> 'completed' or completion_kind is not null)
     and (completion_kind is null or (delivery = 'external') = (completion_kind = 'external_completion'))
     and (delivery = 'external' or (external_completed_on is null and external_hours is null and document_path is null))
     and (completion_kind is distinct from 'external_completion' or external_completed_on is not null)
     and (external_hours is null or (external_hours > 0 and external_hours <= 1000))
     and char_length(coalesce(reflection, '')) <= 5000
     and (last_activity_key is null or last_activity_key ~ '^[a-z0-9][a-z0-9_-]{0,40}$'));
alter table learning_record drop constraint if exists learning_record_document_whole;
alter table learning_record add constraint learning_record_document_whole
  check ((document_path is null) = (document_name is null)
     and (document_path is null) = (document_mime is null)
     and (document_path is null) = (document_bytes is null)
     and (document_path is null or document_path like user_id::text || '/%'));
create unique index if not exists ux_learning_record_person_version on learning_record(user_id, version_id);
create unique index if not exists ux_learning_record_id_user on learning_record(id, user_id);
create index if not exists idx_learning_record_user on learning_record(user_id, updated_at desc);
create index if not exists idx_learning_record_offering on learning_record(offering_id, status);
alter table learning_record enable row level security;
drop policy if exists learning_record_read_own on learning_record;
create policy learning_record_read_own on learning_record for select using (auth.uid() = user_id);

-- An enrolment is only ever on a deliverable version (461), and a free one only where the version says free. Who the
-- record belongs to and what it is of never change. A completed record stays completed, and a record is never
-- deleted except with the person (the history outlives every entitlement, product definition s10).
create or replace function public.learning_record_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v learning_offering_version%rowtype;
  o learning_offering%rowtype;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_record: a learning record is kept. Withdraw it instead';
  end if;
  if tg_op = 'INSERT' then
    select * into v from learning_offering_version where id = new.version_id;
    select * into o from learning_offering where id = new.offering_id;
    if v.id is null or o.id is null or v.offering_id <> o.id then
      raise exception 'learning_record: the version is not a version of this offering';
    end if;
    if not learning_offering_deliverable(v.id) then
      raise exception 'learning_record: only a published, approved version can be enrolled on';
    end if;
    if new.delivery <> o.delivery then raise exception 'learning_record: the delivery is the offering''s'; end if;
    if new.access_kind = 'free' and v.access_model is distinct from 'free' then
      raise exception 'learning_record: this version is not free. Access needs an entitlement';
    end if;
    if new.status not in ('enrolled', 'in_progress') then raise exception 'learning_record: a record starts as an enrolment'; end if;
    new.enrolled_at := now();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.offering_id is distinct from old.offering_id or new.version_id is distinct from old.version_id
     or new.delivery is distinct from old.delivery or new.access_kind is distinct from old.access_kind or new.enrolled_at is distinct from old.enrolled_at
     or new.created_at is distinct from old.created_at then
    raise exception 'learning_record: who a record belongs to and what it is of cannot be rewritten';
  end if;
  if old.status = 'completed' and (new.status <> 'completed' or new.completed_at is distinct from old.completed_at
     or new.completion_kind is distinct from old.completion_kind or new.completion_basis is distinct from old.completion_basis) then
    raise exception 'learning_record: a completed record stays completed as it was recorded';
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'learning_record: a withdrawn record stays withdrawn. Enrol again on a version instead';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists learning_record_guard on learning_record;
create trigger learning_record_guard before insert or update or delete on learning_record for each row execute function public.learning_record_guard();


-- ---- 2. learning_record_activity -- PROGRESS AND THE RESUME POINT ---------------------------------------

create table if not exists learning_record_activity (
  record_id     uuid not null,
  user_id       uuid not null,
  activity_key  text not null,
  kind          text not null,
  completed_at  timestamptz not null default now(),
  score         int,
  max_score     int,
  passed        boolean,
  attempts      int not null default 1,
  primary key (record_id, activity_key)
);
alter table learning_record_activity drop constraint if exists learning_record_activity_record_fk;
alter table learning_record_activity add constraint learning_record_activity_record_fk
  foreign key (record_id, user_id) references learning_record(id, user_id) on delete cascade;
alter table learning_record_activity drop constraint if exists learning_record_activity_check;
alter table learning_record_activity add constraint learning_record_activity_check
  check (activity_key ~ '^[a-z0-9][a-z0-9_-]{0,40}$' and kind in ('lesson', 'check', 'reflection')
     and attempts between 1 and 1000
     and (kind <> 'check' or (score is not null and max_score is not null and passed is not null and score between 0 and max_score and max_score between 1 and 1000))
     and (kind = 'check' or (score is null and max_score is null and passed is null)));
alter table learning_record_activity enable row level security;
drop policy if exists learning_record_activity_read_own on learning_record_activity;
create policy learning_record_activity_read_own on learning_record_activity for select using (auth.uid() = user_id);

create or replace function public.learning_record_activity_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_delivery text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_record_activity: progress is part of the record';
  end if;
  select status, delivery into v_status, v_delivery from learning_record where id = new.record_id;
  if v_delivery is distinct from 'hosted' then raise exception 'learning_record_activity: progress is recorded for hosted learning only'; end if;
  if v_status not in ('enrolled', 'in_progress') then raise exception 'learning_record_activity: the record is % and takes no more progress', v_status; end if;
  if tg_op = 'UPDATE' and (new.record_id is distinct from old.record_id or new.user_id is distinct from old.user_id
     or new.activity_key is distinct from old.activity_key or new.kind is distinct from old.kind) then
    raise exception 'learning_record_activity: an activity cannot be moved';
  end if;
  return new;
end;
$$;
drop trigger if exists learning_record_activity_guard on learning_record_activity;
create trigger learning_record_activity_guard before insert or update or delete on learning_record_activity for each row execute function public.learning_record_activity_guard();


-- ---- 3. learning_check_attempt -- APPEND-ONLY ----------------------------------------------------------

create table if not exists learning_check_attempt (
  id            uuid primary key default gen_random_uuid(),
  record_id     uuid not null,
  user_id       uuid not null,
  activity_key  text not null,
  answers       jsonb not null,
  score         int not null,
  max_score     int not null,
  passed        boolean not null,
  created_at    timestamptz not null default now()
);
alter table learning_check_attempt drop constraint if exists learning_check_attempt_record_fk;
alter table learning_check_attempt add constraint learning_check_attempt_record_fk
  foreign key (record_id, user_id) references learning_record(id, user_id) on delete cascade;
alter table learning_check_attempt drop constraint if exists learning_check_attempt_check;
alter table learning_check_attempt add constraint learning_check_attempt_check
  check (activity_key ~ '^[a-z0-9][a-z0-9_-]{0,40}$' and jsonb_typeof(answers) = 'object'
     and max_score between 1 and 1000 and score between 0 and max_score);
create index if not exists idx_learning_check_attempt_record on learning_check_attempt(record_id, activity_key, created_at desc);
alter table learning_check_attempt enable row level security;
drop policy if exists learning_check_attempt_read_own on learning_check_attempt;
create policy learning_check_attempt_read_own on learning_check_attempt for select using (auth.uid() = user_id);

create or replace function public.learning_check_attempt_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op <> 'INSERT' then raise exception 'learning_check_attempt is append-only'; end if;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists learning_check_attempt_guard on learning_check_attempt;
create trigger learning_check_attempt_guard before insert or update or delete on learning_check_attempt for each row execute function public.learning_check_attempt_guard();


-- ---- 4. learning_certificate_authorisation -- THE ISSUER AUTHORITY, PER VERSION -------------------------

create table if not exists learning_certificate_authorisation (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references learning_offering_version(id),
  issuer_provider_id  uuid not null references learning_provider(id),
  outcomes            text[] not null,
  authorised_by       uuid not null,
  authorised_at       timestamptz not null default now(),
  note                text,
  withdrawn_at        timestamptz,
  withdrawn_by        uuid
);
alter table learning_certificate_authorisation drop constraint if exists learning_certificate_authorisation_check;
alter table learning_certificate_authorisation add constraint learning_certificate_authorisation_check
  check (cardinality(outcomes) between 1 and 2 and outcomes <@ array['course_completion', 'assessed_knowledge']::text[]
     and (withdrawn_at is null) = (withdrawn_by is null)
     and char_length(coalesce(note, '')) <= 1000);
create index if not exists idx_learning_certificate_authorisation_version on learning_certificate_authorisation(version_id, authorised_at desc);
alter table learning_certificate_authorisation enable row level security;

-- True when the person holds an active HQ appointment whose position carries the capability now. The same reading as
-- the 395 decision guard, in one place for the two Learning authorities (certificates here, prices in 463).
create or replace function public.learning_holds_capability(p_person uuid, p_capability text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
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
revoke all on function public.learning_holds_capability(uuid, text) from public, anon, authenticated;
grant execute on function public.learning_holds_capability(uuid, text) to service_role;

-- Only hosted learning that offers a certificate, under the own issuer of the version, by an independent holder of
-- hq.learning.certificate.issue, and one live authorisation per version. Afterwards only a withdrawal changes it.
create or replace function public.learning_certificate_authorisation_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v learning_offering_version%rowtype;
  v_delivery text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_certificate_authorisation: an authorisation is the record. Withdraw it instead';
  end if;
  if tg_op = 'UPDATE' then
    if new.version_id is distinct from old.version_id or new.issuer_provider_id is distinct from old.issuer_provider_id or new.outcomes is distinct from old.outcomes
       or new.authorised_by is distinct from old.authorised_by or new.authorised_at is distinct from old.authorised_at or new.note is distinct from old.note
       or old.withdrawn_at is not null then
      raise exception 'learning_certificate_authorisation: an authorisation cannot change. Withdraw it, once, and authorise again';
    end if;
    return new;
  end if;
  select * into v from learning_offering_version where id = new.version_id;
  select delivery into v_delivery from learning_offering where id = v.offering_id;
  if v.id is null or v.state not in ('submitted', 'published') then
    raise exception 'learning_certificate_authorisation: only a submitted or published version is authorised for certificates';
  end if;
  if v_delivery <> 'hosted' then raise exception 'learning_certificate_authorisation: certificates are issued for hosted learning only'; end if;
  if coalesce(v.content #>> '{certificate,offered}', 'false') <> 'true' then
    raise exception 'learning_certificate_authorisation: this version does not offer a certificate';
  end if;
  if v.certificate_issuer_id is distinct from new.issuer_provider_id then
    raise exception 'learning_certificate_authorisation: the issuer must be the certificate issuer the version names';
  end if;
  if new.authorised_by = any(v.authored_by) or new.authorised_by = v.submitted_by then
    raise exception 'learning_certificate_authorisation: not independent. An author or the submitter of the version cannot authorise its certificates';
  end if;
  if not learning_holds_capability(new.authorised_by, 'hq.learning.certificate.issue') then
    raise exception 'learning_certificate_authorisation: not authorised. It needs an active appointment holding hq.learning.certificate.issue';
  end if;
  if exists (select 1 from learning_certificate_authorisation a where a.version_id = new.version_id and a.withdrawn_at is null) then
    raise exception 'learning_certificate_authorisation: this version already has a live authorisation. Withdraw it first';
  end if;
  new.authorised_at := now();
  new.withdrawn_at := null;
  new.withdrawn_by := null;
  return new;
end;
$$;
drop trigger if exists learning_certificate_authorisation_guard on learning_certificate_authorisation;
create trigger learning_certificate_authorisation_guard before insert or update or delete on learning_certificate_authorisation for each row execute function public.learning_certificate_authorisation_guard();


-- ---- 5. learning_certificate -------------------------------------------------------------------------

create table if not exists learning_certificate (
  id                  uuid primary key default gen_random_uuid(),
  certificate_no      text not null,
  verification_code   text not null,
  record_id           uuid not null,
  user_id             uuid not null,
  offering_id         uuid not null references learning_offering(id),
  version_id          uuid not null references learning_offering_version(id),
  outcome             text not null,
  issuer_provider_id  uuid not null references learning_provider(id),
  authorisation_id    uuid not null references learning_certificate_authorisation(id),
  snapshot            jsonb not null,
  issued_at           timestamptz not null default now(),
  revoked_at          timestamptz,
  revoked_by          uuid,
  revoked_reason      text
);
alter table learning_certificate drop constraint if exists learning_certificate_record_fk;
alter table learning_certificate add constraint learning_certificate_record_fk
  foreign key (record_id, user_id) references learning_record(id, user_id) on delete cascade;
alter table learning_certificate drop constraint if exists learning_certificate_check;
alter table learning_certificate add constraint learning_certificate_check
  check (certificate_no ~ '^LC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' and verification_code ~ '^[a-z0-9]{24}$'
     and outcome in ('course_completion', 'assessed_knowledge') and jsonb_typeof(snapshot) = 'object'
     and (revoked_at is null) = (revoked_by is null)
     and (revoked_at is null or char_length(btrim(coalesce(revoked_reason, ''))) between 3 and 500));
create unique index if not exists ux_learning_certificate_no on learning_certificate(certificate_no);
create unique index if not exists ux_learning_certificate_code on learning_certificate(verification_code);
create unique index if not exists ux_learning_certificate_record_outcome on learning_certificate(record_id, outcome);
create index if not exists idx_learning_certificate_user on learning_certificate(user_id, issued_at desc);
alter table learning_certificate enable row level security;
drop policy if exists learning_certificate_read_own on learning_certificate;
create policy learning_certificate_read_own on learning_certificate for select using (auth.uid() = user_id);

-- A certificate is issued only for a completed hosted record, for an outcome the record achieved and the live
-- authorisation of its own version covers, under the issuer of that authorisation. Assessed knowledge needs a record
-- completed as assessed knowledge. Afterwards it is immutable, except one revocation.
create or replace function public.learning_certificate_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  r learning_record%rowtype;
  a learning_certificate_authorisation%rowtype;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_certificate: a certificate is the record. Revoke it instead';
  end if;
  if tg_op = 'UPDATE' then
    if new.certificate_no is distinct from old.certificate_no or new.verification_code is distinct from old.verification_code or new.record_id is distinct from old.record_id
       or new.user_id is distinct from old.user_id or new.offering_id is distinct from old.offering_id or new.version_id is distinct from old.version_id
       or new.outcome is distinct from old.outcome or new.issuer_provider_id is distinct from old.issuer_provider_id or new.authorisation_id is distinct from old.authorisation_id
       or new.snapshot is distinct from old.snapshot or new.issued_at is distinct from old.issued_at or old.revoked_at is not null then
      raise exception 'learning_certificate: a certificate cannot change. It can be revoked, once';
    end if;
    return new;
  end if;
  select * into r from learning_record where id = new.record_id and user_id = new.user_id;
  if r.id is null or r.status <> 'completed' or r.delivery <> 'hosted' then
    raise exception 'learning_certificate: only a completed hosted record is certified';
  end if;
  if r.version_id <> new.version_id or r.offering_id <> new.offering_id then
    raise exception 'learning_certificate: the certificate names the record''s own course and version';
  end if;
  if new.outcome = 'assessed_knowledge' and r.completion_kind <> 'assessed_knowledge' then
    raise exception 'learning_certificate: assessed knowledge is certified only for a record completed with its assessment passed';
  end if;
  select * into a from learning_certificate_authorisation where id = new.authorisation_id;
  if a.id is null or a.withdrawn_at is not null or a.version_id <> new.version_id or not (new.outcome = any(a.outcomes))
     or a.issuer_provider_id <> new.issuer_provider_id then
    raise exception 'learning_certificate: no live issuer authorisation of this version covers this outcome';
  end if;
  new.issued_at := now();
  new.revoked_at := null;
  new.revoked_by := null;
  new.revoked_reason := null;
  return new;
end;
$$;
drop trigger if exists learning_certificate_guard on learning_certificate;
create trigger learning_certificate_guard before insert or update or delete on learning_certificate for each row execute function public.learning_certificate_guard();


-- ---- 6. THE PRIVATE EVIDENCE BUCKET ------------------------------------------------------------------
--
-- Not the estate evidence bucket and not the Professional one: an external completion document belongs to the
-- learning record. Server-mediated with NO storage policies (the 373 and 336 posture). Every download is a short-lived
-- signed URL issued after the owner check. ON CONFLICT DO NOTHING: an existing bucket keeps its configuration.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learning-evidence', 'learning-evidence', false, 10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;


-- Verification: five new tables with RLS on, read-own policies on the four personal ones, and the bucket private.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('learning_record', 'learning_record_activity', 'learning_check_attempt', 'learning_certificate_authorisation', 'learning_certificate')
 order by c.relname;

select id, public, file_size_limit from storage.buckets where id = 'learning-evidence';

notify pgrst, 'reload schema';
