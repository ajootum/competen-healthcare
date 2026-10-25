-- ROLLBACK 452 (STAGING ONLY). COMPETEN-PROFESSIONAL-PROFILE-01 part B, reminders.
-- Removes the reminder ledger and every row in it. Profile records reminded before the rollback may be
-- reminded once more if 452 is re-applied. Plain statements only.

drop table if exists individual_professional_reminder_log;

notify pgrst, 'reload schema';
