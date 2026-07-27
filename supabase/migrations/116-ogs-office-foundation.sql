-- 116: Office Governance System (OGS-001) — first-class governance offices + charters.
-- OGS Phase 2 foundation. Plain, idempotent statements only (no PL/pgSQL do-blocks — the tenant SQL
-- runner splits on ';'). RLS = authenticated read; writes go through service-role API routes.
-- The office model generalises governance_committees into a constituted Office with a charter, lifecycle
-- state, authority source and review cadence. This migration also SEEDS offices from existing committees
-- (OGS-000 §26 migration strategy) so the OGS surface upgrades from the v1 committee mapping automatically.

create table if not exists ogs_offices (
  id                  uuid primary key default gen_random_uuid(),
  hospital_id         uuid references hospitals(id) on delete cascade,
  organisation_id     uuid references organisations(id) on delete set null,
  source_committee_id uuid references governance_committees(id) on delete set null,
  office_type         text not null default 'governance',   -- competency|quality|hr|education|research|executive|governance|...
  name                text not null,
  code                text,
  scope_type          text not null default 'hospital',      -- enterprise|country|organisation|hospital|department|specialty
  status              text not null default 'active',         -- proposed|in_design|pending_approval|approved|active|under_review|suspended|restructuring|closing|dissolved|archived
  authority_source    text,
  reporting_line      text,
  chair_id            uuid references profiles(id) on delete set null,
  chair_name          text,
  quorum              int default 3,
  established_at      date,
  next_review_date    date,
  charter_version     text default 'v1.0',
  is_active           boolean default true,
  created_at          timestamptz default now()
);
create index if not exists idx_ogs_offices_hospital on ogs_offices(hospital_id);
create index if not exists idx_ogs_offices_source on ogs_offices(source_committee_id);
alter table ogs_offices enable row level security;
drop policy if exists ogs_offices_read on ogs_offices;
create policy ogs_offices_read on ogs_offices for select to authenticated using (true);

create table if not exists ogs_office_charters (
  id              uuid primary key default gen_random_uuid(),
  office_id       uuid not null references ogs_offices(id) on delete cascade,
  version         text not null default 'v1.0',
  purpose         text,
  mandate         text,
  quorum_rule     text,
  decision_rule   text,
  effective_from  date,
  review_date     date,
  approved_by     text,
  approval_status text not null default 'approved',           -- draft|pending|approved|superseded
  created_at      timestamptz default now()
);
create index if not exists idx_ogs_charters_office on ogs_office_charters(office_id);
alter table ogs_office_charters enable row level security;
drop policy if exists ogs_charters_read on ogs_office_charters;
create policy ogs_charters_read on ogs_office_charters for select to authenticated using (true);

-- Seed offices from existing governance committees (idempotent — skip already-mapped committees).
insert into ogs_offices (hospital_id, organisation_id, source_committee_id, office_type, name, scope_type, status, authority_source, quorum, established_at, next_review_date, is_active)
select gc.hospital_id, gc.organisation_id, gc.id, 'governance', gc.name, gc.level,
       case when gc.is_active then 'active' else 'suspended' end,
       'Constituted from governance committee', coalesce(gc.quorum, 3), gc.created_at::date,
       (gc.created_at + interval '365 days')::date, gc.is_active
from governance_committees gc
where not exists (select 1 from ogs_offices o where o.source_committee_id = gc.id);

-- Seed a baseline charter per office (idempotent).
insert into ogs_office_charters (office_id, version, purpose, effective_from, review_date, approved_by, approval_status)
select o.id, 'v1.0', 'Govern the ' || o.name || ' mandate: review, approve, publish, monitor and audit its governed assets.',
       o.established_at, o.next_review_date, o.authority_source, 'approved'
from ogs_offices o
where not exists (select 1 from ogs_office_charters c where c.office_id = o.id);
