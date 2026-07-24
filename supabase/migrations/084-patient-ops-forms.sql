-- 084: Patient Operations Centre form engine (POS-106). The Patient Operations Centre is the
-- controlled operational data-entry & workflow layer: it captures a patient event once, persists
-- it, creates an immutable timeline event, updates operational state and distributes to consumers.
-- This adds the two stores that layer needs on top of the existing op_* operational tables:
--
--   • op_form_instances — the form LIFECYCLE store (§8.2): draft → in_progress → submitted →
--     awaiting_verification → returned → verified → finalised → amended / cancelled. Holds the
--     structured field values as jsonb (payload) plus the template key/version so historical forms
--     keep their template meaning (BR-012, §14 "configuration without historical mutation").
--   • op_form_events — the immutable EVENT ENVELOPE (§11.1): one durable domain event per submission
--     / transition (patient.admitted, patient.shift_update.submitted, …) with actor, role, prev/new
--     state, reason and correlation id. Append-only.
--
-- Key rules baked in:
--   • Submitted records are amended, never silently overwritten (BR-008): an amendment is a NEW
--     instance linked via amends_id; the original is retained and marked 'amended'.
--   • Retrospective / override actions carry a reason (BR-009/010) — the reason column.
--   • All timestamps are server-generated (BR-015) — defaults now(); the API never trusts client time.
--   • Tasks created from action rows use the existing op_tasks store (no parallel task model).
--
-- Idempotent; RLS enabled, service-role only (no client policies) — reads/writes go through the
-- audited, role-gated /api/operations/pos-forms API, matching migrations 050 / 082 / 083.

-- ── op_form_instances — POS-106 form lifecycle store (§8.2) ──────────────────────────────────────
create table if not exists op_form_instances (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null references hospitals(id) on delete cascade,
  department_id    uuid references departments(id) on delete set null,
  patient_id       uuid references op_patients(id) on delete set null,
  shift_id         uuid references op_shifts(id) on delete set null,
  template_key     text not null,                       -- 'shift_update','ward_round','escalation',…
  template_version integer not null default 1,          -- template version stored on each form (BR-012)
  title            text,                                -- optional human label / subject
  state            text not null default 'draft' check (state in (
                     'draft','in_progress','submitted','awaiting_verification',
                     'returned','verified','finalised','amended','cancelled')),
  priority         text check (priority is null or priority in ('routine','urgent','emergency')),
  payload          jsonb not null default '{}'::jsonb,  -- structured field values
  due_at           timestamptz,                         -- action/verification due time
  amends_id        uuid references op_form_instances(id) on delete set null, -- amendment chain (BR-008)
  reason           text,                                -- amendment / cancel / override reason (BR-009/010)
  created_by       uuid references profiles(id) on delete set null,
  submitted_by     uuid references profiles(id) on delete set null,
  submitted_at     timestamptz,
  verified_by      uuid references profiles(id) on delete set null,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_op_form_inst_hosp_state on op_form_instances(hospital_id, state);
create index if not exists idx_op_form_inst_patient on op_form_instances(patient_id, created_at desc);
create index if not exists idx_op_form_inst_template on op_form_instances(hospital_id, template_key);
create index if not exists idx_op_form_inst_creator on op_form_instances(created_by, state);
create index if not exists idx_op_form_inst_due on op_form_instances(hospital_id, due_at) where due_at is not null;

-- ── op_form_events — POS-106 immutable event envelope (§11.1) ────────────────────────────────────
create table if not exists op_form_events (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null references hospitals(id) on delete cascade,
  form_instance_id uuid references op_form_instances(id) on delete cascade,
  event_type       text not null,                       -- 'patient.shift_update.submitted', …
  schema_version   integer not null default 1,
  department_id    uuid references departments(id) on delete set null,
  patient_id       uuid references op_patients(id) on delete set null,
  shift_id         uuid references op_shifts(id) on delete set null,
  actor_id         uuid references profiles(id) on delete set null,
  actor_role       text,
  prev_state       text,
  new_state        text,
  reason           text,
  correlation_id   uuid,
  payload          jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists idx_op_form_events_instance on op_form_events(form_instance_id, created_at);
create index if not exists idx_op_form_events_hosp on op_form_events(hospital_id, created_at desc);
create index if not exists idx_op_form_events_type on op_form_events(hospital_id, event_type);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_form_instances') then
    execute 'alter table public.op_form_instances enable row level security';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_form_events') then
    execute 'alter table public.op_form_events enable row level security';
  end if;
end $$;
