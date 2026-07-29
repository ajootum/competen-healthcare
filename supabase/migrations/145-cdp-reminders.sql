-- 145: CDP-011 Learning Notification & Engagement — scheduled reminders. The in-app notification layer
-- (notifications 029 / notif_deliveries 056) already fires reactive nudges; this adds the SCHEDULED side: a
-- dedup log so a daily scan can proactively remind learners of expiring credentials/competencies exactly once
-- per due milestone (not every day). The scan fires real in-app notifications via notify(); this table only
-- records that a given reminder was sent. Plain, idempotent statements only.

create table if not exists cdp_reminders (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete set null,
  kind          text not null,                       -- credential_expiry | competency_expiry
  subject_id    uuid not null,                       -- source record id (credential / decision)
  recipient_id  uuid references profiles(id) on delete cascade,
  subject_label text,
  due_date      date,
  sent_at       timestamptz not null default now()
);
-- one reminder per (kind, source record, due milestone) → re-runs are idempotent.
create unique index if not exists uq_cdp_reminders on cdp_reminders(kind, subject_id, due_date);
create index if not exists idx_cdp_reminders_sent on cdp_reminders(sent_at);
create index if not exists idx_cdp_reminders_kind on cdp_reminders(kind);

alter table cdp_reminders enable row level security;
drop policy if exists cdp_reminders_read on cdp_reminders;
create policy cdp_reminders_read on cdp_reminders for select to authenticated using (true);

notify pgrst, 'reload schema';
