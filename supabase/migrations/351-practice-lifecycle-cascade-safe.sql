-- 351 CPR-DEL-001 CASCADE-SAFE IMMUTABILITY FOR practice_lifecycle_transition
--
-- APPLY THIS FILE WHOLE. It contains a plpgsql function body delimited by dollar quotes, and a runner
-- that splits on semicolons would cut that body in half and apply the pieces.
--
-- IMPLEMENTS: CPR-DEL-001 s2 (frozen decision), s5 (migration requirements), s16 (developer instruction).
-- EVIDENCE:   docs/CPR-DEL-001-INVENTORY-001-practice-deletion.md, addenda 1 to 3.
--
-- ONE TABLE, AND s5 ASKS FOR THE INCLUSION REASON. practice_lifecycle_transition is the only
-- DEMONSTRATED blocker of a practice workspace deletion. The staging fixture seeded both ends of every
-- other candidate -- facility, patient, encounter, both identifiers, pathway template, stage, patient
-- pathway, patient pathway stage, charge, invoice, invoice item -- and the delete SUCCEEDED, three times,
-- and again with the invoice issued. Static analysis had predicted eight blockers. The database has one.
-- Nine tables that a topology-driven migration would have touched need nothing, and are not touched here.

-- ---- 1. THE TRIGGER ------------------------------------------------------------------------------
--
-- The canonical pattern, copied from gov_decision_event_immutable rather than invented -- s2 forbids a
-- Practice-only mechanism where a proven one exists. pg_trigger_depth() > 1 is true only when this
-- DELETE was caused by another trigger or a referential action, which is precisely the authorized parent
-- cascade. A practitioner or an engine issuing DELETE directly runs at depth 1 and is still refused.
--
-- WHAT DOES NOT CHANGE, because s2 and s5 both require it: UPDATE is refused at every depth, and a direct
-- DELETE is refused exactly as before. The trail stays append only. The only new behaviour is that the
-- trail no longer outlives the workspace it belongs to.

create or replace function practice_lifecycle_transition_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'practice_lifecycle_transition is append only. % refused on transition %', tg_op, old.id;
end;
$$;

-- ---- 2. THE FOREIGN KEY --------------------------------------------------------------------------
--
-- THE TRIGGER ALONE CHANGES NOTHING, and the fixture is why this is stated rather than assumed. With the
-- FK left as NO ACTION the parent delete is refused before any cascade begins, so the allowance above
-- would never fire and practice deletion would still be impossible -- while LOOKING corrected.
--
-- 247's header called this brake deliberate, "while still permitting a full cascade if one is ever built
-- to run in the right order". The staging fixture established that no such ordering exists: the service
-- would have to issue a direct DELETE, which the trigger refuses at depth 1 by design. So the brake and
-- the append-only rule cannot both stand as written -- the door was locked from both sides. This is the
-- cascade that sentence anticipated.
--
-- Drop-then-add rather than a DO block: the runner splits on semicolons and this database has no
-- plpgsql outside function bodies. Both statements are safe to re-run.

alter table practice_lifecycle_transition
  drop constraint if exists practice_lifecycle_transition_workspace_id_fkey;

alter table practice_lifecycle_transition
  add constraint practice_lifecycle_transition_workspace_id_fkey
  foreign key (workspace_id) references practice_workspace(id) on delete cascade;

-- actor_membership_id stays NO ACTION deliberately. practice_membership is itself a cascade child of the
-- workspace, so both rows go in one statement and NO ACTION -- checked at end of statement -- passes.
-- Changing it would be the unrelated FK topology drift s5 forbids.

notify pgrst, 'reload schema';
