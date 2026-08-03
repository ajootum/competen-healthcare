-- ============================================================
-- MIGRATION 196: FOLLOW-UP MANAGEMENT (CPR-140, PEN-004, CPR-BUILD-000 Phase 4)
--
-- The obligation loop: due -> overdue -> scheduled -> closed. CPR-BUILD-000 calls Phases 0-4 "the
-- smallest honest product exists milestone: one practitioner can run a diary, register patients, record
-- encounters and CLOSE FOLLOW-UPS". This is the fourth.
--
-- A FOLLOW-UP IS A COMMITMENT, NOT A REMINDER. It is created at an encounter, by a practitioner, about a
-- named clinical thing -- "review this ulcer in two weeks", "chase the biopsy". That is why it carries an
-- origin encounter, an optional problem or diagnosis, and a reason in words. A generic task list would
-- have been half the code and would have recorded none of that, and a follow-up nobody can trace back to
-- a clinical decision is a note-to-self, not part of the record.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- OVERDUE IS NOT A STATUS. THIS IS THE MOST IMPORTANT DECISION IN THE FILE.
--
-- The obvious design gives status an OVERDUE value and runs something nightly to set it. That design has
-- a failure mode which is exactly backwards: if the job does not run -- no cron, a suspended tenant, a
-- practice that does not open the app for a week -- then nothing is overdue. The screen that exists to
-- say "these people are waiting on you" goes quietest precisely when the practice has been least
-- attentive.
--
-- So `status` holds ONLY what a human decided, and overdue is DERIVED from due_on against the clock at
-- read time. It cannot be stale, cannot be forgotten, and needs nothing to run.
--
-- MISSED IS STILL A STATUS, and it is a different thing from overdue. Overdue is a fact about the
-- calendar. MISSED is a judgement -- "we tried, they did not come, we are no longer chasing this" --
-- and a judgement belongs to the person who made it, with their name and the time on it.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- CANCELLING AN APPOINTMENT MUST RELEASE THE FOLLOW-UP IT WAS BOOKED FOR. Otherwise a cancellation
-- leaves an obligation reading SCHEDULED with a dead appointment behind it -- the single most dangerous
-- state this table can hold, because it looks handled. Section 5 does that in a TRIGGER rather than in
-- the scheduling engine, for two reasons: the engine would have to import the follow-up module and the
-- follow-up module already imports it, and more importantly the rule must hold for every path that
-- cancels an appointment, including ones written later and including a console session.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 5's trigger function is plpgsql with internal semicolons inside $$ ... $$, as in 194 s6 and
-- 195 s7. If it fails to apply, the tables are still correct and the engine still releases follow-ups on
-- the cancellations IT performs -- what is lost is the guarantee that holds when the engine is bypassed,
-- and scripts/practice-followups-harness.ts asserts it by name so its absence is visible.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_follow_up -------------------------------------------------------------------------

create table if not exists practice_follow_up (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- Where the commitment was made. Nullable only because a practitioner may raise one from the patient
  -- record between visits; the UI always passes it when there is an encounter to pass.
  origin_encounter_id uuid references practice_encounter(id) on delete set null,
  -- What it is ABOUT. Either, both or neither: a follow-up may track a longitudinal problem, a specific
  -- diagnosis made at the encounter, or something the reason text names that is neither.
  problem_id uuid references practice_problem(id) on delete set null,
  diagnosis_id uuid references practice_diagnosis(id) on delete set null,

  kind text not null default 'review'
    check (kind in ('review', 'investigation_result', 'treatment_response', 'referral_outcome',
                    'monitoring', 'immunisation', 'other')),
  reason text not null check (char_length(reason) between 1 and 400),
  -- A DATE, not a timestamp. "Review in two weeks" is not a moment, and storing it as one invites a
  -- timezone bug in the one calculation the whole module turns on.
  due_on date not null,
  priority text not null default 'routine'
    check (priority in ('routine', 'soon', 'urgent')),

  -- HUMAN DECISIONS ONLY. See the header: there is no OVERDUE here on purpose.
  status text not null default 'OPEN'
    check (status in ('OPEN', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED')),
  appointment_id uuid references practice_appointment(id) on delete set null,
  closing_encounter_id uuid references practice_encounter(id) on delete set null,
  outcome text,
  closed_at timestamptz,
  closed_by uuid,

  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- The board's own query: everything still owed, soonest first.
create index if not exists idx_practice_followup_board
  on practice_follow_up(workspace_id, status, due_on);
create index if not exists idx_practice_followup_patient
  on practice_follow_up(patient_id, status, due_on);
create index if not exists idx_practice_followup_origin
  on practice_follow_up(origin_encounter_id);
-- Section 5's trigger looks up by appointment; without this it is a sequential scan on every cancel.
create index if not exists idx_practice_followup_appointment
  on practice_follow_up(appointment_id) where appointment_id is not null;

-- ONE LIVE FOLLOW-UP PER APPOINTMENT. Two obligations pointing at one booking means closing the visit
-- satisfies one of them arbitrarily, and the other silently keeps a dead appointment id.
create unique index if not exists ux_practice_followup_appointment
  on practice_follow_up(appointment_id) where appointment_id is not null and status = 'SCHEDULED';

-- ---- 2. practice_follow_up_event (immutable trail) -------------------------------------------------
--
-- Separate from practice_audit_event, which is the workspace-wide operational log. This is the
-- OBLIGATION's own history, readable beside it: raised, booked, released when the booking fell through,
-- closed, reopened. "Why has this been open for four months" is a question the record should answer.

create table if not exists practice_follow_up_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  follow_up_id uuid not null references practice_follow_up(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_practice_followup_event
  on practice_follow_up_event(follow_up_id, occurred_at);

-- ---- 3. The interval catalogue ----------------------------------------------------------------------
--
-- NOT clinical guidance, and the UI says so where it is offered. These are the intervals a practitioner
-- types over and over, turned into buttons; the arithmetic is today plus n days and nothing else. A
-- table rather than a TypeScript array because a practice will eventually want its own, and because the
-- engine validates against it -- an invented interval is then a refusal rather than a silent default.

create table if not exists practice_follow_up_interval (
  code text primary key,
  label text not null,
  days integer not null check (days > 0),
  position integer not null default 0
);

insert into practice_follow_up_interval (code, label, days, position) values
  ('3d', 'In 3 days', 3, 1),
  ('1w', 'In 1 week', 7, 2),
  ('2w', 'In 2 weeks', 14, 3),
  ('1m', 'In 1 month', 30, 4),
  ('6w', 'In 6 weeks', 42, 5),
  ('3m', 'In 3 months', 90, 6),
  ('6m', 'In 6 months', 180, 7),
  ('1y', 'In 1 year', 365, 8)
on conflict (code) do nothing;

-- ---- 4. Capabilities + backfill --------------------------------------------------------------------
--
-- followup.view already exists for the practitioner (191). What is added here is followup.manage, and
-- the SPLIT BETWEEN THEM IS DELIBERATE:
--
--   practice_assistant gets VIEW. They can see who is owed a review and pick up the phone -- which is
--   the actual work of chasing a follow-up, and they already hold appointment.manage to book the visit.
--   practitioner gets MANAGE. Raising a clinical obligation, linking a booking to it, and deciding that
--   one has been met or missed are clinical judgements, and they stay with the clinical role.
--
-- So an assistant can work the board all day and cannot alter a single obligation. That is the intended
-- boundary, not an oversight to be relaxed the first time someone asks.

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'followup.manage'),
  ('practice_assistant', 'followup.view')
on conflict (role_code, capability_code) do nothing;

insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

-- ---- 5. A dead booking releases its follow-up ------------------------------------------------------
--
-- See the header. CANCELLED and NO_SHOW both release: neither means the obligation was met, and a
-- no-show in particular is the case where the follow-up most needs to reappear on the board.
--
-- The appointment id is CLEARED as well as the status reset, so the board never offers to open a
-- cancelled booking. The event trail records who the appointment was cancelled by, so the release is
-- attributable rather than appearing from nowhere.

create or replace function practice_follow_up_release_on_dead_appointment()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('CANCELLED', 'NO_SHOW') and old.status is distinct from new.status then
    insert into practice_follow_up_event (workspace_id, follow_up_id, from_status, to_status, note, actor_id)
    select f.workspace_id, f.id, f.status, 'OPEN',
           'the booking for this follow-up was ' || lower(new.status), new.updated_by
    from practice_follow_up f
    where f.appointment_id = new.id and f.status = 'SCHEDULED';

    update practice_follow_up
    set status = 'OPEN', appointment_id = null,
        record_version = record_version + 1, updated_at = now()
    where appointment_id = new.id and status = 'SCHEDULED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_practice_follow_up_release on practice_appointment;
create trigger trg_practice_follow_up_release
  after update on practice_appointment
  for each row execute function practice_follow_up_release_on_dead_appointment();

-- A follow-up event is a historical fact, as note versions are (195 s7).
create or replace function practice_follow_up_event_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'follow-up event % is part of the record and cannot be changed', old.id;
end;
$$;

drop trigger if exists trg_practice_follow_up_event_immutable on practice_follow_up_event;
create trigger trg_practice_follow_up_event_immutable
  before update on practice_follow_up_event
  for each row execute function practice_follow_up_event_immutable();

-- ---- 6. RLS: deny-by-default ------------------------------------------------------------------------

alter table practice_follow_up enable row level security;
alter table practice_follow_up_event enable row level security;
alter table practice_follow_up_interval enable row level security;

notify pgrst, 'reload schema';
