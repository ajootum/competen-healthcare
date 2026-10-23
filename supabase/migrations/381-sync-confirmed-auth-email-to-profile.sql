-- ====================================================================================================
-- !! APPLY THIS FILE WHOLE. It defines a plpgsql function. A runner that splits on semicolons would cut
-- !! the function body apart. Paste the whole file into the SQL editor, or use apply-migrations.ts.
--
-- MIGRATION 381: KEEP profiles.email IN STEP WITH A CONFIRMED SUPABASE AUTH EMAIL CHANGE
--
-- Owner GO 2026-10-23, item 4 "Email synchronisation": "Develop a separate focused PR for confirmed
-- Auth-email-to-profile synchronisation. Use a Medium-risk migration with staging rollback rehearsal.
-- Preserve verified-email authority, audit, identity integrity and existing notification behaviour."
--
-- APPLY ON STAGING FIRST. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. It creates one
-- function and one trigger on auth.users. It alters no table, column, policy or grant, and depends on
-- profiles (001) and audit_log (040). Re-running it is a no-op. Rollback: drop the trigger, then the
-- function (docs/evidence/ACCOUNT-EMAIL-SYNC/ROLLBACK-381.sql).
-- ====================================================================================================
--
-- WHY. A person changes their email through the verified Supabase flow (auth.updateUser). Auth holds the
-- new address as pending until they confirm it, and only THEN moves it into auth.users.email. Nothing
-- copied it on to profiles.email, so every reader of profiles.email -- notifications, directories,
-- exports -- kept using the old address. Auth is the authority on the verified email of a person. This
-- trigger makes profiles.email follow it, and nothing else.
--
-- WHAT IT COPIES, EXACTLY.
--   Only when auth.users.email ACTUALLY CHANGED (old and new are distinct) and the email of the account is
--   confirmed (email_confirmed_at is not null) and the new value is not null. A pending change does not
--   touch auth.users.email, so it never fires this. The email of an unconfirmed account is never copied.
--   Only profiles.email of THAT person (where id = the auth user id) is written, and only if it differs.
--
-- AUDIT. Every copy writes one audit_log row: action sync_profile_email, actor_name auth, entity the
-- profile, old and new address in old_value and new_value.
--
-- IT NEVER BLOCKS AUTH. A failure inside the sync (a profile row missing, an audit insert refused) is
-- swallowed with a warning, as handle_new_user does, so a person can always confirm their own email.
-- The cost is that a failed sync leaves profiles.email stale, exactly as today, and the warning is in
-- the database log.
--
-- NO BACKFILL. On staging the read-only count of profiles.email values differing from auth.users.email
-- was 0 (18 profiles with an auth user). A production backfill, if its own read-only count is not 0, is
-- a separate reviewed one-time statement, not part of this file.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above (plpgsql, $$).
-- No index. notify pgrst last.
-- ====================================================================================================

create or replace function public.sync_confirmed_auth_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.email is not distinct from old.email then
    return new;
  end if;
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  begin
    update public.profiles
       set email = new.email
     where id = new.id
       and email is distinct from new.email;

    if found then
      insert into public.audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name, old_value, new_value)
      values (null, 'auth', 'sync_profile_email', 'profile', new.id, null,
              jsonb_build_object('email', old.email), jsonb_build_object('email', new.email));
    end if;
  exception when others then
    raise warning 'sync_confirmed_auth_email_to_profile: profiles.email not synced for % (%)', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.sync_confirmed_auth_email_to_profile() from public;
revoke all on function public.sync_confirmed_auth_email_to_profile() from anon, authenticated;

comment on function public.sync_confirmed_auth_email_to_profile() is
  'Migration 381. Copies a CONFIRMED auth.users.email change into profiles.email for the same person, with an audit_log row. A pending or unconfirmed email is never copied. Never blocks the auth update.';

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email on auth.users
  for each row
  execute function public.sync_confirmed_auth_email_to_profile();

notify pgrst, 'reload schema';
