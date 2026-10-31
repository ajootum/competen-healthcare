-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql trigger function between dollar quotes.
-- ====================================================================================================
-- MIGRATION 740: COMPETEN SCHOLAR -- CONNECTED STUDY SESSIONS (SCHOLAR-SESSION-AI-02, slice A)
--
-- Owner GO 31 Oct 2026 (docs/evidence/SCHOLAR-SESSIONS/PLAN.md and STATUS.md, rulings D1 to D5).
--
-- D1. THE LEARN SESSION IS THE ANCHOR. A study session is an individual_scholar_learning_session (414) flagged
-- connected. No parallel session engine, no ninth stage. Four nullable or defaulted columns are added to 414, and
-- one small table links the learner own activities to a session. Every existing session keeps every value it has
-- (connected false, the three new texts null). No row is written, no backfill.
--
-- D2. A LEARNING OBJECTIVE. A CFCA outcome has no id of its own (outcomes are text in
-- framework_competencies.learning_outcomes, 384). As 408 and Evaluate do, the outcome is stored as its text,
-- objective_outcome, and it is held to the session EXISTING competency_id: an outcome without a competency is
-- unstorable. Where no approved mapping exists the session keeps its topic or document, or a free-text educational
-- objective (objective_text), which is a label and is never used for retrieval.
--
-- ONE TRIGGER, FOR ONE REASON. competency_id (414) is ON DELETE SET NULL. With the outcome CHECK alone, deleting a
-- competency that a learner session names with an outcome would fail that CHECK, so a learner private row would block
-- catalogue authoring. The trigger clears objective_outcome whenever competency_id becomes null, which is exactly what
-- ON DELETE SET NULL means for an outcome that belongs to that competency. It changes nothing else.
--
-- THE LINK TABLE. individual_scholar_study_link (session, kind, ref) says that one of the learner own activities
-- belongs to a study session: a revision session, an OSCE attempt, a flashcard deck, a case session, an evaluation or
-- an exam paper (ref is the paper material id, the exam paper key). Composite foreign key onto the learner own session
-- on the same user_id, ON DELETE CASCADE, so the links go with the session and a link under another learner is
-- unstorable. NO foreign key to any activity table: deleting an activity is never blocked by a link, and the store
-- checks that each ref is the caller own before it writes the link.
--
-- NOT COMPETENCE. Nothing here is assessment evidence, a verified competency, a DACUM grade or a Passport record (D5).
-- No AI text and no conversation is stored (D3).
--
-- PRIVATE AND ERASABLE. RLS read-own, as 414. No grants, as 414. Writes come only from the server, through the
-- Scholar store, keyed on the caller. Erased with the learner (the session cascades from profiles).
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 414 only.
-- Re-running it is a no-op. Rollback: docs/evidence/SCHOLAR-SESSIONS/ROLLBACK-740.sql.
--
-- FAIL CLOSED WITHOUT IT. The Individual policy switch scholar_study_sessions defaults off, and the code treats the
-- feature as off while these columns or this table are absent.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE LEARN SESSION BECOMES A STUDY SESSION WHEN CONNECTED ----------------------------------------

alter table individual_scholar_learning_session add column if not exists connected boolean not null default false;
alter table individual_scholar_learning_session add column if not exists last_space text;
alter table individual_scholar_learning_session add column if not exists objective_outcome text;
alter table individual_scholar_learning_session add column if not exists objective_text text;

alter table individual_scholar_learning_session drop constraint if exists individual_scholar_learning_session_study_check;
alter table individual_scholar_learning_session add constraint individual_scholar_learning_session_study_check
  check ((last_space is null or last_space in ('learn', 'revise', 'apply', 'evaluate'))
     and (objective_outcome is null or char_length(btrim(objective_outcome)) between 1 and 500)
     and (objective_outcome is null or competency_id is not null)
     and (objective_text is null or char_length(btrim(objective_text)) between 1 and 300));

-- ---- 2. AN OUTCOME FOLLOWS ITS COMPETENCY WHEN THAT COMPETENCY IS REMOVED --------------------------------

create or replace function public.individual_scholar_learning_session_outcome_follows()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.competency_id is null then
    new.objective_outcome := null;
  end if;
  return new;
end;
$$;

drop trigger if exists individual_scholar_learning_session_outcome_follows on individual_scholar_learning_session;
create trigger individual_scholar_learning_session_outcome_follows
  before update of competency_id on individual_scholar_learning_session
  for each row execute function public.individual_scholar_learning_session_outcome_follows();

-- ---- 3. THE LEARNER OWN ACTIVITIES THAT BELONG TO A STUDY SESSION ----------------------------------------

create table if not exists individual_scholar_study_link (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null,
  user_id     uuid not null,
  kind        text not null,
  ref_id      uuid not null,
  created_at  timestamptz not null default now(),
  constraint individual_scholar_study_link_session_fk foreign key (session_id, user_id)
    references individual_scholar_learning_session(id, user_id) on delete cascade,
  constraint individual_scholar_study_link_unique unique (session_id, kind, ref_id)
);

alter table individual_scholar_study_link drop constraint if exists individual_scholar_study_link_kind_check;
alter table individual_scholar_study_link add constraint individual_scholar_study_link_kind_check
  check (kind in ('revision_session', 'osce_attempt', 'flashcard_deck', 'case_session', 'evaluation', 'exam_paper'));

create index if not exists idx_individual_scholar_study_link_user
  on individual_scholar_study_link(user_id, kind, ref_id);

-- ---- RLS: READ OWN, as 414. Writes come only from the server, through the Scholar store. ------------------

alter table individual_scholar_study_link enable row level security;

drop policy if exists individual_scholar_study_link_read_own on individual_scholar_study_link;
create policy individual_scholar_study_link_read_own on individual_scholar_study_link for select using (auth.uid() = user_id);

comment on column individual_scholar_learning_session.connected is
  'SCHOLAR-SESSION-AI-02 (740). True when this Learn session is a connected study session carried across Learn, Revise, Apply and Evaluate. Default false: every session made before 740 is an ordinary Learn session.';
comment on column individual_scholar_learning_session.last_space is
  'SCHOLAR-SESSION-AI-02 (740). The study space the learner was last in (learn, revise, apply, evaluate), for Continue. Null: not yet recorded.';
comment on column individual_scholar_learning_session.objective_outcome is
  'SCHOLAR-SESSION-AI-02 (740), owner D2. The CFCA learning outcome of competency_id this session studies, as the catalogue worded it. Never without competency_id, and cleared if that competency is removed.';
comment on column individual_scholar_learning_session.objective_text is
  'SCHOLAR-SESSION-AI-02 (740), owner D2. A free-text educational objective where no approved mapping exists. A label only, never used for retrieval.';
comment on table individual_scholar_study_link is
  'SCHOLAR-SESSION-AI-02 (740). One of the learner own activities (revision session, OSCE attempt, flashcard deck, case session, evaluation, exam paper) linked to a study session. No foreign key to the activity, so deleting it is never blocked. Formative context only, never assessment evidence.';

notify pgrst, 'reload schema';
