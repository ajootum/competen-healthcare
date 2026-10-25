-- ROLLBACK 462 (STAGING ONLY). Removes the personal learning record, progress, attempts, certificate authorisations,
-- certificates and the capability reader. It refuses once a learning record, a certificate
-- authorisation or an evidence object exists, because those are records. Run ROLLBACK-463 first.
-- THE BUCKET IS NOT DELETED HERE. Supabase refuses SQL deletes on storage.*. After this rollback a person removes the
-- empty learning-evidence bucket through the Supabase Storage API or the dashboard. A bucket holding files is never
-- deleted automatically: this script refuses while it holds any object. The empty bucket left behind is inert.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'individual_course_entitlement') then
    raise exception 'ROLLBACK-462 refused: 463 is still applied. Roll it back first';
  end if;
  if exists (select 1 from information_schema.tables where table_name = 'learning_record') then
    if exists (select 1 from learning_record) then raise exception 'ROLLBACK-462 refused: learning records exist'; end if;
  end if;
  if exists (select 1 from information_schema.tables where table_name = 'learning_certificate_authorisation') then
    if exists (select 1 from learning_certificate_authorisation) then raise exception 'ROLLBACK-462 refused: certificate authorisations exist'; end if;
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'learning-evidence') then
    raise exception 'ROLLBACK-462 refused: the learning-evidence bucket holds objects';
  end if;
end $$;

drop table if exists learning_certificate;
drop table if exists learning_certificate_authorisation;
drop table if exists learning_check_attempt;
drop table if exists learning_record_activity;
drop table if exists learning_record;
drop function if exists public.learning_certificate_guard();
drop function if exists public.learning_certificate_authorisation_guard();
drop function if exists public.learning_holds_capability(uuid, text);
drop function if exists public.learning_check_attempt_guard();
drop function if exists public.learning_record_activity_guard();
drop function if exists public.learning_record_guard();

notify pgrst, 'reload schema';
