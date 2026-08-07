-- ============================================================
-- MIGRATION 253: THE OTP CHALLENGE LEARNS WHERE A REQUEST CAME FROM
-- CPR-V5-007 s8.1 ("OTP verification and abuse protection"), IAM-000 s7
--
-- ----------------------------------------------------------------------------------------------------
-- THIS SWITCHES ON A CONTROL THAT IS ALREADY WRITTEN AND CURRENTLY REFUSES.
--
-- src/lib/practice/messaging.ts issueOtp() already reads a per-source count and already writes a
-- source_hash on the challenge it inserts. Both halves exist. Neither works, because migration 224 did
-- not anticipate an unauthenticated caller and gave practice_otp_challenge no column to hold a source --
-- so the read errors, and the engine returns SOURCE_LIMIT_UNAVAILABLE and issues nothing.
--
-- That refusal is correct and deliberate: "An unrecorded source is an unlimited one." The per-DESTINATION
-- limit cannot see the abuse this one exists for -- one caller walking a list of a thousand numbers looks
-- untouched from every individual number's point of view. Rather than degrade quietly to a limit that is
-- not running, the engine refuses. This column is the only thing standing between that refusal and a
-- working control, which is why it is alone in its own file: it has no dependencies, it is worth having
-- on its own, and it must not wait behind the booking work.
--
-- WARNING: THIS IS A HASH, AND THE CONSTRAINT BELOW IS WHAT KEEPS IT ONE.
--
-- A source is an IP address, a device cookie or whatever the edge can be trusted to give. Every one of
-- those is personal data about a person who has not signed in and may never book anything. messaging.ts
-- hashSource() computes sha256('otp-source:' || key) and the caller's raw value never reaches a query, a
-- log or a column. The check constraint refuses anything that is not 64 lowercase hex characters, so the
-- obvious future shortcut -- "just store the IP, it is easier to debug" -- fails at the database rather
-- than turning a rate-limit key into a register of who visited a booking page and when.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. THE COLUMN ---------------------------------------------------------------------------------
--
-- NULLABLE, because most challenges have no source and must not pretend to. A sign-in code issued from
-- an authenticated session has a user behind it and needs no source limit -- issueOtp writes this column
-- ONLY when the caller asked to be limited by source, and a NOT NULL with a sentinel would make every
-- unsourced challenge look like it shared one source with all the others, which is the same key
-- colliding for a million unrelated people.
alter table practice_otp_challenge add column if not exists source_hash text;

-- 64 lowercase hex characters, or nothing. See the header: this refuses an address wearing a hash's
-- column name.
alter table practice_otp_challenge drop constraint if exists practice_otp_challenge_source_hash_is_a_hash;
alter table practice_otp_challenge add constraint practice_otp_challenge_source_hash_is_a_hash
  check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$');

-- ---- 2. THE INDEX THE LIMIT READS THROUGH ----------------------------------------------------------
--
-- issueOtp counts with .eq("source_hash", h).gte("created_at", since), so the column order here is the
-- order that query needs: equality first, then the range. Descending on created_at because the window is
-- always the recent end of it.
--
-- PARTIAL, because the equality is always on a real hash and the null rows are the overwhelming
-- majority. Indexing them would grow the index for a value no query ever asks for.
create index if not exists idx_practice_otp_source
  on practice_otp_challenge(source_hash, created_at desc)
  where source_hash is not null;

-- ---- 3. RLS ----------------------------------------------------------------------------------------
--
-- Already enabled by 224 and re-asserted rather than assumed. A challenge register readable by an
-- authenticated stranger is a list of who has been sent a code, and by which practice.
alter table practice_otp_challenge enable row level security;

notify pgrst, 'reload schema';
