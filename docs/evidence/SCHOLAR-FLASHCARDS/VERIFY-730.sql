-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 730 (SCHOLAR-FLASHCARDS-01), staging only. Behaviour checks on rows planted against an existing
-- learner material and section. It ALWAYS ends by raising its result, so the runner rolls everything back.
do $$
declare
  u uuid; m uuid; c uuid; other uuid;
  card uuid; ai_card uuid; deck uuid; deck2 uuid;
  pass int := 0; fail int := 0; failed text := '';
  n int;
begin
  select ch.user_id, ch.material_id, ch.id into u, m, c from individual_scholar_chunk ch limit 1;
  if u is null then raise exception 'VERIFY 730: no learner section on staging to plant against'; end if;
  select id into other from profiles where id <> u limit 1;

  -- A1 a hand-written card is accepted, with its 372 card
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, answer, review_status, rationale, source_quote, model, provider, prompt_version)
    values (u, m, c, 'flashcard', 'What does the loop of Henle concentrate?', '[]'::jsonb, null, '{"back": "Urine, by the countercurrent multiplier"}'::jsonb, 'private_formative', '', '', 'learner', 'learner', 'learner:v1')
    returning id into card;
    insert into individual_scholar_card (user_id, question_id, material_id, next_review_at, status) values (u, card, m, current_date, 'active');
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' A1:' || sqlerrm;
  end;

  -- A2 an AI-written flashcard (as generation writes it) is accepted
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, answer, review_status, rationale, source_quote, model, provider, prompt_version, difficulty)
    values (u, m, c, 'flashcard', 'Where is renin released?', '[]'::jsonb, null, '{"back": "Juxtaglomerular cells"}'::jsonb, 'private_formative', 'Juxtaglomerular cells', 'renin is released by the juxtaglomerular cells', 'some-model', 'anthropic', 'revision-flashcard-v3', 1)
    returning id into ai_card;
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' A2:' || sqlerrm;
  end;

  -- A3 the learner edits their card: version 2 with its edit time
  begin
    update individual_scholar_question set stem = 'What does the loop of Henle set up?', content_version = 2, content_updated_at = now() where id = card;
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' A3:' || sqlerrm;
  end;

  -- B refusals on the question
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, answer, rationale, source_quote, model, provider, prompt_version)
    values (u, m, c, 'flashcard', 'A learner card with a quote?', '[]'::jsonb, null, '{"back": "x"}'::jsonb, '', 'a quote', 'learner', 'learner', 'learner:v1');
    fail := fail + 1; failed := failed || ' B1:accepted-quote';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, answer, rationale, source_quote, model, provider, prompt_version)
    values (u, m, c, 'flashcard', 'Model learner, provider not?', '[]'::jsonb, null, '{"back": "x"}'::jsonb, '', '', 'learner', 'anthropic', 'learner:v1');
    fail := fail + 1; failed := failed || ' B2:accepted-provider';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, answer, rationale, source_quote, model, provider, prompt_version)
    values (u, m, c, 'short', 'A hand-written short answer?', '[]'::jsonb, null, '{"accepted": ["x"]}'::jsonb, '', '', 'learner', 'learner', 'learner:v1');
    fail := fail + 1; failed := failed || ' B3:accepted-kind';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, answer, rationale, source_quote, model, provider, prompt_version)
    values (u, m, c, 'flashcard', 'Another prompt version?', '[]'::jsonb, null, '{"back": "x"}'::jsonb, '', '', 'learner', 'learner', 'revision-flashcard-v3');
    fail := fail + 1; failed := failed || ' B4:accepted-prompt';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_question set content_version = 2, content_updated_at = now() where id = ai_card;
    fail := fail + 1; failed := failed || ' B5:ai-edited';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_question set content_version = 3, content_updated_at = null where id = card;
    fail := fail + 1; failed := failed || ' B6:version-without-time';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_question set content_version = 0 where id = ai_card;
    fail := fail + 1; failed := failed || ' B7:version-0';
  exception when check_violation then pass := pass + 1;
  end;

  -- C decks
  begin
    insert into individual_scholar_flashcard_deck (user_id, title) values (u, 'Renal system') returning id into deck;
    insert into individual_scholar_flashcard_deck (user_id, title, organise_by, organise_ref) values (u, 'Week 3', 'module', 'NUR201') returning id into deck2;
    insert into individual_scholar_flashcard_deck_card (deck_id, user_id, question_id, position) values (deck, u, card, 1), (deck, u, ai_card, 2), (deck2, u, card, 1);
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' C1:' || sqlerrm;
  end;
  begin
    insert into individual_scholar_flashcard_deck (user_id, title) values (u, '');
    fail := fail + 1; failed := failed || ' C2:empty-title';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_flashcard_deck (user_id, title, organise_by, organise_ref) values (u, 'Odd', 'semester', 'x');
    fail := fail + 1; failed := failed || ' C3:organise';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_flashcard_deck (user_id, title, organise_by) values (u, 'Topic without a topic', 'topic');
    fail := fail + 1; failed := failed || ' C4:no-ref';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_flashcard_deck_card (deck_id, user_id, question_id) values (deck, u, card);
    fail := fail + 1; failed := failed || ' C5:twice';
  exception when unique_violation then pass := pass + 1;
  end;
  if other is not null then
    begin
      insert into individual_scholar_flashcard_deck_card (deck_id, user_id, question_id) values (deck2, other, ai_card);
      fail := fail + 1; failed := failed || ' C6:cross-user';
    exception when foreign_key_violation then pass := pass + 1;
    end;
  end if;

  -- D marks
  begin
    insert into individual_scholar_flashcard_mark (user_id, question_id, bookmarked, note, issue, issue_at) values (u, card, true, 'Ask in tutorial', 'unclear', now());
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' D1:' || sqlerrm;
  end;
  begin
    insert into individual_scholar_flashcard_mark (user_id, question_id, issue, issue_at) values (u, ai_card, 'wrong and dangerous', now());
    fail := fail + 1; failed := failed || ' D2:issue-text';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_flashcard_mark (user_id, question_id, issue) values (u, ai_card, 'unclear');
    fail := fail + 1; failed := failed || ' D3:issue-no-time';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_flashcard_mark (user_id, question_id, note) values (u, ai_card, repeat('x', 1001));
    fail := fail + 1; failed := failed || ' D4:long-note';
  exception when check_violation then pass := pass + 1;
  end;

  -- E moving a card between decks leaves its schedule alone, a deck delete leaves the card, a card delete leaves nothing behind
  update individual_scholar_card set repetitions = 3, interval_days = 15, reviews = 3 where question_id = card;
  delete from individual_scholar_flashcard_deck_card where deck_id = deck2 and question_id = card;
  delete from individual_scholar_flashcard_deck where id = deck2;
  select count(*) into n from individual_scholar_card where question_id = card and repetitions = 3 and interval_days = 15 and reviews = 3;
  if n = 1 then pass := pass + 1; else fail := fail + 1; failed := failed || ' E1:schedule-moved'; end if;
  delete from individual_scholar_question where id = card;
  select count(*) into n from individual_scholar_flashcard_deck_card where question_id = card;
  select n + count(*) into n from individual_scholar_flashcard_mark where question_id = card;
  select n + count(*) into n from individual_scholar_card where question_id = card;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failed := failed || ' E2:orphans'; end if;
  select count(*) into n from individual_scholar_flashcard_deck where id = deck;
  if n = 1 then pass := pass + 1; else fail := fail + 1; failed := failed || ' E3:deck-gone'; end if;

  -- F RLS on, a read-own policy on each of the three tables
  select count(*) into n from pg_class where relname in ('individual_scholar_flashcard_deck', 'individual_scholar_flashcard_deck_card', 'individual_scholar_flashcard_mark') and relrowsecurity;
  if n = 3 then pass := pass + 1; else fail := fail + 1; failed := failed || ' F1:rls'; end if;
  select count(*) into n from pg_policies where tablename like 'individual_scholar_flashcard_%' and cmd = 'SELECT';
  if n = 3 then pass := pass + 1; else fail := fail + 1; failed := failed || ' F2:policies'; end if;

  raise exception 'VERIFY 730 RESULT pass=% fail=% %', pass, fail, case when failed = '' then '' else ' :' || failed end;
end;
$$;
