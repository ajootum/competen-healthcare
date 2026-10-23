-- ====================================================================================================
-- MIGRATION 378: COMPETEN INDIVIDUAL INVITATIONS FOR PEOPLE WITHOUT A COMPETEN ACCOUNT
--
-- >>> APPLY THIS FILE WHOLE (apply-migrations.ts, or the Supabase SQL editor). NOT THROUGH A <<<
-- >>> SEMICOLON SPLITTER. Section 3 is a plpgsql trigger function with internal semicolons.   <<<
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION (owner GO, Individual invitations). It creates
-- one new Individual-owned table, one view and one trigger. It alters no existing table, row, policy or
-- constraint. Nothing reads it until the invitation code ships, and re-running it is a no-op.
--
-- COMPETEN-IND-ACCESS-001 (invitations), ADR-016, COMP-ARCH-PSA-001 sections 7, 21 and 40.
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS IS FOR, IN ONE SENTENCE.
--
-- An HQ administrator holding hq.individual.pilot.grant can invite somebody who has no Competen account
-- into Competen Scholar, Competen Professional or both, and the invitation carries the pending grant
-- until the person accepts it -- without creating any membership of any product before they do.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE.
--
--   individual_invitation       ONE row per invitation. The Supabase auth invite creates the
--                               one Competen identity of the invitee (auth user, profiles row, by the existing
--                               on_auth_user_created trigger). This row records what was offered, by
--                               whom, until when, and what became of it. It is NOT a membership: no
--                               Individual, platform, enterprise or practice membership exists until the
--                               person accepts, and accepting writes only the Individual ones (370).
--
--   individual_live_invitation  The invitations that can still be accepted NOW, judged by the DATABASE
--                               clock (status PENDING and expires_at in the future). Expiry is derived,
--                               never stored -- the practice_invitation rule (201) -- and application
--                               code never compares its own clock with expires_at (ADR-016).
--
-- ----------------------------------------------------------------------------------------------------
-- RULES ENFORCED HERE, SO A SECOND WRITER CANNOT BREAK THEM.
--
--   One live invitation per email. A plain FULL unique index on a GENERATED column that holds the email
--     only while the row is PENDING (house rules forbid partial unique indexes, and NULLs are distinct,
--     so accepted and revoked invitations never collide). An expired PENDING row still holds the email:
--     the administrator revokes it, with a reason, before inviting again.
--   D8. Inviting to Scholar requires the HQ adult-eligibility confirmation (when, and who), copied onto the
--     Scholar entitlement at acceptance, where individual_entitlement_scholar_adult (370) checks it again.
--   A revocation says when, by whom and why. An acceptance says when.
--   An invitation expires within thirty days of being made, and after it is made.
--   Append-only history. The trigger allows exactly two changes -- PENDING to ACCEPTED, PENDING to
--     REVOKED -- and nothing else about an invitation may ever change. No DELETE, except the cascade
--     allowance (pg_trigger_depth() above 1), so the profile it points at stays deletable. That is the
--     established fix for a trail nobody can remove (migration 316).
--   RLS ON, own-row SELECT only (ruling D6). No INSERT, UPDATE or DELETE policy: the service role writes,
--     behind the HQ capability and the release gate, or nothing does.
--
-- HOUSE RULES: ASCII only, no semicolons in comments, no partial unique index, idempotent, notify last.
-- NOT IN THIS FILE: any profiles change, any platform_membership write, any estate table, any backfill.
-- ====================================================================================================


-- ---- 1. individual_invitation ------------------------------------------------------------------------

create table if not exists individual_invitation (
  id uuid primary key default gen_random_uuid(),
  invited_email text not null,
  invited_name text,
  invite_scholar boolean not null default false,
  invite_professional boolean not null default false,
  adult_confirmed_at timestamptz,
  adult_confirmed_by uuid references profiles(id) on delete set null,
  entitlement_ends_at timestamptz,
  note text,
  status text not null default 'PENDING',
  expires_at timestamptz not null,
  auth_user_id uuid not null references profiles(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  revoked_reason text,
  pending_email text generated always as (case when status = 'PENDING' then invited_email end) stored
);

alter table individual_invitation drop constraint if exists individual_invitation_status_check;
alter table individual_invitation add constraint individual_invitation_status_check
  check (status in ('PENDING', 'ACCEPTED', 'REVOKED'));

-- Stored normalised, so two spellings of one address are one invitation.
alter table individual_invitation drop constraint if exists individual_invitation_email_normalised;
alter table individual_invitation add constraint individual_invitation_email_normalised
  check (invited_email = lower(btrim(invited_email)) and invited_email like '_%@_%._%' and char_length(invited_email) <= 254);

alter table individual_invitation drop constraint if exists individual_invitation_some_experience;
alter table individual_invitation add constraint individual_invitation_some_experience
  check (invite_scholar or invite_professional);

-- D8: no Scholar invitation without the recorded adult-eligibility confirmation. The time is required
-- and the confirmer is recorded, but the confirmer column alone is not checked: it is set null when that
-- profile is deleted, and a CHECK on it would make the profile undeletable. Same shape as 370.
alter table individual_invitation drop constraint if exists individual_invitation_scholar_adult;
alter table individual_invitation add constraint individual_invitation_scholar_adult
  check (not invite_scholar or adult_confirmed_at is not null);

alter table individual_invitation drop constraint if exists individual_invitation_expiry_window;
alter table individual_invitation add constraint individual_invitation_expiry_window
  check (expires_at > created_at and expires_at <= created_at + interval '30 days');

alter table individual_invitation drop constraint if exists individual_invitation_ends_after_created;
alter table individual_invitation add constraint individual_invitation_ends_after_created
  check (entitlement_ends_at is null or entitlement_ends_at > created_at);

alter table individual_invitation drop constraint if exists individual_invitation_accepted_when;
alter table individual_invitation add constraint individual_invitation_accepted_when
  check ((status = 'ACCEPTED') = (accepted_at is not null));

-- A blank revocation reason is the migration-256 lesson: length, not merely not-null.
alter table individual_invitation drop constraint if exists individual_invitation_revoked_whole;
alter table individual_invitation add constraint individual_invitation_revoked_whole
  check ((status = 'REVOKED') = (revoked_at is not null)
     and (status <> 'REVOKED' or char_length(btrim(coalesce(revoked_reason, ''))) >= 8));

create unique index if not exists ux_individual_invitation_pending_email
  on individual_invitation(pending_email);
create index if not exists idx_individual_invitation_auth_user
  on individual_invitation(auth_user_id, created_at desc);
create index if not exists idx_individual_invitation_email
  on individual_invitation(invited_email, created_at desc);

alter table individual_invitation enable row level security;

drop policy if exists individual_invitation_read_own on individual_invitation;
create policy individual_invitation_read_own on individual_invitation
  for select using (auth.uid() = auth_user_id);

comment on table individual_invitation is
  'COMPETEN-IND-ACCESS-001. An invitation into Competen Individual for a person who had no Competen account. Records the offer and its outcome. It is not a membership: accepting writes individual_membership and individual_entitlement (370) and nothing else.';
comment on column individual_invitation.pending_email is
  'The email while the invitation is PENDING, else null. Its full unique index allows one live invitation per email.';
comment on column individual_invitation.auth_user_id is
  'The Competen identity the Supabase auth invite created. Only this person can accept the invitation.';


-- ---- 2. individual_live_invitation -- WHAT CAN STILL BE ACCEPTED, BY THE DATABASE CLOCK ---------------

create or replace view individual_live_invitation
  with (security_invoker = true) as
  select i.id, i.invited_email, i.invited_name, i.invite_scholar, i.invite_professional,
         i.adult_confirmed_at, i.adult_confirmed_by, i.entitlement_ends_at, i.note,
         i.expires_at, i.auth_user_id, i.created_by, i.created_at
    from individual_invitation i
   where i.status = 'PENDING'
     and i.expires_at > now();

comment on view individual_live_invitation is
  'COMPETEN-IND-ACCESS-001. Invitations that can be accepted now, judged by the database clock. Read this, never compare an application clock with expires_at.';


-- ---- 3. THE HISTORY CANNOT BE REWRITTEN ----------------------------------------------------------------

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
     or new.created_at is distinct from old.created_at then
    raise exception 'invitation % records what was offered, and that cannot change', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_individual_invitation_guard on individual_invitation;
create trigger trg_individual_invitation_guard
  before update or delete on individual_invitation
  for each row execute function individual_invitation_guard();


-- ---- 4. VERIFICATION (read only) ------------------------------------------------------------------------

select column_name, data_type, is_nullable, is_generated
  from information_schema.columns
 where table_name = 'individual_invitation'
 order by ordinal_position;

select conname
  from pg_constraint
 where conrelid = 'individual_invitation'::regclass
 order by conname;

select tablename, policyname, cmd
  from pg_policies
 where tablename = 'individual_invitation';

notify pgrst, 'reload schema';
