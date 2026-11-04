-- ROLLBACK-996: removes exactly what migration 996 adds (SQIE-CLOSE-2026-11 WS-G). No data depends on it. Never refuses.
-- Without 996 the HQ question library shows every learner-derived figure as not measured (it fails closed).
drop function if exists public.ckri_library_item_stats(uuid[], integer, integer);
drop function if exists public.ckri_question_format_correctness(timestamptz, integer, integer);
notify pgrst, 'reload schema';
