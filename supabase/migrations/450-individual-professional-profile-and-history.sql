-- ====================================================================================================
-- MIGRATION 450: COMPETEN PROFESSIONAL -- REGISTRATION, PROGRESSIVE PROFILE AND PROFILE HISTORY
--
-- !! APPLY THIS FILE WHOLE. It contains three plpgsql trigger functions. A runner that splits on
-- !! semicolons would cut a function body in half. Paste the entire file into the SQL editor and run it.
--
-- COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1 (Professional Registration, Profile and Identity), owner GO
-- sections 3, 4 and 5. Development and staging authorised. Production needs a separate owner GO.
-- Build record: docs/COMPETEN-PROFESSIONAL-PROFILE-01-stage1.md.
--
-- APPLY ON STAGING FIRST. It adds nullable columns and three CHECKs to individual_professional_profile
-- (migration 373), creates two tables and three trigger functions, and backfills one history period per
-- profile that exists before this file. It alters no existing row value. Re-running it is a no-op.
--
-- DEPENDS ON 373 only (individual_professional_profile, profiles). Independent of 374 to 436.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
--   1. The registration form (GO s3). Three required facts -- profession, the country or jurisdiction of
--      practice, current professional status -- and optional ones, saved step by step so a person can
--      stop and continue later. They live on the 373 profile row, which stays the CURRENT pointer.
--      registration_completed_at can only be set when the three required facts are present: the schema,
--      not the form, decides that registration is complete.
--
--   2. Profile history (GO s4). 373 keeps ONE row per person, so a change of profession, status,
--      specialty, setting or registration overwrote the earlier context. individual_professional_
--      profile_context is an append-only history written BY TRIGGER on every change of a context field,
--      whoever makes it (the 402 pattern). Its periods use the database clock.
--
--   3. The progressive profile sections (GO s4): many qualifications, registrations and licences,
--      employment periods, specialties, interests and career aspirations, in
--      individual_professional_profile_item. A record is never edited in place. A change is a NEW
--      version that names the one it supersedes, and the trigger closes the old one in the same
--      statement. A person can withdraw a record (recorded in error, no longer held) but not rewrite it.
--
-- ----------------------------------------------------------------------------------------------------
-- EVIDENCE AND VERIFICATION (GO s5), AND WHY NOTHING HERE CAN BE VERIFIED.
--
-- The evidence_class of an item is GENERATED, exactly as in 373: self_declared with no document,
-- source_linked (shown as document-supported) with one. Attaching a document never verifies anything.
-- There is no verified column, no verified_by and no status that means verified. Independently verified
-- records stay where an organisation verified them (professional_credentials.verified, read read-only
-- through the Passport). Expiry is computed from expires_on at read time. Supersession and withdrawal
-- are the lifecycle columns below.
--
-- PLACE OF THE FACTS (D5, migration 270 vocabulary). Facts a person states carry self_declared_ in the
-- column name. Governed option codes sit beside them, and the label shown at the time is COPIED, so
-- renaming an option in configuration never rewrites what an earlier record says.
--
-- NO SCOPE COLUMN. No hospital, organisation, tenant or workspace column on either table, so no
-- institutional reader can scope to them (owner ruling D1).
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT.
--
--   ASCII only. No semicolons inside any comment or string literal. APPLY-WHOLE banner above.
--   No partial unique indexes. experience_code NOT NULL with NO DEFAULT. RLS on, own-row SELECT only, no
--   write policy. Append-only trails keep the cascade path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-450.sql beside this file in the build record.
-- ====================================================================================================


-- ---- 1. THE CURRENT POINTER GAINS THE REGISTRATION FACTS -------------------------------------------

alter table individual_professional_profile add column if not exists profession_code text;
alter table individual_professional_profile add column if not exists practice_jurisdiction_code text;
alter table individual_professional_profile add column if not exists self_declared_practice_jurisdiction text;
alter table individual_professional_profile add column if not exists professional_status_code text;
alter table individual_professional_profile add column if not exists self_declared_professional_status text;
alter table individual_professional_profile add column if not exists professional_title_code text;
alter table individual_professional_profile add column if not exists self_declared_professional_title text;
alter table individual_professional_profile add column if not exists primary_specialty_code text;
alter table individual_professional_profile add column if not exists self_declared_primary_specialty text;
alter table individual_professional_profile add column if not exists practice_setting_code text;
alter table individual_professional_profile add column if not exists self_declared_practice_setting text;
alter table individual_professional_profile add column if not exists self_declared_current_role text;
alter table individual_professional_profile add column if not exists self_declared_years_experience smallint;
alter table individual_professional_profile add column if not exists self_declared_summary text;
alter table individual_professional_profile add column if not exists registration_step text;
alter table individual_professional_profile add column if not exists registration_completed_at timestamptz;

-- A code is a governed option code, and a code never stands without the label shown with it.
alter table individual_professional_profile drop constraint if exists individual_professional_profile_context_shape;
alter table individual_professional_profile add constraint individual_professional_profile_context_shape check (
  (profession_code is null or (profession_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and self_declared_profession is not null))
  and (practice_jurisdiction_code is null or (practice_jurisdiction_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and self_declared_practice_jurisdiction is not null))
  and (professional_status_code is null or (professional_status_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and self_declared_professional_status is not null))
  and (professional_title_code is null or (professional_title_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and self_declared_professional_title is not null))
  and (primary_specialty_code is null or (primary_specialty_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and self_declared_primary_specialty is not null))
  and (practice_setting_code is null or (practice_setting_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and self_declared_practice_setting is not null))
  and char_length(coalesce(self_declared_practice_jurisdiction, '')) <= 160
  and char_length(coalesce(self_declared_professional_status, '')) <= 160
  and char_length(coalesce(self_declared_professional_title, '')) <= 160
  and char_length(coalesce(self_declared_primary_specialty, '')) <= 160
  and char_length(coalesce(self_declared_practice_setting, '')) <= 160
  and char_length(coalesce(self_declared_current_role, '')) <= 160
  and char_length(coalesce(self_declared_summary, '')) <= 2000
  and (self_declared_years_experience is null or self_declared_years_experience between 0 and 70)
);

alter table individual_professional_profile drop constraint if exists individual_professional_profile_registration_step;
alter table individual_professional_profile add constraint individual_professional_profile_registration_step
  check (registration_step is null or registration_step in ('profession', 'practice', 'review'));

-- Registration is complete only with the three required facts (GO s3). Nothing else is required here.
alter table individual_professional_profile drop constraint if exists individual_professional_profile_registration_complete;
alter table individual_professional_profile add constraint individual_professional_profile_registration_complete check (
  registration_completed_at is null or (
    char_length(btrim(coalesce(self_declared_profession, ''))) > 0
    and char_length(btrim(coalesce(self_declared_practice_jurisdiction, ''))) > 0
    and char_length(btrim(coalesce(self_declared_professional_status, ''))) > 0
  )
);


-- ---- 2. THE PROFILE HISTORY ------------------------------------------------------------------------

create table if not exists individual_professional_profile_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  profession_code text,
  self_declared_profession text,
  practice_jurisdiction_code text,
  self_declared_practice_jurisdiction text,
  professional_status_code text,
  self_declared_professional_status text,
  professional_title_code text,
  self_declared_professional_title text,
  primary_specialty_code text,
  self_declared_primary_specialty text,
  practice_setting_code text,
  self_declared_practice_setting text,
  self_declared_current_role text,
  self_declared_years_experience smallint,
  self_declared_registration_body text,
  self_declared_registration_number text,
  self_declared_registration_country text,
  self_declared_registration_expires_on date,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now()
);

alter table individual_professional_profile_context drop constraint if exists individual_professional_profile_context_period;
alter table individual_professional_profile_context add constraint individual_professional_profile_context_period
  check (effective_to is null or effective_to >= effective_from);

create index if not exists idx_individual_professional_profile_context_user
  on individual_professional_profile_context(user_id, effective_from desc);

alter table individual_professional_profile_context enable row level security;
drop policy if exists individual_professional_profile_context_read_own on individual_professional_profile_context;
create policy individual_professional_profile_context_read_own on individual_professional_profile_context
  for select using (auth.uid() = user_id);

comment on table individual_professional_profile_context is
  'COMPETEN-PROFESSIONAL-PROFILE-01. Append-only history of a person''s professional context, one row per period, written by trigger from individual_professional_profile. Every fact is self-declared. Own-row read, trigger write.';


-- ---- 3. THE POINTER WRITES THE HISTORY -------------------------------------------------------------

create or replace function individual_professional_profile_history() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (
       old.profession_code, old.self_declared_profession, old.practice_jurisdiction_code, old.self_declared_practice_jurisdiction,
       old.professional_status_code, old.self_declared_professional_status, old.professional_title_code, old.self_declared_professional_title,
       old.primary_specialty_code, old.self_declared_primary_specialty, old.practice_setting_code, old.self_declared_practice_setting,
       old.self_declared_current_role, old.self_declared_years_experience, old.self_declared_registration_body,
       old.self_declared_registration_number, old.self_declared_registration_country, old.self_declared_registration_expires_on
     ) is not distinct from (
       new.profession_code, new.self_declared_profession, new.practice_jurisdiction_code, new.self_declared_practice_jurisdiction,
       new.professional_status_code, new.self_declared_professional_status, new.professional_title_code, new.self_declared_professional_title,
       new.primary_specialty_code, new.self_declared_primary_specialty, new.practice_setting_code, new.self_declared_practice_setting,
       new.self_declared_current_role, new.self_declared_years_experience, new.self_declared_registration_body,
       new.self_declared_registration_number, new.self_declared_registration_country, new.self_declared_registration_expires_on
     ) then
    return null;
  end if;

  update individual_professional_profile_context
     set effective_to = now()
   where user_id = coalesce(new.user_id, old.user_id)
     and effective_to is null;

  if tg_op in ('INSERT', 'UPDATE') then
    insert into individual_professional_profile_context (
      user_id, profession_code, self_declared_profession, practice_jurisdiction_code, self_declared_practice_jurisdiction,
      professional_status_code, self_declared_professional_status, professional_title_code, self_declared_professional_title,
      primary_specialty_code, self_declared_primary_specialty, practice_setting_code, self_declared_practice_setting,
      self_declared_current_role, self_declared_years_experience, self_declared_registration_body,
      self_declared_registration_number, self_declared_registration_country, self_declared_registration_expires_on, effective_from
    ) values (
      new.user_id, new.profession_code, new.self_declared_profession, new.practice_jurisdiction_code, new.self_declared_practice_jurisdiction,
      new.professional_status_code, new.self_declared_professional_status, new.professional_title_code, new.self_declared_professional_title,
      new.primary_specialty_code, new.self_declared_primary_specialty, new.practice_setting_code, new.self_declared_practice_setting,
      new.self_declared_current_role, new.self_declared_years_experience, new.self_declared_registration_body,
      new.self_declared_registration_number, new.self_declared_registration_country, new.self_declared_registration_expires_on, now()
    );
  end if;
  return null;
end
$$;

drop trigger if exists trg_individual_professional_profile_history on individual_professional_profile;
create trigger trg_individual_professional_profile_history
  after insert or update or delete on individual_professional_profile
  for each row execute function individual_professional_profile_history();

-- The history refuses to be rewritten. The one UPDATE allowed is the pointer trigger closing the open
-- period (pg_trigger_depth() > 1), changing nothing but effective_to. DELETE stays allowed, so a cascade
-- from profiles, and erasure, work.
create or replace function individual_professional_profile_context_append_only() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1
     and old.effective_to is null and new.effective_to is not null
     and (new.id, new.user_id, new.profession_code, new.self_declared_profession, new.practice_jurisdiction_code,
          new.self_declared_practice_jurisdiction, new.professional_status_code, new.self_declared_professional_status,
          new.professional_title_code, new.self_declared_professional_title, new.primary_specialty_code,
          new.self_declared_primary_specialty, new.practice_setting_code, new.self_declared_practice_setting,
          new.self_declared_current_role, new.self_declared_years_experience, new.self_declared_registration_body,
          new.self_declared_registration_number, new.self_declared_registration_country,
          new.self_declared_registration_expires_on, new.effective_from, new.created_at)
         is not distinct from
         (old.id, old.user_id, old.profession_code, old.self_declared_profession, old.practice_jurisdiction_code,
          old.self_declared_practice_jurisdiction, old.professional_status_code, old.self_declared_professional_status,
          old.professional_title_code, old.self_declared_professional_title, old.primary_specialty_code,
          old.self_declared_primary_specialty, old.practice_setting_code, old.self_declared_practice_setting,
          old.self_declared_current_role, old.self_declared_years_experience, old.self_declared_registration_body,
          old.self_declared_registration_number, old.self_declared_registration_country,
          old.self_declared_registration_expires_on, old.effective_from, old.created_at) then
    return new;
  end if;
  raise exception 'individual_professional_profile_context is append-only: an earlier professional context cannot be rewritten';
end
$$;

drop trigger if exists trg_individual_professional_profile_context_append_only on individual_professional_profile_context;
create trigger trg_individual_professional_profile_context_append_only
  before update on individual_professional_profile_context
  for each row execute function individual_professional_profile_context_append_only();


-- ---- 4. THE PROFILE SECTIONS: VERSIONED RECORDS --------------------------------------------------------
--
--   qualification   title = the qualification, organisation = awarding institution, type = qualification
--                   type, started_on = awarded on, expires_on where it expires
--   registration    title = register or category, organisation = registration body, identifier = the
--                   number the person states, type = standing, started_on = since, ended_on, expires_on
--   employment      title = role, organisation = employer, type = practice setting, started_on, ended_on
--                   (no end = current)
--   specialty       title = specialty or practice area, started_on = since
--   interest        title = professional or career interest
--   aspiration      title = the aspiration, target_on = when the person hopes to reach it

create table if not exists individual_professional_profile_item (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  section text not null,
  title text not null,
  type_code text,
  type_label text,
  organisation text,
  jurisdiction text,
  self_declared_identifier text,
  started_on date,
  ended_on date,
  expires_on date,
  target_on date,
  detail text,
  document_path text,
  document_name text,
  document_mime text,
  document_bytes integer,
  evidence_class text generated always as
    (case when document_path is null then 'self_declared' else 'source_linked' end) stored,
  supersedes_id uuid,
  superseded_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_profile_item_id_user
  on individual_professional_profile_item(id, user_id);
-- One successor per version: a record cannot fork into two current versions. FULL index (NULLs distinct).
create unique index if not exists ux_individual_professional_profile_item_supersedes
  on individual_professional_profile_item(supersedes_id);
create index if not exists idx_individual_professional_profile_item_user
  on individual_professional_profile_item(user_id, section, created_at desc);

-- Composite: a version can only supersede a record of the SAME person.
alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_supersedes_fk;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_supersedes_fk
  foreign key (supersedes_id, user_id) references individual_professional_profile_item(id, user_id) on delete set null (supersedes_id);

alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_experience_check;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_experience_check
  check (experience_code in ('scholar', 'professional'));

alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_section_check;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_section_check
  check (section in ('qualification', 'registration', 'employment', 'specialty', 'interest', 'aspiration'));

-- Which facts each section may carry. A column that means nothing for a section stays empty.
alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_section_shape;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_section_shape check (
  (section = 'registration' or self_declared_identifier is null)
  and (section in ('qualification', 'registration') or expires_on is null)
  and (section in ('registration', 'employment') or ended_on is null)
  and (section in ('qualification', 'registration', 'employment', 'specialty') or started_on is null)
  and (section = 'aspiration' or target_on is null)
  and (section in ('qualification', 'registration', 'employment') or document_path is null)
  and (ended_on is null or started_on is null or ended_on >= started_on)
  and (expires_on is null or started_on is null or expires_on >= started_on)
);

alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_lengths;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_lengths check (
  char_length(btrim(title)) between 2 and 200
  and char_length(coalesce(type_label, '')) <= 160
  and char_length(coalesce(organisation, '')) <= 160
  and char_length(coalesce(jurisdiction, '')) <= 160
  and char_length(coalesce(self_declared_identifier, '')) <= 60
  and char_length(coalesce(detail, '')) <= 2000
);

alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_type_shape;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_type_shape check (
  (type_code is null or (type_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and type_label is not null))
);

-- A version is current, superseded or withdrawn -- never two of them. A withdrawal says why.
alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_lifecycle;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_lifecycle check (
  not (superseded_at is not null and withdrawn_at is not null)
  and ((withdrawn_at is null) = (withdrawn_reason is null))
  and (withdrawn_reason is null or withdrawn_reason in ('recorded_in_error', 'no_longer_held'))
);

alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_document_whole;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_document_whole
  check ((document_path is null) = (document_name is null)
     and (document_path is null) = (document_mime is null)
     and (document_path is null) = (document_bytes is null)
     and (document_path is null or document_path like user_id::text || '/%'));

alter table individual_professional_profile_item enable row level security;
drop policy if exists individual_professional_profile_item_read_own on individual_professional_profile_item;
create policy individual_professional_profile_item_read_own on individual_professional_profile_item
  for select using (auth.uid() = user_id);

comment on table individual_professional_profile_item is
  'COMPETEN-PROFESSIONAL-PROFILE-01. The person''s professional profile sections as versioned records: a change is a new version that supersedes the old one, never an edit. No verified column: evidence_class is generated from whether a document is attached. No hospital or organisation scope column.';


-- ---- 5. A NEW VERSION CLOSES THE ONE IT SUPERSEDES ----------------------------------------------------
--
-- In the same statement as the insert. The superseded record must be the same section, and still
-- current (not superseded, not withdrawn). Otherwise the insert itself fails.

create or replace function individual_professional_profile_item_supersede() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.supersedes_id is null then
    return null;
  end if;
  update individual_professional_profile_item
     set superseded_at = now()
   where id = new.supersedes_id
     and user_id = new.user_id
     and section = new.section
     and superseded_at is null
     and withdrawn_at is null;
  if not found then
    raise exception 'individual_professional_profile_item: only a current record of the same section can be superseded';
  end if;
  return null;
end
$$;

drop trigger if exists trg_individual_professional_profile_item_supersede on individual_professional_profile_item;
create trigger trg_individual_professional_profile_item_supersede
  after insert on individual_professional_profile_item
  for each row execute function individual_professional_profile_item_supersede();

-- The facts of a record never change. Three UPDATEs are allowed, each changing only its own columns:
--   the supersede trigger above stamping superseded_at (pg_trigger_depth() > 1)
--   a withdrawal of a current record by its owner (withdrawn_at and withdrawn_reason, once)
--   the foreign key clearing supersedes_id when the superseded record is erased (pg_trigger_depth() > 1)
create or replace function individual_professional_profile_item_append_only() returns trigger
language plpgsql as $$
declare
  same_facts boolean;
begin
  same_facts := (new.id, new.user_id, new.experience_code, new.section, new.title, new.type_code, new.type_label,
                 new.organisation, new.jurisdiction, new.self_declared_identifier, new.started_on, new.ended_on,
                 new.expires_on, new.target_on, new.detail, new.document_path, new.document_name, new.document_mime,
                 new.document_bytes, new.created_at)
                is not distinct from
                (old.id, old.user_id, old.experience_code, old.section, old.title, old.type_code, old.type_label,
                 old.organisation, old.jurisdiction, old.self_declared_identifier, old.started_on, old.ended_on,
                 old.expires_on, old.target_on, old.detail, old.document_path, old.document_name, old.document_mime,
                 old.document_bytes, old.created_at);
  if same_facts
     and pg_trigger_depth() > 1
     and old.superseded_at is null and new.superseded_at is not null
     and old.withdrawn_at is null and new.withdrawn_at is null
     and new.supersedes_id is not distinct from old.supersedes_id then
    return new;
  end if;
  if same_facts
     and old.superseded_at is null and new.superseded_at is null
     and old.withdrawn_at is null and new.withdrawn_at is not null and new.withdrawn_reason is not null
     and new.supersedes_id is not distinct from old.supersedes_id then
    return new;
  end if;
  if same_facts
     and pg_trigger_depth() > 1
     and old.supersedes_id is not null and new.supersedes_id is null
     and new.superseded_at is not distinct from old.superseded_at
     and new.withdrawn_at is not distinct from old.withdrawn_at
     and new.withdrawn_reason is not distinct from old.withdrawn_reason then
    return new;
  end if;
  raise exception 'individual_professional_profile_item is append-only: add a new version instead of changing a record';
end
$$;

drop trigger if exists trg_individual_professional_profile_item_append_only on individual_professional_profile_item;
create trigger trg_individual_professional_profile_item_append_only
  before update on individual_professional_profile_item
  for each row execute function individual_professional_profile_item_append_only();


-- ---- 6. BACKFILL: ONE OPEN PERIOD PER PROFILE THAT EXISTS BEFORE THIS FILE ----------------------------
--
-- 373 kept no history, so the earliest date known for the values a row holds now is its updated_at.
-- Idempotent: a person who already has a history row is skipped.

insert into individual_professional_profile_context (
  user_id, profession_code, self_declared_profession, practice_jurisdiction_code, self_declared_practice_jurisdiction,
  professional_status_code, self_declared_professional_status, professional_title_code, self_declared_professional_title,
  primary_specialty_code, self_declared_primary_specialty, practice_setting_code, self_declared_practice_setting,
  self_declared_current_role, self_declared_years_experience, self_declared_registration_body,
  self_declared_registration_number, self_declared_registration_country, self_declared_registration_expires_on, effective_from
)
select p.user_id, p.profession_code, p.self_declared_profession, p.practice_jurisdiction_code, p.self_declared_practice_jurisdiction,
       p.professional_status_code, p.self_declared_professional_status, p.professional_title_code, p.self_declared_professional_title,
       p.primary_specialty_code, p.self_declared_primary_specialty, p.practice_setting_code, p.self_declared_practice_setting,
       p.self_declared_current_role, p.self_declared_years_experience, p.self_declared_registration_body,
       p.self_declared_registration_number, p.self_declared_registration_country, p.self_declared_registration_expires_on,
       coalesce(p.updated_at, p.created_at)
  from individual_professional_profile p
 where not exists (select 1 from individual_professional_profile_context c where c.user_id = p.user_id);


notify pgrst, 'reload schema';
