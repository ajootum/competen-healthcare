-- ====================================================================================================
-- MIGRATION 437: COMPETEN INDIVIDUAL -- NOTICES IN THE OWN ACCOUNT OF THE PERSON
--
-- !! APPLY THIS FILE WHOLE. It contains one plpgsql trigger function. A runner that splits on
-- !! semicolons would cut its body in half. Paste the entire file into the SQL editor and run it.
--
-- Owner, on duplicate-CPD notices (25 Oct 2026): "Use notifications in the user account, not Email".
-- Relayed by the coordinator with the scope: a minimal Individual-scoped store, staging first, production
-- only with its own GO. Build record: docs/evidence/INDIVIDUAL-NOTIFICATION/437-build-record.md.
--
-- DEPENDS ON profiles only. Independent of every other migration. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY A NEW TABLE. An Individual-only person has no inbox. The estate notifications table is counted by
-- type across every user on estate consoles, so it is ruled out (ADR-016 D1, owner ruling D1). No
-- Individual-scoped notice store existed: the 374 reminders and the home renewals are computed on read,
-- and audit_log is append-only and read by estate consoles. A refused CPD save is not stored anywhere, so
-- its notice has to be.
--
-- WHAT IT IS. One row per notice to one person, reusable by any Individual notice later:
--   kind        a code, for example cpd_duplicate_refused
--   body        a short text. By rule of the writer it names no course or record, so it is safe to show
--               anywhere, including any future email-like surface
--   href        a same-site link, optional
--   dedupe_key  one notice per person, kind and key. The unique index makes a double notice impossible
--   read_at     set once, when the person marks it read
-- Append-only apart from read_at, which is set once. A row is removed only with its person (the
-- cascade from profiles, through the pg_trigger_depth() > 1 allowance). No hospital, organisation,
-- tenant or workspace column. RLS on, own-row SELECT only. Writes are the service role.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/INDIVIDUAL-NOTIFICATION/ROLLBACK-437.sql
-- VERIFY:             docs/evidence/INDIVIDUAL-NOTIFICATION/VERIFY-437.sql
-- ====================================================================================================

create table if not exists individual_notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  body text not null,
  href text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table individual_notification drop constraint if exists individual_notification_kind;
alter table individual_notification add constraint individual_notification_kind
  check (kind ~ '^[a-z][a-z0-9_]{2,60}$');
alter table individual_notification drop constraint if exists individual_notification_body;
alter table individual_notification add constraint individual_notification_body
  check (char_length(body) between 1 and 400);
alter table individual_notification drop constraint if exists individual_notification_href;
alter table individual_notification add constraint individual_notification_href
  check (href is null or (char_length(href) <= 300 and href ~ '^/[^/]'));
alter table individual_notification drop constraint if exists individual_notification_dedupe;
alter table individual_notification add constraint individual_notification_dedupe
  check (char_length(dedupe_key) between 1 and 200);
alter table individual_notification drop constraint if exists individual_notification_read_after;
alter table individual_notification add constraint individual_notification_read_after
  check (read_at is null or read_at >= created_at);

create unique index if not exists ux_individual_notification_once
  on individual_notification(user_id, kind, dedupe_key);
create index if not exists idx_individual_notification_user
  on individual_notification(user_id, created_at desc);

create or replace function individual_notification_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'individual_notification is append-only: a notice is removed only with its person';
  end if;
  if new.id <> old.id or new.user_id <> old.user_id or new.kind <> old.kind or new.body <> old.body
     or new.href is distinct from old.href or new.dedupe_key <> old.dedupe_key or new.created_at <> old.created_at then
    raise exception 'individual_notification: only read_at may change';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'individual_notification: read_at is set once';
  end if;
  return new;
end
$$;

drop trigger if exists trg_individual_notification_guard on individual_notification;
create trigger trg_individual_notification_guard
  before update or delete on individual_notification
  for each row execute function individual_notification_guard();

alter table individual_notification enable row level security;
drop policy if exists individual_notification_read_own on individual_notification;
create policy individual_notification_read_own on individual_notification
  for select using (auth.uid() = user_id);

comment on table individual_notification is
  'Owner 2026-10-25 (notifications in the user account, not email). One notice to one Individual person. Append-only apart from read_at, set once. Unique per person, kind and dedupe key. Own-row read, service-role write. No hospital, organisation or tenant column.';

notify pgrst, 'reload schema';
