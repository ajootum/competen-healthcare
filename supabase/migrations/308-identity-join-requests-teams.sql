-- 308: COMP-IDENTITY-001 item 14, the two genuine zeros -- organisation join requests and team
-- membership. Everything else in the item-14 basket either exists (practice invitations by bearer
-- code, platform invitations by email on the users workspace), is settled into another arc by owner
-- decision (multi-facility membership belongs to Competen Enterprise, ENT-DEC-001 -- NOT a rework of
-- profiles), or waits on an owner decision (custom roles, retention).
--
-- ORG JOIN REQUESTS (the spec's own lifecycle step, "Organization join request"). A person who holds
-- a Competen account but no estate home asks to join an organisation, in their own words. An
-- organisation administrator answers. Approval is the GRANT -- it is recorded on the request row so
-- the row reads as the account of what was asked and what was given. A refusal must carry words,
-- because the requester will read it days later with nothing else to go on.
--
-- TEAM MEMBERSHIP. ent_teams has existed since migration 052 with a name and a lead and NO WAY to
-- say who is on the team -- the spec's "one user may belong to multiple organizations and teams" was
-- unexpressible. One row per person per team, plain and boring.

-- ---- 1. org_join_request ---------------------------------------------------------------------------

create table if not exists org_join_request (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  organisation_id uuid not null references organisations(id) on delete cascade,
  -- The facility they asked into, when they named one. Optional -- an organisation may sort that out
  -- at approval time, and the approver may grant a different one.
  hospital_id uuid references hospitals(id) on delete set null,
  -- The requester's words, for the approver. Never an authority.
  note text check (note is null or char_length(note) <= 500),

  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REFUSED', 'WITHDRAWN')),

  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),

  -- What approval actually granted, recorded ON the request so it answers for itself later. Null on
  -- anything that is not an approval, enforced below.
  granted_org_role text,
  granted_hospital_id uuid references hospitals(id) on delete set null,

  created_at timestamptz not null default now()
);

-- A decision and its timestamp arrive together or not at all. WITHDRAWN counts as a decision made
-- by the requester, so it carries decided_by and decided_at like the others.
alter table org_join_request drop constraint if exists org_join_request_decided_pair;
alter table org_join_request add constraint org_join_request_decided_pair
  check ((status = 'PENDING') = (decided_at is null));

-- Grants exist only on approvals. A refused request that carried a granted role would be two answers
-- on one row.
alter table org_join_request drop constraint if exists org_join_request_grant_on_approval;
alter table org_join_request add constraint org_join_request_grant_on_approval
  check (status = 'APPROVED' or (granted_org_role is null and granted_hospital_id is null));

-- A refusal carries words. btrim, not merely is-not-null -- a blank string is not null, and that
-- lesson has already cost this repository a migration (256 -> 257).
alter table org_join_request drop constraint if exists org_join_request_refusal_needs_words;
alter table org_join_request add constraint org_join_request_refusal_needs_words
  check (status <> 'REFUSED' or (decision_note is not null and btrim(decision_note) <> ''));

-- ONE live request per person per organisation. A full unique index over a sentinel expression,
-- never a partial unique -- the partial-index upsert trap is a recorded bug class here. While the
-- row is PENDING the third column is a constant, so a second PENDING for the same pair collides.
-- Once decided, the third column is the row's own id and can never collide.
create unique index if not exists ux_org_join_request_one_pending
  on org_join_request (user_id, organisation_id,
    (case when status = 'PENDING' then 'PENDING' else id::text end));

create index if not exists idx_org_join_request_org on org_join_request (organisation_id, status, created_at desc);
create index if not exists idx_org_join_request_user on org_join_request (user_id, created_at desc);

alter table org_join_request enable row level security;

-- ---- 2. ent_team_members ---------------------------------------------------------------------------

create table if not exists ent_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references ent_teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  added_by uuid references profiles(id) on delete set null,
  joined_at timestamptz not null default now()
);

-- On a team once. Re-adding is a no-op the engine reports honestly, never a second row.
create unique index if not exists ux_ent_team_members_once on ent_team_members (team_id, user_id);
-- The "which teams am I on" read.
create index if not exists idx_ent_team_members_user on ent_team_members (user_id);

alter table ent_team_members enable row level security;

notify pgrst, 'reload schema';
