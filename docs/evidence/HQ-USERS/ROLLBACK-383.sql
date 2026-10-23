-- ROLLBACK FOR MIGRATION 383 (hq_reserve_password_reset). STAGING rehearsal only, via run-staging-sql.mjs.
-- After this, every administrator reset is refused with 503 until 383 is re-applied -- never sent unmetered.
-- Rows the function wrote (audit_log action admin_password_reset_reserved) stay, as audit history.
drop function if exists hq_reserve_password_reset(uuid, uuid, text, text);

notify pgrst, 'reload schema';
