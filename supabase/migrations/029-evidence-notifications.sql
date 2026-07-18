-- 029: Evidence engine + in-app notifications + CPD annual target
-- (Gap fixes from the Functionality Testing review: §E evidence, §8 events, §G CPD)

-- ── Evidence ─────────────────────────────────────────────────────────────────
-- Files live in the private "evidence" storage bucket; all uploads/downloads go
-- through /api/evidence (service role + signed URLs), so no storage policies
-- are needed. This table is the register linking files to clinical records.
create table if not exists evidence (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references profiles(id) on delete cascade,
  hospital_id        uuid references hospitals(id) on delete set null,
  file_path          text not null,
  file_name          text not null,
  mime_type          text not null,
  size_bytes         bigint not null default 0,
  kind               text not null default 'evidence',  -- evidence | credential_document
  skill_log_entry_id uuid references skill_log_entries(id) on delete cascade,
  credential_id      uuid references professional_credentials(id) on delete cascade,
  competency_id      uuid references framework_competencies(id) on delete set null,
  note               text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_evidence_owner      on evidence(owner_id, created_at desc);
create index if not exists idx_evidence_entry      on evidence(skill_log_entry_id);
create index if not exists idx_evidence_credential on evidence(credential_id);

alter table evidence enable row level security;
do $$ begin
  create policy evidence_select_own on evidence
    for select using (owner_id = auth.uid());
exception when duplicate_object then null; end $$;
-- No client insert/update/delete policies: writes go through the server API.

-- ── Notifications ────────────────────────────────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  href       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on notifications(user_id, read, created_at desc);

alter table notifications enable row level security;
do $$ begin
  create policy notifications_select_own on notifications
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy notifications_update_own on notifications
    for update using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── CPD annual target (org-configurable; null = no target set) ───────────────
alter table hospitals add column if not exists cpd_target_hours numeric;
