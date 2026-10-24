-- ====================================================================================================
-- MIGRATION 414: COMPETEN SCHOLAR -- LEARNING SESSIONS AND STRUCTURED LEARNING HISTORY (STAGE 3, L4)
--
-- COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24, "Stage 3 -- Learn: Development Authorisation"), L4 Persistent
-- Learning History: record learning sessions, the material sections used, the learning actions taken, informal
-- understanding checks and their outcome, session continuation and learner preferences -- so a student can leave
-- and resume. Relevant CFCA relationships are NOT copied here: they are read from the existing mappings (388, 408)
-- of the sections a session used, so a correction there is reflected everywhere.
--
-- STRUCTURE ONLY, NO CONVERSATION. No AI answer and no student free text is stored. Resuming regenerates the
-- explanation from the stored step and its sections. The one short text a student supplies is the topic of a
-- topic-scoped session (at most 120 characters, screened for patient identifiers before it is written).
--
-- NOT COMPETENCE. Nothing here is assessment evidence, nothing here is a verified competency, and nothing here is
-- written to the Passport. An informal check verdict (understood, partly, not yet) is the student own formative
-- signal and is labelled so wherever it is shown.
--
-- PRIVATE AND ERASABLE. Every table is the student own, RLS read-own, erased with the student (profiles cascade).
-- Every source link is a composite foreign key onto the student own chunk or material, ON DELETE CASCADE: deleting
-- a material removes the steps and source links that used it. Erase-all removes the sessions themselves.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: five new tables, nothing existing is altered.
-- It depends on 372 (chunk, material) and on profiles. Re-running it is a no-op.
--
-- FAIL CLOSED WITHOUT IT. The Learn workspace teaches without history where these tables are absent (no resume,
-- no recorded checks), and says so. Rollback: docs/evidence/COMPETEN-SCHOLAR-LEARN-01/ROLLBACK-414.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

-- ---- 1. A LEARNING SESSION ------------------------------------------------------------------------------

create table if not exists individual_scholar_learning_session (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  scope_kind      text not null,
  title           text not null,
  topic           text,
  competency_id   uuid references framework_competencies(id) on delete set null,
  current_step    integer not null default 0,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now()
);

alter table individual_scholar_learning_session drop constraint if exists individual_scholar_learning_session_scope_check;
alter table individual_scholar_learning_session add constraint individual_scholar_learning_session_scope_check
  check (scope_kind in ('section', 'document', 'documents', 'topic', 'competency')
     and (scope_kind = 'topic') = (topic is not null)
     and (topic is null or char_length(btrim(topic)) between 2 and 120));

alter table individual_scholar_learning_session drop constraint if exists individual_scholar_learning_session_state_check;
alter table individual_scholar_learning_session add constraint individual_scholar_learning_session_state_check
  check (status in ('active', 'completed') and current_step >= 0 and char_length(btrim(title)) between 1 and 160);

create unique index if not exists ux_individual_scholar_learning_session_id_user
  on individual_scholar_learning_session(id, user_id);
create index if not exists idx_individual_scholar_learning_session_user
  on individual_scholar_learning_session(user_id, last_active_at desc);

-- ---- 2. ITS SUGGESTED STEPS, EACH A SET OF THE STUDENT OWN SECTIONS --------------------------------------

create table if not exists individual_scholar_learning_step (
  session_id   uuid not null,
  user_id      uuid not null,
  step         integer not null,
  chunk_id     uuid not null,
  material_id  uuid not null,
  constraint individual_scholar_learning_step_pk primary key (session_id, step, chunk_id),
  constraint individual_scholar_learning_step_session_fk foreign key (session_id, user_id)
    references individual_scholar_learning_session(id, user_id) on delete cascade,
  constraint individual_scholar_learning_step_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade,
  constraint individual_scholar_learning_step_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_learning_step drop constraint if exists individual_scholar_learning_step_step_check;
alter table individual_scholar_learning_step add constraint individual_scholar_learning_step_step_check check (step >= 0 and step < 200);

create index if not exists idx_individual_scholar_learning_step_user on individual_scholar_learning_step(user_id);

-- ---- 3. WHAT THE STUDENT DID: ONE ROW PER LEARNING ACTION -------------------------------------------------

create table if not exists individual_scholar_learning_event (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null,
  user_id     uuid not null,
  step        integer not null,
  action      text not null,
  verdict     text,
  created_at  timestamptz not null default now(),
  constraint individual_scholar_learning_event_session_fk foreign key (session_id, user_id)
    references individual_scholar_learning_session(id, user_id) on delete cascade
);

alter table individual_scholar_learning_event drop constraint if exists individual_scholar_learning_event_action_check;
alter table individual_scholar_learning_event add constraint individual_scholar_learning_event_action_check
  check (action in ('teach', 'explain', 'simplify', 'deeper', 'examples', 'summary', 'ask', 'check', 'clarify', 'skip', 'revisit', 'resume')
     and step >= 0
     and (verdict is null or (action = 'clarify' and verdict in ('understood', 'partly', 'not_yet'))));

create unique index if not exists ux_individual_scholar_learning_event_id_user
  on individual_scholar_learning_event(id, user_id);
create index if not exists idx_individual_scholar_learning_event_session
  on individual_scholar_learning_event(session_id, created_at);
create index if not exists idx_individual_scholar_learning_event_user
  on individual_scholar_learning_event(user_id, created_at desc);

-- ---- 4. THE SECTIONS EACH ACTION USED -------------------------------------------------------------------

create table if not exists individual_scholar_learning_event_source (
  event_id  uuid not null,
  user_id   uuid not null,
  chunk_id  uuid not null,
  constraint individual_scholar_learning_event_source_pk primary key (event_id, chunk_id),
  constraint individual_scholar_learning_event_source_event_fk foreign key (event_id, user_id)
    references individual_scholar_learning_event(id, user_id) on delete cascade,
  constraint individual_scholar_learning_event_source_chunk_fk foreign key (chunk_id, user_id)
    references individual_scholar_chunk(id, user_id) on delete cascade
);

create index if not exists idx_individual_scholar_learning_event_source_chunk on individual_scholar_learning_event_source(user_id, chunk_id);

-- ---- 5. LEARNER PREFERENCES -----------------------------------------------------------------------------

create table if not exists individual_scholar_learning_preference (
  user_id         uuid primary key references profiles(id) on delete cascade,
  depth           text not null default 'standard',
  default_action  text not null default 'teach',
  updated_at      timestamptz not null default now()
);

alter table individual_scholar_learning_preference drop constraint if exists individual_scholar_learning_preference_check;
alter table individual_scholar_learning_preference add constraint individual_scholar_learning_preference_check
  check (depth in ('brief', 'standard', 'detailed')
     and default_action in ('teach', 'explain', 'simplify', 'deeper', 'examples', 'summary', 'ask'));

-- ---- RLS: READ OWN. Writes come only from the server, through the Scholar store. --------------------------

alter table individual_scholar_learning_session enable row level security;
alter table individual_scholar_learning_step enable row level security;
alter table individual_scholar_learning_event enable row level security;
alter table individual_scholar_learning_event_source enable row level security;
alter table individual_scholar_learning_preference enable row level security;

drop policy if exists individual_scholar_learning_session_read_own on individual_scholar_learning_session;
create policy individual_scholar_learning_session_read_own on individual_scholar_learning_session for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_learning_step_read_own on individual_scholar_learning_step;
create policy individual_scholar_learning_step_read_own on individual_scholar_learning_step for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_learning_event_read_own on individual_scholar_learning_event;
create policy individual_scholar_learning_event_read_own on individual_scholar_learning_event for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_learning_event_source_read_own on individual_scholar_learning_event_source;
create policy individual_scholar_learning_event_source_read_own on individual_scholar_learning_event_source for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_learning_preference_read_own on individual_scholar_learning_preference;
create policy individual_scholar_learning_preference_read_own on individual_scholar_learning_preference for select using (auth.uid() = user_id);

comment on table individual_scholar_learning_session is
  'COMPETEN-SCHOLAR-LEARN-01 L4. A Scholar student own learning session: its scope, its suggested steps and where they are. Structure only, no conversation. Never assessment, never competence, never on the Passport.';
comment on table individual_scholar_learning_event is
  'COMPETEN-SCHOLAR-LEARN-01 L4. One learning action in a session, with an informal check verdict where the action was a clarification. No AI text, no student text. Formative only.';

notify pgrst, 'reload schema';
