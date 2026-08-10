-- 285 - SWITCH ON THE OFFLINE CACHE
-- CP-OFFLINE-SURVEY-001 s3.7 and s3.8.6. One row. No table, no column, no constraint.
--
-- ====================================================================================================
-- WHY THIS EXISTS: THE FEATURE HAS BEEN BUILT AND SWITCHED OFF SINCE THE DAY IT SHIPPED.
--
-- offline-gate.ts reads plat_feature_flags for practice_offline_cache. There has never been a row, so
-- flagState answers unresolved, and offline-gate withholds -- fail closed, which was the correct state
-- on day one and is the reason nobody has ever seen the feature. The route handler says in writing that
-- the seeding migration was deliberately not written yet. This is it.
--
-- ====================================================================================================
-- !! IT IS GLOBAL, AND NOT THE TENANT-SCOPED PILOT THE SURVEY ASKED FOR, BECAUSE THAT PILOT CANNOT BE
-- EXPRESSED. THIS IS A FINDING, NOT A SHORTCUT.
--
-- Survey decision 12 asks which practice gets the tenant-scoped rollout first. Probed live before
-- writing this: gateFor() derives its tenant from profiles.tenant_id, which is the ESTATE tenant. A
-- Competen Practice user is admitted through gate 2 and has no estate tenant -- the one live practice
-- member has tenant_id NULL. So a tenant-scoped assignment can never match a practice user, and there is
-- no per-practice scope anywhere in the platform flag engine.
--
-- That is the two-gate split showing through: plat_feature_flags is landlord-plane machinery and
-- Competen Practice is a tenant-plane product. Giving the flag engine a practice_workspace scope is real
-- work and it is not this migration.
--
-- WHAT MAKES GLOBAL ACCEPTABLE TODAY, stated so it can be checked rather than believed: there are TWO
-- practice workspaces in existence, Trial and Dr Lifecycle, and both belong to the same two accounts.
-- Public signup is closed by the owners decision. The blast radius is the owner and one test account.
--
-- !! AND WHAT MUST BE REVISITED BEFORE THAT STOPS BEING TRUE. default_on true means a practice that
-- signs up later gets offline caching switched on without anybody deciding it should. Before the first
-- real practice exists, either give the flag engine a practice scope, or set this to false and enable
-- per practice. The only per-practice control that works today is
-- practice_configuration.feature_flags.offline_cache, and it is a REFUSAL switch -- absent is not off,
-- only an explicit false refuses, and only a refusal purges the device.
--
-- ====================================================================================================
-- WHAT SWITCHING THIS ON ACTUALLY DOES, so the change is not larger than it reads.
--
-- It permits a COPY of two things to be held in the browser: the days appointment list, and the
-- practices published guidance. Both are read only. Nothing offline accepts input -- the phase one
-- harness asserts that the number of enabled controls that could change a record is zero. The clinic day
-- is deleted at the end of that day and the guidance after seven days, evaluated on every read, deleted
-- rather than hidden.
--
-- It does NOT switch on offline capture. Nothing in this product captures offline yet.
--
-- House rules obeyed: ASCII only, plain idempotent statements, no plpgsql, no do blocks, notify pgrst
-- last, and NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT - INCLUDING INSIDE A COMMENT.
-- ====================================================================================================

insert into plat_feature_flags (key, description, default_on, product_code)
values (
  'practice_offline_cache',
  'Competen Practice: hold a read-only copy of the day list and published guidance on the device, for use without a connection. Read only. Expires and self-deletes.',
  true,
  'practice'
)
on conflict (key) do update
  set description = excluded.description,
      default_on = excluded.default_on,
      product_code = excluded.product_code;

notify pgrst, 'reload schema';
