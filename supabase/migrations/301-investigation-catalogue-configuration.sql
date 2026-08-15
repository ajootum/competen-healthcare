-- ====================================================================================================
-- 301  INVESTIGATION CLASSIFICATION, DYNAMIC FIELDS AND LOCAL ALIASES  (CPR-INV-CAT-007)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   The three genuine gaps the catalogue audit found, in the shape migration 297 proved for
--   procedures: a per-definition dynamic field profile with an answers table, an
--   investigation-versus-procedure classification with the three known dual-purpose rows backfilled,
--   and per-practice search aliases -- the alias table had no workspace column, so a practice could
--   never teach the search its own word for a test.
--
-- WARNING: FOUR OF s4'S COLUMNS ARE DELIBERATELY REFUSED, AND THE REASONS ARE THE POINT.
--
--   category_id / enumeration   category stays FREE TEXT. The shipped custom-investigation form lets
--                               a practice type its own category, and practices hold rows written that
--                               way. An enumerating CHECK would make those rows unwritable on their
--                               next update and break a live capture path -- the exact failure the
--                               widened-CHECK warning in 300 exists to prevent, caused rather than
--                               avoided. The six seeded categories are convention, not law.
--   display_name                the separation of canonical identity from display terminology already
--                               exists: practice_investigation_activation.local_display_name is the
--                               per-practice display word, which is MORE precise than one global
--                               column. A second display column would be a second answer.
--   abbreviations / keywords    the alias table is the one synonym mechanism, deliberately. An array
--                               beside it would be a second list the search has to merge and the two
--                               would drift -- the reason 275 chose a table over an array is written
--                               in that migration.
--   locale metadata             this product ships to one locale. A column nothing reads is the dead
--                               FK class wearing i18n clothes.
--
--   Versioning is refused too: historical stability is already carried ON THE RECORDED ROW
--   (practice_encounter_investigation.label and display_name_snapshot are written down, not joined),
--   which is the stronger guarantee -- catalogue edits cannot rewrite an encounter no matter what
--   this table does.
--
-- WARNING: THE THREE DUAL-PURPOSE ROWS WERE READ OFF THE LIVE TABLE BEFORE THIS FILE WAS WRITTEN.
--   Upper GI endoscopy, colonoscopy and hysterosalpingogram are procedures sitting in the
--   investigation catalogue, named by the audit and confirmed by code. s10 is explicit that a
--   dual-purpose item takes an EXPLICIT classification rather than a silent duplicate in the
--   procedure catalogue, and dual_purpose is that explicit word. Everything else defaults to
--   investigation, which is what being in this catalogue has always meant.
--
-- WARNING: THE ALIAS UNIQUE INDEX IS REPLACED, AND THE OLD NAME WAS READ OFF A LIVE REFUSAL, not
--   assumed (a duplicate insert was attempted and the error named ux_practice_inv_alias). The new
--   index folds the workspace in through coalesce, so two PRACTICES may teach the same word for the
--   same test while one practice still cannot add it twice -- and the 66 global rows keep their
--   uniqueness against each other through the sentinel. It is a FULL unique index with no WHERE:
--   the partial-unique upsert trap does not apply.
--
-- WARNING: A LOCAL ALIAS RESOLVES, IT NEVER CREATES. s5 and s14: an alias points at an existing
--   canonical definition and cannot create a duplicate one. The foreign key enforces the pointing,
--   and nothing in this file or the engine turns an alias into a row.
-- ====================================================================================================

-- ---- 1. CLASSIFICATION -- s10 -----------------------------------------------------------------------
alter table practice_investigation_catalogue add column if not exists classification text not null default 'investigation';
alter table practice_investigation_catalogue drop constraint if exists practice_inv_cat_classification_check;
alter table practice_investigation_catalogue add constraint practice_inv_cat_classification_check
  check (classification in ('investigation', 'procedure', 'dual_purpose'));

update practice_investigation_catalogue set classification = 'dual_purpose'
where workspace_id is null and code in ('OTH-002', 'OTH-003', 'RAD-FL-002');

-- ---- 2. THE DYNAMIC FIELD PROFILE -- s6, s9 ---------------------------------------------------------
--
-- The same shape 297 proved for procedures: an array of field definitions on the definition, values in
-- an answers table keyed by field key with the label written down. Body region, laterality, specimen,
-- study subtype and contrast are all expressible as entries here, per definition, which is exactly
-- what s9 asks -- "specialty-specific field profiles can be added without new hard-coded forms".
alter table practice_investigation_catalogue add column if not exists detail_fields jsonb not null default '[]'::jsonb;
alter table practice_investigation_catalogue drop constraint if exists practice_inv_cat_detail_fields_check;
alter table practice_investigation_catalogue add constraint practice_inv_cat_detail_fields_check
  check (jsonb_typeof(detail_fields) = 'array');

-- The answers. Keyed by the RECORDED investigation and the field key, never by a reference to the
-- definition entry -- a renamed or deleted field must not rewrite or orphan what was recorded.
create table if not exists practice_investigation_detail (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  encounter_investigation_id uuid not null references practice_encounter_investigation(id) on delete cascade,
  field_key text not null check (char_length(btrim(field_key)) between 1 and 64),
  field_label text not null check (char_length(btrim(field_label)) between 1 and 160),
  value_text text not null check (char_length(btrim(value_text)) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists ux_practice_inv_detail
  on practice_investigation_detail(encounter_investigation_id, field_key);
create index if not exists idx_practice_inv_detail_ws
  on practice_investigation_detail(workspace_id, encounter_investigation_id);

alter table practice_investigation_detail enable row level security;

-- ---- 3. PER-PRACTICE ALIASES -- s12 -----------------------------------------------------------------
--
-- Null workspace = a canonical alias every practice searches by, which is what all 66 existing rows
-- are and remain. A practice row is that practice's own word, invisible to every other tenant.
alter table practice_investigation_alias add column if not exists workspace_id uuid
  references practice_workspace(id) on delete cascade;

drop index if exists ux_practice_inv_alias;
create unique index if not exists ux_practice_inv_alias_scoped
  on practice_investigation_alias (investigation_id, lower(btrim(alias)),
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---- 4. AUDIT COMPLETENESS --------------------------------------------------------------------------
--
-- s12 asks for audit metadata on configuration changes. The catalogue had created_by and updated_at
-- but no updated_by, and the preference table had no updated_at at all -- its sibling from 297 does.
alter table practice_investigation_catalogue add column if not exists updated_by uuid;
alter table practice_investigation_preference add column if not exists updated_at timestamptz not null default now();

notify pgrst, 'reload schema';
