-- ROLLBACK FOR MIGRATION 907. Returns tokens to working across all of a person's workspaces, so only use it with the
-- lifeos_public_api flag off and with an owner GO. Nothing a person keeps in LifeOS is touched.
begin;
drop view if exists lifeos_live_oauth_token;
create view lifeos_live_oauth_token with (security_invoker = true) as
  select t.*, g.client_id, g.individual_id, g.scopes,
    (t.access_expires_at > now()) as access_live, (t.refresh_expires_at > now()) as refresh_live
  from lifeos_oauth_token t join lifeos_oauth_grant g on g.id = t.grant_id
  where t.status = 'active' and g.status = 'active';
revoke all on lifeos_live_oauth_token from anon, authenticated;
create or replace trigger lifeos_stamp_oauth_grant before insert or update on lifeos_oauth_grant
  for each row execute function lifeos_stamp('client_id', 'individual_id');
alter table lifeos_oauth_grant drop constraint if exists lifeos_oauth_grant_active_is_bound;
alter table lifeos_oauth_grant drop constraint if exists lifeos_oauth_grant_bound_member;
alter table lifeos_oauth_grant drop column if exists bound_workspace_id;
commit;
notify pgrst, 'reload schema';
