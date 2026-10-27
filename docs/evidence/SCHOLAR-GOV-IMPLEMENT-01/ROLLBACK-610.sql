-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK-610 (staging rehearsal, or production only with an owner GO).
-- Removes everything migration 610 added. It touches no hq_position, grant, appointment or audit row.
-- Any seat appointment, declaration or status change recorded after 610 is lost with its table, so take a copy first:
--   select * from hq_gov_seat_appointment  and  select * from hq_gov_interest_declaration
-- The audit_log rows written by the hq_gov_admin_* functions stay, as the record that they happened.
-- ====================================================================================================
drop trigger if exists trg_hq_gov_seat_appointment_guard on hq_gov_seat_appointment;
drop trigger if exists trg_hq_gov_interest_append_only on hq_gov_interest_declaration;
drop trigger if exists trg_hq_gov_delegation_guard on hq_gov_delegation;
drop function if exists hq_gov_admin_appoint(uuid, text, text, text, uuid, text, text, text, text, text);
drop function if exists hq_gov_admin_end(uuid, text, text, uuid, text);
drop function if exists hq_gov_admin_declare_interest(uuid, text, text, uuid, text, text, text);
drop function if exists hq_gov_admin_set_delegation(uuid, text, text, text, text, text, text);
drop function if exists hq_gov_admin_set_status_item(uuid, text, text, text, text, text, text, text);
drop function if exists hq_gov_admin_require(uuid, text);
drop table if exists hq_gov_status_item;
drop table if exists hq_gov_link;
drop table if exists hq_gov_delegation;
drop table if exists hq_gov_interest_declaration;
drop table if exists hq_gov_seat_appointment;
drop table if exists hq_gov_seat_exclusion;
drop table if exists hq_gov_seat;
drop table if exists hq_gov_body;
drop function if exists hq_gov_seat_appointment_guard();
drop function if exists hq_gov_append_only_guard();
drop function if exists hq_gov_delegation_guard();
notify pgrst, 'reload schema';
