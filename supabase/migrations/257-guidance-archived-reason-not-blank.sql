-- ============================================================
-- MIGRATION 257: A BLANK REASON IS NOT A REASON
-- CPR-KS-001 Engine 4, correcting migration 256
--
-- ----------------------------------------------------------------------------------------------------
-- Migration 256 wrote practice_guidance_archived_reason as
--
--     check (status <> 'archived' or archived_reason is not null)
--
-- and its comment claimed it stopped guidance being withdrawn without saying why. Probed directly
-- against the deployed constraint, it does not:
--
--     archived_reason = NULL     REFUSED, 23514
--     archived_reason = ''       ACCEPTED
--     archived_reason = '   '    ACCEPTED
--
-- A BLANK STRING IS NOT NULL. So the database refuses a MISSING reason while the engine refuses an
-- EMPTY one -- two different rules, not one rule enforced twice. The consequence is that the engine's
-- guard was the only thing standing between a blank reason and the record: delete it and a practitioner
-- withdraws a published protocol by pressing the space bar, leaving a document marked archived whose
-- reason renders as nothing at all.
--
-- That matters more here than it looks. Withdrawing guidance without saying why leaves the next person
-- unable to tell "superseded by a newer version" from "found to be wrong", and that distinction is the
-- only thing they actually need from an archived protocol.
--
-- WARNING: THE ENGINE'S GUARD STAYS. This does not make it redundant -- it makes the two agree. A rule
-- the database enforces and the engine reports is the shape this codebase wants. A rule only the engine
-- enforces is one a direct write walks past.
--
-- Safe to apply: practice_guidance_document holds ZERO rows, verified live, so the constraint cannot
-- fail validation on arrival. Do this once it holds archived rows and it may refuse the ALTER, which is
-- a different piece of work.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- including inside comments, which silently shredded two sections of migration 238 while
-- the editor still reported success.
-- ============================================================

-- btrim rather than length, so a reason of spaces, tabs or newlines is refused the same way. The
-- constraint is dropped and re-added rather than altered, because a CHECK cannot be modified in place.
alter table practice_guidance_document drop constraint if exists practice_guidance_archived_reason;

alter table practice_guidance_document add constraint practice_guidance_archived_reason
  check (status <> 'archived' or (archived_reason is not null and btrim(archived_reason) <> ''));

alter table practice_guidance_document enable row level security;

notify pgrst, 'reload schema';
