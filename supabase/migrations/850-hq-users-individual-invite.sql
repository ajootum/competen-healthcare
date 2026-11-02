-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql function body between dollar quotes. A runner that splits
-- on the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 850: HQ USER INVITATIONS TO COMPETEN INDIVIDUAL, WITH A DEFINED SOURCE, PREFILL AND PARTICIPATION
--
-- Owner GO "HQ User Management, Invitations and Individual Profile Completion" (2 Nov 2026).
-- Branch hq/users-invite-01. APPLY ON STAGING FIRST. NOT AUTHORISED FOR PRODUCTION without a separate
-- owner GO. Additive. Re-running it is a no-op.
--
-- DEPENDS ON 001 (profiles), 378 (individual_invitation and its guard), 380 (the profile name checks and
-- grants) and 650 (hq_account_classification, whose posture the new table mirrors).
--
-- WHAT IT ADDS
--   individual_invitation.entitlement_source  which entitlement source an accepted invitation writes.
--                          NULL is a legacy row and is accepted as pilot. Only pilot and hq_grant.
--   individual_invitation.prefill  optional details HQ supplied about the person (a JSON object). It is
--                          shown to the person to confirm. HQ never writes it into a learner-owned table.
--   profiles.middle_names  optional. Set by the person, or by HQ on an identity an invitation created or
--                          by an audited compare-and-set edit. Never derived from full_name.
--   hq_account_participation  one row per profile: Regular, Pilot or Staff tester, an optional cohort and an
--                          optional end. It is an administrative label and DECIDES NO ACCESS.
--   individual_invitation_guard()  replaced so the two new invitation columns are as immutable as the
--                          others. The trigger itself is unchanged.
--
-- WHAT IT DOES NOT DO. It grants and revokes no access, writes no row, backfills nothing and touches no
-- existing policy. Nothing reads the new table to decide anything. The application code behind it refuses
-- with NOT_SET_UP while this file is absent.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): RELEASE-2026-10-25/PENDING-36/ROLLBACK-850.sql
-- ====================================================================================================


-- ---- 1. individual_invitation: the source and the prefill -----------------------------------------------

alter table individual_invitation add column if not exists entitlement_source text;
alter table individual_invitation drop constraint if exists individual_invitation_entitlement_source_check;
alter table individual_invitation add constraint individual_invitation_entitlement_source_check
  check (entitlement_source is null or entitlement_source in ('pilot', 'hq_grant'));

alter table individual_invitation add column if not exists prefill jsonb;
alter table individual_invitation drop constraint if exists individual_invitation_prefill_check;
alter table individual_invitation add constraint individual_invitation_prefill_check
  check (prefill is null or jsonb_typeof(prefill) = 'object');

comment on column individual_invitation.entitlement_source is
  'The source the entitlement carries when the invitation is accepted. pilot or hq_grant. NULL is a legacy invitation and is accepted as pilot.';
comment on column individual_invitation.prefill is
  'Optional details HQ supplied about the invitee. Shown to the person to confirm. Never written by HQ into a learner-owned table.';


-- ---- 2. the invitation record stays immutable, including the two new columns --------------------------------

create or replace function individual_invitation_guard()
returns trigger
language plpgsql
as $$
begin
  -- below the top trigger level the change came from a foreign-key cascade on profiles (a delete, or
  -- a set null), so the identity is being removed and the row goes or loses the reference with it
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'individual_invitation is append only. DELETE refused on invitation %', old.id;
  end if;
  if old.status <> 'PENDING' then
    raise exception 'invitation % is %, and can no longer change', old.id, old.status;
  end if;
  if new.status not in ('ACCEPTED', 'REVOKED') then
    raise exception 'invitation % may only be accepted or revoked', old.id;
  end if;
  if new.invited_email is distinct from old.invited_email
     or new.invited_name is distinct from old.invited_name
     or new.invite_scholar is distinct from old.invite_scholar
     or new.invite_professional is distinct from old.invite_professional
     or new.adult_confirmed_at is distinct from old.adult_confirmed_at
     or new.adult_confirmed_by is distinct from old.adult_confirmed_by
     or new.entitlement_ends_at is distinct from old.entitlement_ends_at
     or new.note is distinct from old.note
     or new.expires_at is distinct from old.expires_at
     or new.auth_user_id is distinct from old.auth_user_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.entitlement_source is distinct from old.entitlement_source
     or new.prefill is distinct from old.prefill then
    raise exception 'invitation % records what was offered, and that cannot change', old.id;
  end if;
  return new;
end;
$$;


-- ---- 3. profiles.middle_names ---------------------------------------------------------------------------------

alter table profiles add column if not exists middle_names text;

-- Present means a real value: trimmed, not empty, and of a sane length. Absent is NULL, never an empty
-- string. The same shape as the 380 name checks.
alter table profiles drop constraint if exists profiles_middle_names_check;
alter table profiles add constraint profiles_middle_names_check
  check (middle_names is null or (middle_names = btrim(middle_names) and char_length(middle_names) between 1 and 100));

grant update (middle_names) on table profiles to authenticated;

comment on column profiles.middle_names is
  'Optional. The middle name or names, as the person entered them, or as HQ recorded them for an identity it invited. Never derived from full_name, which stays the authoritative display name. NULL means not recorded.';


-- ---- 4. hq_account_participation -- a label that decides no access ----------------------------------------------

create table if not exists hq_account_participation (
  user_id     uuid primary key references profiles(id) on delete cascade,
  category    text not null,
  cohort_code text,
  valid_until timestamptz,
  set_by      uuid references profiles(id) on delete set null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table hq_account_participation drop constraint if exists hq_account_participation_category_check;
alter table hq_account_participation add constraint hq_account_participation_category_check
  check (category in ('regular', 'pilot', 'staff_tester'));
alter table hq_account_participation drop constraint if exists hq_account_participation_cohort_check;
alter table hq_account_participation add constraint hq_account_participation_cohort_check
  check (cohort_code is null or char_length(btrim(cohort_code)) between 1 and 60);
alter table hq_account_participation drop constraint if exists hq_account_participation_reason_check;
alter table hq_account_participation add constraint hq_account_participation_reason_check
  check (length(btrim(reason)) between 1 and 600);

-- HQ reads and writes it with the service role. No policy: nobody else reads or writes it.
alter table hq_account_participation enable row level security;
revoke all on table hq_account_participation from anon, authenticated;

comment on table hq_account_participation is
  'Administrative participation label per profile: regular, pilot or staff_tester, with an optional cohort and end. It DECIDES NO ACCESS. No function, policy or guard reads it. Access comes from memberships, entitlements and appointments only.';

notify pgrst, 'reload schema';
