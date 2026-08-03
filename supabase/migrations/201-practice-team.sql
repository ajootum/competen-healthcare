-- ============================================================
-- MIGRATION 201: TEAM AND DELEGATED ACCESS (CPR-310)
--
-- The module that makes everything built since CPR-340 reachable by more than one person. Tasks can be
-- handed to a colleague, threads have readers, the assistant role has capabilities -- and until now
-- there has been NO WAY IN THE PRODUCT to add that colleague. The harnesses have been inserting
-- membership rows directly, which is a fair sign of a missing feature.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- DELEGATION NEEDS NO NEW TABLE, AND THAT IS THE FINDING OF THIS MIGRATION.
--
-- practice_role_assignment (migration 191) already has exactly the right shape:
--
--     source          'role_default' | 'explicit_grant' | 'delegation'
--     effective_from  timestamptz not null default now()
--     effective_to    timestamptz
--
-- Time-bounded, attributable, per-capability grants -- designed in Phase 0 and never used. So CPR-310
-- adds no delegation table; it makes the one that exists work.
--
-- WHAT DID NOT WORK, AND IT MATTERS. src/lib/practice/access.ts resolved capabilities with
-- `.is("effective_to", null)`, which has two consequences nobody had noticed:
--
--   1. A grant with an END DATE was invisible EVEN WHILE LIVE. Every delegation this schema was built
--      for would have silently granted nothing.
--   2. `effective_from` was ignored entirely, so a grant dated to begin next Monday was live the moment
--      it was written.
--
-- The second is the security-relevant one. Both are fixed in the resolver rather than here -- capability
-- resolution is application logic and belongs in one readable place -- and the fix is asserted from all
-- three directions: expired must not resolve, not-yet-started must not resolve, open-ended must.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- AN INVITATION CODE IS A BEARER CREDENTIAL, AND THE PRODUCT SAYS SO. The usual design emails a link;
-- this product has no email, no SMS and no delivery of any kind (CPR-320/340), and inventing one for
-- invitations would be the one exception that makes every other honest statement about sending a lie.
-- So an invitation produces a CODE the inviter hands over -- in the room, on the phone, however that
-- practice already trusts. It is single-use, short-lived, and revocable. `invited_email` is a NOTE FOR
-- THE INVITER about who they meant, never an authority: getCaller does not carry a verified email for a
-- practice-only user, so enforcing a match would be theatre.
--
-- EXPIRY IS DERIVED, NOT A STATUS. The same rule as CPR-140's overdue and CPR-340's orphaned work: a
-- stored EXPIRED needs something to run, and nothing runs in a practice that has not opened the app.
-- status holds PENDING, ACCEPTED or REVOKED -- what a human did -- and expired is expires_at against the
-- clock at read time.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 3's trigger function is plpgsql with internal semicolons inside $$ ... $$.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_invitation --------------------------------------------------------------------------

create table if not exists practice_invitation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- The role the invitee will hold. Not 'practice_owner': there is exactly one owner per workspace
  -- (ux_practice_owner_single), and handing that over is a transfer, not an invitation.
  role_code text not null
    check (role_code in ('practitioner', 'practice_assistant', 'billing_reporting', 'read_only_auditor')),
  -- The bearer credential. Opaque, and unique across the whole table rather than per workspace: a code
  -- that is only unique within a practice would let one workspace's code redeem in another.
  code text not null,
  -- A note for the inviter about who they meant. NEVER an authority -- see the header.
  invited_email text,
  invited_name text,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REVOKED')),
  expires_at timestamptz not null,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- Codes are unique globally and looked up by code alone during redemption -- the redeemer is not yet a
-- member of anything, so there is no workspace to scope the lookup by.
create unique index if not exists ux_practice_invitation_code on practice_invitation(code);
create index if not exists idx_practice_invitation_ws on practice_invitation(workspace_id, status, created_at desc);

-- ---- 2. Membership history ---------------------------------------------------------------------------
--
-- Who joined, who changed whose role, who revoked whom, and when. practice_membership holds the CURRENT
-- state; this holds how it got there. Separate from practice_audit_event, which is the workspace-wide
-- operational log: "why does this person have access" is a question that should be answerable beside the
-- membership rather than by filtering a general-purpose stream.

create table if not exists practice_membership_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- The SUBJECT of the change, not the actor. Kept as a plain uuid rather than a membership reference
  -- so the trail survives a membership row being deleted with its workspace.
  subject_user_id uuid not null,
  event_type text not null
    check (event_type in ('invited', 'invitation_revoked', 'joined', 'role_changed',
                          'suspended', 'reinstated', 'revoked', 'capability_delegated', 'delegation_ended')),
  from_value text,
  to_value text,
  note text,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_practice_membership_event
  on practice_membership_event(workspace_id, occurred_at desc);
create index if not exists idx_practice_membership_event_subject
  on practice_membership_event(subject_user_id, occurred_at desc);

-- ---- 3. A workspace may never lose its last owner ----------------------------------------------------
--
-- ux_practice_owner_single guarantees AT MOST one active owner. Nothing guaranteed AT LEAST one -- and a
-- workspace with no active owner is permanently unadministrable: nobody can invite, nobody can restore
-- anybody, and there is no route in the product that can repair it. That is the kind of state a trigger
-- exists for, on the same reasoning as CPR-140's release: the rule must hold for every path, including
-- a console session and whatever route somebody writes next.
--
-- DELETES ARE NOT GUARDED, deliberately: deleting a workspace cascades to its memberships, and refusing
-- that would make a workspace undeletable.

create or replace function practice_last_owner_guard()
returns trigger
language plpgsql
as $$
begin
  if old.role_code = 'practice_owner' and old.status = 'active'
     and (new.status is distinct from 'active' or new.role_code is distinct from 'practice_owner')
     and not exists (
       select 1 from practice_membership m
       where m.workspace_id = old.workspace_id
         and m.role_code = 'practice_owner'
         and m.status = 'active'
         and m.id <> old.id
     )
  then
    raise exception 'this is the last active owner of the practice; transfer ownership before removing it';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_practice_last_owner_guard on practice_membership;
create trigger trg_practice_last_owner_guard
  before update on practice_membership
  for each row execute function practice_last_owner_guard();

-- A membership event is a historical fact, as every other trail in this schema.
create or replace function practice_membership_event_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'membership event % is part of the record and cannot be changed', old.id;
end;
$$;

drop trigger if exists trg_practice_membership_event_immutable on practice_membership_event;
create trigger trg_practice_membership_event_immutable
  before update on practice_membership_event
  for each row execute function practice_membership_event_immutable();

-- ---- 4. Capabilities ---------------------------------------------------------------------------------
--
-- NONE ARE ADDED, and that is deliberate. practice.members.manage already exists on the owner role from
-- migration 191, which is exactly this module's authority. Minting practice.team.view alongside it would
-- be a second capability for one idea -- and listMembers is already called without one, because knowing
-- who your colleagues are is a precondition for assigning them work rather than a privilege.
--
-- The escalation boundary is enforced in the engine instead, where it can be stated in a sentence:
-- YOU CANNOT DELEGATE A CAPABILITY YOU DO NOT HOLD. Without it, an owner -- deliberately given no
-- clinical access by 191 -- could grant themselves encounter.list and read every consultation in the
-- practice. Delegation lends what you have; it does not mint what you lack.

-- ---- 5. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_invitation enable row level security;
alter table practice_membership_event enable row level security;

notify pgrst, 'reload schema';
