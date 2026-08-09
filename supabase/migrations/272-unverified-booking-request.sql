-- ============================================================
-- MIGRATION 272: THE UNVERIFIED BOOKING REQUEST, THE PRACTICE'S QUEUE FOR IT, AND THE MARK IT CARRIES
-- CPR-V5-007 s8.1, s9, s12
--
-- WARNING: THIS MIGRATION CHANGES THIS PRODUCT'S SECURITY POSTURE, AND IT IS THE OWNER'S DECISION.
--
-- issueOtp refuses outright in a deployment with no SMS gateway and no mail provider, so no patient can
-- verify and therefore no patient can book. The owner was told plainly what the alternative costs -- an
-- unverified stranger can ask for a slot -- and chose to make verification CONFIGURABLE per practice.
-- Everything below exists to bound that choice rather than to make it invisible.
--
-- THE FIVE PROPERTIES THIS FILE PUTS IN THE DATABASE RATHER THAN IN AN ENGINE
--
--   1. THE DOOR IS SHUT UNTIL SOMEBODY OPENS IT. unverified_requests_allowed defaults FALSE. A migration
--      whose default opens a door is a door nobody chose to open, and every practice on this platform
--      would have been opted in by a deployment nobody attended.
--   2. THE MARK CANNOT BE FORGED, BECAUSE NOTHING MAY WRITE IT. verification_state is GENERATED ALWAYS,
--      derived from the two columns that record the proof itself. There is no insert, no update and no
--      backfill that can set it, so a request cannot claim a verification it does not carry.
--   3. AN UNVERIFIED REQUEST IS NEVER A BOOKING. It may not reach status verified or booked, may not
--      name an appointment, and may not name a slot. The constraint is what makes that true whatever any
--      future call path believes.
--   4. AN UNVERIFIED REQUEST HOLDS NOTHING. slot_id is refused on those rows, so nothing computing free
--      time can find one. Two people may ask for the same time and the practice decides.
--   5. A REQUEST NOBODY CAN RING IS NOT A REQUEST. A row with no challenge behind it must carry a phone
--      or an inbox, checked with btrim so that a string of spaces is not an answer.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ====================================================================================================
-- 1. THE CONFIGURATION, ON THE BOOKING PAGE, DEFAULTING TO REQUIRING VERIFICATION
-- ====================================================================================================
--
-- WARNING: THIS IS NOT otp_required AND IT MUST NOT BE CONFUSED WITH IT.
--
-- otp_required governs BOOKING, and practice_booking_access_publishable still refuses to publish a page
-- with it false. That constraint is untouched: a booking that becomes an appointment with no practitioner
-- approval step still needs a verified person behind it, and nothing here weakens that.
--
-- This column governs something the product did not have before -- an unverified REQUEST, which becomes
-- no appointment, holds no time and is a message to the practice. The two are separate columns because
-- they are separate decisions, and collapsing them would let a practice that wanted to accept messages
-- accidentally open its diary.
--
-- The two lifecycle columns exist so that opening the door is visible as an act somebody performed on a
-- date, not merely as a boolean that has always been whatever it is now.

alter table practice_booking_access
  add column if not exists unverified_requests_allowed boolean not null default false;

alter table practice_booking_access
  add column if not exists unverified_requests_allowed_at timestamptz;

alter table practice_booking_access
  add column if not exists unverified_requests_allowed_by uuid;

-- ====================================================================================================
-- 2. THE MARK, GENERATED SO THAT NOTHING CAN WRITE IT
-- ====================================================================================================
--
-- WARNING: A FLAG SOMEBODY SETS IS A FLAG SOMEBODY FORGETS TO SET.
--
-- The obvious shape is a plain column defaulting to 'unverified', backfilled once. It works until the
-- second write path, which sets it wrongly or not at all -- and the failure is silent, because a row that
-- says 'verified' looks exactly like one that is.
--
-- So it is DERIVED from the proof rather than asserted beside it. migration 254 already refuses a booked
-- request that cannot name the challenge that verified it and the moment it was verified. Those two
-- columns ARE the verification, so the mark is computed from them and there is no statement anywhere that
-- can make a row say something its own columns do not support.
--
-- It is STORED rather than VIRTUAL so it can be selected, indexed and grouped like any other column, and
-- so a practice-facing list pays nothing to show it.

alter table practice_booking_request
  add column if not exists verification_state text
  generated always as (
    case when challenge_id is not null and verified_at is not null
      then 'verified'::text else 'unverified'::text end
  ) stored;

-- ====================================================================================================
-- 3. WHAT THE PRACTICE DOES WITH ONE
-- ====================================================================================================
--
-- A queue with nothing to take a row out of it is a queue that grows for ever, and the screen reading it
-- becomes useless in a fortnight. These four columns are the smallest honest way to close a request:
-- somebody, at a time, with an outcome from a closed list, and optionally a sentence.
--
-- WARNING: HANDLING ONE IS NOT BOOKING ONE. There is no appointment_id here and there is no verb that
-- writes one. A practice that decides to see this person books them the ordinary way, in the diary, where
-- every rule and the exclusion constraint apply -- because that is a booking, and this was a message.

alter table practice_booking_request
  add column if not exists handled_at timestamptz;

alter table practice_booking_request
  add column if not exists handled_by uuid;

alter table practice_booking_request
  add column if not exists handled_outcome text;

alter table practice_booking_request
  add column if not exists handled_note text;

-- ====================================================================================================
-- 4. THE CONSTRAINTS
-- ====================================================================================================
--
-- WARNING: EVERY ONE IS WRITTEN OVER THE BASE COLUMNS, NOT OVER verification_state. A check constraint
-- referencing a generated column is a restriction that differs between server versions, and the
-- derivation is deterministic, so the two spellings mean the same thing and only one of them is portable.

-- AN UNVERIFIED REQUEST IS A REQUEST. It may not claim the code was entered, may not become a booking,
-- may not name an appointment and may not name a slot.
--
-- Every row written before this migration carries both a challenge and a verification time -- the only
-- insert that has ever existed sets them together -- so every one of them satisfies the first disjunct
-- and this constraint validates against live data without touching it.
alter table practice_booking_request drop constraint if exists practice_booking_request_unverified_holds_nothing;
alter table practice_booking_request add constraint practice_booking_request_unverified_holds_nothing
  check ((challenge_id is not null and verified_at is not null)
      or (status not in ('verified', 'booked')
          and appointment_id is null and slot_id is null));

-- A REQUEST NOBODY CAN ANSWER IS NOT A REQUEST. btrim, because a column that is merely not null is
-- satisfied by a space.
alter table practice_booking_request drop constraint if exists practice_booking_request_unverified_is_contactable;
alter table practice_booking_request add constraint practice_booking_request_unverified_is_contactable
  check (challenge_id is not null
      or btrim(coalesce(contact_phone, '')) <> ''
      or btrim(coalesce(contact_email, '')) <> '');

-- HANDLED MEANS ALL THREE OR NONE. A time with no outcome is a row somebody touched and nobody can read
-- afterwards, and an outcome with no actor is a decision nobody owns.
alter table practice_booking_request drop constraint if exists practice_booking_request_handled_is_complete;
alter table practice_booking_request add constraint practice_booking_request_handled_is_complete
  check ((handled_at is null and handled_by is null and handled_outcome is null)
      or (handled_at is not null and handled_by is not null
          and handled_outcome in ('contacted', 'unreachable', 'declined', 'duplicate')));

alter table practice_booking_request drop constraint if exists practice_booking_request_handled_note_shape;
alter table practice_booking_request add constraint practice_booking_request_handled_note_shape
  check (handled_note is null
      or (btrim(handled_note) <> '' and char_length(handled_note) <= 500));

-- ====================================================================================================
-- 5. THE INDEXES THE RATE LIMIT AND THE QUEUE READ
-- ====================================================================================================
--
-- WARNING: THE FIRST ONE IS HALF OF A CONTROL AND IS USELESS WITHOUT THE OTHER HALF. messaging.ts records
-- the lesson in its own words: a limit that reads a column nothing writes counts nought for ever. The
-- engine below WRITES source_hash on every unverified request and REFUSES when it cannot, so this index
-- serves a count that is actually counting something.
create index if not exists idx_practice_booking_request_source_recent
  on practice_booking_request(source_hash, created_at desc) where source_hash is not null;

create index if not exists idx_practice_booking_request_unhandled
  on practice_booking_request(workspace_id, created_at desc) where handled_at is null;

alter table practice_booking_access enable row level security;
alter table practice_booking_request enable row level security;

notify pgrst, 'reload schema';
