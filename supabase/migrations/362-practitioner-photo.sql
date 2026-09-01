-- ============================================================
-- MIGRATION 362: THE PRACTITIONER PHOTOGRAPH (CPR-BOOK-PROFILE-001 s4, s15)
--
-- s4: "Support an optional professional profile photograph. If absent, use a high-quality
-- initials/avatar fallback." The fallback has shipped. This is the field the photograph itself needs.
--
-- ---- WHAT IS STORED HERE, AND WHAT IS NOT ----------------------------------------------------------
--
-- ONLY THE OBJECT PATH. The image lives in storage, not in a column: a base64 photograph in a row is
-- read by every query that selects * from this table, including the ones that only wanted a name.
--
-- The path is a RANDOM identifier chosen by the service, never the user id or the handle. A predictable
-- object path in a public bucket lets anybody enumerate practitioner photographs by walking ids, which
-- is a disclosure about which clinicians exist -- the same enumeration this product refuses everywhere
-- else (a hidden practitioner is a 404, not a refusal).
--
-- photo_updated_at is separate from the row's updated_at so "when did this person last change their
-- photograph" is answerable without inferring it from an unrelated profile edit.
--
-- ---- REMOVAL IS A DELETE OF THE OBJECT, NOT JUST OF THE PATH ---------------------------------------
--
-- Nulling this column alone would leave the image live at a URL anybody already holding it could still
-- open. practitioner-photo.ts deletes the storage object first and only then clears the column, so the
-- database can never claim a photograph is gone while the bytes are still served.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

alter table practice_practitioner_identity
  add column if not exists photo_path text;

alter table practice_practitioner_identity
  add column if not exists photo_updated_at timestamptz;

-- A PATH WITHOUT A TIME IS A PHOTOGRAPH NOBODY CAN DATE, and a time without a path is a record of an
-- image that is not there. Neither half is meaningful alone, so the pair is constrained to agree.
alter table practice_practitioner_identity
  drop constraint if exists practice_identity_photo_is_complete;

alter table practice_practitioner_identity
  add constraint practice_identity_photo_is_complete
  check ((photo_path is null and photo_updated_at is null)
      or (photo_path is not null and photo_updated_at is not null));

-- Verification: both columns exist with the right types, and the constraint is present.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'practice_practitioner_identity'
   and column_name in ('photo_path', 'photo_updated_at')
 order by column_name;

select conname
  from pg_constraint
 where conname = 'practice_identity_photo_is_complete';

notify pgrst, 'reload schema';
