-- ============================================================
-- MIGRATION 365: WHERE A LOCATION ACTUALLY IS (CPR-BOOK-FLOW-002 s13, CPR-BOOK-PROFILE-001 s8)
--
-- s13: "Offer directions/location details when configured." Nothing was configurable: practice_location
-- has a name, a type and a country, and on the live practice every country is null. A patient could be
-- told they are seen at "Nsambya Hospital" and nothing more.
--
-- ---- TWO COLUMNS, AND THE SECOND IS THE ONE THAT MATTERS FOR SAFETY ------------------------------
--
-- address    what a practice would write on a letterhead. Shown as text, and used to build a maps
--            search when no exact link is set.
-- map_url    an EXACT link the practice chose. A search for an address is a guess -- two clinics share
--            a name, a street repeats in another town -- and the wrong guess sends a sick person to the
--            wrong building. Where a practice pins the exact place, that link wins.
--
-- ---- THE URL IS CONSTRAINED, BECAUSE IT IS RENDERED TO STRANGERS ----------------------------------
--
-- This value ends up as an anchor on a public booking confirmation, so the database refuses anything
-- that is not https. A practice can already write prose on its own booking page, so this is not a new
-- trust boundary -- but a column whose only legitimate content is one shape should not accept another,
-- and 'javascript:' in a link on a patient's screen is not a thing to leave to a form validator.
--
-- Both nullable, no defaults. A location with no address shows no directions, and nothing is invented.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

alter table practice_location
  add column if not exists address text;

alter table practice_location
  add column if not exists map_url text;

alter table practice_location
  drop constraint if exists practice_location_address_check;

alter table practice_location
  add constraint practice_location_address_check
  check (address is null or char_length(btrim(address)) between 1 and 400);

alter table practice_location
  drop constraint if exists practice_location_map_url_check;

alter table practice_location
  add constraint practice_location_map_url_check
  check (map_url is null or (map_url like 'https://%' and char_length(map_url) between 12 and 600));

-- Verification: both columns exist and are nullable, and both constraints are present.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'practice_location'
   and column_name in ('address', 'map_url')
 order by column_name;

select conname
  from pg_constraint
 where conname in ('practice_location_address_check', 'practice_location_map_url_check')
 order by conname;

notify pgrst, 'reload schema';
