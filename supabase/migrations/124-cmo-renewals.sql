-- 124: COMP-020 Competency Recertification & Renewal Management — the renewal record. An expiring competency or
-- certification is renewed through a chosen path (evidence / assessment / simulation / continuing education /
-- practice observation / portfolio / mixed) and tracked through its status lifecycle to completion. The expiring
-- worklist and KPIs are DERIVED on read from the real expiry sources (cmo_certifications + competency_decisions);
-- this table only records the renewals opened against them. Plain, idempotent statements only (no do-blocks).
-- RLS = authenticated read; service-role (admin API) writes.

create table if not exists cmo_renewals (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  nurse_id uuid references profiles(id) on delete set null,
  nurse_name text,
  subject_type text not null default 'competency',   -- competency | certification
  subject_id uuid,
  subject_name text,
  expiry_date date,
  renewal_path text not null default 'assessment',    -- evidence | assessment | simulation | continuing_education | practice_observation | portfolio | mixed
  status text not null default 'pending',             -- pending | in_progress | reassessment | completed | lapsed
  assigned_to uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz default now()
);
create index if not exists idx_cmo_renewals_hospital on cmo_renewals(hospital_id);
create index if not exists idx_cmo_renewals_nurse on cmo_renewals(nurse_id);
alter table cmo_renewals enable row level security;
drop policy if exists cmo_renewals_read on cmo_renewals;
create policy cmo_renewals_read on cmo_renewals for select to authenticated using (true);
