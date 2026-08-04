-- ============================================================
-- MIGRATION 211: RECURRING TASKS, TEMPLATES AND ESCALATION (CPR-340)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- ONE OF THE FIVE GAPS HERE HAS ALREADY BEEN CLOSED ELSEWHERE, and saying so first avoids building it
-- twice: NOTIFICATION PREFERENCES arrived with CPR-360 (migration 205), which added per-category
-- switches wired into listNotifications -- including the rule that a clinical alert may not be silenced.
--
-- What remains is recurring tasks, task templates, escalation rules and the daily agenda. The agenda
-- needs no migration at all: it is appointments, tasks and reminders that already exist, read for one
-- day. See CPR-AUDIT-001-spec-conformance.md.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- A RECURRING TASK DOES NOT PRE-GENERATE A YEAR OF ROWS. The next occurrence is created when the current
-- one CLOSES, which is the same pattern CPR-140's plans use and for the same reason: a board holding
-- fifty-two weekly copies of "check the fridge temperature" is a board nobody reads, and fifty-one of
-- them are commitments nobody has made yet.
--
-- ESCALATION IS DERIVED, NOT FIRED. The specification says overdue high-priority tasks trigger
-- escalation. A trigger needs something to run, and this product's whole doctrine on overdue -- stated
-- at length in migration 196 -- is that nothing runs in a neglected practice. So a rule records WHAT
-- COUNTS as escalated, and the board computes which tasks have breached it at read time. The result is
-- the same information, available the moment somebody looks, with nothing to fail silently overnight.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Recurrence lives on the task ------------------------------------------------------------------
--
-- Not a separate schedule object. A recurring task IS a task; the columns say when the next one is due
-- and where this one came from, and everything else about it -- assignment, priority, the event trail,
-- the derived orphaning -- is unchanged.

alter table practice_task add column if not exists recurrence text;
alter table practice_task drop constraint if exists practice_task_recurrence_check;
alter table practice_task add constraint practice_task_recurrence_check
  check (recurrence is null or recurrence in ('daily', 'weekly', 'fortnightly', 'monthly'));

-- When to stop. NULL means it keeps going until somebody ends it, which is the honest default for
-- "check the fridge temperature" -- unlike a delegation, a standing chore has no natural end date.
alter table practice_task add column if not exists recurrence_until date;

-- Which task produced this one. The chain is what makes "how long has this been running" answerable.
alter table practice_task add column if not exists recurred_from_task_id uuid references practice_task(id) on delete set null;

create index if not exists idx_practice_task_recurring
  on practice_task(workspace_id, recurrence) where recurrence is not null;

-- ---- 2. Task templates --------------------------------------------------------------------------------
--
-- A template makes SEVERAL tasks, not one. "New patient onboarding" is four things, and a template that
-- produced a single task called "onboarding" would be a checklist collapsed into a word.

create table if not exists practice_task_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  code text not null,
  title text not null check (char_length(title) between 1 and 160),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists idx_practice_task_template_code
  on practice_task_template(workspace_id, code);

create table if not exists practice_task_template_item (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references practice_task_template(id) on delete cascade,
  position integer not null,
  title text not null check (char_length(title) between 1 and 240),
  detail text,
  category text,
  -- routine / soon / urgent -- this product's vocabulary, not the comp's high/medium/low. Defaulted to
  -- the same value practice_task defaults to, so a template item that says nothing about priority
  -- produces a task identical to one created by hand.
  priority text not null default 'routine',
  -- Days from the day the template is applied. Offsets from the START, never chained -- the same rule
  -- CPR-140's plan steps follow, and for the same reason: chaining makes every later date drift.
  offset_days integer not null default 0 check (offset_days >= 0)
);

create unique index if not exists idx_practice_task_template_item
  on practice_task_template_item(template_id, position);

-- ---- 3. Escalation rules ------------------------------------------------------------------------------
--
-- WHAT COUNTS AS ESCALATED, not a scheduled job. One rule per priority: a task at this priority, this
-- many days past its due date, is escalated. The board computes the rest at read time.
--
-- notify_user_id is WHO SHOULD BE TOLD, and it is advisory: nothing sends anything. It is what the
-- escalation list shows beside a breached task so somebody knows whose problem it now is.

create table if not exists practice_escalation_rule (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  priority text not null,
  days_overdue integer not null check (days_overdue between 0 and 365),
  notify_user_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists idx_practice_escalation_priority
  on practice_escalation_rule(workspace_id, priority);

-- ---- 4. Capabilities ----------------------------------------------------------------------------------
--
-- No new capability. Templates and recurrence are task.manage, which is already what creating a task
-- takes; escalation rules are task.manage too, because deciding when work is late is the same kind of
-- decision as assigning it.

-- ---- 5. RLS: deny-by-default --------------------------------------------------------------------------

alter table practice_task_template enable row level security;
alter table practice_task_template_item enable row level security;
alter table practice_escalation_rule enable row level security;

notify pgrst, 'reload schema';
