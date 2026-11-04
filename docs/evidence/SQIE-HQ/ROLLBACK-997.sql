-- ROLLBACK-997: restores the 800 bodies of ckri_question_format_ok and individual_scholar_question_library_guard exactly.
-- APPLY THIS FILE WHOLE (functions between dollar quotes). Refuses while any library version has the format calculation or
-- any learner copy is a calculation (they would be left unreadable to 800). Staging only unless the owner gives a GO.
do $$
begin
  if exists (select 1 from ckri_knowledge_version where content ->> 'format' = 'calculation') then
    raise exception 'ROLLBACK-997 refused: a library version has the format calculation';
  end if;
  if exists (select 1 from individual_scholar_question where library_version_id is not null and answer ->> 'format' = 'calculation') then
    raise exception 'ROLLBACK-997 refused: a learner copy is a calculation';
  end if;
end $$;

create or replace function public.ckri_question_format_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(
        jsonb_typeof(p) = 'object'
    and jsonb_typeof(p -> 'stem') = 'string' and char_length(btrim(p ->> 'stem')) between 10 and 2000
    and jsonb_typeof(p -> 'rationale') = 'string' and char_length(btrim(p ->> 'rationale')) between 10 and 4000
    and jsonb_typeof(p -> 'options') = 'array'
    and not jsonb_path_exists(p, '$.options[*] ? (!(@.type() == "string") || @ == "")')
    and (p -> 'rubric' is null or jsonb_typeof(p -> 'rubric') = 'object')
    and (p -> 'answerKey' is null or jsonb_typeof(p -> 'answerKey') = 'object')
    and octet_length(coalesce(p -> 'answerKey', '{}'::jsonb)::text) + octet_length(coalesce(p -> 'rubric', '{}'::jsonb)::text) <= 15000
    and jsonb_typeof(p -> 'marking') = 'string'
    and case p ->> 'format'
      when 'mcq' then jsonb_array_length(p -> 'options') = 4
        and jsonb_path_exists(p, '$.correct_index ? (@.type() == "number" && (@ == 0 || @ == 1 || @ == 2 || @ == 3))')
        and p -> 'answerKey' is null and p ->> 'marking' = 'deterministic'
      when 'mrq' then jsonb_array_length(p -> 'options') between 4 and 6 and p -> 'correct_index' is null
        and jsonb_typeof(p -> 'answerKey' -> 'correct') = 'array'
        and jsonb_array_length(p -> 'answerKey' -> 'correct') between 1 and jsonb_array_length(p -> 'options') - 1
        and (p -> 'answerKey' -> 'correct') <@ '[0, 1, 2, 3, 4, 5]'::jsonb
        and not jsonb_path_exists(p, '$.answerKey.correct[*] ? (@ >= $n)', jsonb_build_object('n', jsonb_array_length(p -> 'options')))
        and p ->> 'marking' = 'deterministic'
      when 'short' then jsonb_array_length(p -> 'options') = 0 and p -> 'correct_index' is null
        and p -> 'answerKey' -> 'format' is null
        and jsonb_typeof(p -> 'answerKey' -> 'accepted') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'accepted') between 1 and 8
        and p ->> 'marking' in ('deterministic', 'self')
      when 'cloze' then jsonb_array_length(p -> 'options') = 0 and p -> 'correct_index' is null
        and p -> 'answerKey' ->> 'format' = 'cloze' and position('_____' in p ->> 'stem') > 0
        and jsonb_typeof(p -> 'answerKey' -> 'accepted') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'accepted') between 1 and 8
        and p ->> 'marking' = 'deterministic'
      when 'true_false' then jsonb_array_length(p -> 'options') = 0 and p -> 'correct_index' is null
        and p -> 'answerKey' ->> 'format' = 'true_false'
        and (p -> 'answerKey' -> 'accepted') in ('["true"]'::jsonb, '["false"]'::jsonb)
        and jsonb_typeof(p -> 'answerKey' -> 'statement') = 'string' and jsonb_typeof(p -> 'answerKey' -> 'explanation') = 'string'
        and p ->> 'marking' = 'deterministic'
      when 'extended' then jsonb_array_length(p -> 'options') = 0 and p -> 'correct_index' is null
        and p -> 'answerKey' ->> 'format' = 'extended'
        and jsonb_typeof(p -> 'answerKey' -> 'accepted') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'accepted') = 1
        and jsonb_typeof(p -> 'answerKey' -> 'modelAnswer') = 'string' and char_length(btrim(p -> 'answerKey' ->> 'modelAnswer')) between 1 and 1200
        and jsonb_path_exists(p, '$.answerKey.marks ? (@.type() == "number" && @ >= 1 && @ <= 10 && @ == @.floor())')
        and jsonb_typeof(p -> 'rubric' -> 'keyPoints') = 'array' and jsonb_array_length(p -> 'rubric' -> 'keyPoints') between 3 and 8
        and p ->> 'marking' in ('rubric_ai_formative', 'self')
      when 'flashcard' then jsonb_array_length(p -> 'options') = 0 and p -> 'correct_index' is null
        and jsonb_typeof(p -> 'answerKey' -> 'back') = 'string' and char_length(p -> 'answerKey' ->> 'back') between 1 and 2000
        and p ->> 'marking' = 'self'
      when 'match' then jsonb_array_length(p -> 'options') between 3 and 6 and p -> 'correct_index' is null
        and jsonb_typeof(p -> 'answerKey' -> 'matches') = 'array'
        and jsonb_array_length(p -> 'answerKey' -> 'matches') = jsonb_array_length(p -> 'options')
        and not jsonb_path_exists(p, '$.answerKey.matches[*] ? (!(@.type() == "string") || @ == "")')
        and p ->> 'marking' = 'deterministic'
      when 'sequence' then jsonb_array_length(p -> 'options') between 3 and 6 and p -> 'correct_index' is null
        and jsonb_typeof(p -> 'answerKey' -> 'order') = 'array'
        and jsonb_array_length(p -> 'answerKey' -> 'order') = jsonb_array_length(p -> 'options')
        and (p -> 'answerKey' -> 'order') <@ '[0, 1, 2, 3, 4, 5]'::jsonb
        and not jsonb_path_exists(p, '$.answerKey.order[*] ? (@ >= $n)', jsonb_build_object('n', jsonb_array_length(p -> 'options')))
        and (select count(distinct e) from jsonb_array_elements(p -> 'answerKey' -> 'order') as x(e)) = jsonb_array_length(p -> 'options')
        and p ->> 'marking' = 'deterministic'
      when 'structured' then jsonb_array_length(p -> 'options') = 0 and p -> 'correct_index' is null
        and jsonb_typeof(p -> 'answerKey' -> 'parts') = 'array'
        and jsonb_array_length(p -> 'answerKey' -> 'parts') between 2 and 4
        and not jsonb_path_exists(p, '$.answerKey.parts[*] ? (!(@.prompt.type() == "string") || !(@.marks.type() == "number") || @.marks < 1 || @.marks > 5 || @.marks != @.marks.floor() || !(@.accepted.type() == "array") || @.accepted.size() < 1)')
        and p ->> 'marking' in ('deterministic', 'self')
      else false end,
    false)
$$;

create or replace function public.individual_scholar_question_library_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v record;
  v_format text;
  v_kind text;
  v_rubric jsonb;
  v_answer jsonb;
begin
  if new.library_version_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.library_version_id is not distinct from old.library_version_id
     and new.library_resource_id is not distinct from old.library_resource_id
     and new.kind = old.kind and new.stem = old.stem and new.options = old.options
     and new.correct_index is not distinct from old.correct_index and new.answer is not distinct from old.answer then
    return new;
  end if;
  select kv.state, kv.content, kv.resource_id, kr.kind, kr.status into v
    from ckri_knowledge_version kv join ckri_knowledge_resource kr on kr.id = kv.resource_id
   where kv.id = new.library_version_id;
  if not found or v.resource_id is distinct from new.library_resource_id then
    raise exception 'individual_scholar_question: unknown library version, or not of the named resource';
  end if;
  if v.kind <> 'revision_question' or v.status <> 'active' or v.state <> 'published' then
    raise exception 'individual_scholar_question: only the published version of an active revision question is reused (this one is % %, %)', v.status, v.kind, v.state;
  end if;
  if not ckri_knowledge_approved(new.library_version_id) then
    raise exception 'individual_scholar_question: this exact library version is not clinically approved';
  end if;
  v_format := coalesce(v.content ->> 'format', 'mcq');
  v_kind := case when v_format in ('cloze', 'true_false', 'extended') then 'short' else v_format end;
  v_rubric := case when jsonb_typeof(v.content -> 'rubric') = 'object' then jsonb_build_object('rubric', v.content -> 'rubric') else '{}'::jsonb end;
  v_answer := case when v_format = 'mcq' then nullif(v_rubric, '{}'::jsonb)
                   else coalesce(v.content -> 'answerKey', '{}'::jsonb) || v_rubric
                        || case when jsonb_typeof(v.content -> 'marking') = 'string' then jsonb_build_object('marking', v.content -> 'marking') else '{}'::jsonb end
              end;
  if new.kind is distinct from v_kind or new.stem is distinct from (v.content ->> 'stem')
     or new.options is distinct from coalesce(v.content -> 'options', '[]'::jsonb)
     or new.correct_index is distinct from (case when v_format = 'mcq' then (v.content ->> 'correct_index')::int end)
     or new.answer is distinct from v_answer then
    raise exception 'individual_scholar_question: a library question is stored exactly as published';
  end if;
  return new;
end;
$$;

drop trigger if exists individual_scholar_question_library_guard on individual_scholar_question;
create trigger individual_scholar_question_library_guard
  before insert or update on individual_scholar_question
  for each row execute function public.individual_scholar_question_library_guard();

notify pgrst, 'reload schema';
