-- ROLLBACK 460 (STAGING ONLY). Removes the Holdings Learning catalogue. It refuses once a
-- provider, an offering or a content object exists, because those are records. Run ROLLBACK-461 first.
-- THE BUCKET IS NOT DELETED HERE. Supabase refuses SQL deletes on storage.*. After this rollback a person removes the
-- empty learning-content bucket through the Supabase Storage API or the dashboard. A bucket holding files is never
-- deleted automatically: this script refuses while it holds any object. The empty bucket left behind is inert.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'clinical_content_version' and column_name = 'learning_version_id') then
    raise exception 'ROLLBACK-460 refused: 461 is still applied. Roll it back first';
  end if;
  if exists (select 1 from information_schema.tables where table_name = 'learning_offering') then
    if exists (select 1 from learning_offering) or exists (select 1 from learning_provider) then raise exception 'ROLLBACK-460 refused: providers or offerings exist'; end if;
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'learning-content') then
    raise exception 'ROLLBACK-460 refused: the learning-content bucket holds objects';
  end if;
end $$;

drop table if exists learning_offering_version_outcome;
drop table if exists learning_offering_version;
drop table if exists learning_offering;
drop table if exists learning_provider;
drop function if exists public.learning_offering_version_outcome_guard();
drop function if exists public.learning_offering_version_guard();
drop function if exists public.learning_offering_guard();
drop function if exists public.learning_provider_guard();

notify pgrst, 'reload schema';
