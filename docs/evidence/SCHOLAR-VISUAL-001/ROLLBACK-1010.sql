-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 1010 (SCHOLAR-VISUAL-001 phase 2, whole slides drawn from the learner's own file).
--
-- !! CHECK THE PROJECT BEFORE RUNNING. Turn policy scholar_whole_slides off first.
-- !! IT REFUSES WHILE ANY DRAWN SLIDE IS ON RECORD, because dropping the table would strand the stored images with no record of their
--    paths. Remove them first, from the rows of individual_scholar_material_render, then delete those rows.
-- It takes image/webp back off the private bucket. Nothing else about the bucket changes.
-- APPLY THIS FILE WHOLE. ASCII only. No semicolons inside comments.
-- ====================================================================================================

do $$
begin
  if to_regclass('public.individual_scholar_material_render') is not null then
    if exists (select 1 from individual_scholar_material_render where jsonb_array_length(units) > 0) then
      raise exception 'Drawn slides are on record. Remove their stored images and rows first.';
    end if;
  end if;
end
$$;

drop table if exists individual_scholar_material_render;

update storage.buckets
  set allowed_mime_types = array(select m from unnest(allowed_mime_types) as m where m <> 'image/webp')
  where id = 'individual-scholar-materials';

notify pgrst, 'reload schema';
