-- ============================================================
-- MIGRATION 012: GOVERNANCE DEPTH (Book I Ch.11, Phase 3)
-- Governance committees, semantic versioning, change requests,
-- and the knowledge dependency graph (edges) for impact analysis.
-- Additive & idempotent.
-- ============================================================

-- ── GOVERNANCE COMMITTEES ───────────────────────────────────
create table if not exists governance_committees (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  level           text not null default 'facility'
                    check (level in ('enterprise','country','facility','department','specialty')),
  organisation_id uuid references organisations(id) on delete cascade,
  hospital_id     uuid references hospitals(id) on delete cascade,
  quorum          int default 1,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

create table if not exists committee_members (
  id            uuid primary key default gen_random_uuid(),
  committee_id  uuid not null references governance_committees(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  role          text default 'member' check (role in ('chair','member','reviewer')),
  created_at    timestamptz default now(),
  unique (committee_id, profile_id)
);

-- ── SEMANTIC VERSIONING (Book I 11.9) ───────────────────────
-- major.minor.revision on frameworks (existing version_num kept as legacy counter)
alter table frameworks add column if not exists version_major int default 1;
alter table frameworks add column if not exists version_minor int default 0;
alter table frameworks add column if not exists version_revision int default 0;
alter table frameworks add column if not exists governance_committee_id uuid references governance_committees(id) on delete set null;
alter table frameworks add column if not exists review_date date;

-- ── CHANGE REQUESTS (Book I 11.10) ──────────────────────────
create table if not exists change_requests (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,
  entity_id     uuid not null,
  entity_name   text,
  rationale     text not null,
  change_kind   text default 'minor' check (change_kind in ('major','minor','revision')),
  impact_summary jsonb,
  status        text default 'open' check (status in ('open','approved','rejected','implemented')),
  requested_by  uuid references profiles(id),
  requested_by_name text,
  reviewed_by   uuid references profiles(id),
  effective_date date,
  created_at    timestamptz default now()
);

-- ── KNOWLEDGE DEPENDENCY GRAPH (Book I 11.15 / 13.9) ────────
-- Generic governed edges between any two objects.
create table if not exists knowledge_edges (
  id            uuid primary key default gen_random_uuid(),
  source_type   text not null,
  source_id     uuid not null,
  target_type   text not null,
  target_id     uuid not null,
  relationship  text not null default 'references'
                  check (relationship in (
                    'contains','belongs_to','requires','depends_on','supports',
                    'assesses','generates','validates','supersedes','references','related_to')),
  created_at    timestamptz default now(),
  unique (source_type, source_id, target_type, target_id, relationship)
);
create index if not exists idx_edges_source on knowledge_edges(source_type, source_id);
create index if not exists idx_edges_target on knowledge_edges(target_type, target_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table governance_committees enable row level security;
alter table committee_members     enable row level security;
alter table change_requests       enable row level security;
alter table knowledge_edges       enable row level security;

do $$ begin
  create policy "Staff read committees" on governance_committees for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','assessor','super_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write committees" on governance_committees for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','super_admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff read committee members" on committee_members for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','assessor','super_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write committee members" on committee_members for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','super_admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Staff read change requests" on change_requests for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','assessor','super_admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff write change requests" on change_requests for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('hospital_admin','educator','super_admin')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Auth read edges" on knowledge_edges for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Super admin writes edges" on knowledge_edges for all
    using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin'));
exception when duplicate_object then null; end $$;
