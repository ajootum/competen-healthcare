-- ====================================================================================================
-- MIGRATION 280: THE MULLEN E. CORRECTIVE MIGRATION -- ONE NAMED ACCOUNT, AND ONLY ONE
--
-- COMP-ARCH-PSA-001 section 31 (Mullen E. corrective migration). CP-SPLIT-002 stage 4.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY THIS IS A SEPARATE FILE FROM 279, AND NOT THE LAST SECTION OF IT.
--
-- 279 is STRUCTURE and it is safe -- it adds a table, backfills every existing estate identity, and
-- takes nothing away from anybody. This file TAKES SOMETHING AWAY FROM A NAMED PERSON. They are
-- separated so the owner can apply the structure, watch the platform for as long as they like, and
-- decide about the one account independently. Applying 279 without 280 leaves the product correct and
-- unchanged for all 47 people. Applying 280 without 279 fails loudly on a missing table, which is the
-- right way round for a dependency.
--
-- ----------------------------------------------------------------------------------------------------
-- !! THE PREDICATE NAMES ONE PERSON. IT MUST NEVER BECOME A RULE.
--
-- The obvious way to write this migration is:
--
--     ... where user_id in (select user_id from practice_membership)
--
-- and it is CATASTROPHIC. It would demote every super_admin who also happens to own a practice, and
-- that is the platform owner's own situation on this database today -- one of the two super_admin
-- accounts is mullenokaisu@gmail.com, a different identity from the one below, and the pattern would
-- catch anybody who later signs up for Practice from an owner account. The result would be the owners
-- locking themselves out of the console they would use to undo it.
--
-- So the predicate is the identity's uuid AND its email address together. Two independent identifiers
-- that both have to match. A mistyped uuid does not silently hit somebody else's row -- it hits none.
--
-- ----------------------------------------------------------------------------------------------------
-- WHO THIS IS, READ BACK FROM THE LIVE DATABASE BEFORE THIS FILE WAS WRITTEN:
--
--   id             22cfc00a-c763-4e0f-a0d9-e9d8e747c3a1
--   email          mullen.elisha777@gmail.com
--   full_name      Mullen E.
--   role           nurse            <- assigned by Practice signup, which had nowhere else to put her
--   roles          {nurse}
--   hospital_id    null             <- she has never been attached to a facility
--   org_role       null
--   platform_role  null
--   practice       owner and practitioner of workspace b7c5dbc1-22e1-4c53-900c-c2c0f0e7135b
--
-- She is the ONLY real person on this database holding a practice membership. The other practice
-- user_id is a harness fixture with no profile row at all.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO, FROM SECTION 31'S OWN LIST:
--
--   The identity is RETAINED -- the profiles row is not deleted, and neither is the auth user.
--   The Practice account, practitioner profile, practice and practice membership are ALL RETAINED and
--   are not read or written by this file. Section 31: "The migration MUST NOT delete the
--   CompetenPractice identity relationship merely to remove the erroneous Platform role."
--   Nothing cascades. platform_membership has no foreign key to any practice_ table and never will.
--
-- ----------------------------------------------------------------------------------------------------
-- TRAPS: no semicolon outside a statement terminator including inside a comment, no -- inside a string
-- literal, no do-blocks, ASCII only, notify pgrst last.
-- ====================================================================================================


-- ---- 1. REMOVE THE PLATFORM MEMBERSHIP THAT 279 BACKFILLED -----------------------------------------
--
-- 279 gave her a row because she holds an estate role today. That row is the accidental Platform
-- membership section 31 asks to remove, and removing it is what actually closes gate 1: the guard in
-- src/lib/platform-membership.ts reads THIS table, not the role column.
--
-- The subselect pins the email as well as the uuid. Both must match the same row.
delete from platform_membership
where user_id = '22cfc00a-c763-4e0f-a0d9-e9d8e747c3a1'
  and user_id in (
    select id from profiles
    where id = '22cfc00a-c763-4e0f-a0d9-e9d8e747c3a1'
      and email = 'mullen.elisha777@gmail.com'
  );


-- ---- 2. REMOVE THE ESTATE ROLE THAT PRACTICE SIGNUP ASSIGNED ---------------------------------------
--
-- Section 31: "remove the accidentally created Platform Nurse membership, remove Platform permissions
-- arising solely from that erroneous provisioning."
--
-- Both role columns, because every gate in the product resolves them as (roles?.length ? roles : [role])
-- and clearing one alone would leave the other still speaking. roles becomes an EMPTY ARRAY rather than
-- null so that the length-check in that expression falls through to the scalar, which is now null --
-- the two together resolve to no estate role at all, which is the whole intent.
--
-- This is possible only because migration 279 dropped the NOT NULL on profiles.role. Applying this file
-- without 279 fails on that constraint, loudly, which is correct.
--
-- WHY BOTH THE MEMBERSHIP AND THE ROLE, WHEN THE MEMBERSHIP ALONE WOULD CLOSE THE GATE: because a role
-- she does not hold is a lie stored in the identity table, and the next feature that reads role without
-- consulting membership -- there are 174 API routes that gate on role today -- would act on it. The
-- membership closes the door. Clearing the role means there is nothing behind the door either.
update profiles
set role = null,
    roles = '{}'
where id = '22cfc00a-c763-4e0f-a0d9-e9d8e747c3a1'
  and email = 'mullen.elisha777@gmail.com';


-- ---- 3. THE AUDIT RECORD ---------------------------------------------------------------------------
--
-- Section 31's last bullet: "write an audit record documenting the corrective action."
--
-- old_value is written from the values read back from the live database above rather than from a
-- subquery, because by the time this statement runs sections 1 and 2 have already destroyed them. If
-- either of those statements matched no row, this record overstates what happened -- which is why the
-- verification query at the end of this file exists and why the operator should run it.
insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name,
                       old_value, new_value, notes)
values (
  null,
  'Migration 280',
  'platform_membership_corrective_removal',
  'profile',
  '22cfc00a-c763-4e0f-a0d9-e9d8e747c3a1',
  'Mullen E.',
  '{"role": "nurse", "roles": ["nurse"], "platform_membership": "active (backfill_legacy, migration 279)"}'::jsonb,
  '{"role": null, "roles": [], "platform_membership": "none"}'::jsonb,
  'COMP-ARCH-PSA-001 s31. Competen Practice registration assigned a Competen Platform nurse role because profiles.role was NOT NULL and had nowhere else to put a practitioner. Platform membership and estate role removed. Competen Practice account, practitioner profile, practice and practice membership all retained and untouched. Reviewed and applied by name, never by a rule over practice membership.'
);


-- ---- 4. VERIFICATION, TO BE RUN BY HAND AFTER APPLYING ---------------------------------------------
--
-- Paste this on its own and read the result. It must return exactly one row, with a null role, an empty
-- roles array, zero platform memberships and TWO surviving practice memberships. If practice_rows is
-- not 2, stop and report it -- this file must not have touched them.
--
--   select p.id, p.email, p.role, p.roles,
--          (select count(*) from platform_membership m where m.user_id = p.id) as platform_rows,
--          (select count(*) from practice_membership pm where pm.user_id = p.id) as practice_rows
--     from profiles p
--    where p.email = 'mullen.elisha777@gmail.com'
--
-- And the counterpart that proves this file was surgical -- it must return 46, one fewer than the 47
-- rows migration 279 backfilled, and it must still include BOTH super_admin accounts:
--
--   select count(*) from platform_membership where status = 'active'


-- ---- 5. TELL PostgREST ------------------------------------------------------------------------------
-- No schema changed here, only rows. The reload is harmless and keeps every migration in this arc
-- ending the same way.
notify pgrst, 'reload schema';
