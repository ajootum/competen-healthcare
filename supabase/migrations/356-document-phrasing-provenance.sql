-- 356 HOW A DOCUMENT'S PROSE WAS WRITTEN
--
-- CPR-DOC-AUTO-001 sections 10 and 15.
--
-- Phases 1 to 3 compose every document deterministically: the selected facts are
-- printed as labelled lines, in a fixed order, by a pure function. Section 10
-- allows more than that -- "AI may improve organization, grammar and professional
-- phrasing" -- and this column records which of the two produced the body a
-- practitioner is about to sign.
--
-- WHY THIS IS ON THE DOCUMENT AND NOT ONLY IN THE AUDIT TRAIL. A clinical
-- document outlives the session that made it. Somebody reading a signed referral
-- letter in two years, deciding how much weight to give its phrasing, is asking a
-- question about THAT DOCUMENT, and an answer that requires joining to an audit
-- log by correlation id is an answer most readers will not get. Section 15 asks
-- for document type, template version, author, timestamps and lifecycle status to
-- be stored on the artifact. How the prose was produced belongs in the same place.
--
-- 'deterministic' IS THE DEFAULT AND THE FLOOR. Every existing row is exactly
-- that, truthfully, without a backfill: the default is not a guess applied to
-- unknown history, it is what those documents actually are. Assisted phrasing is
-- opt-in per request, and any request that cannot be verified as grounded falls
-- back to deterministic and is recorded as deterministic -- because that is what
-- the body then is.
--
-- WHAT THIS COLUMN IS NOT. It is not a model name, a prompt version or a
-- provider. Section 18 forbids exposing prompts, model parameters and internal
-- identifiers to practitioners, and a column that carries them would put them one
-- careless select away from a rendered page. The model and token usage are
-- already recorded by the AI runtime gateway's usage log, which is where an
-- engineer looks and a practitioner does not.

alter table practice_clinical_document
  add column if not exists phrasing text not null default 'deterministic'
  check (phrasing in ('deterministic', 'assisted'));

-- Answers "how many of our letters were assisted" without scanning bodies.
create index if not exists practice_clinical_document_phrasing_idx
  on practice_clinical_document (workspace_id, phrasing);

notify pgrst, 'reload schema';
