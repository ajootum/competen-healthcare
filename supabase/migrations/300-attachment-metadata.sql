-- ====================================================================================================
-- 300  ATTACHMENT TITLE, TAGS, VISIBILITY AND CATEGORIES  (CPR-ATT-HFE-009 s8, s9, s10, s13)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   The columns the Attachments rebuild declared missing, in its own header, rather than faking with
--   controls that stored nothing: a display title distinct from the filename, tags, the "Show in
--   patient's Documents" visibility, a content hash for honest duplicate detection, and the three
--   categories s9 names that the kind CHECK did not contain.
--
-- WARNING: THE TABLE IS EMPTY, probed before this file was written -- zero rows live. Every default
--   below lands on new rows only. If applied to a database that has since gained rows: title stays
--   null (the engine falls back to file_name for display, which is what those rows showed anyway),
--   tags default empty, and patient_visible defaults TRUE -- which is exactly the behaviour those
--   rows already had -- until now every attachment appeared in the Documents workspace with no way
--   to keep one out.
--
-- WARNING: patient_visible = false HIDES FROM THE DOCUMENTS WORKSPACE, NOT FROM THE ENCOUNTER.
--   s10: unchecked "means encounter association remains ... without broader projection". The row
--   stays on the encounter Attachments tab where it was created, and documentRegister excludes it. It is
--   a PROJECTION rule, not an access rule -- anybody who can open the encounter still sees the file,
--   and the audit trail of its creation is untouched. Defaulted TRUE because that is current
--   behaviour, and a migration must not silently hide anything that is visible today.
--
-- WARNING: THE CONSTRAINT NAME WAS READ OFF THE LIVE REFUSAL, NOT ASSUMED. An insert with an illegal
--   kind was attempted and the error named practice_attachment_kind_check. Dropping a guessed name
--   and adding a new constraint beside a surviving old one would leave BOTH enforced, and the new
--   values still refused -- the exact trap migration 194 set for the treatment types.
--
-- WARNING: THE OLD SIX KIND VALUES ALL SURVIVE. photograph, scan, result, consent, referral, other
--   remain legal alongside the three new ones. A widened CHECK that dropped a value in use would
--   make existing rows unwritable on their next update. Nothing here renames or remaps.
--
-- WARNING: content_hash IS NULLABLE AND CARRIES NO UNIQUE INDEX, DELIBERATELY. s13 asks for duplicate
--   PREVENTION "where reliable detection is available while PERMITTING legitimate duplicates when
--   explicitly confirmed". A unique index cannot express "permitted when confirmed" -- it refuses,
--   full stop, and a practitioner re-attaching a corrected scan of the same page would be blocked by
--   the database with no way through. The engine checks the hash and refuses ONLY without the
--   caller's explicit confirmation. Rows from before this file have no hash and are simply not
--   matched against, which is honest: no claim is made about bytes nobody hashed.
-- ====================================================================================================

-- ---- 1. DISPLAY TITLE -- s8 -------------------------------------------------------------------------
--
-- Distinct from file_name on purpose. file_name is the storage-sanitised name of the bytes and is part
-- of the record of what was uploaded, and a title is what a person calls it. Overloading one would
-- make the record's copy of the filename editable, which it must not be.
alter table practice_attachment add column if not exists title text;
alter table practice_attachment drop constraint if exists practice_attachment_title_len;
alter table practice_attachment add constraint practice_attachment_title_len
  check (title is null or char_length(btrim(title)) between 1 and 200);

-- ---- 2. TAGS -- s8 ----------------------------------------------------------------------------------
--
-- An array, not a join table: tags here are search words on one row, never shared objects with their
-- own lifecycle. Capped so a misbehaving client cannot store an essay per element.
alter table practice_attachment add column if not exists tags text[] not null default '{}';
alter table practice_attachment drop constraint if exists practice_attachment_tags_cap;
alter table practice_attachment add constraint practice_attachment_tags_cap
  check (array_length(tags, 1) is null or array_length(tags, 1) <= 12);

-- ---- 3. VISIBILITY -- s3, s10 -----------------------------------------------------------------------
alter table practice_attachment add column if not exists patient_visible boolean not null default true;

-- ---- 4. CONTENT HASH -- s13 -------------------------------------------------------------------------
--
-- sha256 hex, computed by the upload route from the bytes it received. See the header for why there is
-- no unique index on it.
alter table practice_attachment add column if not exists content_hash text;
alter table practice_attachment drop constraint if exists practice_attachment_hash_shape;
alter table practice_attachment add constraint practice_attachment_hash_shape
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

-- The duplicate question the engine asks: has this encounter already got these bytes?
create index if not exists idx_practice_attachment_hash
  on practice_attachment(encounter_id, content_hash) where content_hash is not null;

-- ---- 5. THE THREE MISSING CATEGORIES -- s9 ----------------------------------------------------------
alter table practice_attachment drop constraint if exists practice_attachment_kind_check;
alter table practice_attachment add constraint practice_attachment_kind_check
  check (kind in ('photograph', 'scan', 'result', 'consent', 'referral',
                  'procedure_document', 'external_record', 'administrative', 'other'));

notify pgrst, 'reload schema';
