-- ROLLBACK FOR MIGRATION 904. Removes invitations and nothing else. Memberships already accepted stay.
-- Only for use with an owner GO.
begin;
drop view if exists lifeos_live_invitation;
drop table if exists lifeos_invitation;
commit;
notify pgrst, 'reload schema';
