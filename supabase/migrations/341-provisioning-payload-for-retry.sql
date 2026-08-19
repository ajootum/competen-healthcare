-- Migration 341: persist the provisioning payload so a retry can be faithful (CPR-PD-014 section 8.3)
--
-- ============================ THE GAP THIS CLOSES ============================
--
-- Section 8.3 asks for a server-side recovery operation that "reuses the original request payload and
-- idempotency identity". provisioning_request records payload_HASH and not the payload, so today there
-- is nothing to reuse. A hash proves two requests were the same. It cannot rebuild either of them.
--
-- Measured in src/lib/practice/provisioning.ts before writing this: the payload is read in three places
-- after the run begins --
--
--   create_workspace       name, country, timezone, default practice type, profession, specialty
--   create_configuration   locale
--   issue_identity         display name
--
-- so a resumed run that has lost the payload can only guess. Two of those are partially recoverable
-- from the workspace row itself, and locale is not recoverable at all when the failure happened AT
-- create_configuration -- which is one of the steps most likely to fail.
--
-- !! RECONSTRUCTING IT FROM THE WORKSPACE WOULD BE THE WRONG FIX, and worth saying plainly because it
-- is the tempting one. It works for the fields the workspace happens to carry and silently invents the
-- rest, which turns a recovery operation into a quiet data-entry step performed by nobody.
--
-- ============================ WHAT IS STORED, AND WHAT IS NOT ============================
--
-- The individual provisioning request only: display name, country, timezone, profession, specialty,
-- practice type, locale and the terms/privacy versions accepted. It is practitioner setup data, and it
-- is exactly what the operator typed into the provisioning console.
--
-- !! NO PATIENT DATA CAN REACH THIS COLUMN, because provisioning runs before a practice has any. And
-- nothing here widens what the Product Operations plane may READ -- the plane boundary governs that
-- separately, and this column is not added to any allowlist by this migration.
--
-- ============================ EXISTING ROWS STAY NULL, DELIBERATELY ============================
--
-- No backfill. A request provisioned before this column existed has no payload and must READ as having
-- none, so the retry path can refuse rather than resume from a reconstruction. Section 13: report the
-- dependency instead of inventing behaviour. A backfill would put invented values behind a real-looking
-- column and remove the only signal that they were invented.

alter table provisioning_request
  add column if not exists payload jsonb;

comment on column provisioning_request.payload is
  'The individual provisioning request as submitted, for faithful retry (CPR-PD-014 section 8.3). Null on rows created before migration 341, where a retry must refuse rather than reconstruct.';

notify pgrst, 'reload schema';
