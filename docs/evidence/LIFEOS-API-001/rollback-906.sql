-- ROLLBACK FOR MIGRATION 906. Removes the public API's tables, which ends every third party's access at once.
-- Nothing a person keeps in LifeOS is touched. Only for use with an owner GO.
begin;
drop view if exists lifeos_live_oauth_token;
drop view if exists lifeos_live_oauth_code;
drop table if exists lifeos_oauth_token, lifeos_oauth_code, lifeos_oauth_grant, lifeos_api_client;
commit;
notify pgrst, 'reload schema';
