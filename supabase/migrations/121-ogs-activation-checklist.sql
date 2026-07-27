-- 121: OGS activation-readiness checklist (OGS-001). One row per office recording the activation gate at
-- constitution — an auditable artifact of whether the office met the readiness criteria and was activated.
-- Plain, idempotent statements only (no do-blocks). RLS = authenticated read; service-role writes. No seed.

create table if not exists ogs_activation_checklist (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid not null references ogs_offices(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete cascade,
  has_name    boolean default false,
  has_charter boolean default false,
  has_chair   boolean default false,
  has_quorum  boolean default false,
  ready       boolean default false,
  activated   boolean default false,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz default now()
);
create index if not exists idx_ogs_checklist_office on ogs_activation_checklist(office_id);
alter table ogs_activation_checklist enable row level security;
drop policy if exists ogs_checklist_read on ogs_activation_checklist;
create policy ogs_checklist_read on ogs_activation_checklist for select to authenticated using (true);
