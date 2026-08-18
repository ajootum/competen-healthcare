-- CPR-PD-010 phase 5 - Exceptions and Risk Acceptance, s12.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- THE THIRD TABLE IN THIS MODULE TO OMIT THE OBVIOUS COLUMN, AND THE SAME REASONING EACH TIME
--
--   321  the risk carries no score      so completing an action cannot lower it
--   322  the control carries no verdict so an untested control cannot read Effective
--   323  the exception carries no is_active flag
--
-- s12: "EXPIRED EXCEPTIONS CANNOT SILENTLY REMAIN ACTIVE." An is_active boolean is exactly how they do:
-- somebody sets it true on approval, the expiry passes, and the flag says true for ever unless a job
-- nobody wrote runs. The failure mode is silent and permanent and looks like a working control.
--
-- So active is DERIVED - approved, started, and not past expiry, evaluated whenever anybody looks. An
-- exception expires by the passage of time rather than by an update, which is the only way an expiry
-- can be trusted when the thing it protects against is inattention.
--
-- expires_on IS NOT NULL, WITH NO ESCAPE
--
-- s12 requires an expiry or review date on every exception. A nullable column would make "no expiry"
-- expressible, and a permanent exception is not an exception - it is an undocumented change of policy
-- with a governance record attached to make it look considered.
--
-- WHAT s19 BECOMES ENFORCEABLE HERE
--
-- s19: the Product Director "must not automatically self-approve every high-risk acceptance", and s12
-- adds that high or critical residual acceptance "may require higher governance authority than Product
-- Director". The capability grants for that already exist: hq.practice.risk.accept is held by
-- platform_director and chief_executive and NOT by practice_product_director. This migration adds the
-- half the database owns - an approver who is not the requester.

-- ---- 1. THE EXCEPTION (s12) -------------------------------------------------------------------------

create table if not exists gov_exception (
  exception_id  uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  -- s12 distinguishes two things people conflate. A WAIVER sets a requirement aside. A RISK ACCEPTANCE
  -- accepts a specific measured residual risk. Same lifecycle, different claim, and the register must
  -- be able to count them apart
  kind          text not null
                check (kind in ('exception', 'waiver', 'risk_acceptance')),

  title         text not null check (btrim(title) <> ''),
  -- s12: "scope, reason, affected control/obligation, compensating controls, risk assessment"
  scope         text not null check (btrim(scope) <> ''),
  reason        text not null check (btrim(reason) <> ''),

  affected_control_id uuid references gov_control(control_id) on delete set null,
  risk_id             uuid references gov_product_risk(risk_id) on delete set null,
  -- s12: risk acceptance "records the SPECIFIC RESIDUAL RISK BEING ACCEPTED, not a generic permission
  -- to ignore controls". So it points at one assessment - a score, made on a date, under a stated
  -- methodology - and not merely at the risk, whose score changes underneath it
  accepted_assessment_id uuid references gov_risk_assessment(assessment_id) on delete restrict,

  risk_summary  text,

  requested_by  text not null check (btrim(requested_by) <> ''),
  requested_at  timestamp with time zone not null default now(),
  owner_name    text,

  status        text not null default 'requested'
                check (status in ('requested', 'approved', 'rejected', 'withdrawn', 'closed')),
  approved_by   text,
  approved_at   timestamp with time zone,
  approval_authority text,
  rejection_reason text,

  starts_on     date not null default current_date,
  -- NOT NULL by design. See the header
  expires_on    date not null,
  review_on     date,

  -- s12: "Renewal requires reassessment and new approval, PRESERVE PRIOR HISTORY". A renewal is a new
  -- row pointing back, never an edited expiry on the old one
  renews_exception_id uuid references gov_exception(exception_id) on delete set null,

  closed_at     timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_exception_window_is_ordered
    check (expires_on > starts_on),
  constraint gov_exception_approved_is_attributed
    check ((status = 'approved') = (approved_by is not null and approved_at is not null)),
  constraint gov_exception_rejected_is_explained
    check ((status = 'rejected') = (rejection_reason is not null)),
  -- s19 and s12: the approver is not the requester. The one rule that makes an approval mean anything
  constraint gov_exception_approver_is_not_requester
    check (approved_by is null or btrim(lower(approved_by)) <> btrim(lower(requested_by))),
  -- a risk acceptance accepts a MEASURED residual, so it names the assessment it accepted
  constraint gov_exception_acceptance_names_its_assessment
    check (kind <> 'risk_acceptance' or accepted_assessment_id is not null),
  constraint gov_exception_not_its_own_renewal
    check (renews_exception_id is null or renews_exception_id <> exception_id)
);

comment on table gov_exception is
  'CPR-PD-010 s12 exception, waiver and risk acceptance. Carries NO is_active flag - active is derived from the dates, because an expired exception that stays true until a job runs is exactly what s12 forbids.';

alter table gov_exception enable row level security;

create index if not exists idx_gov_exception_live on gov_exception (status, expires_on);
create index if not exists idx_gov_exception_risk on gov_exception (risk_id);
create index if not exists idx_gov_exception_control on gov_exception (affected_control_id);

-- ---- 2. COMPENSATING CONTROLS (s12) -----------------------------------------------------------------
--
-- s12 requires compensating controls on an exception. Many to many: one exception may lean on several,
-- and one control may compensate for several exceptions. A text column would let somebody type
-- "monitoring" and have it count as a compensating control that nobody owns and nothing tests.

create table if not exists gov_exception_compensating_control (
  exception_id uuid not null references gov_exception(exception_id) on delete cascade,
  control_id   uuid not null references gov_control(control_id) on delete cascade,
  note         text,
  linked_at    timestamp with time zone not null default now(),
  primary key (exception_id, control_id)
);

comment on table gov_exception_compensating_control is
  'CPR-PD-010 s12 compensating controls. A real link to a real control, so a compensating control is something that exists and is tested rather than a word typed into a field.';

alter table gov_exception_compensating_control enable row level security;

-- ---- 3. THE LIFECYCLE TRAIL (s20) -------------------------------------------------------------------

create table if not exists gov_exception_event (
  event_id     uuid primary key default gen_random_uuid(),
  exception_id uuid not null references gov_exception(exception_id) on delete cascade,
  at           timestamp with time zone not null default now(),
  actor_name   text,
  from_status  text,
  to_status    text,
  reason       text,
  note         text
);

alter table gov_exception_event enable row level security;

create index if not exists idx_gov_exception_event on gov_exception_event (exception_id, at desc);

create or replace function gov_exception_event_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'CPR-PD-010 s20: gov_exception_event is append only. % refused on event %.', tg_op, old.event_id;
end;
$$;

drop trigger if exists trg_gov_exception_event_immutable on gov_exception_event;
create trigger trg_gov_exception_event_immutable
  before update or delete on gov_exception_event
  for each row execute function gov_exception_event_immutable();

-- ---- 4. AN EXPIRED EXCEPTION CANNOT BE RE-APPROVED IN PLACE (s12) -----------------------------------
--
-- s12: "Renewal requires reassessment and new approval, preserve prior history." Extending expires_on
-- on an approved exception is renewal without either - the quiet path this rule exists to close, and
-- the one a hurried operator will always find first.

create or replace function gov_exception_no_silent_renewal()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'approved' and new.status = 'approved'
     and new.expires_on is distinct from old.expires_on then
    raise exception
      'CPR-PD-010 s12: an approved exception cannot have its expiry extended in place. Renewal requires a NEW exception referencing this one through renews_exception_id, so the prior approval and its window survive.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_exception_no_silent_renewal on gov_exception;
create trigger trg_gov_exception_no_silent_renewal
  before update on gov_exception
  for each row execute function gov_exception_no_silent_renewal();

-- ---- 5. THE DERIVED VIEW, SO EVERY READER AGREES ON "ACTIVE" ----------------------------------------
--
-- One definition of live, in the database, rather than a filter each caller writes for itself. Two
-- surfaces disagreeing about whether an exception is still in force is how one of them keeps relying
-- on it.

create or replace view gov_exception_live as
select
  e.*,
  (e.status = 'approved'
   and e.starts_on <= current_date
   and e.expires_on >= current_date) as is_live,
  (e.status = 'approved' and e.expires_on < current_date) as is_expired,
  (e.expires_on - current_date) as days_to_expiry
from gov_exception e;

comment on view gov_exception_live is
  'CPR-PD-010 s12. is_live and is_expired are computed from the dates at read time, so an exception lapses by the passage of time rather than by somebody remembering to update a flag.';

-- ---- 6. NOTHING IS SEEDED ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
