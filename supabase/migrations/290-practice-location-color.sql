-- 290 - THE CLINIC PLANNER COLOUR
-- The owner, 2026-08-12: Aga Khan and TMR hashed to neighbouring hues, and a practitioner should be
-- able to CHOOSE each clinic colour rather than live with the hash. One nullable column on the
-- location row the clinic already is.
--
-- NULL MEANS AUTOMATIC: the planner hashes the location id over its base palette, exactly as before
-- this migration. A chosen slot wins over the hash on every view at once, because all four planner
-- views resolve hues through one function reading one map.
--
-- THE CHECK MIRRORS LOCATION_COLOR_SLOTS in src/lib/practice/planner-constants.ts, which is the one
-- registry the migration, the engine validator, the settings picker and the palette all read. Adding
-- a colour later means extending BOTH in one commit.
--
-- House rules obeyed: ASCII only, plain idempotent statements, no plpgsql, no do blocks, no functions,
-- notify pgrst last, and NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT - INCLUDING INSIDE A COMMENT,
-- because the runner splits the file on semicolons and one inside a comment silently drops the
-- statements around it while still reporting Success. No rows returned.

alter table practice_location add column if not exists color_slot text;

alter table practice_location drop constraint if exists ck_practice_location_color_slot;

alter table practice_location add constraint ck_practice_location_color_slot
  check (color_slot is null or color_slot in ('indigo', 'emerald', 'teal', 'violet', 'sky', 'orange', 'rose', 'fuchsia', 'lime', 'cyan'));

notify pgrst, 'reload schema';
