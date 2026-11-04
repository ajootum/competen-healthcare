-- ====================================================================================================
-- MIGRATION 970: COMPETEN SCHOLAR -- A TRANSFER CHECK IS RECORDED WITH THE LESSON CONTEXT IT IS OUTSIDE
-- (SALE-2026-11 R2, row SALE-10 transfer-of-learning assessment)
--
-- Owner directive SALE-2026-11 section 7.3: introduce new questions or scenarios to determine whether the learner can
-- apply a concept outside the original lesson context, and record the result as transfer evidence.
--
-- REUSE, ONE SMALL NEW TABLE. A transfer check IS a revision session (417) of one to five questions, chosen reuse first
-- (an approved library copy, a saved question from other notes or sections, else one written by the existing revision
-- sessions route). Its answers ARE ordinary attempts (416) that name the session. What no existing table can say is
-- WHY the session was asked: for which topic, outside which lesson context, and how each question is outside it. That
-- is this table: one row per question of the session.
--
-- WHAT IT CHANGES.
--   1. individual_scholar_transfer_check: user_id, revision_session_id, question_id, topic (2 to 120 characters),
--      outside (library, other_material, other_section, new_question), source (saved, library, generated),
--      context_chunk_ids (the sections where the topic was taught, at most 200), created_at.
--   2. The question must be an item of that same session (foreign key onto the 417 session item), and the session must
--      be the same learner (foreign key onto the 417 owner-scoped session identity). A row for a question that is not
--      in the session of that learner is therefore unrepresentable. One row per session and question.
--   3. Own rows only: RLS on, a read-own policy, as every 417 table. Writes go through the server (service role).
--
-- DELETION. Erasing the session, its item, its question or the learner removes the rows (cascades). Nothing else
-- references this table.
--
-- FORMATIVE ONLY. A transfer answer is learning evidence for the learner. Never assessment, verified competence, a
-- competency stage or a Passport record.
--
-- FAIL CLOSED WITHOUT IT. The route offers no transfer check where the table is absent (not provisioned), and the learning
-- state reads no transfer evidence. Everything else is unchanged.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 372, 416, 417.
-- Re-running it is a no-op. Rollback: ROLLBACK-970.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

create table if not exists individual_scholar_transfer_check (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references profiles(id) on delete cascade,
  revision_session_id  uuid not null,
  question_id          uuid not null,
  topic                text not null,
  outside              text not null,
  source               text not null,
  context_chunk_ids    uuid[] not null default '{}',
  created_at           timestamptz not null default now(),
  constraint individual_scholar_transfer_check_session_fk foreign key (revision_session_id, user_id)
    references individual_scholar_revision_session(id, user_id) on delete cascade,
  constraint individual_scholar_transfer_check_item_fk foreign key (revision_session_id, question_id)
    references individual_scholar_revision_session_item(session_id, question_id) on delete cascade
);

alter table individual_scholar_transfer_check drop constraint if exists individual_scholar_transfer_check_shape_check;
alter table individual_scholar_transfer_check add constraint individual_scholar_transfer_check_shape_check
  check (char_length(topic) between 2 and 120
     and topic = btrim(topic)
     and outside in ('library', 'other_material', 'other_section', 'new_question')
     and source in ('saved', 'library', 'generated')
     and cardinality(context_chunk_ids) <= 200);

create unique index if not exists ux_individual_scholar_transfer_check_session_question
  on individual_scholar_transfer_check(revision_session_id, question_id);
create index if not exists idx_individual_scholar_transfer_check_user
  on individual_scholar_transfer_check(user_id, created_at desc);

alter table individual_scholar_transfer_check enable row level security;

drop policy if exists individual_scholar_transfer_check_read_own on individual_scholar_transfer_check;
create policy individual_scholar_transfer_check_read_own on individual_scholar_transfer_check
  for select using (auth.uid() = user_id);

comment on table individual_scholar_transfer_check is
  'SALE-2026-11 R2 SALE-10 (970). A transfer check: one row per question of a revision session asked to see whether the learner can use a topic outside the lesson where it was taught, with that lesson context and how the question is outside it. Answers are the 416 attempts naming the session. Private, formative, never competence.';

notify pgrst, 'reload schema';
