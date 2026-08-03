-- ============================================================
-- MIGRATION 208: DELEGATION BY AREA, APPROVALS AND ROLE TEMPLATES (CPR-310, the delegation model)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE SPECIFICATION DELEGATES BY AREA. WHAT WAS BUILT DELEGATES ONE CAPABILITY AT A TIME.
--
-- CPR-310's comp shows a personal assistant with "24 Areas" and a Delegated Access Summary listing
-- Scheduling & Appointments, Patient Registration, Documentation & Letters, Communications, Billing &
-- Payments, Reports & Data Entry. That is what a practitioner actually decides: "Mary handles my diary",
-- not "Mary holds appointment.manage, practice.calendar.view and queue.manage until the 30th".
--
-- What exists is a good time-bounded capability grant with a resolver that reads it. All of that stays.
-- An AREA is a named bundle ON TOP of it. See CPR-AUDIT-001-spec-conformance.md.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- AN AREA DELEGATION MATERIALISES ORDINARY CAPABILITY GRANTS. It does not become a second place a
-- permission can live. The resolver still reads practice_role_assignment and nothing else; a delegation
-- row is the GROUPING that says why those grants exist and lets them be withdrawn together. This is the
-- same shape CPR-140's plans take over follow-ups, for the same reason: two places a permission can live
-- is two answers to "may this person do that" and no tiebreak.
--
-- THE AREAS THEMSELVES ARE NOT A TABLE. They are a fixed vocabulary in code (delegation-constants.ts),
-- because an area is a mapping to capabilities and a practice-defined area would be one whose
-- capabilities nobody had defined. What IS a table is a ROLE TEMPLATE -- the spec's "custom role
-- templates" -- which is a practice-named bundle OF areas.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The delegation ---------------------------------------------------------------------------------
--
-- STILL TIME-BOUNDED, AND STILL MAY NOT BE OPEN-ENDED. The rule the capability-level delegation was built
-- on is not relaxed by making the unit bigger: an open-ended delegation is a role change wearing a
-- temporary label, and the whole value of the mechanism is that somebody wrote down when it stops.

create table if not exists practice_delegation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  membership_id uuid not null references practice_membership(id) on delete cascade,
  area text not null,
  -- CPR-310 s3 "location-specific access". Null means every location; a named one narrows it. Advisory
  -- at the capability layer -- see the note in delegation.ts, which is honest about what it does and
  -- does not enforce today.
  location_id uuid references practice_location(id) on delete set null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz not null,
  note text,
  -- Withdrawn early, as distinct from expired. "Why did this stop" has different answers.
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawn_reason text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_delegation_member
  on practice_delegation(workspace_id, membership_id, effective_to);

-- The grants this delegation created, so withdrawing it can end exactly those and nothing else. A
-- delegation that ended every grant for its capability would revoke a colleague's ROLE DEFAULT because
-- somebody else's temporary cover expired.
alter table practice_role_assignment add column if not exists delegation_id uuid references practice_delegation(id) on delete set null;
create index if not exists idx_practice_role_assignment_delegation
  on practice_role_assignment(delegation_id) where delegation_id is not null;

-- ---- 2. Role templates (CPR-310 s3 "custom role templates") -------------------------------------------
--
-- A practice-named bundle of AREAS. The comp's sidebar names PA, Secretary, Practice Manager,
-- Receptionist and Support; those are not this product's four roles, and hard-coding five more would be
-- guessing at what any given practice means by "secretary". A template lets the practice say.

create table if not exists practice_role_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  code text not null,
  title text not null check (char_length(title) between 1 and 80),
  description text,
  -- The areas it grants, as a list of area codes. Validated in the engine against the fixed vocabulary,
  -- so a template can never name an area that resolves to nothing.
  areas jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create unique index if not exists idx_practice_role_template_code
  on practice_role_template(workspace_id, code);

-- ---- 3. Approvals (CPR-310 s4 "practitioner review"; s5 "only practitioners can sign") ----------------
--
-- WHAT AN APPROVAL IS FOR, PRECISELY. CPR-310 s5 already holds without any of this: only a practitioner
-- can sign, and the signing engines enforce it. An approval request is for the OTHER case -- work a
-- delegate has done that a practitioner asked to see before it goes further. It is a queue, not a gate
-- on the database.
--
-- SAYING SO MATTERS. An approval table that looked like a permission check would invite somebody to
-- believe unapproved work is blocked. It is not: the delegate could do it because they held the
-- capability. This records that a practitioner wanted to look, and whether they have.

create table if not exists practice_approval_request (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- Who did the work, and who is being asked to look at it.
  requested_by uuid not null,
  assigned_to uuid,
  subject_kind text not null
    check (subject_kind in ('document', 'patient', 'appointment', 'task', 'incoming_document', 'other')),
  subject_id uuid,
  patient_id uuid references practice_patient(id) on delete set null,
  area text,
  summary text not null check (char_length(summary) between 1 and 300),
  urgency text not null default 'routine' check (urgency in ('routine', 'urgent')),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  decided_by uuid,
  decided_at timestamptz,
  -- A rejection without words is a decision nobody can act on. Enforced in the engine.
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_approval_pending
  on practice_approval_request(workspace_id, status, urgency, created_at);
create index if not exists idx_practice_approval_assignee
  on practice_approval_request(workspace_id, assigned_to, status);

-- ---- 4. Capabilities -----------------------------------------------------------------------------------
--
-- No new capability. Granting an area is practice.members.manage, which is what granting a capability
-- already took; deciding an approval takes whatever the work itself would have taken, checked in the
-- engine against the request's subject.

-- ---- 5. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_delegation enable row level security;
alter table practice_role_template enable row level security;
alter table practice_approval_request enable row level security;

notify pgrst, 'reload schema';
