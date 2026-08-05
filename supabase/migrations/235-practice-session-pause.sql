-- ============================================================
-- MIGRATION 235: SESSION PAUSE AND RESUME (CPR-V5-004 "Session Lifecycle", CPR-CORE-001 s6.2)
--
-- ----------------------------------------------------------------------------------------------------
-- CPR-V5-004 gives the session six rungs -- Start, Run, Pause, Resume, Close, Generate Summary -- and
-- this build had two of them. practice_activity.started_at and ended_at express planned, running and
-- finished, and nothing in the schema could express "running, but not right now". So a clinic broken by
-- lunch, a ward round interrupted by theatre, or a session left open over a coffee all kept burning
-- through the progress bar and the time-remaining figure, and the practitioner read a number that was
-- wrong by exactly the length of the interruption.
--
-- A PAUSE IS AN INTERVAL, NOT A STATUS, and that is the whole design.
--
-- Migration 232 refused a status column on practice_activity because a stored state and a clock disagree
-- the moment nobody clicks anything. A 'PAUSED' status would repeat that mistake with interest: it says
-- that a session is paused but not since when, so the minutes lost to the pause cannot be recovered from
-- it, and a session left paused overnight would still read PAUSED in the morning with no way to tell how
-- much of the night to discount. Storing the two ends of the interval instead means the state is still
-- DERIVED -- an activity is paused exactly when it has a pause row with no resumed_at -- and the
-- arithmetic that has to come out of the session's clock is sitting right there in the same rows.
--
-- WHY ITS OWN TABLE RATHER THAN paused_at AND resumed_at ON practice_activity. A session can be paused
-- more than once. Two columns hold the most recent pause and silently forget the first, so a clinic
-- interrupted twice would have half its lost time counted -- and a half-corrected number is worse than
-- an uncorrected one, because nothing about it looks wrong.
--
-- THIS IS THE SESSION-LEVEL TWIN OF MIGRATION 234. s6.2 says "interruption time must not be counted as
-- active consultation time" of an encounter. The same sentence one rung up is that interruption time
-- must not be counted as elapsed session time, and 234 solved it for the encounter by reading the
-- transition log. The session has no transition log, so it gets this ledger.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except at the end of
-- a statement -- the migration runner splits on them and a semicolon inside a comment cuts the file
-- mid-sentence.
-- ============================================================

-- ---- 1. The pause ledger ---------------------------------------------------------------------------

create table if not exists practice_activity_pause (
  id uuid primary key default gen_random_uuid(),

  -- Denormalised from the activity so that every read, sweep and tenancy check on this table looks like
  -- every other one in the schema. Without it, "all pauses in this practice" is a join, and the drift
  -- tools that sweep for workspace_id would not see this table at all.
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- CASCADE, unlike migration 234's interrupted_by_id. A pause is not an independent fact: it is a hole
  -- in one session's clock, and with the session gone there is no clock for it to be a hole in. The
  -- clinical record made during the session is a different row and is not touched by this.
  activity_id uuid not null references practice_activity(id) on delete cascade,

  paused_at timestamptz not null default now(),

  -- NULL MEANS OPEN, and that is the only way this table says "paused right now". Deriving it from a
  -- null keeps the state honest for the same reason 232 kept started_at and ended_at: nothing has to be
  -- kept in step by a background job, and a session paused and forgotten still reports exactly how long
  -- it has been paused rather than a stale label.
  resumed_at timestamptz,

  -- WHY, in the practitioner's words. Optional, because most pauses are somebody stepping out and
  -- demanding a reason would only produce a table full of the word "break". Kept because "Session
  -- Summary" is one of CPR-V5-004's components and a summary that can say "paused 35 min for theatre"
  -- is worth more than one that says "paused 35 min".
  reason text check (reason is null or char_length(reason) between 1 and 200),

  -- WHO stopped and who restarted. Separate columns rather than one actor: a session paused by the
  -- practitioner and resumed by an assistant is an ordinary morning, and collapsing the two would lose
  -- the only fact that distinguishes it from a session nobody else touched.
  paused_by uuid not null,
  resumed_by uuid,

  created_at timestamptz not null default now(),

  -- A pause that ends before it begins would subtract negative time from the session clock, which is to
  -- say it would ADD time, which is the one direction this feature must never move a number.
  constraint practice_activity_pause_not_backwards
    check (resumed_at is null or resumed_at >= paused_at),

  -- resumed_by and resumed_at travel together or not at all. Half a resume is a row that claims somebody
  -- restarted a session that is still stopped.
  constraint practice_activity_pause_resume_complete
    check ((resumed_at is null and resumed_by is null) or (resumed_at is not null and resumed_by is not null))
);

-- ---- 2. AT MOST ONE OPEN PAUSE PER ACTIVITY --------------------------------------------------------
--
-- Enforced by the database rather than by the engine alone, for the reason migrations 232 and 234 both
-- give: two browser tabs each read "not paused" and both insert, and the session then has two open
-- intervals whose minutes are counted twice. A session that overlapped itself would report more paused
-- time than it has been running, and the progress bar would run backwards.
--
-- WARNING: THIS IS A PARTIAL INDEX, SO POSTGREST UPSERT CANNOT TARGET IT. `onConflict` needs a
-- non-partial unique constraint and fails at runtime, not at compile time, when pointed at this one.
-- Resuming is an UPDATE against the open row by activity, never an upsert, and it must stay that way.
-- The same trap is recorded in 232 and 234.
create unique index if not exists uq_practice_activity_pause_one_open
  on practice_activity_pause(activity_id)
  where resumed_at is null;

-- The only read this table has: every pause for one session, oldest first, to be summed and subtracted.
create index if not exists idx_practice_activity_pause_activity
  on practice_activity_pause(activity_id, paused_at);

-- The practice-wide sweep, for the summary and for any later reconciliation of sessions against the
-- events that describe them.
create index if not exists idx_practice_activity_pause_workspace
  on practice_activity_pause(workspace_id, paused_at desc);

-- ---- 3. RLS: deny-by-default -----------------------------------------------------------------------
--
-- No policies, matching practice_activity. Every reader of this table is a server engine holding the
-- service role and a WorkspaceContext it has already checked -- see src/lib/practice/activity.ts.
alter table practice_activity_pause enable row level security;

-- ---- 4. NO NEW CAPABILITY CODE ---------------------------------------------------------------------
--
-- Pausing and resuming are gated on `appointment.manage` (migration 192), the same code that already
-- gates starting and ending -- they are rungs of one lifecycle and splitting them would create a role
-- that can start a clinic and cannot stop it. Reading a summary is gated on `practice.home.view`
-- (migration 191). Both are read out of those migrations rather than remembered: a capability code is a
-- string compared against practice_role_capabilities, and an invented one disables the feature silently
-- for every user including the owner. That has shipped in this codebase three times.

notify pgrst, 'reload schema';
