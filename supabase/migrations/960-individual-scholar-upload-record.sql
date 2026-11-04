-- ====================================================================================================
-- MIGRATION 960: COMPETEN SCHOLAR -- THE RECORD OF AN UPLOAD IN FLIGHT (SCHOLAR-CE07C)
--
-- Owner directive LEARNING-CLOSE-2026-11 (4 Nov 2026), WS02 CE-07 and acceptance 6.5: interrupted uploads recover
-- safely without duplicate or corrupted material. Today nothing on the server records an upload between the signed
-- slot (POST uploads) and the material row (POST materials). So a finish retried after a lost response cannot tell
-- "already kept" or "still being read" from "never started", extraction can run twice for one upload, the size and
-- sha256 the browser had are not bound to the upload, and an object uploaded but never finished is found only by
-- listing storage. Docs: docs/evidence/SCHOLAR-CE07/upload-path-map.md.
--
-- WHAT IT ADDS. One table, individual_scholar_upload, one row per upload identity (id = the upload id = the id the
-- material will have). States: issued (slot given, bytes may be arriving), processing (one finish holds the claim),
-- kept (the material exists), refused (the finish refused it, with the learner-facing answer so a retry gets the
-- same one), cancelled (the learner cancelled), abandoned (nothing finished it within 24 hours, object removed).
-- It holds no study content: the declared type, size and sha256 of the bytes only. No change to any existing table,
-- column, policy, bucket or function. No backfill.
--
-- TIMES. issued_at and processing_started_at are written by the app and compared only with the app clock (a stale
-- claim is taken over after the 300 s the finish may run, plus a margin). They decide no grant.
--
-- ACCESS. RLS on, no policy: only the service role (the upload routes and the hourly clean-up job) reads or writes
-- it. The browser never sees a row.
--
-- FAIL SAFE WITHOUT IT. While 960 is absent the routes behave as before (isNotProvisioned): uploads still resume
-- and the finish is still idempotent by the material id, but a concurrent second finish may extract again and the
-- hourly clean-up does nothing (the per-person clean-up on the next upload still runs).
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 372 (profiles FK
-- pattern) and on the formats of 405/406 and the 25 MB cap of 413. Re-running it is a no-op. Rollback:
-- docs/evidence/SCHOLAR-CE07/ROLLBACK-960.sql (drops the table: in-flight uploads then finish as before 960).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

create table if not exists individual_scholar_upload (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  mime_type text not null,
  byte_size integer not null,
  sha256 text not null,
  state text not null default 'issued',
  issued_at timestamptz not null,
  processing_started_at timestamptz,
  settled_at timestamptz,
  refusal_status integer,
  refusal_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_scholar_upload drop constraint if exists individual_scholar_upload_mime_check;
alter table individual_scholar_upload add constraint individual_scholar_upload_mime_check
  check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain'));

-- The same 25 MB cap as the bucket and the material row (413).
alter table individual_scholar_upload drop constraint if exists individual_scholar_upload_size_check;
alter table individual_scholar_upload add constraint individual_scholar_upload_size_check
  check (byte_size > 0 and byte_size <= 26214400);

alter table individual_scholar_upload drop constraint if exists individual_scholar_upload_sha256_check;
alter table individual_scholar_upload add constraint individual_scholar_upload_sha256_check
  check (sha256 ~ '^[0-9a-f]{64}$');

alter table individual_scholar_upload drop constraint if exists individual_scholar_upload_state_check;
alter table individual_scholar_upload add constraint individual_scholar_upload_state_check
  check (state in ('issued', 'processing', 'kept', 'refused', 'cancelled', 'abandoned')
     and (state <> 'processing' or processing_started_at is not null)
     and ((state = 'refused') = (refusal_status is not null))
     and (refusal_message is null or (state = 'refused' and length(refusal_message) <= 600))
     and ((state in ('issued', 'processing')) = (settled_at is null)));

create index if not exists idx_individual_scholar_upload_user_sha256
  on individual_scholar_upload(user_id, sha256, state);
create index if not exists idx_individual_scholar_upload_state_issued
  on individual_scholar_upload(state, issued_at);

alter table individual_scholar_upload enable row level security;

comment on table individual_scholar_upload is
  'SCHOLAR-CE07C (migration 960). One upload identity in flight: issued, processing (the single finish claim), kept, refused, cancelled or abandoned. Holds the declared type, size and sha256 only, never study content. Service role only (RLS on, no policy). Settled rows are removed after 7 days by the hourly clean-up job.';
comment on column individual_scholar_upload.id is
  'The upload id, which is also the id of the material the finish creates. The object path is <user_id>/<id>.<ext>.';
comment on column individual_scholar_upload.sha256 is
  'The hex sha256 the browser computed before sending. The finish refuses bytes in storage that do not match it, before any extraction.';
comment on column individual_scholar_upload.refusal_message is
  'The learner-facing answer of a refused finish, so a retried finish (after a lost response) gets the same answer. Never a database or provider detail.';

notify pgrst, 'reload schema';
