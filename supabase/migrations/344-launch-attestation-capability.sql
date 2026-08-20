-- ============================================================
-- MIGRATION 344: THE LAUNCH ATTESTATION CAPABILITY (CPR-IAM-001 s14.1, CPR-PD-012 s21)
--
-- Launch Readiness holds three controls that only a person can satisfy, and the screen says so:
-- "Recording an attestation is not yet possible, the authorised write path is pending." The ledger
-- has existed since migration 340 and nothing anywhere writes to it, because the ledger records
-- attested_by_capability and no capability existed to name.
--
-- ============================================================ WHY A NEW CODE, NOT AN EXISTING ONE
--
-- Three candidates were considered and two were rejected on governance grounds.
--
--   hq.practice.flags.manage      flips the launch flags. Letting the flag-flipper also attest that the
--                                 controls are met collapses the act of DOING something with the act of
--                                 saying it was done, which is the whole of what an attestation is for.
--
--   hq.practice.change.approve    PD-012 s21 makes this the CHECKER half of maker-checker and it is
--                                 deliberately held by nobody. Granting it to make attestation possible
--                                 would quietly hand the Product Director the approval authority that
--                                 section exists to withhold.
--
--   hq.practice.launch.attest     new, and narrow: it records a statement of fact about a control, and
--                                 authorises nothing else.
--
-- ============================================================ ATTESTING IS NOT APPROVING
--
-- This distinction is the reason the new code is safe to grant to the Product Director, and it must
-- survive any later reading of this file.
--
-- The three controls are EVIDENCE, not decisions. "A person signed in cold, from signed out, with their
-- own credentials" and "controlled internal and pilot-user acceptance testing" are things that either
-- happened or did not. The person who ran them is the only person who can say so, and that person is
-- the Product Director, whose job is Practice product operations.
--
-- APPROVING THE TRANSITION TO PUBLIC SIGNUP IS A DIFFERENT ACT and this capability does not confer it.
-- The gate still requires every control. Attesting a control does not open the product, does not flip a
-- flag, and does not approve a change. hq.practice.change.approve remains unheld, exactly as PD-012 s21
-- intends, and this migration does not grant it to anybody.
--
-- ============================================================ WHAT THIS DOES NOT DO
--
-- It does not create a write path. The engine, the route and the control are application code, gated on
-- the capability created here. A capability with no enforcement is the inert grant the CPR-PD-013 s9
-- pass reported for export.execute and licence.verify, and pd-screen-doctrine-harness now ratchets
-- against exactly that, so this code is expected to be enforced by a route in the same change set.
--
-- ============================================================ ON CONFLICT, AND A CORRECTION
--
-- !! THE HEADER OF MIGRATION 311 SAYS hq_position_capability HAS NO UNIQUE CONSTRAINT ON
-- (position_code, capability_code) AND THAT on conflict CANNOT BE USED. That is false. Migration 264
-- line 92 creates uq_hq_position_capability on exactly that pair, and a duplicate insert was probed
-- against the live database and refused with 23505. The insert-select workaround in migration 311 was
-- written around a constraint that was already there, so this file uses the plain form.
--
-- !! AND THE INDEX CONTRADICTS THE TEMPORAL COLUMNS, which is worth recording rather than fixing here.
-- effective_from and effective_to exist so a capability can be revoked and later regranted, and a
-- UNIQUE index on the pair forbids the second grant outright. Nothing in this migration depends on
-- regranting, so it is left alone and named for whoever meets it.
-- ============================================================

insert into hq_capability (code, space, label, description) values
  ('hq.practice.launch.attest', 'practice', 'Attest a launch control',
   'Record a human attestation against a Competen Practice launch control. States what was observed. Does not approve a transition, flip a flag or open the product.')
on conflict (code) do nothing;

-- The Product Director runs Practice product operations, so they are the person who performs the
-- controls and therefore the only person who can honestly say what happened.
insert into hq_position_capability (position_code, capability_code, source)
values ('practice_product_director', 'hq.practice.launch.attest', 'position_default')
on conflict (position_code, capability_code) do nothing;

comment on table pd_launch_attestation is
  'Append-only human attestations against launch controls (CPR-IAM-001 s14.1). Written only by a holder of hq.practice.launch.attest, created by migration 344. An attestation states what was observed and authorises nothing - approving the transition to public signup is hq.practice.change.approve, which PD-012 s21 keeps separate and which no position holds.';

notify pgrst, 'reload schema';
