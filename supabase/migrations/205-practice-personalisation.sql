-- ============================================================
-- MIGRATION 205: CONFIGURATION AND PERSONALISATION (CPR-360, the personalisation half)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE COMMIT MESSAGE THAT SAID "NOTHING IN THIS PRODUCT HAS A PER-USER PREFERENCE WORTH STORING" WAS
-- WRITTEN WITHOUT READING A SPECIFICATION THAT IS MOSTLY PER-USER PREFERENCES.
--
-- CPR-360's spec and comp are roughly four-fifths personalisation: dashboard customisation with widget
-- toggles and saved layouts, theme, primary and accent colour, font size, density, reduce-visual-noise,
-- notification preferences with quiet hours, keyboard shortcuts, specialty profile, workflow
-- preferences, sync and devices, import/export, reset to defaults. What was built was WORKSPACE
-- configuration -- practice name, timezone, locations, appointment length -- which appears in the comp
-- as two fields inside one panel. See CPR-AUDIT-001-spec-conformance.md.
--
-- The workspace configuration is kept in full. The timezone correction and its write-time validation are
-- genuinely load-bearing. This migration adds the half that was missing.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- ONE ROW PER PERSON PER WORKSPACE. Preferences are per-membership, not per-account: a practitioner who
-- works at two practices may reasonably want a compact dashboard at the busy one and a full one at the
-- quiet one, and a single global row would make that impossible to express.
--
-- CROSS-DEVICE SYNC IS NOT A FEATURE HERE, IT IS A CONSEQUENCE. The spec asks for preferences that
-- follow you between desktop, tablet and mobile; storing them server-side against the user IS that,
-- with no sync engine, no conflict resolution and no device register. The comp's "Sync & Devices" panel
-- says so rather than implying machinery that does not exist.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The preference row ---------------------------------------------------------------------------
--
-- SCALARS AS COLUMNS, LISTS AS JSONB. A column per scalar so a typo is caught by a CHECK rather than
-- discovered when the page renders nothing; jsonb only where the shape is genuinely a list whose members
-- come from the application (which widgets exist, which notification categories exist).
--
-- EVERY OVERRIDE COLUMN IS NULLABLE, AND NULL MEANS "FOLLOW THE PRACTICE". This is the spec's
-- "organisation defaults with personal overrides" made storable: there is no way to accidentally freeze
-- a copy of the practice default into a personal row, because not-choosing is representable.

create table if not exists practice_user_preference (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  user_id uuid not null,

  -- Appearance.
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  accent text not null default 'indigo' check (accent in ('indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'slate')),
  font_scale text not null default 'normal' check (font_scale in ('small', 'normal', 'large')),
  density text not null default 'comfortable' check (density in ('comfortable', 'compact')),
  reduce_visual_noise boolean not null default false,

  -- Dashboard: an ordered list of {key, visible}. Order matters and a set cannot express it.
  dashboard_widgets jsonb,

  -- Notifications: {category: boolean}. Categories are defined by the application, not by this table --
  -- a category added later must not require a migration to become switchable.
  notification_categories jsonb,

  -- Specialty profile. Consumed by the template library, which already carries a `specialty` column --
  -- a specialty that filtered nothing would be a form that stores words.
  specialty text,
  subspecialties jsonb,

  -- Keyboard shortcuts, on or off. Not remappable: see the note in preferences.ts.
  shortcuts_enabled boolean not null default true,

  -- Personal overrides of practice defaults. NULL = follow the practice.
  default_encounter_mode text,
  default_appointment_minutes integer check (default_appointment_minutes is null or (default_appointment_minutes between 5 and 240)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per person per workspace, enforced rather than assumed: two rows would make "what is my theme"
-- a question with two answers and no tiebreak.
create unique index if not exists idx_practice_user_pref_unique
  on practice_user_preference(workspace_id, user_id);

-- ---- 2. Organisation policy takes precedence (CPR-360 s5) --------------------------------------------
--
-- A LIST OF PREFERENCE KEYS THE PRACTICE HAS LOCKED. The spec's business rule is that personal settings
-- override defaults WHERE PERMITTED and that organisation policies take precedence over restricted
-- settings; without somewhere to record which settings are restricted, "where permitted" means
-- "everywhere", and the rule is decoration.
--
-- Empty by default. A practice that locks nothing behaves exactly as it did.

alter table practice_configuration add column if not exists locked_preferences jsonb;

-- ---- 3. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_user_preference enable row level security;

notify pgrst, 'reload schema';
