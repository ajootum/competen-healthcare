-- ============================================================
-- MIGRATION 181: QIE-003 LEADING vs LAGGING CLASSIFICATION
--
-- QIE-003's entire premise is the split between LEADING indicators (predictive signals -- act before harm)
-- and LAGGING indicators (outcome measures -- what already happened). This platform has 38 KPIs and 494
-- recorded values, and NOTHING that says which is which. pa_kpis carries `category` (the Balanced
-- Scorecard perspectives: Clinical Quality, Operations, Workforce, Financial, Patient Experience,
-- Learning & Growth) and `direction` (higher_better / lower_better). Neither answers the question.
--
-- I COULD HAVE GUESSED IT AND DID NOT. Reading the 38 names, some calls are obvious -- "Medication Error
-- Rate" is an outcome, "Hand Hygiene Compliance" is a leading signal -- and plenty are not. Whether
-- "PEWS Compliance" is predictive of deterioration or a record of process adherence is a clinical
-- governance judgement, and it changes which board a number appears on. Classifying 38 indicators by
-- inference and presenting the result as this hospital's indicator model would be a confident fabrication
-- wearing the clothes of intelligence.
--
-- So the column is NULLABLE and starts null everywhere. Null means UNCLASSIFIED, which is true, and the
-- QIE-003 surface reports "38 indicators, 0 classified" rather than a tidy split nobody agreed to. The
-- classification is a decision for whoever owns quality governance, and this gives them somewhere to
-- record it.
--
-- Added to pa_kpis rather than a parallel qie_indicator_registry, because QIE is a COMPOSING layer: a
-- shadow registry would need syncing with the store that actually holds the KPIs, and two catalogues of
-- indicators is precisely the second-source-of-truth this architecture exists to avoid.
--
-- Additive and idempotent.
-- ============================================================

alter table pa_kpis add column if not exists indicator_class text
  check (indicator_class in ('leading', 'lagging'));

alter table pa_kpis add column if not exists classified_by uuid references profiles(id) on delete set null;
alter table pa_kpis add column if not exists classified_at timestamptz;

create index if not exists idx_pa_kpis_indicator_class
  on pa_kpis(hospital_id, indicator_class)
  where indicator_class is not null;

notify pgrst, 'reload schema';
