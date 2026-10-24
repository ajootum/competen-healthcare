-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql block between dollar quotes. A runner that splits on the
-- statement separator would cut it in half, so paste and run the entire file at once.
-- ====================================================================================================
-- ROLLBACK OF MIGRATION 423 (case candidacy, case candidates, case delivery sessions). STAGING ONLY.
--
-- It removes exactly what 423 added: the two triggers it put on case_library_version (the trigger of 422 stays),
-- the foreign key from case_library_version to case_candidate, the queue view, the four tables and the functions.
--
-- It REFUSES, changing nothing, once any candidacy, permission event, candidate or session exists, or any library
-- version names a candidate. Removing those would destroy what a person offered, the permission it rested on, or
-- their learning record.
-- ====================================================================================================

do $$
begin
  if to_regclass('public.case_candidate') is not null then
    if exists (select 1 from case_candidacy) or exists (select 1 from case_candidacy_event) or exists (select 1 from case_candidate)
       or exists (select 1 from case_library_session) or exists (select 1 from case_library_version where origin_candidate_id is not null) then
      raise exception 'ROLLBACK-423 refused: candidacy, candidate or session data exists';
    end if;
  end if;
end $$;

drop trigger if exists case_library_version_candidate_promote on case_library_version;
drop trigger if exists case_library_version_candidate_guard on case_library_version;
alter table case_library_version drop constraint if exists case_library_version_origin_candidate_fk;

drop view if exists case_candidate_queue;
drop table if exists case_library_session;
drop table if exists case_candidate;
drop table if exists case_candidacy_event;
drop table if exists case_candidacy;

drop function if exists public.case_library_version_candidate_promote();
drop function if exists public.case_library_version_candidate_guard();
drop function if exists public.case_library_session_guard();
drop function if exists public.case_candidate_guard();
drop function if exists public.case_candidacy_event_guard();
drop function if exists public.case_candidate_expire(timestamptz);
drop function if exists public.case_candidate_withdraw(uuid, text, text);
drop function if exists public.case_candidacy_revoke(uuid, text);
drop function if exists public.case_candidacy_grant(uuid, text, text);
drop function if exists public.case_jsonb_uuids(jsonb);
drop function if exists public.case_identifier_kinds(text);
drop function if exists public.case_nhs_number_valid(text);

notify pgrst, 'reload schema';
