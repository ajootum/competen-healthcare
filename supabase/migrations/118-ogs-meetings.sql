-- 118: OGS meetings core (OGS-004) — meetings, attendance (→ quorum) and agenda items.
-- Plain, idempotent statements only (no PL/pgSQL do-blocks). RLS = authenticated read; service-role writes.
-- Forward-looking write-first surface: no seed — offices schedule meetings via the write-workflow.
-- hospital_id is denormalised onto ogs_meetings for cheap tenant-scoping; child tables scope via the meeting.

create table if not exists ogs_meetings (
  id              uuid primary key default gen_random_uuid(),
  office_id       uuid not null references ogs_offices(id) on delete cascade,
  hospital_id     uuid references hospitals(id) on delete cascade,
  title           text not null,
  meeting_type    text not null default 'regular',    -- regular|extraordinary|emergency
  scheduled_at    timestamptz,
  location        text,
  status          text not null default 'scheduled',  -- scheduled|in_progress|held|cancelled
  required_quorum int default 3,
  chaired_by      uuid references profiles(id) on delete set null,
  chaired_by_name text,
  minutes         text,
  held_at         timestamptz,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz default now()
);
create index if not exists idx_ogs_meetings_office on ogs_meetings(office_id);
create index if not exists idx_ogs_meetings_hospital on ogs_meetings(hospital_id);
create index if not exists idx_ogs_meetings_when on ogs_meetings(scheduled_at);
alter table ogs_meetings enable row level security;
drop policy if exists ogs_meetings_read on ogs_meetings;
create policy ogs_meetings_read on ogs_meetings for select to authenticated using (true);

create table if not exists ogs_meeting_attendance (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references ogs_meetings(id) on delete cascade,
  person_id   uuid references profiles(id) on delete set null,
  person_name text,
  role        text,
  status      text not null default 'invited',        -- invited|present|apologies|absent
  created_at  timestamptz default now()
);
create index if not exists idx_ogs_attendance_meeting on ogs_meeting_attendance(meeting_id);
alter table ogs_meeting_attendance enable row level security;
drop policy if exists ogs_attendance_read on ogs_meeting_attendance;
create policy ogs_attendance_read on ogs_meeting_attendance for select to authenticated using (true);

create table if not exists ogs_agenda_items (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references ogs_meetings(id) on delete cascade,
  seq         int default 0,
  title       text not null,
  description text,
  item_type   text not null default 'discussion',     -- discussion|decision|information
  status      text not null default 'pending',        -- pending|discussed|deferred
  created_at  timestamptz default now()
);
create index if not exists idx_ogs_agenda_meeting on ogs_agenda_items(meeting_id);
alter table ogs_agenda_items enable row level security;
drop policy if exists ogs_agenda_read on ogs_agenda_items;
create policy ogs_agenda_read on ogs_agenda_items for select to authenticated using (true);
