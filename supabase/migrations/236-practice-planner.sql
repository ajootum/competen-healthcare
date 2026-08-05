-- ============================================================
-- MIGRATION 236: PRACTICE PLANNER (CPR-V5-005)
--
-- ----------------------------------------------------------------------------------------------------
-- CPR-V5-005 replaces the appointment calendar with a PLANNER whose primary object is the activity, and
-- migration 232 already built that object. practice_activity has the type, the day, the window, the
-- place and the two timestamps that derive planned / running / done. The planner does not need a second
-- table -- it needs the things s5's actions have nowhere to write.
--
-- s5 lists eleven actions. Move, Duplicate, Split, Extend, Shorten and Change Location are all rewrites
-- of columns that already exist. Two are not:
--
--   CANCEL     CPR-CORE-001 s13: "deleted records should normally be voided or superseded rather than
--              physically removed". A cancelled clinic is not an absent clinic. Deleting the row would
--              take the audit trail's subject away with it, would silently orphan any encounter that
--              inherited it as context, and would leave a practitioner unable to answer "what happened
--              to Thursday" -- which is the exact question a cancellation raises.
--
--   ADD NOTES  s5's last action, and there is no column on practice_activity that holds a sentence.
--
-- WHY CANCELLATION IS A TIMESTAMP AND NOT A STATUS. Migration 232 refused a status column because a
-- stored state and a clock disagree the moment nobody clicks anything, and 235 repeated the argument for
-- pauses. The same reasoning holds here and gives the same shape: cancelled_at is null or it is the
-- instant the activity was called off, the state is DERIVED from it, and the row can say WHEN it was
-- cancelled rather than only that it was. A boolean cancelled flag could never answer that.
--
-- WHAT THIS MIGRATION DOES NOT ADD, so the omissions are decisions rather than oversights:
--
--   NO TARGET COLUMN. The design comp puts "Edit targets" on the Day Summary. Nothing in this product
--   stores a target for a practitioner's day, and a number invented here would be rendered back to them
--   as their own professional standard. It is not stored because it is not known.
--
--   NO MEASURED TRAVEL TIME. The comp shows "2h 45m Travel Time" on the week and "20m travel" on a day.
--   The only travel figure this product holds is practice_location.travel_buffer_minutes (migration
--   228), which is a number a practitioner TYPED. Summing typed buffers is arithmetic on stored inputs
--   and the planner does it. Storing the result as a measured distance would be a fabrication, and
--   src/lib/practice/hospital-booking.ts already refuses that claim by name.
--
--   NO NEW CAPABILITY CODE. Every write below is gated on appointment.manage (migration 192) and every
--   read on practice.home.view (migration 191) -- the codes migration 235 chose for the same lifecycle,
--   read out of those files rather than remembered. A capability code is a string compared against
--   practice_role_capabilities, and an invented one returns 403 for every user including the owner while
--   compiling perfectly. That has shipped in this codebase four times.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the migration runner splits the file on them and a semicolon inside a comment
-- cuts the statement it sits in half.
-- ============================================================

-- ---- 1. CANCELLATION, WHICH IS A VOID AND NOT A DELETE ---------------------------------------------

alter table practice_activity add column if not exists cancelled_at timestamptz;

-- WHO called it off, kept separate from practitioner_id for the reason migration 232 separates the
-- practitioner from the person typing: an assistant cancelling a consultant's Thursday is an ordinary
-- morning, and a row that only remembered whose day it was could never say who ended it.
alter table practice_activity add column if not exists cancelled_by uuid;

-- WHY, in the practitioner's words. Optional: most cancellations are obvious to the person making them,
-- and demanding a reason produces a column full of the word "cancelled". Kept because the week view has
-- to be able to say "Theatre list pulled" rather than only drawing a struck-through block.
alter table practice_activity add column if not exists cancellation_reason text;

-- ---- 2. NOTES (s5 "Add Notes") ---------------------------------------------------------------------
--
-- ONE COLUMN, NOT A NOTE LEDGER. A note here is the practitioner's standing annotation on a planned
-- block -- "bring the ultrasound", "Dr Okello covers the second half" -- not a clinical record and not a
-- conversation. practice_encounter holds what was found and practice_audit_event holds every change to
-- this field with its actor and instant, so the history a ledger would provide already exists in the
-- place a compliance question is asked.
alter table practice_activity add column if not exists notes text;

-- ---- 3. LINEAGE, SO A COPY AND A SPLIT ARE NOT ANONYMOUS -------------------------------------------
--
-- s5's Duplicate and Split both END WITH A NEW ROW, and without these the new row is indistinguishable
-- from one somebody typed. That matters twice: a practitioner looking at Thursday should be able to see
-- that it came from Tuesday, and a later reader trying to explain why a four-hour clinic is two
-- two-hour clinics has nothing else to go on. migration 230 gives practice_availability_template a
-- duplicated_from_id for exactly this reason and this follows it.
--
-- SET NULL rather than cascade, matching migration 232's rule for practice_encounter.activity_id:
-- deleting a source block must never take the blocks derived from it with it.
alter table practice_activity add column if not exists duplicated_from_id uuid
  references practice_activity(id) on delete set null;

alter table practice_activity add column if not exists split_from_id uuid
  references practice_activity(id) on delete set null;

-- ---- 4. THE CONSTRAINTS ----------------------------------------------------------------------------
--
-- DROP THEN ADD, because Postgres has no "add constraint if not exists" and a do-block is not available
-- here. The pair is idempotent and is the pattern migrations 203, 211, 222, 229 and 230 already use.

-- cancelled_at and cancelled_by travel together or not at all. Half a cancellation is a row that claims
-- a clinic was called off by nobody, which is the one thing a cancellation must always be able to say.
alter table practice_activity drop constraint if exists practice_activity_cancel_complete;
alter table practice_activity add constraint practice_activity_cancel_complete
  check ((cancelled_at is null and cancelled_by is null)
      or (cancelled_at is not null and cancelled_by is not null));

-- WARNING: A STARTED ACTIVITY CANNOT BE CANCELLED, AND THE DATABASE IS WHAT SAYS SO.
--
-- The engine refuses it with a sentence a practitioner can act on ("that clinic has begun -- end it
-- instead"), but the refusal has to hold against two tabs and against any later caller that forgets.
-- The reason is not tidiness: a clinic that ran is a clinic that happened, encounters may already point
-- at it as their context, and marking it cancelled would retroactively unmake the setting of a clinical
-- record. Cancelling is for a plan that will not take place. Ending is for one that did.
alter table practice_activity drop constraint if exists practice_activity_cancel_before_start;
alter table practice_activity add constraint practice_activity_cancel_before_start
  check (cancelled_at is null or started_at is null);

-- Lengths, matching the shapes already in the schema: 200 for a reason (migration 235's pause reason),
-- and 2000 for a note. Bounded rather than free: an unbounded text column on a row every day view reads
-- is how a single pasted document makes a week of planning slow for everybody.
alter table practice_activity drop constraint if exists practice_activity_cancellation_reason_len;
alter table practice_activity add constraint practice_activity_cancellation_reason_len
  check (cancellation_reason is null or char_length(cancellation_reason) between 1 and 300);

alter table practice_activity drop constraint if exists practice_activity_notes_len;
alter table practice_activity add constraint practice_activity_notes_len
  check (notes is null or char_length(notes) between 1 and 2000);

-- ---- 5. THE INDEX THE PLANNER ACTUALLY READS -------------------------------------------------------
--
-- Migration 232's idx_practice_activity_day covers one practitioner on one date. The planner asks for
-- SEVEN dates at once and, on every one of them, only for the blocks that are still happening -- a
-- cancelled clinic is drawn struck through in the week but is invisible to the conflict check, to the
-- workload arithmetic and to the travel chain. This is that read.
--
-- PARTIAL on cancelled_at is null. Cancellations accumulate and are never removed (that is the point of
-- voiding rather than deleting), so an index that kept them would grow forever against a query that
-- never wants them.
create index if not exists idx_practice_activity_live_week
  on practice_activity(workspace_id, practitioner_id, plan_date, planned_start_minute)
  where cancelled_at is null;

-- The struck-through half of the week view, and the only query that wants cancellations specifically.
create index if not exists idx_practice_activity_cancelled
  on practice_activity(workspace_id, practitioner_id, plan_date)
  where cancelled_at is not null;

-- ---- 6. RLS -----------------------------------------------------------------------------------------
--
-- Re-asserted rather than assumed. Idempotent, and no new table is introduced here: every column above
-- lands on practice_activity, whose deny-by-default posture and reasoning are in migration 232. Every
-- reader is a server engine holding the service role and a WorkspaceContext it has already checked --
-- see src/lib/practice/planner.ts.
alter table practice_activity enable row level security;

-- ---- 7. NO NEW DOMAIN EVENT TYPE -------------------------------------------------------------------
--
-- Migration 233's event_type CHECK is a closed catalogue and it has no activity.cancelled, activity.moved
-- or activity.split. Adding one here would be adding a name to a contract with consumers that do not
-- exist yet, and src/lib/practice/activity.ts sets the precedent the planner follows: planActivity emits
-- no domain event either and records the write in practice_audit_event alone. Every planner action does
-- the same, so a duplicated block and a hand-planned one announce themselves identically -- which is the
-- only arrangement in which a projection cannot come to disagree with the plan.

notify pgrst, 'reload schema';
