-- 070: Task Centre — Workflow & Automation (SSW-TSK-001 §Workflow & Automation).
-- op_task_templates are reusable clinical/operational task definitions the
-- supervisor can instantiate on demand, with recurrence and event-trigger config.
-- Instantiation creates a real op_task through the audited tasks API. Recurrence
-- auto-firing and event-driven auto-generation are configured here; their
-- scheduled/event execution is a later phase (the config is the store this needs).
-- Idempotent; RLS service-role only (writes via the audited templates API).

create table if not exists op_task_templates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  name text not null,
  task_type text,
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  description text,
  due_offset_min int not null default 60,                 -- instantiated task due = now + offset
  recurrence text not null default 'none'
    check (recurrence in ('none','hourly','per_shift','daily','weekly')),
  trigger_event text not null default 'manual'
    check (trigger_event in ('manual','admission','discharge','transfer','pews_high','ward_round','incident')),
  requires_review boolean not null default false,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_op_task_templates_hospital on op_task_templates(hospital_id, active);
create index if not exists idx_op_task_templates_trigger on op_task_templates(trigger_event);

alter table op_task_templates enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind the audited, role-gated task-templates API route.
