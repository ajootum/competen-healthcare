-- ====================================================================================================
-- MIGRATION 390: COMPETEN SCHOLAR -- A MAPPING MADE BY A PERSON CARRIES NO AI PROVENANCE
--
-- COMPETEN-SCHOLAR-01 S2. Migration 388 says, in its own comment, that a mapping made by a person says
-- neither which model made it nor how sure it was. Its CHECK enforced only one direction: an AI row must
-- carry model, prompt version and confidence. A student or reviewer row carrying a confidence (or a model)
-- was still storable, and would read as an AI judgement. The staging acceptance run (D5) inserted one.
-- This makes it unstorable: a non-AI row has no model, no prompt version and no confidence.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: one CHECK on individual_scholar_competency_map
-- is replaced by a stricter one. The application never writes such a row (store.addMapping writes none of
-- the three), so no valid row is lost. If a row already violates it the ALTER fails and changes nothing --
-- count first: the rows of individual_scholar_competency_map whose source is not ai and that have
-- a model, a prompt version or a confidence. It depends on 388.
-- Re-running it is a no-op. Rollback: docs/evidence/COMPETEN-SCHOLAR-01/ROLLBACK-390.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_provenance_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_provenance_check
  check ((source = 'ai') = (model is not null and prompt_version is not null and confidence is not null)
     and (source = 'ai' or (model is null and prompt_version is null and confidence is null))
     and (confidence is null or (confidence >= 0 and confidence <= 1))
     and (rationale is null or char_length(rationale) <= 500));

notify pgrst, 'reload schema';
