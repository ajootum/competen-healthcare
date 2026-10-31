-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 730 (SCHOLAR-FLASHCARDS-01). Staging rehearsal, or production only with a separate owner GO.
-- It REFUSES while anything depends on 730: a hand-written card, an edited card, a deck, a deck card, a mark.
-- Remove those first (the learner can delete their own cards and decks in Scholar), then run it again.
do $$
declare
  n_learner int := 0;
  n_edited int := 0;
  n_decks int := 0;
  n_deck_cards int := 0;
  n_marks int := 0;
begin
  if to_regclass('public.individual_scholar_flashcard_deck') is not null then
    execute 'select count(*) from individual_scholar_flashcard_deck' into n_decks;
    execute 'select count(*) from individual_scholar_flashcard_deck_card' into n_deck_cards;
    execute 'select count(*) from individual_scholar_flashcard_mark' into n_marks;
  end if;
  select count(*) into n_learner from individual_scholar_question where model = 'learner' or provider = 'learner';
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_question' and column_name = 'content_version') then
    execute 'select count(*) from individual_scholar_question where content_version <> 1' into n_edited;
  end if;
  if n_learner + n_edited + n_decks + n_deck_cards + n_marks > 0 then
    raise exception 'ROLLBACK 730 refused: % hand-written card(s), % edited card(s), % deck(s), % deck card(s), % mark(s) depend on 730.',
      n_learner, n_edited, n_decks, n_deck_cards, n_marks;
  end if;
end;
$$;

drop table if exists individual_scholar_flashcard_mark;
drop table if exists individual_scholar_flashcard_deck_card;
drop table if exists individual_scholar_flashcard_deck;
alter table individual_scholar_question drop constraint if exists individual_scholar_question_learner_card_check;
alter table individual_scholar_question drop column if exists content_updated_at;
alter table individual_scholar_question drop column if exists content_version;

notify pgrst, 'reload schema';
