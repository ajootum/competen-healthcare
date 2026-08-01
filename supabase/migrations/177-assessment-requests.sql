-- ============================================================
-- MIGRATION 177: ASSESSMENT REQUESTS (XWI P2-5)
--
-- The gap: a shift supervisor can see that a nurse is not competent for what the ward needs, and has no
-- way to ask for an assessment. There is no table, no route, no queue -- the audit recorded it as
-- "NO supervisor->assessor assessment-request path exists", and that was still true. The supervisor's
-- only options were to deploy anyway under a governed override, or to handle it outside the system.
-- Neither produces a record that the competency gap was noticed.
--
-- DESIGN CALL: assessor_id IS NULLABLE, and null means OPEN.
-- A supervisor mid-shift usually knows which nurse needs assessing and not which assessor is free, so
-- forcing a named recipient would push them back outside the system. Null = any assessor in the hospital
-- may claim it; set = directed at that person. One column supports both, and either can be constrained
-- later by policy without a schema change.
--
-- STATUS is a claim lifecycle, not a workflow engine: open -> claimed -> completed, with declined and
-- cancelled as terminal exits. `claimed_by` is recorded separately from `assessor_id` so a directed
-- request that someone else picks up still shows who actually did it.
--
-- RLS: enabled with NO client policies -- the service-role-only pattern this codebase settled on in
-- migration 074 and uses for 140 tables. Every reader goes through the API, which enforces role and
-- tenant scope in code. Verified by scripts/client-usage-audit.ts: nothing reaches op_*/competency data
-- through the user client.
--
-- Plain statements, idempotent, no do-blocks, ASCII only.
-- ============================================================

create table if not exists assessment_requests (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  nurse_id       uuid not null references profiles(id) on delete cascade,
  competency_id  uuid references framework_competencies(id) on delete set null,
  cycle_id       uuid references competency_cycles(id) on delete set null,
  requested_by   uuid references profiles(id) on delete set null,
  requested_role text,
  assessor_id    uuid references profiles(id) on delete set null,
  reason         text,
  urgency        text not null default 'routine' check (urgency in ('routine', 'urgent')),
  status         text not null default 'open' check (status in ('open', 'claimed', 'completed', 'declined', 'cancelled')),
  claimed_by     uuid references profiles(id) on delete set null,
  claimed_at     timestamptz,
  outcome_note   text,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_asmreq_hospital_status on assessment_requests(hospital_id, status, created_at desc);
create index if not exists idx_asmreq_assessor        on assessment_requests(assessor_id, status);
create index if not exists idx_asmreq_nurse           on assessment_requests(nurse_id, created_at desc);

-- One OPEN request per (nurse, competency) so a supervisor pressing twice does not queue the same work
-- twice for whoever picks it up. Completed and declined requests do not block a fresh one, because
-- re-requesting after a decline is the normal path.
create unique index if not exists ux_asmreq_open_per_competency
  on assessment_requests(nurse_id, competency_id)
  where status in ('open', 'claimed');

alter table assessment_requests enable row level security;

notify pgrst, 'reload schema';
