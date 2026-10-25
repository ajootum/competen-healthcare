-- ====================================================================================================
-- MIGRATION 452: COMPETEN PROFESSIONAL -- CONFIGURABLE EXPIRY REMINDERS FOR PROFILE RECORDS
--
-- COMPETEN-PROFESSIONAL-PROFILE-01, owner continuation GO part B item 2 (25 Oct 2026): configurable
-- professional registration and licence-expiry reminders. Schedules and eligibility are no-code settings
-- (the Individual policy, WCE). Development and staging authorised. Production needs its own GO.
-- Build record: docs/COMPETEN-PROFESSIONAL-PROFILE-01-stage1.md, section 6.
--
-- DEPENDS ON 450 (individual_professional_profile_item). Independent of 451 and 453.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS: ONE LEDGER, SO EACH REMINDER IS SENT ONCE.
--
-- The existing daily job (src/lib/platform/jobs.ts, individual_professional_reminders) already emails the
-- person about their primary registration and credentials through the notification dispatcher, once per
-- expiry date, marked on the row itself (373). Profile records (450) can be reminded at SEVERAL offsets
-- before expiry, chosen in configuration, so the once-only mark needs one row per record, expiry date and
-- offset. The unique key is the claim: two overlapping runs cannot both send. A send that fails deletes
-- its claim, so the next run tries again (the 373 claim-and-release rule).
--
-- NOT cdp_reminders and NOT notifications (owner ruling D1): both are read by hospital consoles. No scope
-- column. A changed expiry date is a new key, so the new date is reminded afresh.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No plpgsql. No partial unique index. RLS on,
-- own-row SELECT only. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-PROFILE-01/ROLLBACK-452.sql
-- ====================================================================================================

create table if not exists individual_professional_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null,
  expires_on date not null,
  offset_days integer not null,
  created_at timestamptz not null default now()
);

alter table individual_professional_reminder_log drop constraint if exists individual_professional_reminder_log_item_fk;
alter table individual_professional_reminder_log add constraint individual_professional_reminder_log_item_fk
  foreign key (item_id, user_id) references individual_professional_profile_item(id, user_id) on delete cascade;

create unique index if not exists ux_individual_professional_reminder_log_once
  on individual_professional_reminder_log(item_id, expires_on, offset_days);
create index if not exists idx_individual_professional_reminder_log_user
  on individual_professional_reminder_log(user_id, created_at desc);

alter table individual_professional_reminder_log drop constraint if exists individual_professional_reminder_log_offset;
alter table individual_professional_reminder_log add constraint individual_professional_reminder_log_offset
  check (offset_days between 0 and 366);

alter table individual_professional_reminder_log enable row level security;
drop policy if exists individual_professional_reminder_log_read_own on individual_professional_reminder_log;
create policy individual_professional_reminder_log_read_own on individual_professional_reminder_log
  for select using (auth.uid() = user_id);

comment on table individual_professional_reminder_log is
  'COMPETEN-PROFESSIONAL-PROFILE-01 (owner GO part B). One row per reminder sent about a profile record, expiry date and offset. The unique key is the once-only claim. Own-row read, service-role write. No hospital column.';

notify pgrst, 'reload schema';
