-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK-998: removes the explicit approval of safety markers (migration 998). Afterwards Scholar caps nothing (its read of
-- ckri_library_caps_approved fails, which it treats as not approved), so every safety flag is formative feedback again.
--
-- REFUSES while any decision records a marker approval: those are clinical reviewers' recorded decisions, and dropping the column
-- would destroy them. Decide first (owner) whether they are to be discarded. Nothing else depends on 998.

do $guard$
begin
  if exists (select 1 from information_schema.columns where table_name = 'clinical_review_decision' and column_name = 'safety_markers_approved')
     and exists (select 1 from clinical_review_decision where safety_markers_approved) then
    raise exception 'ROLLBACK-998 refused: clinical reviewers have recorded marker approvals. Decide whether to discard them first';
  end if;
end
$guard$;

drop trigger if exists clinical_review_decision_marker_guard on clinical_review_decision;
drop function if exists public.clinical_review_decision_marker_guard();
drop function if exists public.ckri_library_caps_approved(uuid);
drop function if exists public.ckri_question_has_safety_markers(jsonb);
alter table clinical_review_decision drop column if exists safety_markers_approved;

notify pgrst, 'reload schema';
