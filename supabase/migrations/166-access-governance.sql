-- 166: Access review campaigns and segregation of duties (UMW-TLS-002).
--
-- WHAT ALREADY EXISTS AND IS NOT DUPLICATED HERE. TLS-002 overlaps ADM-007 heavily, and most of it is
-- already built and live:
--   adm_delegations     delegated administration, with validity dates and a revoked state
--   break_glass_grant   emergency access, already surfaced as Temporary & Emergency Access
--   audit_log           the activity trail
--   profiles.roles      role assignment
-- Rebuilding any of those under a new name would give a unit two answers to "who can do what".
--
-- WHAT DOES NOT EXIST, and is all this adds:
--   1. ACCESS REVIEW CAMPAIGNS. Periodically asking an owner "should this person still have this access?"
--      and recording the answer. Without a store, a review is a conversation nobody can evidence at audit.
--   2. SEGREGATION OF DUTIES. A rule that two roles must not be held by the same person. The VIOLATIONS are
--      deliberately NOT stored - they are computed live from profiles.roles, because a stored violation
--      goes stale the moment someone's roles change and would then accuse a person who is already clean.
--
-- The permission MATRIX is not a table either. What a role can actually reach is decided by the gates in
-- the application code, so the matrix is generated from that code (src/lib/access/matrix.generated.json)
-- and checked for staleness by a harness. A hand-maintained permissions table would drift from the code
-- silently, and a matrix that disagrees with the real gate is worse than no matrix at all.
--
-- Plain idempotent statements only (no do-blocks, no semicolons inside comments). Pure ASCII.
-- RLS: authenticated read (these describe policy, not personal data), service-role writes.

create table if not exists access_reviews (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  name        text not null,
  scope       text not null default 'unit' check (scope in ('unit','department','hospital','role')),
  scope_ref   text,
  status      text not null default 'draft' check (status in ('draft','open','closed','cancelled')),
  opened_at   timestamptz,
  due_at      timestamptz,
  closed_at   timestamptz,
  owner_id    uuid references profiles(id) on delete set null,
  owner_name  text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_access_reviews_hospital on access_reviews(hospital_id, status, due_at);

-- One line per (campaign, person, access) decision. `decision` stays null until someone actually decides,
-- so an undecided item can never be counted as approved - a campaign that nobody completed must not read
-- as a clean bill of health.
create table if not exists access_review_items (
  id            uuid primary key default gen_random_uuid(),
  review_id     uuid not null references access_reviews(id) on delete cascade,
  subject_id    uuid references profiles(id) on delete cascade,
  subject_name  text,
  access_type   text not null default 'role' check (access_type in ('role','delegation','break_glass','workspace')),
  access_ref    text not null,
  decision      text check (decision in ('retain','revoke','modify')),
  decided_by    uuid references profiles(id) on delete set null,
  decided_by_name text,
  decided_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  unique (review_id, subject_id, access_type, access_ref)
);
create index if not exists idx_access_review_items_review on access_review_items(review_id);

-- Segregation of duties. role_a and role_b must not be held by the same person. severity drives whether a
-- breach is a finding or a blocker - "an educator who also assesses" is not the same risk as "the person who
-- requests access also approves it".
create table if not exists sod_rules (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  code        text not null,
  label       text not null,
  role_a      text not null,
  role_b      text not null,
  severity    text not null default 'medium' check (severity in ('low','medium','high','critical')),
  rationale   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (hospital_id, code)
);
create index if not exists idx_sod_rules_hospital on sod_rules(hospital_id, active);

-- An accepted breach. A rule someone has consciously decided to live with, with an owner and an expiry,
-- is governance. The same breach with no record is just an unnoticed hole, so the two are kept distinct.
create table if not exists sod_exceptions (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  rule_id      uuid not null references sod_rules(id) on delete cascade,
  subject_id   uuid not null references profiles(id) on delete cascade,
  subject_name text,
  reason       text not null,
  approved_by  uuid references profiles(id) on delete set null,
  approved_by_name text,
  expires_at   date,
  created_at   timestamptz not null default now(),
  unique (rule_id, subject_id)
);
create index if not exists idx_sod_exceptions_hospital on sod_exceptions(hospital_id);

alter table access_reviews enable row level security;
alter table access_review_items enable row level security;
alter table sod_rules enable row level security;
alter table sod_exceptions enable row level security;

drop policy if exists access_reviews_read on access_reviews;
create policy access_reviews_read on access_reviews for select to authenticated using (true);
drop policy if exists access_review_items_read on access_review_items;
create policy access_review_items_read on access_review_items for select to authenticated using (true);
drop policy if exists sod_rules_read on sod_rules;
create policy sod_rules_read on sod_rules for select to authenticated using (true);
drop policy if exists sod_exceptions_read on sod_exceptions;
create policy sod_exceptions_read on sod_exceptions for select to authenticated using (true);

notify pgrst, 'reload schema';
