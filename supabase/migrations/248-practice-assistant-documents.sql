-- ============================================================
-- MIGRATION 248: THE ASSISTANT CAN CLASSIFY A DOCUMENT BUT CANNOT OPEN THE WORKSPACE
-- CPR-DOC-002 s13
--
-- ----------------------------------------------------------------------------------------------------
-- s13: a practice assistant may "upload, classify, prepare drafts".
--
-- Today the assistant holds inbox.record and NOT document.view. The consequence is a workspace that is
-- half-open to them: they can record an arriving document at /practice/inbox and classify it through the
-- API, and then cannot open the Documents workspace at all, because every tab gates on document.view --
-- as the sidebar entry already does. The work is permitted and the place it belongs is shut.
--
-- Found while building CPR-DOC-002 Phase 1. Deliberately left for the user, because it widens what an
-- assistant can SEE and that is a decision about a practice's privacy posture rather than a defect.
-- Confirmed 2026-08-07: "The assistant should be able to upload documents etc."
--
-- WHAT THIS DOES NOT GRANT, AND WHY THE OMISSIONS ARE THE POINT:
--
--   document.sign    s7.1 makes signing a document a DISTINCT ACT from signing an encounter, and s13's
--                    own sentence stops at "prepare drafts". An assistant who could sign would be
--                    attesting as a clinician. This is the boundary the whole capability split exists to
--                    draw, and migration 194 drew the same one for encounters.
--   inbox.review     Reviewing an arriving result is a clinical judgement about whether it matters.
--                    Recording that one arrived is not. The assistant keeps the second and not the first.
--
-- document.author IS granted, because "prepare drafts" is authorship -- the assistant writes, the
-- practitioner signs. That sequence is the reason the two codes are separate.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- the runner splits on them, and one inside a comment silently drops the statements around
-- it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. THE CATALOGUE -------------------------------------------------------------------------------
--
-- Both codes already exist and are held by practitioner. Verified live against
-- practice_role_capabilities before this file was written, because six invented capability codes have
-- shipped on this product and every one of them looked plausible.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practice_assistant', 'document.view'),
  ('practice_assistant', 'document.author')
on conflict (role_code, capability_code) do nothing;

-- ---- 2. THE GRANT -----------------------------------------------------------------------------------
--
-- Capability resolution reads practice_role_assignment, NOT the catalogue, so section 1 on its own
-- grants nothing to anybody. This is the half migration 239 omitted, which left three pathway
-- capabilities catalogued and unreachable in every workspace that existed before it -- repaired by
-- migration 247 as a side effect, which is not a repair strategy anyone should rely on twice.
insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and c.role_code = 'practice_assistant'
  and c.capability_code in ('document.view', 'document.author')
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code
  );

notify pgrst, 'reload schema';
