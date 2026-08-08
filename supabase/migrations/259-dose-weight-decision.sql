-- ============================================================
-- MIGRATION 259: NO WEIGHT IS NOT NO DECISION
-- CPR-MED-001 s3, and the user's ruling of 2026-08-08
--
-- ----------------------------------------------------------------------------------------------------
-- THE RULE: "Permit dosing only on a weight recorded in the same session. If there is no weight, prompt
-- the practitioner to make a decision and RECORD the decision."
--
-- The second half is the part this migration exists for, and it is better than the alternative it
-- replaced. Refusing outright was the obvious answer and the wrong one: a prescriber who cannot get a
-- number out of the product works it out on paper instead, and then the decision has happened anyway
-- with nothing recording that it did. The product loses the reasoning and the patient keeps the risk.
--
-- So the calculation is permitted, and the judgement that permitted it is written down beside it. That is
-- the shape s14's booking override already uses and that migration 238 uses for outcome = 'other':
-- the reason is recorded BEFORE the thing it authorises, in words, and travels with it.
--
-- WARNING: IT BELONGS ON THIS ROW AND NOT ONLY IN practice_medication_event. Migration 258 froze
-- weight_state here rather than deriving it, on the stated ground that "a reader looking at a
-- prescription from March needs to know what the screen said in March". The decision is the same kind of
-- fact. An event in another table can be printed apart from the prescription it justified -- and a dose
-- printed without the reasoning that produced it is exactly what this column prevents.
--
-- WARNING: THIS IS NOT AN OFFLINE RULE, THOUGH IT WAS DECIDED WHILE SCOPING OFFLINE WORK. Nothing about
-- "no weight recorded" is peculiar to having no network. The online prescribing path gets the same prompt
-- and the same column, or the online product is left with the weaker behaviour.
-- ============================================================

-- ---- 1. THE COLUMN --------------------------------------------------------------------------------
--
-- Free text, because the reasons are not enumerable in advance: a parent-reported weight, an estimate
-- from age, a figure from last month's card, a child who could not be weighed. A closed vocabulary here
-- would be a list of excuses to pick from, and the one that mattered would always be missing.
alter table practice_medication_dose_calculation
  add column if not exists weight_decision text;

-- ---- 2. WHEN IT IS REQUIRED, AND WHEN DEMANDING IT WOULD BE WRONG ----------------------------------
--
-- WARNING: A FIXED-DOSE REGIMEN NEEDS NO WEIGHT AND MUST NOT BE ASKED TO JUSTIFY NOT HAVING ONE.
-- MED s3's four bases are mg_per_kg, mg_per_kg_per_day, mg_per_m2 and fixed. Only the first three are
-- functions of weight -- BASES_NEEDING_WEIGHT in medication-constants.ts names exactly those. A
-- constraint keyed on weight_state alone would demand a written justification every time somebody
-- prescribed a fixed dose to a patient nobody had weighed, which is most of them, and a prompt that
-- fires when nothing is wrong is a prompt people learn to dismiss without reading.
--
-- WARNING: 'unreadable' IS INCLUDED, WHICH IS ONE STATE BEYOND THE LITERAL WORDS OF THE RULING, AND THE
-- REASON IS SAID HERE RATHER THAN ASSUMED. 'absent' means no weight was ever recorded. 'unreadable'
-- means the read failed -- and from the prescriber's chair those are the same situation: there is no
-- number to work from. Requiring the decision in both is the safer reading, and this codebase has a
-- standing rule to take it.
--
-- 'stale', 'implausible' and 'age_unjudged' are DELIBERATELY NOT HERE. In each of those a weight exists
-- and the engine already puts an override-reason field in front of the prescriber. Whether that override
-- should also land in this column is a real question and a separate one -- it is not answered by
-- silently widening a constraint written for a different case.
alter table practice_medication_dose_calculation
  drop constraint if exists practice_dose_weight_decision_required;

alter table practice_medication_dose_calculation
  add constraint practice_dose_weight_decision_required
  check (
    basis not in ('mg_per_kg', 'mg_per_kg_per_day', 'mg_per_m2')
    or weight_state not in ('absent', 'unreadable')
    or (weight_decision is not null and btrim(weight_decision) <> '')
  );

-- ---- 3. btrim, AND WHY IT IS NOT `is not null` -----------------------------------------------------
--
-- Migration 256 wrote `archived_reason is not null` and its comment claimed it stopped guidance being
-- withdrawn without a reason. It did not: a blank string is not null, so "" and "   " were both accepted,
-- and the only thing standing between a blank reason and the record was an engine guard. That cost
-- migration 257 to correct. The same mistake here would let a prescriber satisfy a clinical-safety
-- constraint with the space bar.
--
-- Safe to apply: practice_medication_dose_calculation holds ZERO rows, verified live before this file was
-- written, so the constraint cannot fail validation on arrival. Once it holds rows the ALTER may refuse,
-- which is a different piece of work.

alter table practice_medication_dose_calculation enable row level security;

notify pgrst, 'reload schema';
