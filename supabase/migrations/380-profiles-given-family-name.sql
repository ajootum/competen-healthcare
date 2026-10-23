-- ====================================================================================================
-- MIGRATION 380: OPTIONAL GIVEN NAME AND FAMILY NAME ON profiles -- ADDITIVE, NEVER DERIVED
--
-- Owner GO 2026-10-23, "PR D - Shared My Profile": "Support optional given/family names only through a
-- reviewed, backward-compatible schema change. Never infer them from full_name." Build record and PR:
-- the shared My profile change (src/lib/account/own-profile.ts, src/components/account/OwnProfileCard.tsx).
--
-- APPLY ON STAGING FIRST. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. It adds two
-- nullable columns to profiles, a check constraint on each, and a column-level UPDATE grant on those two
-- columns only. It alters no existing column, row, policy or function, and depends only on profiles
-- (migration 001). Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- BACKWARD COMPATIBILITY.
--
--   full_name stays NOT NULL and authoritative. Every existing reader keeps reading it unchanged.
--   given_name and family_name are NULL for every existing row, and nothing fills them in. They are set
--   only by the person, on their own profile. No backfill, and no split of full_name: a name split by
--   rule is a fact invented about the person, and it differs across naming conventions.
--
-- ----------------------------------------------------------------------------------------------------
-- AUTHORITY IS UNCHANGED.
--
--   The self-update policy "Users update own profile" (WITH CHECK profile_authority_unchanged(...)) is
--   NOT touched. It continues to refuse any self-update that changes role, roles, org_role, org_roles,
--   platform_role, platform_roles, hospital_id, organisation_id, tenant_id, managed_country,
--   is_senior_assessor or account_status.
--
--   The one privilege change: the authenticated role already holds column-level UPDATE on exactly
--   full_name, phone, country, specialization and avatar_url (and on no authority column). This adds
--   given_name and family_name to that list, so a person can set their own two name parts through the
--   same RLS-checked path. No table-level UPDATE is granted, and email stays ungranted.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts).
--   1. ASCII only. No semicolons inside any comment or string literal.
--   2. No plpgsql, no do-blocks, no functions. So no APPLY-WHOLE banner is required.
--   3. No index.
--   4. notify pgrst LAST.
-- ====================================================================================================

alter table profiles add column if not exists given_name text;
alter table profiles add column if not exists family_name text;

-- Present means a real value: trimmed, not empty, and of a sane length. Absent is NULL, never an empty
-- string, so "not recorded" has exactly one representation.
alter table profiles drop constraint if exists profiles_given_name_check;
alter table profiles add constraint profiles_given_name_check
  check (given_name is null or (given_name = btrim(given_name) and char_length(given_name) between 1 and 100));

alter table profiles drop constraint if exists profiles_family_name_check;
alter table profiles add constraint profiles_family_name_check
  check (family_name is null or (family_name = btrim(family_name) and char_length(family_name) between 1 and 100));

grant update (given_name, family_name) on table profiles to authenticated;

comment on column profiles.given_name is
  'Optional. The given name the person entered for themselves. Never derived from full_name, which stays the authoritative display name. NULL means not recorded.';
comment on column profiles.family_name is
  'Optional. The family name the person entered for themselves. Never derived from full_name. NULL means not recorded.';

notify pgrst, 'reload schema';
