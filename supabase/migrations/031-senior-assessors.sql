-- 031: Senior assessors + evidence escalation (Evidence Validation Centre
-- spec "Escalate to Senior Assessor"). Senior status is assignable by
-- educators/admins; escalated entries can only be decided by seniors.

-- Senior-assessor flag (assignment is audit-logged via the API)
alter table profiles add column if not exists is_senior_assessor boolean not null default false;

-- Widen the logbook status enum to include 'escalated'
alter table skill_log_entries drop constraint if exists skill_log_entries_status_check;
alter table skill_log_entries add constraint skill_log_entries_status_check
  check (status in ('pending','verified','rejected','changes_requested','escalated'));

-- Escalation provenance
alter table skill_log_entries add column if not exists escalated_by uuid references profiles(id);
alter table skill_log_entries add column if not exists escalated_by_name text;
alter table skill_log_entries add column if not exists escalated_at timestamptz;
alter table skill_log_entries add column if not exists escalation_reason text;
