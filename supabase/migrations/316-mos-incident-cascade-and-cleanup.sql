-- CPR-CORE-MOS-001 phase 4, correction - the incident trail may be cascaded away with its incident.
--
-- APPLY THIS FILE WHOLE. It replaces a plpgsql trigger function with a dollar-quoted body, on the
-- pattern migration 247 established. A runner that splits on semicolons would cut the body in half.
--
-- WHAT WENT WRONG, AND HOW IT WAS FOUND
--
-- Migration 315 made mos_incident_event append only with a trigger that refuses UPDATE and DELETE
-- outright. That is correct for a direct write and wrong for a cascade: mos_incident_event references
-- mos_incident ON DELETE CASCADE, and the cascade issues a DELETE against the child, which the trigger
-- then refused. The effect was that AN INCIDENT WITH A LIFECYCLE ROW COULD NEVER BE REMOVED BY ANYBODY.
--
-- It surfaced as five test incidents left behind by the phase 4 harness. The harness deleted them in a
-- finally block, the delete was refused, and the harness did not read the error - so it reported clean
-- while the estate filled up. The Product Health screen then showed five identical incidents against a
-- practice that no longer exists, which is how it was noticed at all.
--
-- THE FIX, AND WHAT IT COSTS
--
-- The trigger now allows a DELETE that arrives at trigger depth greater than one - that is, one issued
-- by the cascade rather than by a caller. A direct DELETE is still refused, and UPDATE is still refused
-- unconditionally, so the trail remains immutable for as long as its incident exists.
--
-- NOTE  THE HONEST STATEMENT OF THE TRADE. Removing an incident now removes its history with it. That is a
-- weaker guarantee than "this trail can never be destroyed", and it is the right one: the alternative
-- was a record with no removal path at all, which is not immutability but an unbounded table. Deleting
-- an incident is a governed act on the INCIDENT, and s26's requirement is that history is never
-- SILENTLY MUTATED - not that a whole record can never be withdrawn.
--
-- NOTE  AND IT IS STILL NOT AN ARCHIVE. Nothing here preserves a removed incident anywhere. CPR-LIFE-001
-- reached the same junction for practice_audit_event and answered it with a decommissioning saga that
-- archives before it removes. An incident model that needs the same will need the same, and this
-- migration does not pretend otherwise.

create or replace function mos_incident_event_immutable()
returns trigger
language plpgsql
as $$
begin
  -- a DELETE arriving below the top trigger level came from the cascade on mos_incident, not from a
  -- caller reaching for this table, so the incident is being withdrawn as a whole
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'mos_incident_event is append only. % refused on incident event %', tg_op, old.id;
end;
$$;

-- ---- CLEAN UP THE FIXTURE RESIDUE -------------------------------------------------------------------
--
-- Five incidents raised by acceptance runs against practices that were removed afterwards. They are
-- identified by BOTH conditions together - the fixture title and an orphaned subject - so a real
-- incident that happens to share a title is not swept up with them.

delete from mos_incident
where title = 'Bookings failing for one practice'
  and subject_type = 'practice'
  and subject_id not in (select id::text from practice_workspace);

notify pgrst, 'reload schema';
