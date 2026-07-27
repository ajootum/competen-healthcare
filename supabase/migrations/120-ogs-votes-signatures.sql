-- 120: OGS roll-call votes + digital signatures (OGS-004 refinement). Plain, idempotent statements only
-- (no do-blocks). RLS = authenticated read; service-role writes. No seed (forward-looking write surfaces).
-- ogs_votes = per-member roll-call on a decision (the tally on ogs_decisions is derived from these when a
-- roll-call is recorded). ogs_signatures = e-sign sign-off on a decision / charter / meeting minutes.

create table if not exists ogs_votes (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references ogs_decisions(id) on delete cascade,
  voter_id    uuid references profiles(id) on delete set null,
  voter_name  text,
  vote        text not null default 'abstain',   -- for|against|abstain
  created_at  timestamptz default now()
);
create index if not exists idx_ogs_votes_decision on ogs_votes(decision_id);
alter table ogs_votes enable row level security;
drop policy if exists ogs_votes_read on ogs_votes;
create policy ogs_votes_read on ogs_votes for select to authenticated using (true);

create table if not exists ogs_signatures (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,                      -- decision|charter|minutes
  entity_id   uuid not null,
  office_id   uuid references ogs_offices(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  signer_id   uuid references profiles(id) on delete set null,
  signer_name text,
  signer_role text,
  statement   text,
  signed_at   timestamptz default now()
);
create index if not exists idx_ogs_sig_entity on ogs_signatures(entity_type, entity_id);
create index if not exists idx_ogs_sig_office on ogs_signatures(office_id);
alter table ogs_signatures enable row level security;
drop policy if exists ogs_sig_read on ogs_signatures;
create policy ogs_sig_read on ogs_signatures for select to authenticated using (true);
