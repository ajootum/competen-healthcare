-- APPLY THIS FILE WHOLE. It defines function bodies, so a statement-splitting runner would cut them in
-- half.
--
-- Migration 340: the human attestation ledger (CPR-PD-014 section 8.2)
--
-- ============================ WHAT THIS IS FOR ============================
--
-- Section 6.4 replaces prose-only manual gate items with governed attestation rows: a control, a status,
-- an owner, evidence, who attested and when, and against which build. Section 12 requires launch human
-- attestations to be persisted, attributable and auditable. Today they are none of those -- the manual
-- half of the gate is a sentence on a page, and a sentence cannot be attributed to anybody.
--
-- ============================ APPEND-ONLY BY CONSTRUCTION, NOT BY POLICY ============================
--
-- !! THERE IS NO MUTABLE status COLUMN, AND THAT IS THE DESIGN. A ledger whose rows can be updated is a
-- table with a history-shaped name. Each row here is an attestation EVENT: attesting appends, rejecting
-- appends, superseding appends. The CURRENT verdict for a control is the latest row for that control and
-- release, which plat_pd_launch_attestation_current() computes.
--
-- Section 6.4 also says a new release may invalidate an attestation "only according to an explicit
-- control rule, never silently". Because attestation is scoped to release_ref, a new build simply has no
-- row yet -- it reads as AWAITING rather than inheriting a tick from the build that was tested. Nothing
-- is invalidated silently because nothing is carried forward at all.
--
-- The UPDATE and DELETE refusal below follows the cascade-allowance idiom this estate already uses
-- (316, 318, 319): pg_trigger_depth() > 1 lets a parent row be deleted while a hand-written DELETE is
-- refused. Without it this repo has twice produced a trail that nobody could ever remove.
--
-- ============================ WHAT IS DELIBERATELY NOT HERE ============================
--
-- !! NO EVIDENCE BLOB. evidence_ref is a POINTER -- a document id, a URL, a run identifier. Section 6.4
-- says "reference or attachment pointer, no invented evidence". Storing the artefact itself would put
-- material of unknown provenance and unknown sensitivity into the operations plane.
--
-- !! NO attestor_name. The identity is a uuid. A display name copied at write time is a name that goes
-- stale and a second place to leak one, and the plane boundary already governs how a name is resolved
-- for display.

create table if not exists pd_launch_attestation (
  id            uuid primary key default gen_random_uuid(),

  -- The stable control identifier. It matches GateItem.id for the manual half of the gate, so a control
  -- keeps its history across renames of its human label.
  control_id    text not null check (btrim(control_id) <> ''),

  -- Product, environment, build or release reference: WHAT WAS ACTUALLY TESTED (section 6.4). Free text
  -- because the estate has no single release identifier yet -- a git sha, a release tag and an
  -- environment name are all legitimate answers, and inventing an enum would force a wrong one.
  release_ref   text not null check (btrim(release_ref) <> ''),

  verdict       text not null check (verdict in ('ATTESTED', 'REJECTED', 'SUPERSEDED')),

  -- Attributability: who, holding what, when. The capability is recorded AS HELD AT THE TIME, because a
  -- grant can be revoked later and an audit asks what was true when the attestation was made.
  attested_by            uuid not null,
  attested_by_capability text not null check (btrim(attested_by_capability) <> ''),
  attested_at            timestamptz not null default now(),

  evidence_ref  text,
  note          text,

  -- Optional expiry (section 8.2). Null means it does not expire on its own.
  expires_at    timestamptz,

  -- A superseding row names the row it replaces, so the chain is explicit rather than inferred by time.
  supersedes_id uuid references pd_launch_attestation(id) on delete set null,

  created_at    timestamptz not null default now()
);

alter table pd_launch_attestation enable row level security;

create index if not exists pd_launch_attestation_control_idx
  on pd_launch_attestation (control_id, release_ref, attested_at desc);


-- ---- Append-only ----------------------------------------------------------------------------------

create or replace function pd_launch_attestation_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A cascade may remove a row when its parent goes. A person may not.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'pd_launch_attestation is append-only: % refused. Record a new attestation instead.', tg_op;
end;
$$;

drop trigger if exists pd_launch_attestation_no_update on pd_launch_attestation;
create trigger pd_launch_attestation_no_update
  before update or delete on pd_launch_attestation
  for each row execute function pd_launch_attestation_immutable();


-- ---- The current verdict per control --------------------------------------------------------------
--
-- Latest row wins, scoped to control AND release. A control with no row for the release under test
-- simply does not appear, and the screen renders it as AWAITING -- an absence, not a failure.

create or replace function plat_pd_launch_attestation_current(p_release_ref text)
returns table(
  control_id             text,
  release_ref            text,
  verdict                text,
  attested_by            uuid,
  attested_by_capability text,
  attested_at            timestamptz,
  evidence_ref           text,
  note                   text,
  expires_at             timestamptz,
  expired                boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (a.control_id)
    a.control_id, a.release_ref, a.verdict, a.attested_by, a.attested_by_capability,
    a.attested_at, a.evidence_ref, a.note, a.expires_at,
    (a.expires_at is not null and a.expires_at < now())
  from public.pd_launch_attestation a
  where a.release_ref = p_release_ref
  order by a.control_id, a.attested_at desc
$$;

revoke all on function plat_pd_launch_attestation_current(text) from public;

revoke all on function plat_pd_launch_attestation_current(text) from anon;

grant execute on function plat_pd_launch_attestation_current(text) to service_role;

notify pgrst, 'reload schema';
