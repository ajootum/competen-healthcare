-- ============================================================
-- MIGRATION 260: THE OFFLINE CACHE FLAG
-- CP offline phase one (docs/CP-OFFLINE-SURVEY-001.md)
--
-- ----------------------------------------------------------------------------------------------------
-- One seed row. No schema change -- phase one is a client-side cache over an endpoint that already
-- exists, and the only thing missing is the switch that decides whether any of it runs.
--
-- WARNING: default_on IS FALSE AND MUST STAY FALSE. This flag decides whether a copy of a clinic's
-- appointment list is written to a browser. A flag of that kind defaulting on is a decision taken for
-- every practice by whoever typed the migration.
--
-- UNTIL THIS ROW EXISTS THE FEATURE IS OFF FOR EVERYBODY, AND HONESTLY SO. flagState() answers
-- `unresolved / no_such_flag`, the gate withholds rather than guesses, nothing is written to any device,
-- and the flags page shows the key as wired-but-absent. That is the correct resting state and the reason
-- this migration is not urgent: the code shipped safe.
--
-- product_code is NULL because there is no `practice` row in plat_products. The `marketplace` flag sets
-- that precedent rather than this file inventing one.
--
-- WARNING: SEEDING THIS ROW DOES NOT TURN ANYTHING ON. With default_on false and no assignment, every
-- resolution still answers "off" -- what changes is that it answers off DELIBERATELY rather than because
-- the key is missing. A tenant-scoped rollout to a pilot practice is then an assignment row and no code
-- change. See the recorded decision: do not scope by tenant while one real workspace exists, and do not
-- gate on practice_session.trusted, which is false on every session because the device register minted a
-- new id per request until this week.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- including inside comments, which silently shredded two sections of migration 238 while the
-- editor still reported success.
-- ============================================================

-- ---- THE ROW ---------------------------------------------------------------------------------------
--
-- on conflict do nothing rather than an upsert: if somebody has already created this key and set it ON
-- for a pilot, re-running this file must not switch it back off underneath them.
insert into plat_feature_flags (key, description, default_on, product_code) values
  ('practice_offline_cache',
   'Competen Practice read-only offline cache: today''s appointment list held in the browser',
   false,
   null)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
