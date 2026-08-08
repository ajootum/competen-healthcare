-- ============================================================
-- MIGRATION 265: MAKING THE RECORDED DECISION REACHABLE
-- CPR-MED-001 s3, and the user's ruling of 2026-08-08
--
-- ----------------------------------------------------------------------------------------------------
-- THE DEFECT: MIGRATIONS 258 AND 259 CONTRADICT EACH OTHER, AND 259 IS THE LATER AND WRONGER OF THE TWO.
--
-- The ruling was: "Permit dosing only on a weight recorded in the same session. If there is no weight,
-- prompt the practitioner to make a decision and RECORD the decision."
--
-- 259 built the second half -- a weight_decision column, required whenever the basis needs a weight and
-- weight_state is 'absent' or 'unreadable'.
--
-- 258 had already made that case impossible:
--
--   practice_medication_dose_needs_weight
--     check (basis not in ('mg_per_kg', 'mg_per_kg_per_day') or weight_kg is not null)
--
-- No weight means no row, whatever the practitioner decided. So 259's branch CANNOT FIRE: the only rows
-- it governs are rows 258 refuses. The column has been unreachable since the day it was added, and
-- nothing in the application writes it -- which is consistent, because nothing could.
--
-- WARNING: THIS WAS VISIBLE AT THE TIME AND WAS MISREAD. 259's third control returned 400 instead of 201
-- and was recorded as a test that forgot to post a weight. It was not. It was this constraint refusing
-- exactly the case the migration existed to permit, and calling it a test artifact cost a week of the
-- column being dead.
--
-- WHY RELAXING 258 IS THE RULING AND NOT A WEAKENING OF IT. Refusing outright was considered and
-- rejected, in 259's own header and by the user: a prescriber who cannot get a number out of the product
-- works the dose out on paper, and then the decision has happened anyway with nothing recording that it
-- did. The product loses the reasoning and the patient keeps the risk. The dose is permitted here ONLY
-- when the judgement that permitted it is written down beside it, in words, on the same row.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- including inside comments, which silently shredded two sections of migration 238 while the
-- editor still reported success.
-- ============================================================

-- ---- 1. WEIGHT-BASED DOSING: A WEIGHT, OR A RECORDED DECISION ---------------------------------------
--
-- The third disjunct is the whole change. Everything else is 258's rule unaltered: a mg/kg dose still
-- needs a weight, and now names the alternative rather than pretending there is none.
--
-- WARNING: btrim, NOT `is not null`. Migration 256 wrote `archived_reason is not null` believing it
-- stopped a blank reason -- a blank string is not null, and that cost migration 257. Here the same
-- mistake would let a prescriber satisfy a clinical-safety constraint with the space bar, which is worse
-- than having no constraint because the record would then carry a reason field that renders as nothing.
alter table practice_medication_dose_calculation
  drop constraint if exists practice_medication_dose_needs_weight;

alter table practice_medication_dose_calculation
  add constraint practice_medication_dose_needs_weight
  check (
    basis not in ('mg_per_kg', 'mg_per_kg_per_day')
    or weight_kg is not null
    or (weight_decision is not null and btrim(weight_decision) <> '')
  );

-- ---- 2. BODY SURFACE AREA: THE SAME DOOR, AND WHY IT IS DELIBERATELY NARROWER ------------------------
--
-- 258 required bsa_m2 AND weight_kg AND height_cm together, because a BSA dose is a function of all
-- three. 259's decision requirement already names 'mg_per_m2' among the bases that need a decision, so
-- leaving this constraint alone would reproduce the exact contradiction this file exists to remove --
-- one constraint demanding a decision for a row another constraint refuses.
--
-- WARNING: bsa_m2 IS STILL REQUIRED, AND THAT IS NOT AN OVERSIGHT. A decision may stand in for a missing
-- MEASUREMENT -- a weight nobody could take, a height nobody recorded. It cannot stand in for the
-- ARITHMETIC: a mg/m2 dose without a surface area is not a dose made on a stated judgement, it is a
-- blank. So the practitioner may proceed on an estimated or parent-reported basis with the reasoning
-- written down, and still may not record a BSA dose with no BSA at all.
alter table practice_medication_dose_calculation
  drop constraint if exists practice_medication_dose_needs_bsa;

alter table practice_medication_dose_calculation
  add constraint practice_medication_dose_needs_bsa
  check (
    basis <> 'mg_per_m2'
    or (bsa_m2 is not null and weight_kg is not null and height_cm is not null)
    or (bsa_m2 is not null and weight_decision is not null and btrim(weight_decision) <> '')
  );

-- ---- 3. WHAT IS NOT CHANGED ------------------------------------------------------------------------
--
-- 259's practice_dose_weight_decision_required stands exactly as written. It is the half of the pair
-- that was always correct: when the basis needs a weight and there is none, the decision is REQUIRED.
-- This file does not loosen that -- it makes it reachable. Together the two now say the thing the ruling
-- said: a weight, or a decision, and never neither.
--
-- Safe to apply: practice_medication_dose_calculation holds ZERO rows, verified live before this file was
-- written, so neither constraint can fail validation on arrival.

alter table practice_medication_dose_calculation enable row level security;

notify pgrst, 'reload schema';
