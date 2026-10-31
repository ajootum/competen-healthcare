-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK-752, STAGING ONLY. Removes migration 752: the apply-on-publish trigger and its
-- three functions. 750 and 751 are untouched. With 752 gone the app refuses to publish a pending layout (it does
-- not fall back to applying it itself). Re-running it is a no-op.
-- ====================================================================================================

drop trigger if exists frameworks_layout_apply_on_publish on frameworks;
drop function if exists public.frameworks_layout_apply_on_publish();
drop function if exists public.framework_layout_check(uuid);
drop function if exists public.framework_layout_problem(uuid, jsonb);

notify pgrst, 'reload schema';
