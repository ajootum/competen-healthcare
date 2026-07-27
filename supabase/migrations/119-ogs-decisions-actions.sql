-- 119: OGS decisions + office actions (OGS-004). Decisions carry a vote tally (for/against/abstain) and an
-- outcome; actions are the tasks arising. Plain, idempotent statements only (no do-blocks). RLS = authenticated
-- read; service-role writes. hospital_id + office_id denormalised for cheap tenant-scoping and office rollups.

create table if not exists ogs_decisions (
  id              uuid primary key default gen_random_uuid(),
  office_id       uuid not null references ogs_offices(id) on delete cascade,
  meeting_id      uuid references ogs_meetings(id) on delete set null,
  agenda_item_id  uuid references ogs_agenda_items(id) on delete set null,
  hospital_id     uuid references hospitals(id) on delete cascade,
  title           text not null,
  description     text,
  decision_type   text not null default 'resolution', -- resolution|approval|policy|endorsement
  outcome         text not null default 'carried',    -- carried|rejected|deferred|tabled
  votes_for       int default 0,
  votes_against   int default 0,
  votes_abstain   int default 0,
  decided_at      timestamptz default now(),
  recorded_by     uuid references profiles(id) on delete set null,
  recorded_by_name text,
  created_at      timestamptz default now()
);
create index if not exists idx_ogs_decisions_office on ogs_decisions(office_id);
create index if not exists idx_ogs_decisions_meeting on ogs_decisions(meeting_id);
create index if not exists idx_ogs_decisions_hospital on ogs_decisions(hospital_id);
alter table ogs_decisions enable row level security;
drop policy if exists ogs_decisions_read on ogs_decisions;
create policy ogs_decisions_read on ogs_decisions for select to authenticated using (true);

create table if not exists ogs_office_actions (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references ogs_offices(id) on delete cascade,
  meeting_id   uuid references ogs_meetings(id) on delete set null,
  decision_id  uuid references ogs_decisions(id) on delete set null,
  hospital_id  uuid references hospitals(id) on delete cascade,
  title        text not null,
  description  text,
  owner_id     uuid references profiles(id) on delete set null,
  owner_name   text,
  due_date     date,
  status       text not null default 'open',           -- open|in_progress|completed|cancelled
  created_at   timestamptz default now(),
  completed_at timestamptz
);
create index if not exists idx_ogs_actions_office on ogs_office_actions(office_id);
create index if not exists idx_ogs_actions_meeting on ogs_office_actions(meeting_id);
create index if not exists idx_ogs_actions_hospital on ogs_office_actions(hospital_id);
create index if not exists idx_ogs_actions_status on ogs_office_actions(status);
alter table ogs_office_actions enable row level security;
drop policy if exists ogs_actions_read on ogs_office_actions;
create policy ogs_actions_read on ogs_office_actions for select to authenticated using (true);
