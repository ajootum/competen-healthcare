-- 079: Handover Centre (SSW-HC-002..012) data model. Grows the base handover store
-- (op_handovers / op_handover_items, migration 038) into the full end-to-end shift
-- handover workflow: per-patient SBAR narrative, review/acceptance lifecycle and an
-- embedded JBI audit, plus a clarification Q&A channel between shifts and standalone
-- JBI audit records for the audit engine + analytics. Everything is auto-populated
-- from live op_* data by the loader; supervisor edits and sign-offs persist here.
-- The clinical narrative fields hold only what a clinician types or the loader derives
-- from operational data — op_patients carries no PHI, so nothing is fabricated.
-- Idempotent; RLS service-role only (writes via the audited, role-gated handover API).

-- Shift-level handover envelope
alter table op_handovers add column if not exists jbi_score      int;
alter table op_handovers add column if not exists quality_score  int;
alter table op_handovers add column if not exists shift_label    text;
alter table op_handovers add column if not exists completed_at   timestamptz;
alter table op_handovers add column if not exists outgoing_notes text;

-- Per-patient handover item: SBAR, lifecycle status, review/acceptance, JBI
alter table op_handover_items add column if not exists sbar_situation      text;
alter table op_handover_items add column if not exists sbar_background     text;
alter table op_handover_items add column if not exists sbar_assessment     text;
alter table op_handover_items add column if not exists sbar_recommendation text;
alter table op_handover_items add column if not exists sbar_status  text not null default 'draft';   -- draft|reviewed|shared|archived
alter table op_handover_items add column if not exists item_status  text not null default 'pending'; -- pending|in_progress|completed|reviewed|accepted
alter table op_handover_items add column if not exists reviewed     boolean not null default false;
alter table op_handover_items add column if not exists reviewed_by  uuid references profiles(id) on delete set null;
alter table op_handover_items add column if not exists reviewed_at  timestamptz;
alter table op_handover_items add column if not exists accepted     boolean not null default false;
alter table op_handover_items add column if not exists accepted_by  uuid references profiles(id) on delete set null;
alter table op_handover_items add column if not exists accepted_at  timestamptz;
alter table op_handover_items add column if not exists jbi_checklist jsonb;
alter table op_handover_items add column if not exists jbi_score    int;
alter table op_handover_items add column if not exists updated_at   timestamptz not null default now();

-- Clarification Q&A: incoming supervisor asks the outgoing supervisor about a patient
create table if not exists op_handover_clarifications (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid references hospitals(id) on delete cascade,
  handover_id      uuid references op_handovers(id) on delete cascade,
  item_id          uuid references op_handover_items(id) on delete cascade,
  patient_id       uuid references op_patients(id) on delete set null,
  question         text not null,
  asked_by         uuid references profiles(id) on delete set null,
  asked_by_name    text,
  answer           text,
  answered_by      uuid references profiles(id) on delete set null,
  answered_by_name text,
  answered_at      timestamptz,
  status           text not null default 'pending' check (status in ('pending','answered','closed')),
  created_at       timestamptz not null default now()
);
create index if not exists idx_handover_clarif_handover on op_handover_clarifications(handover_id, status);
create index if not exists idx_handover_clarif_patient on op_handover_clarifications(patient_id);

-- Standalone JBI audit records (the audit engine + quality analytics)
create table if not exists op_handover_audits (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  handover_id    uuid references op_handovers(id) on delete set null,
  item_id        uuid references op_handover_items(id) on delete set null,
  patient_id     uuid references op_patients(id) on delete set null,
  auditor_id     uuid references profiles(id) on delete set null,
  auditor_name   text,
  checklist      jsonb not null default '{}',      -- { domain_key: score_out_of_5 }
  total_score    int,
  max_score      int not null default 35,
  compliance_pct int,
  classification text,                             -- excellent|good|fair|needs_improvement
  duration_seconds int,
  follow_up_note text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_handover_audits_hospital on op_handover_audits(hospital_id, created_at desc);
create index if not exists idx_handover_audits_patient on op_handover_audits(patient_id);

alter table op_handover_clarifications enable row level security;
alter table op_handover_audits enable row level security;
-- No client policies: reads/writes go through the service-role admin client behind
-- the audited, role-gated handover API.
