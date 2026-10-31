-- ====================================================================================================
-- MIGRATION 730: COMPETEN SCHOLAR -- FLASHCARDS: THE LEARNER OWN CARDS, DECKS, AND CARD MARKS
--
-- SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026), "Flashcards and Downloadable Revision Guides V1". Owner GO to
-- prepare and validate on staging. Production application is a separate owner act.
-- Build record: docs/evidence/SCHOLAR-FLASHCARDS/730-build-record.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Two defaulted or nullable columns and one new CHECK on
-- individual_scholar_question that every existing row already satisfies, and three new tables. No row is changed,
-- no column removed, no function, no trigger. Re-running the file is a no-op. OPS-001 s8: proposed Low.
-- DEPENDS ON 372 (individual_scholar_question, individual_scholar_material), 416 (kind flashcard, review_status)
-- and 710 (library_version_id). Application order: 372, 416, 710, then 730.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT IS FOR.
--
-- Flashcards already exist and are NOT duplicated here. A card IS an individual_scholar_question of kind flashcard
-- (416), its schedule IS the 372 card on the shared SM-2, and its history IS the 391 review log. What was missing:
--
-- A. A CARD THE LEARNER WRITES. A learner may write a card by hand, with no AI. It is a flashcard row whose model and
--    provider are both learner, prompt_version learner:v1, source_quote empty (it quotes nothing from the
--    notes) and review_status private_formative. The new CHECK binds all of that together, so a hand-written card
--    can never carry a notes quote, a library provenance, or a clinically approved status, and no other row can
--    claim to be hand-written. content_version counts edits to it (1 when written) and only a learner
--    card may be edited past 1, so an AI-written or library card is never silently rewritten.
--
-- B. DECKS. individual_scholar_flashcard_deck is a named deck the learner makes, optionally organised by module,
--    topic, document or competency (a label or an id, no foreign key: it is filing by the learner).
--    individual_scholar_flashcard_deck_card says which cards are in it. A deck REFERENCES cards: the schedule
--    stays on the 372 card, so moving a card between decks never copies or resets its review history. One row
--    per deck and card. Deleting a deck leaves its cards and their history. Deleting a card (or its material)
--    removes it from every deck.
--
-- C. CARD MARKS. individual_scholar_flashcard_mark holds, per learner and card, a bookmark, a private note, and a
--    reported issue as a CODE only (the five codes of the existing feedback path, plat_ai_feedback 600). It is a
--    private list for the learner. It publishes nothing and is never read into the governed library.
--
-- PRIVATE BY DEFAULT. Nothing here is shared, published or copied to the library. RLS on, own-row SELECT only (owner
-- ruling D6, as 372, 417 and 720). The server writes through the service role, keyed on the caller.
-- FORMATIVE. Nothing here is assessment, mastery or verified competence.
--
-- FAIL CLOSED WITHOUT IT. Scholar probes a 730 table once. Without 730, hand-written cards, decks and marks are not
-- offered (the page says so), and flashcards from notes, the library and learning gaps work as before.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. No function. notify pgrst last.
-- ROLLBACK (staging): docs/evidence/SCHOLAR-FLASHCARDS/ROLLBACK-730.sql. It refuses while any learner card, edited
-- card, deck or mark exists, and says what to remove.
-- ====================================================================================================


-- ---- 1. the hand-written card, and its content version ----------------------------------------------

alter table individual_scholar_question add column if not exists content_version integer not null default 1;
alter table individual_scholar_question add column if not exists content_updated_at timestamptz;

alter table individual_scholar_question drop constraint if exists individual_scholar_question_learner_card_check;
alter table individual_scholar_question add constraint individual_scholar_question_learner_card_check
  check (content_version between 1 and 100000
     and ((model = 'learner') = (provider = 'learner'))
     and (model <> 'learner' or (kind = 'flashcard' and review_status = 'private_formative' and library_version_id is null
          and prompt_version = 'learner:v1' and source_quote = '' and correct_index is null))
     and (content_version = 1 or model = 'learner')
     and ((content_updated_at is null) = (content_version = 1))) not valid;
alter table individual_scholar_question validate constraint individual_scholar_question_learner_card_check;

comment on column individual_scholar_question.content_version is
  'SCHOLAR-FLASHCARDS-01 (730). 1 when written. Only a learner-written flashcard (model and provider learner) may be edited past 1. AI-written and library rows are never rewritten.';
comment on column individual_scholar_question.content_updated_at is
  'SCHOLAR-FLASHCARDS-01 (730). When a learner-written flashcard was last edited. Null while content_version is 1.';


-- ---- 2. decks, and which cards are in them ------------------------------------------------------------

create table if not exists individual_scholar_flashcard_deck (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  title            text not null,
  organise_by      text not null default 'personal',
  organise_ref     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_studied_at  timestamptz
);

alter table individual_scholar_flashcard_deck drop constraint if exists individual_scholar_flashcard_deck_check;
alter table individual_scholar_flashcard_deck add constraint individual_scholar_flashcard_deck_check
  check (char_length(title) between 1 and 120
     and organise_by in ('personal', 'module', 'topic', 'document', 'competency')
     and (organise_ref is null or char_length(organise_ref) between 1 and 200)
     and ((organise_by = 'personal') = (organise_ref is null)));

create unique index if not exists ux_individual_scholar_flashcard_deck_id_user
  on individual_scholar_flashcard_deck(id, user_id);
create index if not exists idx_individual_scholar_flashcard_deck_user
  on individual_scholar_flashcard_deck(user_id, updated_at desc);

create table if not exists individual_scholar_flashcard_deck_card (
  deck_id      uuid not null,
  user_id      uuid not null,
  question_id  uuid not null,
  position     integer not null default 0,
  added_at     timestamptz not null default now(),
  constraint individual_scholar_flashcard_deck_card_pk primary key (deck_id, question_id),
  constraint individual_scholar_flashcard_deck_card_deck_fk foreign key (deck_id, user_id)
    references individual_scholar_flashcard_deck(id, user_id) on delete cascade,
  constraint individual_scholar_flashcard_deck_card_question_fk foreign key (question_id, user_id)
    references individual_scholar_question(id, user_id) on delete cascade
);

alter table individual_scholar_flashcard_deck_card drop constraint if exists individual_scholar_flashcard_deck_card_check;
alter table individual_scholar_flashcard_deck_card add constraint individual_scholar_flashcard_deck_card_check
  check (position between 0 and 100000);

create index if not exists idx_individual_scholar_flashcard_deck_card_question
  on individual_scholar_flashcard_deck_card(user_id, question_id);


-- ---- 3. card marks: bookmark, private note, reported issue (a code) ----------------------------------

create table if not exists individual_scholar_flashcard_mark (
  user_id      uuid not null,
  question_id  uuid not null,
  bookmarked   boolean not null default false,
  note         text,
  issue        text,
  issue_at     timestamptz,
  updated_at   timestamptz not null default now(),
  constraint individual_scholar_flashcard_mark_pk primary key (user_id, question_id),
  constraint individual_scholar_flashcard_mark_question_fk foreign key (question_id, user_id)
    references individual_scholar_question(id, user_id) on delete cascade
);

alter table individual_scholar_flashcard_mark drop constraint if exists individual_scholar_flashcard_mark_check;
alter table individual_scholar_flashcard_mark add constraint individual_scholar_flashcard_mark_check
  check ((note is null or char_length(note) between 1 and 1000)
     and (issue is null or issue in ('inaccurate', 'unclear', 'difficulty', 'relevance', 'evidence'))
     and ((issue is null) = (issue_at is null)));


-- ---- 4. RLS: own rows, read only. The server writes through the service role ----------------------------

alter table individual_scholar_flashcard_deck enable row level security;
alter table individual_scholar_flashcard_deck_card enable row level security;
alter table individual_scholar_flashcard_mark enable row level security;

drop policy if exists individual_scholar_flashcard_deck_read_own on individual_scholar_flashcard_deck;
create policy individual_scholar_flashcard_deck_read_own on individual_scholar_flashcard_deck
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_flashcard_deck_card_read_own on individual_scholar_flashcard_deck_card;
create policy individual_scholar_flashcard_deck_card_read_own on individual_scholar_flashcard_deck_card
  for select using (auth.uid() = user_id);
drop policy if exists individual_scholar_flashcard_mark_read_own on individual_scholar_flashcard_mark;
create policy individual_scholar_flashcard_mark_read_own on individual_scholar_flashcard_mark
  for select using (auth.uid() = user_id);

comment on table individual_scholar_flashcard_deck is
  'SCHOLAR-FLASHCARDS-01 (730). A learner''s named flashcard deck. It references cards (individual_scholar_flashcard_deck_card) and never holds a schedule: the 372 card and the 391 log do. Private, formative.';
comment on table individual_scholar_flashcard_deck_card is
  'SCHOLAR-FLASHCARDS-01 (730). Which cards are in a deck. Moving a card between decks moves this row only, never its review history.';
comment on table individual_scholar_flashcard_mark is
  'SCHOLAR-FLASHCARDS-01 (730). Per learner and card: a bookmark, a private note, and a reported issue as a code only. Never published, never read into the library.';

notify pgrst, 'reload schema';
