-- ============================================================
-- RESET — drops all Competen tables so schema.sql can run clean
-- Run this FIRST, then run schema.sql
-- ============================================================
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

drop table if exists cpd_logs            cascade;
drop table if exists quiz_attempts       cascade;
drop table if exists questions           cascade;
drop table if exists course_enrollments  cascade;
drop table if exists courses             cascade;
drop table if exists nurse_competencies  cascade;
drop table if exists competencies        cascade;
drop table if exists profiles            cascade;
drop table if exists hospitals           cascade;
