-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 423: CASE CANDIDACY, DE-IDENTIFIED CASE CANDIDATES, AND CASE DELIVERY SESSIONS
--
-- COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s7 (C1) and s10 (C4), owner Stage 5 case interface approval, IND-004 C-a to C-e
-- and D-a to D-e. Coordinator range 421-424. Depends on 422 (the case library) and profiles.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Four new tables, one view, one foreign key added to case_library_version, two new
-- triggers on case_library_version (the trigger of 422 is not replaced), and the functions below. Re-running it is a
-- no-op. OPS-001 s8: proposed Medium (it holds the content a person offered and the permission it rests on), with a
-- rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets a student, with a separate and revocable permission, offer ONE private case at a time as a de-identified
-- structured candidate for the shared library, lets an educator take it into development without ever learning who
-- offered it, and lets a student work through a published, approved library case with the progress kept by the server.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT MAKES UNREPRESENTABLE.
--
--   An offer without the permission.        A candidate row needs a granted case_candidacy for its user (trigger).
--   Identifiable content in the pipeline.  An eligible candidate, and any library version being submitted, must pass
--                                          case_identifier_kinds(): NHS numbers (modulus 11), labelled dates of
--                                          birth, hospital or patient numbers, e-mail addresses, telephone numbers,
--                                          full calendar dates, UK postcodes and Ugandan national ID numbers. The
--                                          application screen (src/lib/cases/candidates.ts) is stricter still. This
--                                          is the backstop, so a bypassed screen still cannot store one.
--   Content kept after it should go.       Ineligible, declined and withdrawn candidates hold NO content (CHECK).
--                                          Revoking the permission, deleting the source, erasure and retention all
--                                          withdraw every unpromoted candidate and purge it, in the database.
--   An educator seeing the student.        HQ reads candidates only through case_candidate_queue, which has no user
--                                          and no source reference, and is security_invoker with no grant to anon
--                                          or authenticated.
--   A rewritten candidate.                 The content of a candidate never changes. The educator develops a
--                                          library draft from it, with its own provenance.
--   A promoted case resting on no rights.  A library version of candidate origin must carry the rights the student
--                                          attested, and the candidate must be in development.
--   A session on an unapproved case.       A delivery session starts only on a deliverable version
--                                          (case_library_deliverable: published AND approved for this exact version).
--
--   Offering never charges anybody. There is no AI in this file and no ledger write.
--
-- RLS: on for the four new tables, no policy. Execute on the functions: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CASES/ROLLBACK-423.sql drops what this file adds. It refuses once a candidacy,
--   a candidate or a session exists, or a library version names a candidate.
-- ====================================================================================================


-- ---- 1. the identifier backstop -------------------------------------------------------------------------

-- The NHS number modulus-11 check (NHS Data Dictionary), as src/lib/privacy/patient-identifiers.ts has it. A leading
-- 0 is refused, because UK telephone numbers start with 0.
create or replace function public.case_nhs_number_valid(p_digits text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_sum int := 0;
  v_check int;
begin
  if p_digits !~ '^[1-9][0-9]{9}$' then return false; end if;
  for i in 1..9 loop
    v_sum := v_sum + substr(p_digits, i, 1)::int * (11 - i);
  end loop;
  v_check := 11 - (v_sum % 11);
  if v_check = 10 then return false; end if;
  if v_check = 11 then v_check := 0; end if;
  return v_check = substr(p_digits, 10, 1)::int;
end;
$$;

-- The KINDS of identifier found in a text, never the values. Empty when none. The same kinds and patterns as
-- STRUCTURED_KINDS in src/lib/cases/candidates.ts, proven alike on one corpus.
create or replace function public.case_identifier_kinds(p_text text)
returns text[]
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_found text[] := '{}';
  m text[];
begin
  if p_text is null then return v_found; end if;
  -- Record identifiers (uuids: competencies, terms, domains) are not about a patient, and their digit runs would
  -- read as numbers. They are blanked first.
  p_text := regexp_replace(p_text, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ' ', 'g');
  for m in select regexp_matches(p_text, '(^|[^0-9])([0-9]{3})[ -]?([0-9]{3})[ -]?([0-9]{4})($|[^0-9])', 'g') loop
    if case_nhs_number_valid(m[2] || m[3] || m[4]) then v_found := v_found || 'nhs_number'::text; exit; end if;
  end loop;
  if p_text ~* '(^|[^a-z])(dob|d\.o\.b\.?|date of birth)\s*[:-]?\s*[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}' then v_found := v_found || 'date_of_birth'::text; end if;
  if p_text ~* '(^|[^a-z])(mrn|hospital\s+(no|number)|patient\s+(id|number)|unit\s+number)\s*[:#.]?\s*[a-z]{0,3}[0-9]{5,}' then v_found := v_found || 'hospital_number'::text; end if;
  if p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then v_found := v_found || 'email'::text; end if;
  if p_text ~ '(\+[0-9]{1,3}[ -]?[0-9]{2,4}[ -]?[0-9]{3}[ -]?[0-9]{3,4})|((^|[^0-9])0[0-9]{2,4}[ -]?[0-9]{3,4}[ -]?[0-9]{3,4}($|[^0-9]))' then v_found := v_found || 'phone'::text; end if;
  if p_text ~ '(^|[^0-9])([0-2]?[0-9]|3[01])[/.-](0?[1-9]|1[0-2])[/.-](19|20)[0-9]{2}($|[^0-9])' or p_text ~ '(^|[^0-9])(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])($|[^0-9])' then v_found := v_found || 'calendar_date'::text; end if;
  if p_text ~ '(^|[^A-Za-z0-9])[A-Z]{1,2}[0-9][A-Z0-9]?\s+[0-9][A-Z]{2}($|[^A-Za-z0-9])' then v_found := v_found || 'postcode'::text; end if;
  if p_text ~ '(^|[^A-Z0-9])C[MF][A-Z0-9]{12}($|[^A-Z0-9])' then v_found := v_found || 'national_id'::text; end if;
  return v_found;
end;
$$;


-- ---- 2. the permission: separate, revocable, recorded with its attestation text version -------------------

create table if not exists case_candidacy (
  user_id             uuid primary key references profiles(id) on delete cascade,
  status              text not null,
  attestation         text not null,
  attestation_version text not null,
  granted_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  revoked_reason      text,
  updated_at          timestamptz not null default now()
);
alter table case_candidacy drop constraint if exists case_candidacy_check;
alter table case_candidacy add constraint case_candidacy_check
  check (status in ('granted', 'revoked') and attestation in ('own_notes', 'licensed_to_share')
     and char_length(attestation_version) between 1 and 60
     and (status = 'revoked') = (revoked_at is not null)
     and (status = 'granted' or revoked_reason in ('student', 'erasure', 'administrative')));
alter table case_candidacy enable row level security;

-- Every grant and revocation, append-only. A cascade from the person still deletes (erasure).
create table if not exists case_candidacy_event (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  event               text not null,
  attestation         text not null,
  attestation_version text not null,
  reason              text,
  created_at          timestamptz not null default now()
);
alter table case_candidacy_event drop constraint if exists case_candidacy_event_check;
alter table case_candidacy_event add constraint case_candidacy_event_check check (event in ('granted', 'revoked'));
create index if not exists idx_case_candidacy_event_user on case_candidacy_event(user_id, created_at desc);
alter table case_candidacy_event enable row level security;

create or replace function public.case_candidacy_event_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'case_candidacy_event is append-only';
end;
$$;
drop trigger if exists case_candidacy_event_guard on case_candidacy_event;
create trigger case_candidacy_event_guard before update or delete on case_candidacy_event for each row execute function public.case_candidacy_event_guard();


-- ---- 3. the candidate: de-identified, structured, and only ever what the student offered ------------------

create table if not exists case_candidate (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references profiles(id) on delete set null,
  source_key          text not null,
  status              text not null,
  snapshot            jsonb,
  snapshot_hash       text,
  reasons             text[] not null default '{}',
  screen_version      text not null,
  attestation         text not null default 'set-by-trigger',
  attestation_version text not null default 'set-by-trigger',
  title               text,
  level               text,
  complexity          int,
  risk                text,
  profession_term_id  uuid,
  specialty_term_ids  uuid[] not null default '{}',
  cfca_domain_ids     uuid[] not null default '{}',
  cpu_ids             uuid[] not null default '{}',
  competency_ids      uuid[] not null default '{}',
  offered_at          timestamptz not null default now(),
  decided_by          uuid,
  decided_at          timestamptz,
  decline_reason      text,
  promoted_version_id uuid references case_library_version(id),
  withdrawn_at        timestamptz,
  withdrawn_reason    text,
  updated_at          timestamptz not null default now()
);
alter table case_candidate drop constraint if exists case_candidate_check;
alter table case_candidate add constraint case_candidate_check
  check (status in ('eligible', 'ineligible', 'in_development', 'promoted', 'declined', 'withdrawn')
     and char_length(source_key) between 8 and 200 and char_length(screen_version) between 1 and 60
     and (snapshot is not null) = (status in ('eligible', 'in_development', 'promoted'))
     and (snapshot_hash is not null) = (snapshot is not null)
     and (snapshot is null or jsonb_typeof(snapshot) = 'object')
     and (status <> 'ineligible' or cardinality(reasons) >= 1)
     and (status not in ('eligible', 'in_development', 'promoted') or cardinality(reasons) = 0)
     and (status = 'withdrawn') = (withdrawn_at is not null)
     and (status <> 'withdrawn' or withdrawn_reason in ('student', 'revoked', 'source_deleted', 'erasure', 'retention'))
     and (status = 'promoted') = (promoted_version_id is not null)
     and (status not in ('in_development', 'promoted', 'declined') or (decided_by is not null and decided_at is not null))
     and (status <> 'declined' or char_length(btrim(coalesce(decline_reason, ''))) >= 2)
     and (user_id is not null or status in ('promoted', 'withdrawn'))
     and (level is null or level in ('foundation', 'intermediate', 'advanced'))
     and (risk is null or risk in ('standard', 'high'))
     and (complexity is null or complexity between 1 and 5));
create unique index if not exists ux_case_candidate_offer on case_candidate(user_id, source_key, snapshot_hash);
create index if not exists idx_case_candidate_queue on case_candidate(status, offered_at desc);
create index if not exists idx_case_candidate_user on case_candidate(user_id, source_key);
alter table case_candidate enable row level security;

-- uuid[] from a jsonb array of uuid strings, ignoring anything that is not one.
create or replace function public.case_jsonb_uuids(p jsonb)
returns uuid[]
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(array_agg(x::uuid order by x), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) as e(x)
   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

create or replace function public.case_candidate_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  g case_candidacy%rowtype;
  v_kinds text[];
  v_md jsonb;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'case_candidate: a candidate is withdrawn, not deleted, so the record of what was offered and why it went stays';
  end if;

  if tg_op = 'INSERT' then
    select * into g from case_candidacy where user_id = new.user_id;
    if new.user_id is null or not found or g.status <> 'granted' then
      raise exception 'case_candidate: no candidacy permission. The student must grant it, separately, before offering a case';
    end if;
    if new.status not in ('eligible', 'ineligible') then raise exception 'case_candidate: an offer is eligible or ineligible'; end if;
    -- The permission the offer rests on comes from the database, never from the caller.
    new.attestation := g.attestation;
    new.attestation_version := g.attestation_version;
    new.offered_at := now();
    new.decided_by := null; new.decided_at := null; new.decline_reason := null; new.promoted_version_id := null;
    new.withdrawn_at := null; new.withdrawn_reason := null;
    if new.status = 'ineligible' then
      new.snapshot := null; new.snapshot_hash := null;
      new.title := null; new.level := null; new.complexity := null; new.risk := null; new.profession_term_id := null;
      new.specialty_term_ids := '{}'; new.cfca_domain_ids := '{}'; new.cpu_ids := '{}'; new.competency_ids := '{}';
      return new;
    end if;
    v_kinds := case_identifier_kinds(new.snapshot::text);
    if cardinality(v_kinds) > 0 then
      raise exception 'case_candidate: identifiable content (%) cannot enter the candidate pipeline', array_to_string(v_kinds, ', ');
    end if;
    -- The queue filters come from the metadata of the snapshot itself, so a caller cannot label a candidate apart from its content.
    v_md := new.snapshot -> 'metadata';
    new.snapshot_hash := md5(new.snapshot::text);
    new.title := left(new.snapshot ->> 'title', 200);
    new.level := case when v_md ->> 'level' in ('foundation', 'intermediate', 'advanced') then v_md ->> 'level' end;
    new.complexity := case when v_md ->> 'complexity' ~ '^[1-5]$' then (v_md ->> 'complexity')::int end;
    new.risk := case when v_md ->> 'risk' in ('standard', 'high') then v_md ->> 'risk' end;
    new.profession_term_id := case when v_md ->> 'professionTermId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_md ->> 'professionTermId')::uuid end;
    new.specialty_term_ids := case_jsonb_uuids(v_md -> 'specialtyTermIds');
    new.cfca_domain_ids := case_jsonb_uuids(v_md -> 'cfcaDomainIds');
    new.cpu_ids := case_jsonb_uuids(v_md -> 'cpuIds');
    new.competency_ids := (select coalesce(array_agg(distinct c order by c), '{}') from jsonb_array_elements(coalesce(new.snapshot -> 'learningObjectives', '[]'::jsonb)) as lo(o),
                           unnest(case_jsonb_uuids(lo.o -> 'competencyIds')) as c);
    return new;
  end if;

  -- UPDATE. Identity and provenance never change, and the content never changes: it is only ever purged.
  if new.id is distinct from old.id or new.source_key is distinct from old.source_key or new.offered_at is distinct from old.offered_at
     or new.screen_version is distinct from old.screen_version or new.attestation is distinct from old.attestation
     or new.attestation_version is distinct from old.attestation_version or new.reasons is distinct from old.reasons
     or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'case_candidate: what was offered, by whom and on what permission cannot be rewritten';
  end if;
  if new.snapshot is not null and new.snapshot is distinct from old.snapshot then
    raise exception 'case_candidate: a candidate''s content never changes. Develop a library draft from it instead';
  end if;
  -- Erasure: the person is gone, so everything not yet promoted is withdrawn and purged.
  if new.user_id is null and old.user_id is not null and old.status not in ('promoted', 'withdrawn') then
    new.status := 'withdrawn'; new.withdrawn_reason := 'erasure';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'eligible' and new.status in ('in_development', 'declined', 'withdrawn'))
         or (old.status = 'in_development' and new.status in ('eligible', 'promoted', 'declined', 'withdrawn'))
         or (old.status in ('ineligible', 'declined') and new.status = 'withdrawn')) then
      raise exception 'case_candidate: a candidate cannot move from % to %', old.status, new.status;
    end if;
    if new.status = 'promoted' and coalesce(current_setting('competen.case_candidate', true), '') <> 'on' then
      raise exception 'case_candidate: a candidate is promoted only by creating its library draft';
    end if;
    if new.status = 'eligible' then new.decided_by := null; new.decided_at := null; end if;
    if new.status in ('in_development', 'declined') then new.decided_at := now(); end if;
    if new.status = 'withdrawn' then new.withdrawn_at := now(); end if;
  end if;
  if new.status in ('declined', 'withdrawn', 'ineligible') then
    new.snapshot := null; new.snapshot_hash := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists case_candidate_guard on case_candidate;
create trigger case_candidate_guard before insert or update or delete on case_candidate for each row execute function public.case_candidate_guard();

-- What HQ reads: the queue, with no user and no source reference. Eligible and in-development candidates only.
create or replace view case_candidate_queue with (security_invoker = true) as
  select id, status, snapshot, snapshot_hash, title, level, complexity, risk, profession_term_id, specialty_term_ids,
         cfca_domain_ids, cpu_ids, competency_ids, attestation, offered_at, decided_by, decided_at
    from case_candidate
   where status in ('eligible', 'in_development');
revoke all on case_candidate_queue from public, anon, authenticated;
grant select on case_candidate_queue to service_role;


-- ---- 4. the functions of the permission ------------------------------------------------------------------------

-- Grant (or re-grant) the permission, recording the attestation and the version of its text. Granting offers nothing.
create or replace function public.case_candidacy_grant(p_user uuid, p_attestation text, p_version text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if p_attestation not in ('own_notes', 'licensed_to_share') then raise exception 'case_candidacy_grant: the attestation is own_notes or licensed_to_share'; end if;
  insert into case_candidacy (user_id, status, attestation, attestation_version, granted_at)
    values (p_user, 'granted', p_attestation, p_version, now())
  on conflict (user_id) do update set status = 'granted', attestation = excluded.attestation, attestation_version = excluded.attestation_version,
    granted_at = now(), revoked_at = null, revoked_reason = null, updated_at = now();
  insert into case_candidacy_event (user_id, event, attestation, attestation_version) values (p_user, 'granted', p_attestation, p_version);
end;
$$;

-- Revoke the permission. Every candidate not yet promoted is withdrawn and its content purged, in this transaction.
create or replace function public.case_candidacy_revoke(p_user uuid, p_reason text)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  g case_candidacy%rowtype;
  v_n int;
begin
  select * into g from case_candidacy where user_id = p_user for update;
  if not found or g.status <> 'granted' then return 0; end if;
  update case_candidacy set status = 'revoked', revoked_at = now(), revoked_reason = coalesce(p_reason, 'student'), updated_at = now() where user_id = p_user;
  insert into case_candidacy_event (user_id, event, attestation, attestation_version, reason) values (p_user, 'revoked', g.attestation, g.attestation_version, coalesce(p_reason, 'student'));
  update case_candidate set status = 'withdrawn', withdrawn_reason = 'revoked'
   where user_id = p_user and status in ('eligible', 'ineligible', 'in_development', 'declined');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Withdraw what one source produced (the student deleted it, or withdrew the offer). An act of the student.
create or replace function public.case_candidate_withdraw(p_user uuid, p_source_key text, p_reason text)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_n int;
begin
  if p_reason not in ('student', 'source_deleted') then raise exception 'case_candidate_withdraw: the reason is student or source_deleted'; end if;
  update case_candidate set status = 'withdrawn', withdrawn_reason = p_reason
   where user_id = p_user and source_key = p_source_key and status in ('eligible', 'ineligible', 'in_development', 'declined');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Retention: withdraw and purge candidates nobody took into development before the cutoff.
create or replace function public.case_candidate_expire(p_before timestamptz)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_n int;
begin
  update case_candidate set status = 'withdrawn', withdrawn_reason = 'retention'
   where status in ('eligible', 'ineligible', 'declined') and offered_at < p_before;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ---- 5. promotion: a library draft of candidate origin --------------------------------------------------

alter table case_library_version drop constraint if exists case_library_version_origin_candidate_fk;
alter table case_library_version add constraint case_library_version_origin_candidate_fk foreign key (origin_candidate_id) references case_candidate(id);

-- Before a version of candidate origin is created: the candidate is in development, the educator taking it is an
-- author of the draft, and the draft carries the rights the student attested. Before any version is submitted: the
-- identifier backstop, over the whole content.
create or replace function public.case_library_version_candidate_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  c case_candidate%rowtype;
  v_kinds text[];
begin
  if tg_op = 'INSERT' and new.origin_kind = 'candidate' then
    select * into c from case_candidate where id = new.origin_candidate_id for update;
    if not found or c.status <> 'in_development' then
      raise exception 'case_library_version: a case of candidate origin starts only from a candidate in development';
    end if;
    if not (c.decided_by = any(new.authored_by)) then
      raise exception 'case_library_version: the educator who took the candidate into development authors its draft';
    end if;
    if (new.content -> 'metadata' -> 'provenance' ->> 'rights') is distinct from c.attestation then
      raise exception 'case_library_version: a case of candidate origin rests on the rights the student attested (%)', c.attestation;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.state = 'draft' and new.state = 'submitted' then
    v_kinds := case_identifier_kinds(new.content::text);
    if cardinality(v_kinds) > 0 then
      raise exception 'case_library_version: identifiable content (%) cannot be submitted', array_to_string(v_kinds, ', ');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists case_library_version_candidate_guard on case_library_version;
create trigger case_library_version_candidate_guard before insert or update on case_library_version for each row execute function public.case_library_version_candidate_guard();

create or replace function public.case_library_version_candidate_promote()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.origin_kind = 'candidate' then
    perform set_config('competen.case_candidate', 'on', true);
    update case_candidate set status = 'promoted', promoted_version_id = new.id where id = new.origin_candidate_id;
    perform set_config('competen.case_candidate', 'off', true);
  end if;
  return null;
end;
$$;
drop trigger if exists case_library_version_candidate_promote on case_library_version;
create trigger case_library_version_candidate_promote after insert on case_library_version for each row execute function public.case_library_version_candidate_promote();


-- ---- 6. delivery: the session of a student on a library case, kept by the server -------------------------------

create table if not exists case_library_session (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  version_id         uuid not null references case_library_version(id),
  view_salt          text not null default replace(gen_random_uuid()::text, '-', ''),
  variation          jsonb not null default '{}'::jsonb,
  reached_stage_ids  text[] not null default '{}',
  revealed_fact_ids  text[] not null default '{}',
  answers            jsonb not null default '[]'::jsonb,
  safety_events      int not null default 0,
  status             text not null default 'in_progress',
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now()
);
alter table case_library_session drop constraint if exists case_library_session_check;
alter table case_library_session add constraint case_library_session_check
  check (status in ('in_progress', 'completed', 'abandoned') and (status = 'completed') = (completed_at is not null)
     and jsonb_typeof(variation) = 'object' and jsonb_typeof(answers) = 'array' and safety_events >= 0
     and char_length(view_salt) between 16 and 64);
create index if not exists idx_case_library_session_user on case_library_session(user_id, version_id, started_at desc);
create index if not exists idx_case_library_session_version on case_library_session(version_id, status);
alter table case_library_session enable row level security;

create or replace function public.case_library_session_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if not case_library_deliverable(new.version_id) then
      raise exception 'case_library_session: only a published case approved for this exact version is delivered';
    end if;
    new.status := 'in_progress'; new.completed_at := null; new.started_at := now();
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.version_id is distinct from old.version_id or new.view_salt is distinct from old.view_salt
     or new.variation is distinct from old.variation or new.started_at is distinct from old.started_at then
    raise exception 'case_library_session: whose session, on which version, with which variation, cannot be rewritten';
  end if;
  if old.status <> 'in_progress' then raise exception 'case_library_session: a % session is closed', old.status; end if;
  if new.status = 'completed' then new.completed_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists case_library_session_guard on case_library_session;
create trigger case_library_session_guard before insert or update on case_library_session for each row execute function public.case_library_session_guard();


-- ---- 7. execute: the service role only --------------------------------------------------------------------

revoke all on function public.case_nhs_number_valid(text) from public, anon, authenticated;
revoke all on function public.case_identifier_kinds(text) from public, anon, authenticated;
revoke all on function public.case_jsonb_uuids(jsonb) from public, anon, authenticated;
revoke all on function public.case_candidacy_grant(uuid, text, text) from public, anon, authenticated;
revoke all on function public.case_candidacy_revoke(uuid, text) from public, anon, authenticated;
revoke all on function public.case_candidate_withdraw(uuid, text, text) from public, anon, authenticated;
revoke all on function public.case_candidate_expire(timestamptz) from public, anon, authenticated;
grant execute on function public.case_nhs_number_valid(text) to service_role;
grant execute on function public.case_identifier_kinds(text) to service_role;
grant execute on function public.case_jsonb_uuids(jsonb) to service_role;
grant execute on function public.case_candidacy_grant(uuid, text, text) to service_role;
grant execute on function public.case_candidacy_revoke(uuid, text) to service_role;
grant execute on function public.case_candidate_withdraw(uuid, text, text) to service_role;
grant execute on function public.case_candidate_expire(timestamptz) to service_role;


-- Verification: the new tables with RLS on and no policy, the view closed to anon and authenticated.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('case_candidacy', 'case_candidacy_event', 'case_candidate', 'case_library_session')
 order by c.relname;

select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'case_candidate_queue' order by 1, 2;

notify pgrst, 'reload schema';
