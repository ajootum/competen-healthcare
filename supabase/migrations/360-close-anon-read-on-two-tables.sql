-- 360 CLOSE AN ANONYMOUS READ ON TWO TABLES CARRYING CLINICAL DATA
--
-- WHAT IS WRONG RIGHT NOW. Two tables are readable by anyone holding the ANON key, which ships in the
-- browser bundle and is public by design. No login, no membership, no session:
--
--     practice_document_fact          4 of 4 rows readable
--     practice_referral_destination   1 of 1 row readable
--
-- What an anonymous reader currently gets from practice_document_fact:
--
--     [diagnosis]  Pneumonia :: confirmed
--     [treatment]  Amoxicillin with Clavulanic Acid :: 750 - Oral - Twice a day (BD)
--     [medication] Amoxicillin with Clavulanic Acid :: 750 mg - Oral - Twice a day (BD)
--     [follow_up]  Review for Response to Current Treatment :: due 2026-08-19
--
-- That is clinical information about a real patient of a real practice. The rows also carry
-- workspace_id, document_id and source_id, so they are joinable to the practice and to the record they
-- came from. practice_referral_destination carries display_name, facility, address, phone and email
-- for referral targets.
--
-- WHY IT HAPPENED, AND WHY THAT MATTERS MORE THAN THE FIX. Migrations 352 and 353 BOTH CONTAIN the
-- correct statement:
--
--     352 line 67   alter table practice_referral_destination enable row level security
--     353 line 59   alter table practice_document_fact enable row level security
--
-- The statements are present, correct, and target the right tables. Production has RLS OFF on both
-- anyway, so those two statements did not take when the files were applied. Neither file violates the
-- house rules -- no semicolons inside comments, so a semicolon-splitting runner would have produced
-- them as discrete statements. The most likely explanation is a partial apply: the file was run before
-- those lines existed, or the run stopped short of them.
--
-- !! WHICH MEANS A MIGRATION CONTAINING A SECURITY STATEMENT IS NOT EVIDENCE THE STATEMENT IS IN FORCE.
-- The repository said these tables were protected. Production disagreed. Only asking the database
-- settled it -- scripts/anon-exposure-harness.ts, which probes all 671 public tables with the anon key
-- and reports what actually comes back.
--
-- !! AND THAT HARNESS ALREADY EXISTED. It was not in ci-harnesses.ts and had not been run, so the
-- exposure sat there from the day 352 and 353 were applied. The control was written, correct, and
-- unwired.
--
-- WHAT THIS FILE DOES. Enables row level security on both tables, with NO policies -- which is the
-- posture every other practice_* table already has and which CLAUDE.md records as load-bearing:
-- RLS enabled, zero policies, deny-all to anon, and the service role bypassing it entirely so the
-- application keeps working through its own guards. Nothing about how the product reads these tables
-- changes, because the product reads them with the service role.
--
-- SAFE TO RE-RUN. `enable row level security` on a table that already has it is a no-op.

alter table practice_document_fact enable row level security;

alter table practice_referral_destination enable row level security;

-- ---- THE FOUR THAT CANNOT BE CHECKED, RE-ASSERTED ANYWAY ----------------------------------------
--
-- scripts/migration-verify.ts can only test an RLS claim by asking the anon key whether it reads rows
-- the service role can see. For a table holding NO ROWS the answer is empty either way, so these four
-- report CANNOT VERIFY rather than a pass. Their own migrations do claim RLS, exactly as 352 and 353
-- did -- and 352 and 353 were wrong.
--
-- !! TWO OF THEM ARE THE BILLING TABLES, AND THAT IS WHY THIS IS NOT LEFT FOR LATER. practice_checkout
-- and practice_subscription are empty only because no payment has ever completed. The first real
-- transaction would put a payment record in them, and if their RLS never applied, that first row would
-- BE the discovery -- found the way the clinical rows were, by somebody probing with a public key.
--
-- `enable row level security` on a table that already has it is a no-op, so re-asserting costs nothing
-- and removes the uncertainty instead of scheduling it.

alter table practice_checkout enable row level security;

alter table practice_checkout_event enable row level security;

alter table practice_subscription enable row level security;

alter table practice_document_style enable row level security;

notify pgrst, 'reload schema';
