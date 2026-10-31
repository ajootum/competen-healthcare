-- ====================================================================================================
-- ROLLBACK-750, STAGING ONLY. Removes migration 750: the layout guard trigger and function, the two checks and
-- the four frameworks columns. Any layout draft or section order saved on staging is lost. Re-running it is a
-- no-op.
-- ====================================================================================================

drop trigger if exists frameworks_layout_guard on frameworks;
drop function if exists public.frameworks_layout_guard();
alter table frameworks drop constraint if exists frameworks_layout_draft_check;
alter table frameworks drop constraint if exists frameworks_component_order_check;
alter table frameworks drop column if exists layout_draft;
alter table frameworks drop column if exists layout_draft_by;
alter table frameworks drop column if exists layout_draft_at;
alter table frameworks drop column if exists component_order;

notify pgrst, 'reload schema';
