-- 161: Platform Notification, Messaging and Alert Framework (PUI-006).
--
-- WHAT WAS ACTUALLY MISSING. The platform already writes notifications (242 distinct `type` values across
-- the codebase), already records per-channel delivery attempts in notif_deliveries, and already renders a
-- notification centre. What it did NOT have was PRIORITY as a property of the notification itself: the
-- notification centre GUESSED it from a hard-coded list of about a dozen type names, so the other ~230
-- types silently fell through to "low". A safety alert and a course reminder were indistinguishable to
-- every consumer except that one loader.
--
-- This makes the spec's model first-class, additively:
--   priority     critical | high | medium | low          (PUI-006 s2)
--   category     the six spec notification TYPES         (PUI-006 s1)
--   state        unread -> read -> acknowledged | escalated | resolved   (PUI-006 s7)
--   requires_ack derived from priority at write time, so behaviour cannot drift from severity
--
-- BACKWARDS COMPATIBILITY IS DELIBERATE. `read` stays and stays authoritative for existing callers; `state`
-- is the richer machine and the two are kept consistent by the write path, never by a trigger. Every column
-- has a default, so the ~242 existing notify() call sites keep working untouched and simply land as
-- medium/information/unread until their caller opts into more.
--
-- Plain idempotent statements only (no do-blocks). RLS = a user reads their OWN rows; service-role writes.

alter table notifications add column if not exists priority text not null default 'medium';
alter table notifications drop constraint if exists notifications_priority_check;
alter table notifications add constraint notifications_priority_check
  check (priority in ('critical','high','medium','low'));

alter table notifications add column if not exists category text not null default 'information';
alter table notifications drop constraint if exists notifications_category_check;
alter table notifications add constraint notifications_category_check
  check (category in ('information','reminder','clinical_alert','safety_alert','escalation','announcement'));

alter table notifications add column if not exists state text not null default 'unread';
alter table notifications drop constraint if exists notifications_state_check;
alter table notifications add constraint notifications_state_check
  check (state in ('unread','read','acknowledged','escalated','resolved'));

-- Acknowledgement is a RECORD, not a flag: who and when, because a critical clinical alert that was
-- acknowledged needs to say by whom.
alter table notifications add column if not exists requires_ack boolean not null default false;
alter table notifications add column if not exists acknowledged_at timestamptz;
alter table notifications add column if not exists acknowledged_by uuid references profiles(id) on delete set null;

-- Escalation: when an unacknowledged critical/high alert was escalated, and to whom.
alter table notifications add column if not exists escalate_after_min int;
alter table notifications add column if not exists escalated_at timestamptz;
alter table notifications add column if not exists escalated_to uuid references profiles(id) on delete set null;
alter table notifications add column if not exists resolved_at timestamptz;

-- What the notification is ABOUT, so a consumer can group or deduplicate without parsing the title.
alter table notifications add column if not exists entity_type text;
alter table notifications add column if not exists entity_id uuid;
alter table notifications add column if not exists hospital_id uuid references hospitals(id) on delete cascade;
alter table notifications add column if not exists expires_at timestamptz;

create index if not exists idx_notifications_state on notifications(user_id, state, created_at desc);
create index if not exists idx_notifications_priority on notifications(user_id, priority, state);
create index if not exists idx_notifications_ack_due on notifications(requires_ack, state, created_at)
  where requires_ack = true;
create index if not exists idx_notifications_entity on notifications(entity_type, entity_id);

-- -- User preferences (PUI-006 s6 "Preferences: users configure channels, quiet hours and rules") --------
-- One row per user. Quiet hours suppress NON-critical delivery only; a critical alert is never silenced,
-- which is why quiet_hours has no override for it.
create table if not exists notification_preferences (
  user_id          uuid primary key references profiles(id) on delete cascade,
  in_app           boolean not null default true,
  email            boolean not null default true,
  sms              boolean not null default false,
  push             boolean not null default true,
  quiet_from       time,                      -- local wall-clock start of quiet hours
  quiet_to         time,                      -- local wall-clock end
  quiet_timezone   text,                      -- IANA zone the quiet window is expressed in
  -- Categories the user has opted OUT of. Absent means everything is on, so a new category is
  -- delivered by default rather than silently withheld until someone opts in.
  muted_categories text[] not null default '{}',
  -- The lowest priority worth an interruption. 'low' means everything.
  min_priority     text not null default 'low' check (min_priority in ('critical','high','medium','low')),
  updated_at       timestamptz not null default now()
);

alter table notification_preferences enable row level security;
drop policy if exists notification_preferences_own on notification_preferences;
create policy notification_preferences_own on notification_preferences for select to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
