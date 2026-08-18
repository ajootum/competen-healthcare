-- CPR-PD-010 phase 7 - Audit and Evidence, s13.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- THE FIFTH TABLE IN THIS MODULE TO OMIT THE OBVIOUS COLUMN
--
--   321  the risk carries no score        so completing an action cannot lower it
--   322  the control carries no verdict   so an untested control cannot read Effective
--   323  the exception carries no is_active
--   324  the decision carries no in_effect
--   325  the evidence carries no is_valid
--
-- s22: "Evidence stale - show stale/expired, DO NOT TREAT CONTROL AS EVIDENCED." An is_valid boolean is
-- how a control stays evidenced by a certificate that expired in March: somebody set it true when the
-- evidence was collected, and nothing has been false since.
--
-- Validity is DERIVED from valid_until against today. Evidence goes stale by the passage of time, which
-- is the only mechanism that works when the failure mode is that nobody is looking.
--
-- THE LINK TABLE USES TYPED PARENTS, AND THAT IS A LESSON RATHER THAN A PREFERENCE
--
-- s13 requires evidence to link to controls, obligations, risks and findings - naturally polymorphic.
-- Migration 318 built exactly that shape with a record_type word and a bare uuid, and migration 319 had
-- to replace it: with no foreign key nothing cascaded, and the append-only trigger refused a direct
-- delete, so a trail row could not be removed BY ANYBODY. Five typed nullable keys with an exactly-one
-- CHECK is what 319 arrived at, and it is what this migration starts from.
--
-- AND NO FILE IS STORED HERE
--
-- s13: "DO NOT DUPLICATE AUTHORITATIVE EVIDENCE FILES UNNECESSARILY, store governed references where
-- appropriate." So this is an INDEX of where evidence lives, not a copy of it. The same position
-- CPR-320 took on incoming clinical documents: a location named honestly beats a second copy that
-- drifts from the authoritative one and has its own retention question.

-- ---- 1. THE EVIDENCE INDEX (s13) --------------------------------------------------------------------

create table if not exists gov_evidence (
  evidence_id   uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  title         text not null check (btrim(title) <> ''),
  description   text,

  -- s20: "System-generated evidence and human attestations are DISTINGUISHABLE." Not a boolean, because
  -- s13 names four kinds and an attestation is not merely "not automated" - it is somebody's word,
  -- which is a different thing to weigh than an export from a system of record
  evidence_kind text not null
                check (evidence_kind in ('system_generated', 'document', 'attestation',
                                         'external_assurance')),

  -- s13: "source, ... owner, collection date, validity/expiry, classification and access restrictions"
  source_system text,
  source_ref    text,
  -- where the authoritative copy lives. Named rather than duplicated
  held_at       text,

  owner_name    text,
  collected_at  timestamp with time zone,
  collected_by  text,

  -- NULL means "does not expire", which is legitimate for a signed attestation about a past event but
  -- wrong for a penetration test. The distinction is the evidence owner's to make, so it is nullable
  -- here and surfaced on screen rather than guessed at
  valid_from    date,
  valid_until   date,

  classification text not null default 'internal'
                 check (classification in ('public', 'internal', 'confidential', 'restricted')),
  -- s8/s19: restricted records stay restricted in search, notifications, exports and cross-module links
  is_restricted boolean not null default false,
  restriction_reason text,

  superseded_by_evidence_id uuid references gov_evidence(evidence_id) on delete set null,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_evidence_window_is_ordered
    check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint gov_evidence_restriction_is_explained
    check (not is_restricted or btrim(coalesce(restriction_reason, '')) <> ''),
  -- s13 wants a collection date on evidence. An attestation nobody dated cannot be aged, and undated
  -- evidence that never goes stale is the quiet version of the is_valid bug this table avoids
  constraint gov_evidence_collected_is_attributed
    check ((collected_at is null) = (collected_by is null)),
  constraint gov_evidence_not_its_own_successor
    check (superseded_by_evidence_id is null or superseded_by_evidence_id <> evidence_id)
);

comment on table gov_evidence is
  'CPR-PD-010 s13 evidence index. Carries NO is_valid column - staleness is derived from valid_until, because a flag set at collection time keeps a control evidenced by a certificate that expired months ago.';

alter table gov_evidence enable row level security;

create index if not exists idx_gov_evidence_expiry on gov_evidence (valid_until);
create index if not exists idx_gov_evidence_kind on gov_evidence (evidence_kind, collected_at desc);

-- ---- 2. WHAT THE EVIDENCE SUPPORTS - TYPED PARENTS (s13) --------------------------------------------

create table if not exists gov_evidence_link (
  link_id       uuid primary key default gen_random_uuid(),
  evidence_id   uuid not null references gov_evidence(evidence_id) on delete cascade,

  -- exactly one of these. See the header for why this is not a record_type word plus a bare uuid
  control_id    uuid references gov_control(control_id) on delete cascade,
  risk_id       uuid references gov_product_risk(risk_id) on delete cascade,
  exception_id  uuid references gov_exception(exception_id) on delete cascade,
  decision_id   uuid references gov_decision(decision_id) on delete cascade,
  control_test_id uuid references gov_control_test(test_id) on delete cascade,

  note          text,
  linked_at     timestamp with time zone not null default now(),

  constraint gov_evidence_link_one_parent
    check (
      (case when control_id is not null then 1 else 0 end)
      + (case when risk_id is not null then 1 else 0 end)
      + (case when exception_id is not null then 1 else 0 end)
      + (case when decision_id is not null then 1 else 0 end)
      + (case when control_test_id is not null then 1 else 0 end) = 1
    )
);

comment on table gov_evidence_link is
  'CPR-PD-010 s13 evidence linkage. Typed nullable parents with an exactly-one CHECK, on the pattern migration 319 had to introduce after a polymorphic pair left rows nobody could delete.';

alter table gov_evidence_link enable row level security;

create index if not exists idx_gov_evidence_link_control on gov_evidence_link (control_id);
create index if not exists idx_gov_evidence_link_risk on gov_evidence_link (risk_id);

-- ---- 3. AUDIT AND REVIEW REQUESTS (s13) -------------------------------------------------------------
--
-- s13: "Audit/review requests track requested evidence, owner, due date, supplied state and reviewer
-- outcome."

create table if not exists gov_audit_request (
  request_id    uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  title         text not null check (btrim(title) <> ''),
  requested_by  text not null check (btrim(requested_by) <> ''),
  requester_org text,
  owner_name    text,
  what_is_requested text not null check (btrim(what_is_requested) <> ''),
  due_on        date,

  state         text not null default 'open'
                check (state in ('open', 'in_progress', 'supplied', 'accepted', 'rejected', 'withdrawn')),
  supplied_at   timestamp with time zone,
  reviewed_by   text,
  reviewed_at   timestamp with time zone,
  reviewer_outcome text,

  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_audit_request_supplied_is_dated
    check ((state in ('supplied', 'accepted', 'rejected')) = (supplied_at is not null)),
  -- an outcome is a review somebody performed, so it names them and when
  constraint gov_audit_request_review_is_attributed
    check ((reviewed_at is null) = (reviewed_by is null)),
  constraint gov_audit_request_rejection_is_reasoned
    check (state <> 'rejected' or btrim(coalesce(reviewer_outcome, '')) <> '')
);

alter table gov_audit_request enable row level security;

create index if not exists idx_gov_audit_request_open on gov_audit_request (state, due_on);

create table if not exists gov_audit_request_evidence (
  request_id  uuid not null references gov_audit_request(request_id) on delete cascade,
  evidence_id uuid not null references gov_evidence(evidence_id) on delete cascade,
  supplied_at timestamp with time zone not null default now(),
  primary key (request_id, evidence_id)
);

alter table gov_audit_request_evidence enable row level security;

-- ---- 4. FINDINGS (s13) ------------------------------------------------------------------------------
--
-- s13: "Findings link to risks, controls and corrective actions." A finding is what an audit produced
-- and it must be able to generate work, so it points at the risk register and the control catalogue
-- rather than restating them.

create table if not exists gov_audit_finding (
  finding_id    uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  request_id    uuid references gov_audit_request(request_id) on delete set null,
  control_id    uuid references gov_control(control_id) on delete set null,
  risk_id       uuid references gov_product_risk(risk_id) on delete set null,
  control_test_id uuid references gov_control_test(test_id) on delete set null,

  title         text not null check (btrim(title) <> ''),
  detail        text,
  -- deliberately NOT the incident severity vocabulary. s6 findings are deficiencies in assurance, and
  -- borrowing SEV-1..SEV-4 would invite a reader to compare a control gap with a live outage
  severity      text not null default 'moderate'
                check (severity in ('minor', 'moderate', 'major', 'critical')),

  raised_by     text,
  raised_at     timestamp with time zone not null default now(),
  owner_name    text,
  due_on        date,

  state         text not null default 'open'
                check (state in ('open', 'accepted', 'in_remediation', 'remediated', 'closed', 'disputed')),
  -- s15's rule again, in its s13 form: a finding is not closed by somebody saying so, it is closed by
  -- evidence that the deficiency is gone
  closing_evidence_id uuid references gov_evidence(evidence_id) on delete set null,
  closed_at     timestamp with time zone,
  dispute_reason text,

  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_finding_closed_is_dated
    check ((state = 'closed') = (closed_at is not null)),
  constraint gov_finding_dispute_is_reasoned
    check (state <> 'disputed' or btrim(coalesce(dispute_reason, '')) <> '')
);

comment on table gov_audit_finding is
  'CPR-PD-010 s13 audit finding. severity is deliberately NOT the incident vocabulary - a control deficiency and a live outage are not comparable and sharing SEV-1..SEV-4 would invite the comparison.';

alter table gov_audit_finding enable row level security;

create index if not exists idx_gov_finding_open on gov_audit_finding (state, due_on);
create index if not exists idx_gov_finding_control on gov_audit_finding (control_id);

-- ---- 5. A CLOSED FINDING NEEDS ITS CLOSING EVIDENCE (s13, s15) --------------------------------------

create or replace function gov_finding_closed_is_evidenced()
returns trigger
language plpgsql
as $$
begin
  if new.state = 'closed' and new.closing_evidence_id is null then
    raise exception
      'CPR-PD-010 s13: finding % cannot be closed without closing evidence. A deficiency is closed by evidence that it is gone, not by somebody marking it closed.',
      new.reference;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_finding_closed_is_evidenced on gov_audit_finding;
create trigger trg_gov_finding_closed_is_evidenced
  before insert or update on gov_audit_finding
  for each row execute function gov_finding_closed_is_evidenced();

-- and that closing evidence must not itself be expired at the moment of closure
create or replace function gov_finding_closing_evidence_is_current()
returns trigger
language plpgsql
as $$
declare
  vu date;
begin
  if new.closing_evidence_id is null then
    return new;
  end if;
  select valid_until into vu from gov_evidence where evidence_id = new.closing_evidence_id;
  if vu is not null and vu < current_date then
    raise exception
      'CPR-PD-010 s22: the evidence closing finding % expired on %. Stale evidence does not evidence anything.',
      new.reference, vu;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_finding_closing_evidence_current on gov_audit_finding;
create trigger trg_gov_finding_closing_evidence_current
  before insert or update on gov_audit_finding
  for each row execute function gov_finding_closing_evidence_is_current();

-- ---- 6. THE DERIVED VIEW (s13, s22) -----------------------------------------------------------------

create or replace view gov_evidence_live as
select
  e.*,
  (e.valid_until is not null and e.valid_until < current_date) as is_expired,
  (e.superseded_by_evidence_id is not null) as is_superseded,
  (
    e.collected_at is not null
    and e.superseded_by_evidence_id is null
    and (e.valid_from is null or e.valid_from <= current_date)
    and (e.valid_until is null or e.valid_until >= current_date)
  ) as is_current,
  (e.valid_until - current_date) as days_to_expiry
from gov_evidence e;

comment on view gov_evidence_live is
  'CPR-PD-010 s13/s22. is_current is computed at read time, so evidence goes stale by the passage of time rather than by somebody remembering to clear a flag.';

-- ---- 7. NOTHING IS SEEDED ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
