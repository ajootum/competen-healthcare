-- ROLLBACK 590 (STAGING rehearsal only). Returns the database schema to its pre-590 state. Removes rows only where
-- the pre-590 schema cannot hold them: skill records and the identity rows.
--
-- STORAGE IS NOT TOUCHED HERE. Supabase refuses direct deletes on storage tables from SQL. Removing the
-- individual-photos bucket is a separate step through the Storage API: rollback-590-storage.ts beside this file
-- (empties the bucket, then deletes it), or the dashboard. Re-applying 590 with the bucket still present is safe
-- (its insert is on conflict do nothing).

alter table individual_passport_share_view drop column if exists include_photo;

delete from individual_professional_profile_item where section = 'skill';
alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_section_check;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_section_check
  check (section in ('qualification', 'registration', 'employment', 'specialty', 'interest', 'aspiration'));

drop table if exists individual_identity_profile;

notify pgrst, 'reload schema';
