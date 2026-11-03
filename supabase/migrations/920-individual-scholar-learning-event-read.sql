-- ====================================================================================================
-- MIGRATION 920: COMPETEN SCHOLAR -- THE LEARNER'S OWN "READ" MARK ON A LESSON (SCHOLAR-INDEPENDENT-LEARNING-01)
--
-- Owner instruction 3 Nov 2026: Scholar's core learning activities must work without generative AI. A learner who
-- reads a lesson's original sections (their own notes, in the Learn workspace) can now record that they have read
-- it. That mark is a learning event like every other (migration 414), with the sections it covered as its sources.
--
-- WHAT IT CHANGES. One CHECK constraint on individual_scholar_learning_event: the action list gains 'read'. Nothing
-- else: no table, no column, no row written, no backfill. The verdict rule is unchanged (a verdict only on 'clarify').
--
-- NOT COMPETENCE. A read mark is the learner's own statement that they read the material. It is a learning record
-- for the learner, never assessment evidence, never verified competence and never a Passport record.
--
-- FAIL CLOSED WITHOUT IT. While 920 is absent the store's write is refused by the 414 CHECK (SQLSTATE 23514), the
-- route answers { recorded: false } and the page keeps the mark on the device and in the 790 position only.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 414 only.
-- Re-running it is a no-op (drop if exists, then add). Rollback: ROLLBACK-920.sql (restores the 414 list, and refuses
-- while any 'read' event row exists).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_learning_event drop constraint if exists individual_scholar_learning_event_action_check;
alter table individual_scholar_learning_event add constraint individual_scholar_learning_event_action_check
  check (action in ('teach', 'explain', 'simplify', 'deeper', 'examples', 'summary', 'ask', 'check', 'clarify', 'skip', 'revisit', 'resume', 'read')
     and step >= 0
     and (verdict is null or (action = 'clarify' and verdict in ('understood', 'partly', 'not_yet'))));

notify pgrst, 'reload schema';
