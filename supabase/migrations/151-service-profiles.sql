-- 151: CGR-028 — Service profiles (the missing "Service Profile" object, spec §12).
-- The platform could say who holds which competency, but NOT what a SERVICE requires — so §9 service-activation
-- readiness ("are we ready to open this ICU?") had nothing to evaluate against. These two tables are that
-- requirements store: a service profile names a service line, and its required-competency rows state which
-- competency it needs, at what minimum level, held by how many staff, and whether the requirement is CRITICAL
-- (an unmet critical requirement blocks activation regardless of overall coverage).
--
-- Tenancy: hospital_id null = a SHARED/global template (same convention as the frameworks master library) —
-- deliberate, not the caller-scoping bug; tenant rows are local adaptations. Defining requirements is a
-- governance act, so the write path is admin-gated and every change audited.
-- Plain, idempotent statements only (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists service_profiles (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid references hospitals(id) on delete cascade,   -- null = shared template
  name         text not null,                                     -- e.g. "Adult ICU Service"
  code         text,                                              -- e.g. SVC-ICU-001
  description  text,
  status       text not null default 'draft'
                 check (status in ('draft','active','retired')),
  created_by   uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at   timestamptz not null default now()
);

create table if not exists service_required_competencies (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references service_profiles(id) on delete cascade,
  competency_id  uuid not null references framework_competencies(id) on delete cascade,
  min_staff      int not null default 1 check (min_staff >= 1),   -- staff who must hold it, current & competent
  min_level      text check (min_level in ('novice','advanced_beginner','competent','proficient','expert','mentor','authority')),
  is_critical    boolean not null default false,                  -- unmet critical requirement blocks activation
  notes          text,
  created_at     timestamptz not null default now(),
  unique (profile_id, competency_id)
);

create index if not exists idx_service_profiles_status on service_profiles(status, created_at desc);
create index if not exists idx_service_profiles_hosp   on service_profiles(hospital_id);
create index if not exists idx_src_profile             on service_required_competencies(profile_id);
create index if not exists idx_src_competency          on service_required_competencies(competency_id);

alter table service_profiles enable row level security;
alter table service_required_competencies enable row level security;
drop policy if exists service_profiles_read on service_profiles;
create policy service_profiles_read on service_profiles for select to authenticated using (true);
drop policy if exists service_required_competencies_read on service_required_competencies;
create policy service_required_competencies_read on service_required_competencies for select to authenticated using (true);

notify pgrst, 'reload schema';
