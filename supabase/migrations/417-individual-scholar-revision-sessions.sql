-- ====================================================================================================
-- MIGRATION 417: COMPETEN SCHOLAR -- SAVED REVISION SETS, AND REVISION SESSIONS A STUDENT CAN RETURN TO
--
-- COMPETEN-SCHOLAR-REVISION-01 (Stage 4), R1 and R4, owner GO: development and staging authorised,
-- production activation on hold. Build record: docs/COMPETEN-SCHOLAR-REVISION-01.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: four new tables, and one nullable column with
-- its foreign key on individual_scholar_attempt. No existing row is changed. No function, no trigger.
-- It depends on 372 (question, attempt), 416 (applied first: the question kinds a set may name) and profiles.
-- The ON DELETE SET NULL (column) form needs PostgreSQL 15 or later, as 373 already does.
-- Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- Revision reuses what exists: the questions (372, 388, 416), the attempts, the spaced-review cards and the
-- review log (391). What did not exist is a place for the two things Stage 4 adds around them.
--
--   individual_scholar_revision_set        a SAVED revision set: its name, how it was built (mode, scope,
--   individual_scholar_revision_set_item   formats, quantity, difficulty, feedback) and the questions in it,
--                                          in order. Replaying it uses the stored questions and their stored
--                                          keys. No AI call, and so it stays available when AI does not.
--   individual_scholar_revision_session    ONE sitting of revision: its questions in order (a snapshot, so
--   individual_scholar_revision_session_item  a set edited later does not change a sitting already begun), where
--                                          the student is, and whether it is finished. Leaving for Teach Me and
--                                          coming back resumes at the same question. Each answer is an
--                                          attempt (372) that names its session, so the answers so far are
--                                          the attempts, not a copy of them.
--
-- STRUCTURE ONLY. A set or a session holds which questions, in what order, and how they are offered. It holds no
-- answer text, no score and no AI output of its own: answers are attempts, reviews are the 391 log. Nothing here
-- is assessment, competence or Passport evidence. Mock practice is formative practice, not a formal assessment.
--
-- OWNERSHIP IS IN THE SCHEMA. Every reference is a composite (id, user_id) foreign key, so a set, a session or an
-- item of one person cannot point at a question, set or session of another. A question deleted (with its
-- material, or by erasing everything) takes its set and session items with it. A deleted set leaves its sessions,
-- which keep their own snapshot, with set_id cleared. A deleted session leaves its attempts, which are the
-- revision history, with revision_session_id cleared.
--
-- RLS ON, own-row SELECT policy only (owner ruling D6). The server writes through the service role.
--
-- FAIL CLOSED WITHOUT IT. Until it is applied, saved sets and resumable sessions are not offered, and practice and
-- spaced review work as they do today.
-- Rollback: docs/evidence/COMPETEN-SCHOLAR-REVISION-01/ROLLBACK-417.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. No function. notify pgrst last.
-- ====================================================================================================


-- ---- 1. A SAVED REVISION SET ------------------------------------------------------------------------

create table if not exists individual_scholar_revision_set (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  title         text not null,
  mode          text not null,
  scope         jsonb not null,
  formats       jsonb not null,
  quantity      smallint not null,
  difficulty    text not null default 'any',
  feedback      text not null default 'immediate',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

alter table individual_scholar_revision_set drop constraint if exists individual_scholar_revision_set_check;
alter table individual_scholar_revision_set add constraint individual_scholar_revision_set_check
  check (char_length(title) between 1 and 120
     and mode in ('today', 'quick', 'spaced', 'weak', 'mock', 'flashcards', 'custom')
     and jsonb_typeof(scope) = 'object' and octet_length(scope::text) <= 4000
     and jsonb_typeof(formats) = 'array' and jsonb_array_length(formats) between 1 and 7
     and formats <@ '["mcq", "case", "mrq", "short", "flashcard", "match", "sequence"]'::jsonb
     and quantity between 1 and 50
     and difficulty in ('any', 'easy', 'standard', 'harder')
     and feedback in ('immediate', 'end'));

create unique index if not exists ux_individual_scholar_revision_set_id_user
  on individual_scholar_revision_set(id, user_id);
create index if not exists idx_individual_scholar_revision_set_user
  on individual_scholar_revision_set(user_id, updated_at desc);

create table if not exists individual_scholar_revision_set_item (
  set_id       uuid not null,
  user_id      uuid not null,
  ordinal      smallint not null,
  question_id  uuid not null,
  constraint individual_scholar_revision_set_item_pk primary key (set_id, ordinal),
  constraint individual_scholar_revision_set_item_set_fk foreign key (set_id, user_id)
    references individual_scholar_revision_set(id, user_id) on delete cascade,
  constraint individual_scholar_revision_set_item_question_fk foreign key (question_id, user_id)
    references individual_scholar_question(id, user_id) on delete cascade
);

alter table individual_scholar_revision_set_item drop constraint if exists individual_scholar_revision_set_item_check;
alter table individual_scholar_revision_set_item add constraint individual_scholar_revision_set_item_check
  check (ordinal between 1 and 50);

create unique index if not exists ux_individual_scholar_revision_set_item_question
  on individual_scholar_revision_set_item(set_id, question_id);
create index if not exists idx_individual_scholar_revision_set_item_question
  on individual_scholar_revision_set_item(question_id);


-- ---- 2. A REVISION SESSION, ITS QUESTIONS, AND WHERE THE STUDENT IS ---------------------------------

create table if not exists individual_scholar_revision_session (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  set_id          uuid,
  mode            text not null,
  feedback        text not null default 'immediate',
  status          text not null default 'active',
  position        smallint not null default 0,
  total           smallint not null,
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now(),
  completed_at    timestamptz,
  constraint individual_scholar_revision_session_set_fk foreign key (set_id, user_id)
    references individual_scholar_revision_set(id, user_id) on delete set null (set_id)
);

alter table individual_scholar_revision_session drop constraint if exists individual_scholar_revision_session_check;
alter table individual_scholar_revision_session add constraint individual_scholar_revision_session_check
  check (mode in ('today', 'quick', 'spaced', 'weak', 'mock', 'flashcards', 'custom')
     and feedback in ('immediate', 'end')
     and status in ('active', 'completed')
     and total between 1 and 50
     and position between 0 and total
     and ((status = 'completed') = (completed_at is not null)));

create unique index if not exists ux_individual_scholar_revision_session_id_user
  on individual_scholar_revision_session(id, user_id);
create index if not exists idx_individual_scholar_revision_session_user
  on individual_scholar_revision_session(user_id, status, last_active_at desc);

create table if not exists individual_scholar_revision_session_item (
  session_id   uuid not null,
  user_id      uuid not null,
  ordinal      smallint not null,
  question_id  uuid not null,
  constraint individual_scholar_revision_session_item_pk primary key (session_id, ordinal),
  constraint individual_scholar_revision_session_item_session_fk foreign key (session_id, user_id)
    references individual_scholar_revision_session(id, user_id) on delete cascade,
  constraint individual_scholar_revision_session_item_question_fk foreign key (question_id, user_id)
    references individual_scholar_question(id, user_id) on delete cascade
);

alter table individual_scholar_revision_session_item drop constraint if exists individual_scholar_revision_session_item_check;
alter table individual_scholar_revision_session_item add constraint individual_scholar_revision_session_item_check
  check (ordinal between 1 and 50);

create unique index if not exists ux_individual_scholar_revision_session_item_question
  on individual_scholar_revision_session_item(session_id, question_id);
create index if not exists idx_individual_scholar_revision_session_item_question
  on individual_scholar_revision_session_item(question_id);


-- ---- 3. AN ATTEMPT NAMES THE SESSION IT WAS MADE IN ------------------------------------------------

alter table individual_scholar_attempt add column if not exists revision_session_id uuid;

alter table individual_scholar_attempt drop constraint if exists individual_scholar_attempt_revision_session_fk;
alter table individual_scholar_attempt add constraint individual_scholar_attempt_revision_session_fk
  foreign key (revision_session_id, user_id)
  references individual_scholar_revision_session(id, user_id) on delete set null (revision_session_id);

create index if not exists idx_individual_scholar_attempt_revision_session
  on individual_scholar_attempt(revision_session_id, answered_at);


-- ---- 4. OWN ROWS ONLY ---------------------------------------------------------------------------------

alter table individual_scholar_revision_set enable row level security;
alter table individual_scholar_revision_set_item enable row level security;
alter table individual_scholar_revision_session enable row level security;
alter table individual_scholar_revision_session_item enable row level security;

drop policy if exists individual_scholar_revision_set_read_own on individual_scholar_revision_set;
create policy individual_scholar_revision_set_read_own on individual_scholar_revision_set
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_revision_set_item_read_own on individual_scholar_revision_set_item;
create policy individual_scholar_revision_set_item_read_own on individual_scholar_revision_set_item
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_revision_session_read_own on individual_scholar_revision_session;
create policy individual_scholar_revision_session_read_own on individual_scholar_revision_session
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_revision_session_item_read_own on individual_scholar_revision_session_item;
create policy individual_scholar_revision_session_item_read_own on individual_scholar_revision_session_item
  for select using (auth.uid() = user_id);

comment on table individual_scholar_revision_set is
  'COMPETEN-SCHOLAR-REVISION-01 (417). A saved revision set: how it was built and, in its items, which stored questions in what order. Replayed from stored questions and keys, with no AI call. Structure only, private, not assessment.';
comment on table individual_scholar_revision_session is
  'COMPETEN-SCHOLAR-REVISION-01 (417). One sitting of revision: its questions (items, a snapshot), the position reached and whether it is finished. Answers are attempts that name it. Structure only, private, not assessment.';

notify pgrst, 'reload schema';
