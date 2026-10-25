-- ROLLBACK 441 (STAGING ONLY): CKRI K2 aggregate intelligence.
-- Drops the builder, the purge function, both triggers and both tables. Snapshots built on staging are lost (they hold
-- aggregates only, no person data). Run ROLLBACK-443 and ROLLBACK-442 first if they were applied.

drop table if exists ckri_snapshot_cell cascade;
drop table if exists ckri_snapshot cascade;
drop function if exists public.ckri_build_snapshot(text, date, date, text, text, integer, integer, boolean, text, text, integer, uuid);
drop function if exists public.ckri_purge_expired_snapshots();
drop function if exists public.ckri_snapshot_cell_guard();
drop function if exists public.ckri_snapshot_guard();

notify pgrst, 'reload schema';
