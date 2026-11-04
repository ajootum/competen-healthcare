-- ROLLBACK-995: removes exactly what migration 995 adds (SQIE-CLOSE-2026-11 WS-E).
-- Stored meta keys stay in version content as data: 442 ignores extra keys, and the application validator still checks
-- them. Never refuses. Apply on staging only unless the owner gives a production GO for the rollback itself.
drop trigger if exists ckri_knowledge_version_meta_guard on ckri_knowledge_version;
drop function if exists public.ckri_knowledge_version_meta_guard();
drop function if exists public.ckri_question_meta_ok(jsonb);
notify pgrst, 'reload schema';
