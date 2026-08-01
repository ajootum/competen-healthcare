-- ============================================================
-- MIGRATION 171: WRITE BACK handle_new_user() AS DEPLOYED
--
-- Found by scripts/function-drift-audit.ts on its first full run. The deployed body of the signup trigger
-- has diverged from schema.sql and the difference is not cosmetic:
--
--   repo (supabase/schema.sql)        deployed
--   -------------------------------   ----------------------------------------------------------------
--   inserts id, full_name, email      also inserts ROLE, defaulting to 'nurse'
--   full_name or 'New User'           trims blanks, falls back to the email local-part, then 'New User'
--   on conflict do nothing            on conflict DO UPDATE (full_name, email, role)
--   errors propagate                  exception when others then return new
--
-- Nobody wrote this down. Rebuild the database from the repo and every new user would be created with a
-- NULL role -- and role is what every workspace gate reads -- so signup would appear to work and the user
-- would land nowhere. This writes the deployed behaviour into the repo so the repo is the source of
-- truth, which is the only way the drift audit can mean anything.
--
-- CHANGED NOTHING ON PURPOSE. This is a write-back, not a redesign. Two things in it are worth a decision
-- later, and are recorded here rather than silently "improved":
--   1. `exception when others then return new` swallows EVERY error, so a failed profile insert during
--      signup is invisible -- the auth user is created and the profile is not, with no trace.
--   2. The default role 'nurse' is granted by the database, not by an admin. Anyone who can sign up gets
--      a clinical role by default.
--
-- The trigger on auth.users is unchanged and keeps pointing at this function; `create or replace` does not
-- disturb it.
--
-- Additive and idempotent.
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'New User'),
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'nurse')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email     = excluded.email,
    role      = excluded.role;
  return new;
exception when others then
  return new;
end;
$$ language plpgsql security definer;

notify pgrst, 'reload schema';
