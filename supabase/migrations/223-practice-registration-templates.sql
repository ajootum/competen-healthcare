-- ============================================================
-- MIGRATION 223: REGISTRATION CONFIGURATION FRAMEWORK (CPR-PRM-001 s2, s9)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- "CONFIGURATION REPLACES HARD-CODED FORMS" (s2) -- BUT NOT THE MINIMUM DATASET.
--
-- s9 asks for configurable field visibility, order and mandatory rules, custom fields without code, and
-- a conditional rules engine. All of that is built here. What is NOT configurable is the floor:
-- registerPatient already refuses a registration with no name, with neither a date of birth nor an age
-- estimate, and with neither a phone nor an email (CPR-V2-005's minimum dataset).
--
-- IF A TEMPLATE COULD HIDE THOSE, ONE OF TWO THINGS WOULD HAPPEN, AND BOTH ARE BAD:
--   the engine still refuses  -- and the practice gets an error about a field their own form never
--                                showed them, which is unfixable from where they are standing
--   the engine stops refusing -- and a safety rule has been switched off by configuration, which is the
--                                thing this codebase has refused to allow anywhere else
--
-- So a template may ADD requirements, reorder anything, add custom fields and hide OPTIONAL fields. It
-- may not hide or un-require a protected one. The list lives in the engine beside the rule it protects,
-- not in a table an administrator can edit -- a floor that can be lowered is not a floor.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Templates (s9) -----------------------------------------------------------------------------------

create table if not exists practice_registration_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),

  -- s9: "Registration templates by specialty, country or organisation." All optional and all narrowing:
  -- a template with none set applies everywhere, one with a specialty applies to that specialty.
  specialty text,
  country text,
  practice_type text,

  -- DRAFT UNTIL PUBLISHED, and validated at publish rather than at every edit -- so a template can be
  -- built up over several sittings without each half-finished state being refused, while a broken one
  -- can never go live.
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  version integer not null default 1,

  -- The one a practice falls back to when nothing more specific matches.
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  published_at timestamptz,
  published_by uuid
);

create index if not exists idx_practice_reg_template_ws
  on practice_registration_template(workspace_id, status);

-- ONE DEFAULT AT A TIME among the published ones. A partial unique index rather than an engine check,
-- because "which form do we use" must not depend on which code path wrote the row.
create unique index if not exists ux_practice_reg_template_default
  on practice_registration_template(workspace_id) where is_default and status = 'published';

-- ---- 2. Fields (s9) --------------------------------------------------------------------------------------

create table if not exists practice_registration_field (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  template_id uuid not null references practice_registration_template(id) on delete cascade,

  -- A CORE field maps to a column that already exists (display_name, birth_date, phone...). A CUSTOM one
  -- does not, and its value goes to practice_patient.custom_fields keyed by this same key.
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  is_core boolean not null default false,

  label text not null check (char_length(label) between 1 and 120),
  help text,
  field_type text not null default 'text'
    check (field_type in ('text', 'long_text', 'number', 'date', 'select', 'multi_select',
                          'boolean', 'phone', 'email')),

  required boolean not null default false,
  visible boolean not null default true,
  display_order integer not null default 0,

  -- For select and multi_select. [{ "value": "...", "label": "..." }]
  options jsonb not null default '[]'::jsonb,

  -- s9's conditional rules engine. One shape, evaluated by one pure function that both the server and
  -- the form use -- two evaluators would disagree, and the one that mattered would be the server's,
  -- silently, after the user had filled the form in.
  --   { "when": "has_insurance", "equals": true }
  --   { "when": "referral_source", "in": ["hospital", "clinic"] }
  --   { "when": "guardian_name", "isPresent": true }
  condition jsonb,

  created_at timestamptz not null default now()
);

create unique index if not exists ux_practice_reg_field_key
  on practice_registration_field(template_id, field_key);
create index if not exists idx_practice_reg_field_template
  on practice_registration_field(template_id, display_order);

-- ---- 3. Where a custom field's value goes ------------------------------------------------------------------
--
-- ON THE PATIENT, as jsonb keyed by field_key. A row-per-value table would be a join for every read of
-- a record that already has its own row, and a custom field is one value about one person.

alter table practice_patient add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- ---- 4. Capabilities -------------------------------------------------------------------------------------
--
-- Authoring a template is practice configuration: practice.settings.manage, the same capability that
-- governs the timezone and the appointment default. Filling a form in is patient.create, unchanged.

-- ---- 5. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_registration_template enable row level security;
alter table practice_registration_field enable row level security;

notify pgrst, 'reload schema';
