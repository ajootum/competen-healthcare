-- 082: Roster Governance workflow stores (UMW-WFM-004). Adds the stateful governance stores
-- that the Roster Governance module's next-phase tabs need: the exception register (§14 /
-- §21.7), approval chain (§15 / §21.8), publication + staff acknowledgement (§15 / §21.9-10),
-- post-publication amendments (§16 / §21.11) and planned-vs-actual attendance (§17 / §21.12).
--
-- Design note: the spec's canonical model has roster_cycle → roster_version as the envelope.
-- This platform already has that envelope as op_rosters (migration 080 — the week roster with
-- status draft|published|archived + version), so these stores key to op_rosters(id) as the
-- roster version rather than introducing a parallel cycle/version model. Tables use the op_
-- prefix + plural naming to match op_rosters / op_roster_assignments; the spec's canonical
-- table name is noted on each. Actual attendance is a SEPARATE record and never overwrites
-- the published roster (BR-015). No hard deletes — records are status-transitioned (§ / BR-010).
--
-- Idempotent; RLS enabled, service-role only (no client policies) — all reads/writes go through
-- the audited, role-gated APIs, matching migration 080.

-- ── op_roster_exceptions — the stateful exception register (§14.5 / §21.7) ───────────────────
create table if not exists op_roster_exceptions (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  roster_id          uuid references op_rosters(id) on delete cascade,
  roster_assignment_id uuid references op_roster_assignments(id) on delete set null,
  department_id      uuid references departments(id) on delete set null,
  unit_name          text,
  shift_date         date,
  shift_type         text,
  category           text not null,  -- coverage/skill_mix/supervisor/competency/availability/leave/working_time/fatigue/contract/credential/cost/fairness/preference/conflict/approval/publication/acknowledgement/amendment/attendance
  severity           text not null default 'moderate' check (severity in ('critical','high','moderate','low','informational')),
  status             text not null default 'detected' check (status in ('detected','assigned','under_review','correction_proposed','awaiting_evidence','awaiting_approval','accepted_with_mitigation','resolved','rejected','expired','reopened','superseded')),
  rule_id            text,
  description        text,
  staff_id           uuid references profiles(id) on delete set null,
  staff_name         text,
  owner_id           uuid references profiles(id) on delete set null,
  owner_name         text,
  due_at             timestamptz,
  proposed_resolution text,
  mitigation         text,
  override_required  boolean not null default false,
  -- controlled override (§14.7): never silently changes the underlying rule
  override_reason    text,
  override_risk      text,
  override_expires_at timestamptz,
  override_approved_by uuid references profiles(id) on delete set null,
  resolution_evidence text,
  final_decision     text,
  resolved_by        uuid references profiles(id) on delete set null,
  resolved_by_name   text,
  resolved_at        timestamptz,
  detected_at        timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_roster_exc_roster on op_roster_exceptions(roster_id, status, severity);
create index if not exists idx_op_roster_exc_hospital on op_roster_exceptions(hospital_id, status);

-- ── op_roster_approvals — the configurable approval chain (§15.2 / §21.8) ────────────────────
create table if not exists op_roster_approvals (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  roster_id          uuid not null references op_rosters(id) on delete cascade,
  stage_order        int not null default 1,
  approval_stage     text not null,  -- roster_officer/unit_manager/nursing_admin/hr/finance/publication
  approver_role      text,
  approver_id        uuid references profiles(id) on delete set null,
  approver_name      text,
  status             text not null default 'pending' check (status in ('pending','approved','approved_with_conditions','returned','rejected','delegated','info_requested')),
  decision           text,
  comments           text,
  conditions         text,
  attestation        boolean not null default false,   -- §15.5 approval attestation captured
  delegated_to       uuid references profiles(id) on delete set null,
  delegated_to_name  text,
  due_at             timestamptz,
  acted_at           timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_roster_appr_roster on op_roster_approvals(roster_id, stage_order);

-- ── op_roster_publications — publication record (§15.6-7 / §21.9) ────────────────────────────
create table if not exists op_roster_publications (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  roster_id          uuid not null references op_rosters(id) on delete cascade,
  publication_status text not null default 'scheduled' check (publication_status in ('scheduled','published','partially_failed','withdrawn','republished')),
  scheduled_at       timestamptz,
  published_at       timestamptz,
  published_by       uuid references profiles(id) on delete set null,
  published_by_name  text,
  channels           text[],   -- in_app/email/sms/push/tenant
  target_group       text,     -- all/changed_only/amendments_only/selected
  recipient_count    int not null default 0,
  delivery_failure_count int not null default 0,
  version            int not null default 1,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_roster_pub_roster on op_roster_publications(roster_id, publication_status);

-- ── op_roster_acknowledgements — staff acknowledgement (§15.9 / §21.10) ──────────────────────
create table if not exists op_roster_acknowledgements (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  roster_publication_id uuid not null references op_roster_publications(id) on delete cascade,
  staff_id           uuid references profiles(id) on delete set null,
  staff_name         text,
  notification_status text not null default 'pending' check (notification_status in ('pending','sent','delivered','failed')),
  viewed_at          timestamptz,
  acknowledged_at    timestamptz,
  concern_raised     boolean not null default false,  -- staff retain a mechanism to raise a concern (§15.9)
  concern_note       text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_roster_ack_pub on op_roster_acknowledgements(roster_publication_id, notification_status);

-- ── op_roster_amendments — controlled post-publication change (§16 / §21.11) ─────────────────
-- Preserves the originally published roster (BR-010); every change creates an amendment (BR-009).
create table if not exists op_roster_amendments (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  roster_id          uuid not null references op_rosters(id) on delete cascade,
  amendment_type     text not null,  -- swap/reassignment/sickness_replacement/leave_replacement/emergency_cover/supervisor_replacement/cross_unit/agency/overtime/service_change/correction/cancelled/time_change/role_change
  reason             text,
  department_id      uuid references departments(id) on delete set null,
  affected_unit      text,
  affected_shift_date date,
  affected_shift_type text,
  from_staff_id      uuid references profiles(id) on delete set null,
  from_staff_name    text,
  to_staff_id        uuid references profiles(id) on delete set null,
  to_staff_name      text,
  impact_summary     text,
  requested_by       uuid references profiles(id) on delete set null,
  requested_by_name  text,
  requested_at       timestamptz not null default now(),
  approval_status    text not null default 'requested' check (approval_status in ('requested','validated','approved','applied','rejected','cancelled')),
  approved_by        uuid references profiles(id) on delete set null,
  approved_by_name   text,
  approved_at        timestamptz,
  emergency          boolean not null default false,
  retrospective_review_required boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_roster_amd_roster on op_roster_amendments(roster_id, approval_status);

-- ── op_roster_actuals — planned-vs-actual attendance (§17 / §21.12) ──────────────────────────
-- A SEPARATE record; actual attendance never overwrites the planned roster (BR-015).
create table if not exists op_roster_actuals (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  roster_id          uuid references op_rosters(id) on delete cascade,
  roster_assignment_id uuid references op_roster_assignments(id) on delete set null,
  department_id      uuid references departments(id) on delete set null,
  unit_name          text,
  shift_date         date not null,
  shift_type         text,
  staff_id           uuid references profiles(id) on delete set null,
  staff_name         text,
  actual_role        text,
  actual_supervisor  boolean not null default false,
  attendance_status  text not null default 'attended' check (attendance_status in ('attended','approved_replacement','unapproved_replacement','sickness','no_show','late','early_departure','redeployed','overtime_extension','supervisor_change','role_change','cancelled')),
  arrival_time       timestamptz,
  departure_time     timestamptz,
  actual_hours       numeric,
  variance_reason    text,
  confirmed_by       uuid references profiles(id) on delete set null,
  confirmed_by_name  text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_op_roster_act_roster on op_roster_actuals(roster_id, shift_date);
create index if not exists idx_op_roster_act_staff on op_roster_actuals(staff_id);

-- ── RLS: enable, service-role only (no client policies), matching migration 080 ──────────────
alter table op_roster_exceptions       enable row level security;
alter table op_roster_approvals         enable row level security;
alter table op_roster_publications      enable row level security;
alter table op_roster_acknowledgements  enable row level security;
alter table op_roster_amendments        enable row level security;
alter table op_roster_actuals           enable row level security;
