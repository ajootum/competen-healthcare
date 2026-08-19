-- APPLY THIS FILE WHOLE. It defines a function body, so a statement-splitting runner would cut it in
-- half.
--
-- Migration 343: make "the latest attestation" deterministic (CPR-PD-014 section 6.4)
--
-- ============================ THE DEFECT THIS FIXES ============================
--
-- !! FOUND BY EXERCISING 340, NOT BY READING IT. The append-only trigger was proven on staging -- UPDATE
-- and DELETE are both refused -- and the same test then appended a SUPERSEDED row over an ATTESTED one
-- and asked plat_pd_launch_attestation_current which verdict stood. It answered ATTESTED.
--
-- The cause is that now() in PostgreSQL is TRANSACTION time, not statement time. Two attestations
-- recorded in one transaction carry an identical attested_at, and
--
--     select distinct on (control_id) ... order by control_id, attested_at desc
--
-- resolves that tie arbitrarily. There is no ordering to appeal to, so the row Postgres happens to
-- reach first wins. The ledger recorded both rows perfectly and the READ of it was undefined.
--
-- !! THIS IS NOT A TEST-ONLY EDGE. A supersession appended in the same request as the attestation it
-- replaces is the ordinary case, and any batch correction ties too. A governance ledger whose current
-- verdict depends on physical row order is not one an audit can rely on.
--
-- ============================ WHY A SEQUENCE AND NOT A BETTER TIMESTAMP ============================
--
-- clock_timestamp() would break the tie, and it would also make attested_at disagree with every other
-- audit timestamp in this estate, which all use now(). More importantly it would still tie under a
-- coarse clock and would leave correctness depending on how fast two inserts happen to be.
--
-- A bigserial is monotonic by construction: it answers "which row was appended later" without reference
-- to any clock, which is the actual question. attested_at keeps meaning "when the person attested" and
-- stops being asked to do a job it cannot do.
--
-- Existing rows are numbered in their current attested_at order, which is the best available answer for
-- rows written before this column existed and is exactly right wherever their timestamps already differ.

alter table pd_launch_attestation
  add column if not exists seq bigserial;

comment on column pd_launch_attestation.seq is
  'Monotonic append order. The current verdict for a control is the highest seq, because now() is transaction time and two attestations in one transaction share an attested_at (CPR-PD-014 section 6.4).';

create index if not exists pd_launch_attestation_seq_idx
  on pd_launch_attestation (control_id, release_ref, seq desc);


-- ---- The current verdict, now deterministic --------------------------------------------------------

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
  order by a.control_id, a.seq desc
$$;

notify pgrst, 'reload schema';
