-- ROLLBACK 437 (STAGING). Removes the Individual notice store and its guard.
-- Every notice on the environment is lost with it. The application tolerates the table being absent:
-- notices are not written and the panel shows nothing (src/lib/individual/notifications.ts).
-- Production: not to be run without the owner. Fix forward instead.

drop trigger if exists trg_individual_notification_guard on individual_notification;
drop function if exists individual_notification_guard();
drop table if exists individual_notification;

notify pgrst, 'reload schema';
