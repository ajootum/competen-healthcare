-- ============================================================
-- 309: CPR-FUP-002 -- the follow-up taxonomy split
--
-- The spec's core rule: Category answers WHAT DOMAIN the obligation belongs to, Follow-up Type
-- answers WHAT ACTION must happen next. The two columns already exist (196's kind, 299's
-- follow_up_type) but their vocabularies predate the separation -- kind's offered list mixed
-- action labels into the domain question, and follow_up_type had four values where the spec
-- defines nine controlled action codes.
--
-- THIS MIGRATION ONLY WIDENS. Every code ever written stays valid, because CPR-FUP-002 s14 is
-- explicit that historical records retain their original code even when labels change -- and
-- because offline devices may hold in-flight follow-up captures carrying the old codes, which
-- must still file at sync. The UI stops OFFERING the legacy codes and that is the whole change
-- of behaviour. medication_review enters the CHECK now (s4, configuration-ready) so enabling it
-- later is a UI decision, not another migration.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. kind: the Category column (domain / subject) ------------------------------------------------
-- 196 created this as an inline check, so the constraint carries the default generated name.
alter table practice_follow_up drop constraint if exists practice_follow_up_kind_check;
alter table practice_follow_up add constraint practice_follow_up_kind_check
  check (kind in (
    'clinical_condition', 'investigation_result', 'treatment_response', 'procedure_intervention',
    'referral_outcome', 'administrative', 'other',
    'review', 'monitoring', 'immunisation'
  ));

-- ---- 2. follow_up_type: the action column (CPR-FUP-002 s3, nine controlled values) -------------------
alter table practice_follow_up drop constraint if exists practice_follow_up_type_check;
alter table practice_follow_up add constraint practice_follow_up_type_check
  check (follow_up_type in (
    'clinical_review', 'results_review', 'treatment_review', 'post_procedure',
    'repeat_investigation', 'referral_followup', 'contact_patient', 'administrative', 'other',
    'medication_review',
    'appointment', 'review', 'contact'
  ));

notify pgrst, 'reload schema';
