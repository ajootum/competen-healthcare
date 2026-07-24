-- 087: Patient Operations governance stores (POS-106A §13). POS-106A splits the ONE shared POS-106
-- service into role modes: the Shift Supervisor Workspace hosts Operational Mode (data entry) and
-- the Unit Manager Workspace hosts Governance Mode (oversight, approvals, exceptions, amendments,
-- audit) — read-first, operating on the SAME op_form_instances object identifiers, never a second
-- record (§1 non-negotiable rule). Governance needs two stores the operational engine didn't:
--
--   • op_exceptions       — the Exception Service (§13.1): a recorded policy/rule breach with reason,
--     temporary risk acceptance, requester, resolved approver, effective period and status.
--   • op_amendment_requests — the Amendment process (§13.2): a request to correct a COMPLETED event.
--     On approval the system creates a NEW linked version of the form instance (amends_id) and the
--     original remains preserved (BR-008); this store is the request → decision workflow around it.
--
-- Both reference op_form_instances / op_patients — no duplicate patient or form records.
-- Idempotent; RLS enabled, service-role only — reads/writes go through the audited, role-gated
-- /api/operations/pos-governance API, matching migrations 084 / 085 / 086.

-- ── op_exceptions — Exception Service (§13.1) ────────────────────────────────────────────────────
create table if not exists op_exceptions (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null references hospitals(id) on delete cascade,
  patient_id       uuid references op_patients(id) on delete set null,
  form_instance_id uuid references op_form_instances(id) on delete set null,
  exception_type   text not null,                       -- configured taxonomy
  rule_ref         text,                                -- rule identifier + version breached
  reason_category  text not null,                       -- structured category
  reason           text not null,                       -- narrative
  risk_level       text check (risk_level is null or risk_level in ('low','moderate','high','critical')),
  temporary_controls text,
  requester_id     uuid references profiles(id) on delete set null,
  requester_role   text,
  approver_id      uuid references profiles(id) on delete set null,
  effective_from   timestamptz,
  expiry           timestamptz,
  status           text not null default 'requested' check (status in ('requested','approved','rejected','expired','revoked')),
  decision_reason  text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_op_exceptions_hosp on op_exceptions(hospital_id, status);
create index if not exists idx_op_exceptions_patient on op_exceptions(patient_id, created_at desc);

-- ── op_amendment_requests — Amendment process (§13.2) ───────────────────────────────────────────
create table if not exists op_amendment_requests (
  id                   uuid primary key default gen_random_uuid(),
  hospital_id          uuid not null references hospitals(id) on delete cascade,
  form_instance_id     uuid not null references op_form_instances(id) on delete cascade, -- the completed event
  patient_id           uuid references op_patients(id) on delete set null,
  requested_by         uuid references profiles(id) on delete set null,
  requester_role       text,
  reason               text not null,
  proposed_payload     jsonb,                            -- optional proposed corrected values
  status               text not null default 'requested' check (status in ('requested','approved','rejected')),
  approver_id          uuid references profiles(id) on delete set null,
  decision_reason      text,
  decided_at           timestamptz,
  amendment_instance_id uuid references op_form_instances(id) on delete set null, -- new version created on approval
  created_at           timestamptz not null default now()
);
create index if not exists idx_op_amend_hosp on op_amendment_requests(hospital_id, status);
create index if not exists idx_op_amend_form on op_amendment_requests(form_instance_id);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_exceptions') then
    execute 'alter table public.op_exceptions enable row level security';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_amendment_requests') then
    execute 'alter table public.op_amendment_requests enable row level security';
  end if;
end $$;
