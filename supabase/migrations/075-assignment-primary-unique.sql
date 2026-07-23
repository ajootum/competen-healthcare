-- 075-assignment-primary-unique.sql
-- DATA-INTEGRITY FIX (SSW-XWI-TEST-001, P2): enforce one active PRIMARY clinician
-- per patient on op_patient_assignments.
--
-- PROBLEM: the assign flow (api/operations/assignments) does a non-atomic
-- "end the existing active primary, then insert the new one". A concurrent
-- double-submit / retry can interleave and leave TWO rows with
-- assignment_type='primary' AND status='active' for the same patient — i.e. two
-- responsible clinicians for one patient. There was no constraint to catch it.
--
-- FIX: a partial UNIQUE index on (patient_id) restricted to active primaries.
-- Supporting assignments and ended rows are unconstrained (a patient may have
-- several active supporting staff; one nurse may be primary for many patients).
--
-- Idempotent. Safe to re-run.

-- 1. Resolve any pre-existing duplicates so the unique index can be created.
--    Keep the most recent active primary per patient (max started_at, tie-broken
--    by id); end the older duplicates.
update op_patient_assignments a
set status = 'ended', ended_at = coalesce(a.ended_at, now())
where a.assignment_type = 'primary'
  and a.status = 'active'
  and exists (
    select 1 from op_patient_assignments b
    where b.patient_id = a.patient_id
      and b.assignment_type = 'primary'
      and b.status = 'active'
      and (b.started_at > a.started_at
           or (b.started_at = a.started_at and b.id > a.id))
  );

-- 2. Enforce the invariant going forward.
create unique index if not exists ux_patient_primary_assignment
  on op_patient_assignments (patient_id)
  where assignment_type = 'primary' and status = 'active';

-- NOTE (app-side follow-up, not required for this migration): the assign route
-- should also catch the unique-violation (Postgres error 23505) and return a
-- clean 409 instead of a 500, and ideally do the end-old + insert-new in a
-- single transaction / RPC. The index alone already prevents the bad state.
