-- ============================================================
-- MIGRATION 232: CURRENT ACTIVITY (CPR-V3-001 s2/s4, CPR-V3-002 "Today's Work")
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE THING V3 TURNS THE PRODUCT AROUND, AND THE ONE PIECE OF IT THAT DID NOT EXIST.
--
-- CPR-V3-001 s"Core Workflow Principles": "Everything begins from the practitioner's current context"
-- and "Appointments are inputs, not the centre of the system". Today this application has no idea what
-- a practitioner is DOING at any moment -- it knows what is booked, which is a different question. So
-- s6 ("every encounter inherits the current activity, location, hospital and practitioner context
-- automatically") has nothing to inherit FROM.
--
-- This table is that context: the planning hierarchy's last two rungs, Today's Plan and Current Activity.
--
-- NOT practice_clinical_activity. That table is a RETROSPECTIVE portfolio record -- what I did, with CPD
-- minutes and a participation role, written after the fact as evidence. This one is live and forward
-- looking, and conflating them would mean either a portfolio full of half-finished ward rounds or a
-- "current activity" that only appears once it is over.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists practice_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- WHOSE DAY THIS IS, not who typed it. A receptionist building tomorrow's plan for a consultant must
  -- not end up owning the consultant's day -- the same distinction migration 209 draws with performed_by.
  practitioner_id uuid not null,

  -- CPR-V3-001 s4's list, exactly. A type not on it is a type no screen knows how to draw.
  activity_type text not null check (activity_type in (
    'outpatient_clinic', 'ward_round', 'theatre', 'emergency_consult',
    'virtual_clinic', 'telephone_review', 'administration', 'teaching')),

  title text not null check (char_length(title) between 1 and 200),

  -- WHERE. Both nullable and both kept: a ward round has a hospital and no consulting room, a telephone
  -- review has neither, and administration may be at a desk that is not a practice location at all.
  facility_id uuid references practice_facility(id) on delete set null,
  location_id uuid references practice_location(id) on delete set null,
  room text check (room is null or char_length(room) between 1 and 80),

  -- ---- THE PLAN ----------------------------------------------------------------------------------
  --
  -- Local wall-clock minutes from midnight, which is migration 229's convention for practice hours and
  -- is kept here for the same reason: 08:30 clinic means half past eight where the clinic is, and
  -- storing an instant would move it every time the offset changed.
  plan_date date not null,
  planned_start_minute integer not null check (planned_start_minute between 0 and 1440),
  planned_end_minute integer not null check (planned_end_minute between 0 and 1440),

  -- ---- WHAT ACTUALLY HAPPENED --------------------------------------------------------------------
  --
  -- NO STATUS COLUMN. "In progress" is derived from these two timestamps, never stored, because a stored
  -- status and a clock disagree the moment nobody clicks anything -- a clinic that ran late would still
  -- read "In Progress" the next morning, and Today's Timeline would be confidently wrong. Planned,
  -- running and finished are the three states these two nulls already express.
  started_at timestamptz,
  ended_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint practice_activity_window check (planned_end_minute > planned_start_minute),
  constraint practice_activity_ended_after_start check (ended_at is null or started_at is not null),
  constraint practice_activity_not_backwards check (ended_at is null or ended_at >= started_at)
);

-- ---- ONE ACTIVITY AT A TIME, ENFORCED BY THE DATABASE -----------------------------------------------
--
-- CPR-V3-001 s4: "Only one activity is active at a time." Enforced here rather than in the engine
-- because two browser tabs, or a switch racing a start, would each read "nothing running" and both
-- insert -- and every screen downstream is built on there being exactly one answer to "what am I doing".
--
-- ⚠️ THIS IS A PARTIAL INDEX, SO POSTGREST UPSERT CANNOT TARGET IT. `onConflict` needs a non-partial
-- unique constraint; pointed at this one it fails at runtime rather than at compile time. The engine
-- must end the running activity and then insert, never upsert. See src/lib/practice/activity.ts.
create unique index if not exists uq_practice_activity_one_running
  on practice_activity(workspace_id, practitioner_id)
  where started_at is not null and ended_at is null;

-- The day view, which is every read this table has: one practitioner, one date, in clock order.
create index if not exists idx_practice_activity_day
  on practice_activity(workspace_id, practitioner_id, plan_date, planned_start_minute);

-- ---- ENCOUNTERS INHERIT THE CONTEXT -----------------------------------------------------------------
--
-- CPR-V3-001 s6. Nullable, because every encounter recorded before this migration has no activity to
-- point at and inventing one would be fabricating a context nobody was in. `set null` rather than
-- cascade: deleting a mis-typed plan entry must not delete the clinical record made during it.
alter table practice_encounter add column if not exists activity_id uuid
  references practice_activity(id) on delete set null;

create index if not exists idx_practice_encounter_activity
  on practice_encounter(activity_id) where activity_id is not null;

-- ---- RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_activity enable row level security;

notify pgrst, 'reload schema';
