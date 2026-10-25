-- ROLLBACK 500 (staging rehearsal). Removes everything migration 500 added: the two triggers, the nine
-- functions and the three grant columns. Positions, grants and audit_log rows written THROUGH the screen
-- after 500 was applied are data, not part of the migration, and are left in place.
-- After it runs, the HQ position screen refuses every write (the functions are gone) and reads still work.

drop trigger if exists hq_position_capability_guard on hq_position_capability;
drop trigger if exists hq_position_guard on hq_position;

drop function if exists hq_position_admin_create(uuid, text, text, text, text, text, text, text);
drop function if exists hq_position_admin_update(uuid, text, text, text, text, text, text);
drop function if exists hq_position_admin_set_active(uuid, text, text, text, boolean, text);
drop function if exists hq_position_admin_grant(uuid, text, text, text, text, text, boolean);
drop function if exists hq_position_admin_end_grant(uuid, text, text, text, text, text);
drop function if exists hq_position_admin_register(uuid, text, text, text, text, text, text, text);
drop function if exists hq_position_admin_require(uuid, text);
drop function if exists hq_position_capability_guard();
drop function if exists hq_position_guard();
drop function if exists hq_capability_exclusions();
drop function if exists hq_capability_sensitive_class(text);
drop function if exists hq_actor_is_owner(uuid);

alter table hq_position_capability drop column if exists grant_reason;
alter table hq_position_capability drop column if exists ended_by;
alter table hq_position_capability drop column if exists end_reason;

notify pgrst, 'reload schema';
