-- ============================================================
-- MIGRATION 348: BOOKING PAGES ADOPT THE HANDLE THAT WAS ALREADY CLAIMED
--
-- THE FINDING. There are two columns called handle. practice_practitioner_identity.handle is the claim a
-- practitioner makes in Practice Setup. practice_booking_access.handle is the foreign key migration 254
-- added so a patient can reach that practice at /@handle. 254 made the second ON UPDATE CASCADE, so
-- CHANGING a handle later moves the booking page with it automatically -- and from there everything,
-- including this repo's own comments, assumed the column looked after itself.
--
-- Nothing ever performed the FIRST write. No engine, no API route, no screen set it. The column has been
-- null on every booking page that has ever existed, which made the HANDLE_CLAIMED publish blocker
-- unsatisfiable through the product: a practitioner who had claimed @elisham1 -- and whose Practice Setup
-- header displayed it -- was told two clicks away that no handle had been claimed, with no action
-- available anywhere that would have changed the answer.
--
-- THE CODE FIX IS THE PRIMARY ONE, AND THIS IS NOT IT. claimHandle now writes the handle onto the page it
-- finds, and creating a page seeds it from the practice's own claimed identity, so either order of the
-- two acts now lands in the same place. Neither of those helps a page that already exists and whose owner
-- already claimed: the claim will not happen a second time, and a settings save deliberately never moves
-- a handle. So exactly those rows need one write, once, which is this.
--
-- WHY THE COUNT SUBQUERY IS NOT DEFENSIVE CLUTTER. One page carries one handle
-- (ux_practice_booking_access_handle). When two practitioners have both pointed their identity at one
-- workspace there is no non-arbitrary way to choose between them, and picking the older row would print
-- one clinician's personal address on a practice they share. Those rows are left null on purpose: the
-- readiness check now says so in those words, and a person decides. The application helper
-- handleForWorkspace applies the same rule, so a page backfilled here and a page created tomorrow agree.
--
-- REVERSIBILITY. Setting a handle publishes nothing. publish_state and mode are untouched, so every page
-- this writes to stays exactly as findable as it was a moment before.
-- ============================================================

update practice_booking_access ba
set handle = i.handle,
    updated_at = now()
from practice_practitioner_identity i
where ba.handle is null
  and i.handle is not null
  and i.primary_workspace_id = ba.workspace_id
  and (
    select count(*)
    from practice_practitioner_identity i2
    where i2.primary_workspace_id = ba.workspace_id
      and i2.handle is not null
  ) = 1;

-- House rules require this last. For a DATA-ONLY migration it is a no-op -- no schema changed, so
-- PostgREST has nothing stale to cache -- but the gate exists so nobody has to judge that case by eye.
notify pgrst, 'reload schema';
