-- ============================================================
-- MIGRATION 198: TASKS, REMINDERS AND NOTIFICATIONS (CPR-340)
--
-- The operational spine the rest of CPR-300..370 references.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THREE BOUNDARY DECISIONS, ALL OF WHICH ARE "DO NOT BUILD A SECOND ONE OF SOMETHING".
--
-- 1. A TASK IS NOT A FOLLOW-UP. CPR-140's follow-up is a CLINICAL OBLIGATION TO A PATIENT -- the
--    practice committed to reviewing someone, it lives in their record, and failing it is a clinical
--    failure. A task is A PIECE OF WORK ASSIGNED TO A PERSON: chase the lab, order dressings, fill in
--    the insurance form. It may mention a patient; it is not part of their clinical record, and
--    deleting every task in this table would lose no clinical fact.
--
--    That boundary matters because the cheap thing to do is let tasks absorb follow-ups -- they look
--    similar, both have a due date and a done button. The result is two systems that each hold half the
--    commitments, and a patient who falls through the gap between them.
--
-- 2. A REMINDER IS NOT A THIRD OBJECT. "Remind me on the 14th to chase the lab" and "task: chase the
--    lab, due the 14th" are the same sentence. CPR-340 names reminders separately; a separate table
--    would be a task table with fewer columns and a different board, and the two would drift. So
--    `remind_on` is a column, and the reminder IS the task surfacing on that date.
--
-- 3. THERE IS NO SENDING. Not by email, not by SMS, not by WhatsApp, not to patients. Every comp for a
--    screen like this shows "Reminder sent to patient ✓", and this product has no delivery channel --
--    the same position CPR-130 took when it recorded that a document was issued without pretending to
--    have issued it. A notification here appears IN THE APP to a member of this practice, and nowhere
--    else. If a delivery channel is ever built, that is a specification and a decision, not a column.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- WHY A PRACTICE-SCOPED NOTIFICATION TABLE, when the platform already has one. `notifications` (161)
-- carries `hospital_id references hospitals(id)` and `notification_preferences.user_id references
-- profiles(id)`. Practice is a parallel tenant boundary -- practice_workspace, not hospitals -- and a
-- practice-only user may have no profiles row at all. Reusing it would mean either inventing a hospital
-- for every practice or making the platform's keys nullable, and both make the platform's tenancy
-- weaker to save one table here. Considered and refused, recorded so it is not re-litigated.
--
-- WHAT A NOTIFICATION IS FOR, AND WHAT IT MUST NEVER HOLD. CPR-300 established that state which can be
-- DERIVED is derived: overdue follow-ups and unsigned encounters are computed at read time precisely so
-- nothing has to run for them to be true. A notification row that said "you have an overdue follow-up"
-- would be a second source of truth for a fact the home page already computes, and the two would
-- disagree the moment one was closed without the other being cleared.
--
-- So this table holds ONLY what cannot be recovered from current state: somebody assigned you a task,
-- somebody amended a document you wrote. "X happened and you have not seen it" is not derivable from
-- the record afterwards. In a solo practice this table will be permanently empty -- that is correct,
-- not broken.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 4's trigger function is plpgsql with internal semicolons inside $$ ... $$.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_task -------------------------------------------------------------------------------

create table if not exists practice_task (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  detail text,

  -- WHO OWES IT. Not nullable: an unassigned task is a wish. The engine additionally refuses anyone who
  -- is not an ACTIVE member of this workspace, because work assigned to a revoked account lands nowhere.
  assigned_to uuid not null,

  -- WHAT IT IS ABOUT. All optional, all merely REFERENCES -- none of them makes this row part of the
  -- clinical record. on delete set null throughout: a task outliving its subject is a loose end somebody
  -- should close, and silently deleting it would hide that.
  patient_id uuid references practice_patient(id) on delete set null,
  encounter_id uuid references practice_encounter(id) on delete set null,
  document_id uuid references practice_clinical_document(id) on delete set null,
  follow_up_id uuid references practice_follow_up(id) on delete set null,

  category text not null default 'admin'
    check (category in ('admin', 'clinical_admin', 'supplies', 'billing', 'referral', 'equipment', 'other')),
  priority text not null default 'routine' check (priority in ('routine', 'soon', 'urgent')),

  -- DATES, not timestamps, for the same reason CPR-140 gives: "by Friday" is not a moment, and storing
  -- it as one invites a timezone bug in the calculation the board turns on.
  due_on date,
  -- THE REMINDER. See boundary decision 2: this is not a second object, it is the date the task starts
  -- appearing in front of its assignee. Usually equal to or before due_on.
  remind_on date,

  status text not null default 'OPEN'
    check (status in ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED')),
  blocked_reason text,
  outcome text,
  closed_at timestamptz,
  closed_by uuid,

  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- The two queries the board actually runs: "what do I owe" and "what does this practice owe".
create index if not exists idx_practice_task_assignee on practice_task(workspace_id, assigned_to, status, due_on);
create index if not exists idx_practice_task_board on practice_task(workspace_id, status, due_on);
create index if not exists idx_practice_task_patient on practice_task(patient_id) where patient_id is not null;
create index if not exists idx_practice_task_remind on practice_task(workspace_id, remind_on) where remind_on is not null;

-- ---- 2. practice_task_event (immutable trail) -------------------------------------------------------

create table if not exists practice_task_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  task_id uuid not null references practice_task(id) on delete cascade,
  from_status text,
  to_status text not null,
  -- Reassignment is a status-preserving move, so it needs its own field to be visible in the trail at
  -- all: "who was this with before" is the question a stalled task raises.
  from_assignee uuid,
  to_assignee uuid,
  note text,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_practice_task_event on practice_task_event(task_id, occurred_at);

-- ---- 3. practice_notification -----------------------------------------------------------------------
--
-- IN-APP ONLY. See boundary decision 3. There is no delivery column, no channel column and no
-- `sent_at`, because there is nothing to send with -- and a nullable `sent_at` sitting unused is how a
-- product ends up claiming to have messaged somebody.

create table if not exists practice_notification (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- The RECIPIENT. Notifications are per person, not per workspace: "somebody assigned you a task" is
  -- not news to the person who assigned it.
  user_id uuid not null,
  event_type text not null
    check (event_type in ('task_assigned', 'task_reassigned', 'document_amended', 'task_blocked')),
  title text not null check (char_length(title) between 1 and 240),
  body text,
  -- Where to go. Every notification must lead somewhere, for the reason CPR-300 gives about figures:
  -- something you cannot act on is decoration.
  href text not null,
  source_kind text check (source_kind in ('task', 'document', 'follow_up', 'encounter')),
  source_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_notification_inbox
  on practice_notification(workspace_id, user_id, read_at, created_at desc);

-- ---- 4. The task trail is immutable ------------------------------------------------------------------
--
-- As note versions (195 s7), follow-up events (196 s5) and procedure outcomes (197 s5).
--
-- NOTE WHAT IS *NOT* A TRIGGER HERE, AND WHY. CPR-140 put the follow-up release in the database because
-- a follow-up reading SCHEDULED against a cancelled booking is a record that LIES -- it looks handled.
-- Assignment notifications are written by the engine instead, because a missed notification is a missed
-- courtesy, not a false record: the task itself is still there, correctly assigned, on the assignee's
-- board. Different stakes, different placement, stated so the inconsistency reads as a decision.

create or replace function practice_task_event_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'task event % is part of the trail and cannot be changed', old.id;
end;
$$;

drop trigger if exists trg_practice_task_event_immutable on practice_task_event;
create trigger trg_practice_task_event_immutable
  before update on practice_task_event
  for each row execute function practice_task_event_immutable();

-- ---- 5. Capabilities + backfill ----------------------------------------------------------------------
--
-- THE FIRST MODULE WHERE ALL THREE ROLES ARE FULL PARTICIPANTS, and that is the point of it. Every
-- clinical capability so far has stopped at the practitioner: an assistant may see the follow-up board
-- and not alter an obligation, may not read a clinical document, may not record a procedure. Operational
-- work is different -- chasing a lab, ordering dressings and filling in a form are the assistant's job
-- and the owner's business, and a task list only they can read but not write would be a noticeboard.
--
-- The clinical boundary is untouched: a task can REFERENCE a patient, and reading that patient's record
-- still needs patient.view.

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'task.view'),
  ('practitioner', 'task.manage'),
  ('practice_assistant', 'task.view'),
  ('practice_assistant', 'task.manage'),
  ('practice_owner', 'task.view'),
  ('practice_owner', 'task.manage')
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

-- ---- 6. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_task enable row level security;
alter table practice_task_event enable row level security;
alter table practice_notification enable row level security;

notify pgrst, 'reload schema';
