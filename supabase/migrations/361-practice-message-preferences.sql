-- ============================================================
-- MIGRATION 361: PER-MESSAGE-TYPE COMMUNICATION PREFERENCES (CPR-SET-COMMS-001 s7)
--
-- One jsonb column on the channel row, keyed by message type -- 'booking_confirmation',
-- 'cancellation_notice', 'rescheduling_notice' -- with boolean values. AN ABSENT KEY MEANS ON.
-- The default posture is that a patient is told what happened to their appointment, and a practice
-- switches a message OFF as a deliberate recorded act, so no backfill is needed and every existing
-- practice keeps exactly the behaviour it has today.
--
-- REQUIRED MESSAGE TYPES HAVE NO KEY HERE AT ALL. Booking verification codes are a booking
-- dependency, and the send path that issues them never consults this column -- "verification off"
-- is unrepresentable rather than merely forbidden, per the s7 requirement that the UI cannot
-- disable a dependency online booking needs.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql.
-- ============================================================

alter table practice_message_channel
  add column if not exists message_preferences jsonb not null default '{}'::jsonb;

-- Verification: the column exists, is jsonb, refuses null, and defaults to the empty object.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'practice_message_channel'
   and column_name = 'message_preferences';

notify pgrst, 'reload schema';
