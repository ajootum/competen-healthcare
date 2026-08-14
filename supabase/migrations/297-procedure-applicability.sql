-- ====================================================================================================
-- 297  PROCEDURE APPLICABILITY AND PER-PRACTICE CONFIGURATION  (CPR-PROC-HFE-005 s20)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   s20 asks the procedure DEFINITION to say which fields a procedure uses. Until now
--   practice_procedure_type carried exactly two booleans, sided and consent_required, and nothing else
--   -- so "site is required for this procedure", "this one only ever takes left or right", "this one
--   is never merely ordered" and "this one must record an outcome" were unsayable. This adds the
--   vocabulary, plus the two tables s20 asks for that did not exist at all: per-practice enable and
--   disable, and practitioner usage.
--
-- WARNING: THE TWO BOOLEANS ARE NOT DROPPED, AND ENFORCEMENT TAKES THE STRICTER OF THE TWO.
--   sided and consent_required are what procedures.ts refuses on TODAY, and the sided one is the
--   wrong-site check. Replacing them with a tri-state would mean a single mis-set backfill silently
--   turns off the only control standing between this product and a never-event. So both survive, both
--   are written together by the engine, and the rule is: refuse if the boolean says so OR the tri-state
--   says so. A stale boolean can then only ever ADD safety, never remove it.
--
-- WARNING: THE BACKFILL PRESERVES TODAY'S BEHAVIOUR EXACTLY, INCLUDING THE PART THAT LOOKS ODD.
--   sided = false becomes laterality_rule = 'not_applicable', not 'optional'. That is deliberate: the
--   screen shipped in 84f25aa0 already hides Side when the catalogue says a procedure is not sided, so
--   'not_applicable' is what the product already does. 'optional' would have been a quieter word for a
--   change in behaviour. consent_required = false becomes 'optional' for the same reason, in the other
--   direction: the engine refuses nothing today, and the field is offered.
--
-- WARNING: AN EMPTY ARRAY MEANS NO RESTRICTION, NOT NO CHOICES.
--   allowed_lateralities and allowed_statuses default to '{}' and every existing row keeps it. Empty
--   means the full vocabulary is allowed, which is what is true today. A migration that seeded them
--   with the full list instead would look identical and behave identically until somebody removed a
--   value by hand and could not tell the difference between "restricted to these" and "not restricted".
--
-- WARNING: NO PER-CATEGORY STATUS LIST IS INVENTED HERE. Migration 294's header noted that
--   CPR-TRT-PROC-003 s14 wants one. allowed_statuses is per PROCEDURE, which is what s20 asks for. A
--   category-level default would be a second place deciding the same thing.
--
-- WARNING: detail_fields IS A SCHEMA, AND practice_procedure_detail IS WHERE THE ANSWERS GO.
--   The column describes fields, it does not hold values. Values belong to the procedure EVENT, keyed
--   by field, so a renamed or removed field definition cannot rewrite what was recorded -- the same
--   reasoning that makes practice_procedure.label a written-down string rather than a join.
--
-- WARNING: ACTIVATION RECORDS ONLY THE DEPARTURE. No row means enabled, exactly as
--   practice_investigation_activation (275) and practice_treatment_option_state (275) work. A practice
--   that has never opened the settings screen has no rows and sees the whole catalogue.
-- ====================================================================================================

-- ---- 1. FIELD APPLICABILITY ON THE PROCEDURE DEFINITION ---------------------------------------------
--
-- Three rules, one vocabulary. required means the item cannot be recorded without it, optional means
-- the field is offered, not_applicable means it is not drawn at all -- s3: do not display a field
-- merely because it exists.
alter table practice_procedure_type add column if not exists site_rule text not null default 'optional';
alter table practice_procedure_type add column if not exists laterality_rule text not null default 'not_applicable';
alter table practice_procedure_type add column if not exists consent_rule text not null default 'optional';

alter table practice_procedure_type drop constraint if exists practice_proc_type_site_rule_check;
alter table practice_procedure_type add constraint practice_proc_type_site_rule_check
  check (site_rule in ('required', 'optional', 'not_applicable'));

alter table practice_procedure_type drop constraint if exists practice_proc_type_laterality_rule_check;
alter table practice_procedure_type add constraint practice_proc_type_laterality_rule_check
  check (laterality_rule in ('required', 'optional', 'not_applicable'));

alter table practice_procedure_type drop constraint if exists practice_proc_type_consent_rule_check;
alter table practice_procedure_type add constraint practice_proc_type_consent_rule_check
  check (consent_rule in ('required', 'optional', 'not_applicable'));

-- The backfill. See the second warning above for why these two mappings are not symmetrical.
update practice_procedure_type set laterality_rule = 'required' where sided = true;
update practice_procedure_type set laterality_rule = 'not_applicable' where sided = false;
update practice_procedure_type set consent_rule = 'required' where consent_required = true;
update practice_procedure_type set consent_rule = 'optional' where consent_required = false;

-- ---- 2. THE ALLOWED VALUES ---------------------------------------------------------------------------
--
-- s9: "for procedures requiring laterality, show only valid configured choices". A knee injection that
-- can only be left or right should not offer bilateral.
alter table practice_procedure_type add column if not exists allowed_lateralities text[] not null default '{}';
alter table practice_procedure_type drop constraint if exists practice_proc_type_allowed_lat_check;
alter table practice_procedure_type add constraint practice_proc_type_allowed_lat_check
  check (allowed_lateralities <@ array['left', 'right', 'bilateral']::text[]);

-- s11 and s20: the allowed and default lifecycle statuses. ABANDONED is included because migration 294
-- still accepts it and rows may hold it, so a restriction list must be able to name what exists.
alter table practice_procedure_type add column if not exists allowed_statuses text[] not null default '{}';
alter table practice_procedure_type drop constraint if exists practice_proc_type_allowed_status_check;
alter table practice_procedure_type add constraint practice_proc_type_allowed_status_check
  check (allowed_statuses <@ array['ORDERED', 'SCHEDULED', 'PERFORMED', 'ATTEMPTED', 'CANCELLED', 'DECLINED', 'ABANDONED']::text[]);

alter table practice_procedure_type add column if not exists default_status text;
alter table practice_procedure_type drop constraint if exists practice_proc_type_default_status_check;
alter table practice_procedure_type add constraint practice_proc_type_default_status_check
  check (default_status is null or default_status in ('ORDERED', 'SCHEDULED', 'PERFORMED', 'ATTEMPTED', 'CANCELLED', 'DECLINED'));

-- A default outside its own allowed list is a catalogue entry that cannot record its own default.
alter table practice_procedure_type drop constraint if exists practice_proc_type_default_in_allowed_check;
alter table practice_procedure_type add constraint practice_proc_type_default_in_allowed_check
  check (default_status is null or allowed_statuses = '{}'::text[] or default_status = any(allowed_statuses));

-- ---- 3. OUTCOME REQUIREMENT -- s14 ------------------------------------------------------------------
--
-- s14: "where a configured procedure requires outcome documentation, surface the field automatically."
-- The engine only demands it where the procedure actually HAPPENED -- asking what the outcome was of
-- something merely ordered invites an answer that contradicts the status beside it.
alter table practice_procedure_type add column if not exists outcome_required boolean not null default false;

-- ---- 4. PROCEDURE-SPECIFIC DETAIL FIELDS -- s8, s20 -------------------------------------------------
--
-- An array of field definitions. Each entry is an object with key, label, kind and required, and choice
-- fields carry options. Deliberately a small closed vocabulary rather than an open form builder: a
-- clinical field with no declared kind cannot be validated, and an unvalidatable clinical field is a
-- free-text column with extra steps.
alter table practice_procedure_type add column if not exists detail_fields jsonb not null default '[]'::jsonb;
alter table practice_procedure_type drop constraint if exists practice_proc_type_detail_fields_check;
alter table practice_procedure_type add constraint practice_proc_type_detail_fields_check
  check (jsonb_typeof(detail_fields) = 'array');

-- The answers. Keyed by procedure event and field key, NOT by a reference to the definition: a field
-- definition that is renamed or deleted must not be able to rewrite or orphan what was recorded.
create table if not exists practice_procedure_detail (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  procedure_id uuid not null references practice_procedure(id) on delete cascade,
  field_key text not null check (char_length(btrim(field_key)) between 1 and 64),
  field_label text not null check (char_length(btrim(field_label)) between 1 and 160),
  value_text text not null check (char_length(btrim(value_text)) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists ux_practice_proc_detail
  on practice_procedure_detail(procedure_id, field_key);
create index if not exists idx_practice_proc_detail_ws
  on practice_procedure_detail(workspace_id, procedure_id);

alter table practice_procedure_detail enable row level security;

-- ---- 5. PER-PRACTICE ENABLE AND DISABLE -- s20 ------------------------------------------------------
--
-- The practice_investigation_activation pattern (275), applied to procedures. Absence of a row means
-- enabled, so this table holds only what a practice has deliberately changed.
--
-- The catalogue's own nullable workspace_id already lets a practice ADD its own entries. It has never
-- let one hide or rename a supplied entry, which is why a practice that does not do obstetrics has
-- always had obstetric procedures in its search results.
create table if not exists practice_procedure_type_activation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  procedure_type_id uuid not null references practice_procedure_type(id) on delete cascade,
  enabled boolean not null default true,
  local_display_name text check (local_display_name is null or char_length(btrim(local_display_name)) between 1 and 200),
  sort_order integer,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists ux_practice_proc_type_activation
  on practice_procedure_type_activation(workspace_id, procedure_type_id);

alter table practice_procedure_type_activation enable row level security;

-- ---- 6. PRACTITIONER USAGE -- s20 -------------------------------------------------------------------
--
-- The practice_investigation_preference pattern (275). favourite is EXPLICIT and usage_count is
-- OBSERVED, and they stay two columns because they answer different questions -- s6 forbids presenting
-- either as a recommendation, and a shortcut list has to be able to say which of the two put an item on
-- screen.
create table if not exists practice_procedure_preference (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  practitioner_id uuid not null,
  procedure_type_id uuid not null references practice_procedure_type(id) on delete cascade,
  favourite boolean not null default false,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_practice_proc_preference
  on practice_procedure_preference(workspace_id, practitioner_id, procedure_type_id);

alter table practice_procedure_preference enable row level security;

-- ---- 7. THE SEEDED CATALOGUE LEARNS WHAT IT ALREADY KNEW --------------------------------------------
--
-- The ten supplied entries get the rules their names imply. Only the platform rows are touched, and
-- only where nobody has set anything -- a practice that has already configured its own copy is left
-- alone.
--
-- WARNING: EVERY CODE BELOW WAS READ OFF THE LIVE TABLE, NOT REMEMBERED. The first draft of this
--   section also set burn_dressing, which does not exist -- the seeded ten are abscess_incision,
--   cannulation, im_injection, joint_injection, lesion_excision, nebulisation, suture_removal,
--   suturing, urinary_catheter and wound_dressing. An update naming a code that is not there affects
--   nothing and reports success, so it would have shipped as a silent no-op.
--
-- Skin and wound work takes a site: WHICH wound or lesion is the clinical content of the record, and
-- these are the four where a record without one says almost nothing.
update practice_procedure_type set site_rule = 'required'
where workspace_id is null and site_rule = 'optional'
  and code in ('wound_dressing', 'suturing', 'abscess_incision', 'lesion_excision');

-- Sided procedures that cannot sensibly be bilateral. An abscess is incised on one side or the other,
-- and a peripheral cannula goes into one arm. joint_injection is left unrestricted deliberately --
-- injecting both knees on one visit is ordinary.
update practice_procedure_type set allowed_lateralities = array['left', 'right']::text[]
where workspace_id is null and allowed_lateralities = '{}'::text[]
  and code in ('abscess_incision', 'cannulation');

-- Nothing restricts allowed_statuses here, deliberately -- see the empty-array warning at the top. Any
-- of these ten can legitimately be ordered, scheduled, declined or cancelled as well as performed.

notify pgrst, 'reload schema';
