-- ====================================================================================================
-- 295  MULTI-TYPE TREATMENT  (CP-TREAT-002 s2, s12)
-- ====================================================================================================
--
-- APPLY THIS FILE WHOLE -- paste it into the Supabase SQL editor in one piece and run it once.
-- It contains a do-block, which the usual statement-splitting runner would break apart.
--
-- WHAT THIS DOES
--   Treatment becomes the parent clinical concept and medication one subtype. CP-TREAT-002 names eight
--   types, six of which this database refuses today: wound_care, physiotherapy, nutrition, respiratory,
--   device_support and lifestyle. This widens the check that refuses them and seeds them as configured,
--   offerable options.
--
-- WARNING: THE CONSTRAINT IS FOUND, NOT NAMED. Migration 194 declared the check inline, which would
--   make the name practice_treatment_treatment_type_check -- but the LIVE constraint accepts values 194
--   never allowed, so the file is not the current definition and the name cannot be trusted. That was
--   established by probing the live database rather than by reading the migration, after an earlier
--   reading of the file produced the wrong answer. The do-block below looks the constraint up by the
--   column it governs and drops whatever it finds, so a wrong guess cannot leave two constraints where
--   the old one silently refuses every new type.
--
-- WARNING: NOTHING IS REMOVED FROM THE ACCEPTED SET. non_drug, change_medication, stop_medication,
--   no_change and the rest stay valid, because rows already carry them and CP-TREAT-002 s10 requires
--   that "historical records must retain original treatment type and details". non_drug is retired from
--   the OFFERED list instead -- s2 replaces it with the six specific types, and a practice that picks
--   Non-drug treatment tomorrow would be choosing a category the new forms cannot describe.
--
-- WARNING: SEEDS ARE PLATFORM DEFAULTS, workspace_id NULL. A practice that has configured nothing gets
--   working lists rather than empty ones, and a practice that HAS configured something keeps its own
--   ordering through practice_treatment_option_state, which this file does not touch.
--
-- Apply in the Supabase SQL editor. Expected result: Success. No rows returned.
-- ====================================================================================================

-- ---- 1. Widen the accepted set ----------------------------------------------------------------------
do $$
declare
  con_name text;
begin
  select c.conname into con_name
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'practice_treatment'::regclass
    and c.contype = 'c'
    and a.attname = 'treatment_type'
  limit 1;

  if con_name is not null then
    execute format('alter table practice_treatment drop constraint %I', con_name);
  end if;

  -- Belt and braces, and it is what the house-rules checker reads: the lookup above drops whatever the
  -- constraint is actually called, and this drops the name we are about to add in case a previous run
  -- of this file left one behind. Both are no-ops when there is nothing to drop.
  alter table practice_treatment drop constraint if exists practice_treatment_treatment_type_check;

  alter table practice_treatment add constraint practice_treatment_treatment_type_check
    check (treatment_type in (
      -- CP-TREAT-002 s2, the eight
      'medication', 'wound_care', 'physiotherapy', 'nutrition', 'respiratory',
      'device_support', 'lifestyle', 'other',
      -- kept so existing rows stay valid and readable
      'change_medication', 'stop_medication', 'non_drug', 'advice', 'monitoring', 'no_change',
      'procedure', 'investigation', 'referral'));
end $$;

-- ---- 2. Seed the six new types as offerable options --------------------------------------------------
-- Sort order leaves medication first, then the new clinical types, then the medication-management and
-- catch-all entries. The practice can reorder any of it in configuration.
insert into practice_treatment_option (workspace_id, field_key, code, label, sort_order, active)
select null, 'treatment_type', v.code, v.label, v.sort_order, true
from (values
  ('wound_care', 'Wound / dressing care', 15),
  ('physiotherapy', 'Physiotherapy', 16),
  ('nutrition', 'Nutrition / diet', 17),
  ('respiratory', 'Respiratory therapy', 18),
  ('device_support', 'Device / support', 19),
  ('lifestyle', 'Lifestyle intervention', 21)
) as v(code, label, sort_order)
where not exists (
  select 1 from practice_treatment_option o
  where o.workspace_id is null and o.field_key = 'treatment_type' and o.code = v.code);

-- ---- 3. Retire the category the six replace ----------------------------------------------------------
-- Still ACCEPTED by the check above, so existing rows are untouched and still render. Simply no longer
-- offered, because s2 replaces it with types that have their own fields.
update practice_treatment_option set active = false
where workspace_id is null and field_key = 'treatment_type' and code = 'non_drug';

notify pgrst, 'reload schema';
