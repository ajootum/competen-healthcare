-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains functions between dollar quotes (one sql, one plpgsql trigger function).
-- A runner that splits on the statement separator would cut a function in half, so paste and run the entire
-- file at once.
-- ====================================================================================================
-- MIGRATION 997: CKRI LIBRARY QUESTIONS -- CALCULATION, SAFETY MARKERS, JUSTIFICATION AND INTERPRETATION
--
-- SQIE-CLOSE-2026-11 workstream WS-E (library form and format check) for the formats of WS-A, WS-B and WS-C, owner decision
-- of 4 Nov 2026 item 1 (calculation). The field contracts are those of the scoring session (src/lib/individual/scholar/scoring-rules.ts,
-- branch scholar/sqie-scoring cdd9026b). Build record: docs/evidence/SQIE-HQ/997-build-record.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. WIDENING. Two functions of 800 are
-- replaced by bodies that are the 800 bodies with additions only: every existing library content and every existing learner
-- copy is checked exactly as before. No table, column or row is changed. Re-running it is a no-op.
-- DEPENDS ON 800 (both functions), which depends on 442, 710 and 721. Application order: 800, then 997. Independent of 995,
-- 996 and 801/802. OPS-001 s8: proposed Low-Medium (two replaced functions), with rollback SQL.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
-- A. ckri_question_format_ok gains the format calculation: options [], no correct_index, answerKey { format calculation,
--    accepted 1-8 strings (the answer in words), value a number, unit a string of at most 30 (empty for none),
--    equivalentUnits up to 6 strings, rounding { mode decimal_places or significant_figures, places 0-6 }, tolerance
--    { kind absolute, amount above 0 } or { kind percent, amount above 0 and at most 10 }, safetyCritical a boolean, working
--    at most 1200 }, marking deterministic. The application validator is stricter: units must be recognised and of the same
--    kind, the value already rounded (scoring-rules.ts calculationProblems). A tolerance is stored but used only while HQ
--    policy scholar_calculation_tolerances is on, which stays off until the clinical calculation policy is approved.
-- B. Every format: optional WS-B and WS-C key fields are type-checked when present -- answerKey.safetyCritical a boolean,
--    answerKey.unsafe up to 6 strings, answerKey.variant answer_justify or interpretation, answerKey.findings 1-12 rows, and
--    for structured parts a role of answer, justify or interpret, 1-8 criteria, 2-6 options. Absent, nothing changes.
-- C. The 800 learner-copy guard maps calculation to the stored kind short (as cloze, true_false and extended are) and is
--    otherwise the 800 guard exactly: a copy is only ever the published, clinically approved content, exactly.
--
-- FAIL CLOSED WITHOUT IT. Before this file a calculation version is refused by 442 (the HQ editor says so) and no learner copy
-- of one can be stored. Scholar offers only what it can copy, so a calculation is never offered from the library.
--
-- RLS: unchanged.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK: docs/evidence/SQIE-HQ/ROLLBACK-997.sql restores both 800 bodies exactly. It refuses while any version has the
--   format calculation or any learner copy is a calculation.
-- ====================================================================================================


-- ---- 1. the shape of a revision question that names its format (800, plus calculation and the WS-B/WS-C fields) ----

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
    and (p -> 'answerKey' -> 'safetyCritical' is null or jsonb_typeof(p -> 'answerKey' -> 'safetyCritical') = 'boolean')
    and (p -> 'answerKey' -> 'unsafe' is null or (jsonb_typeof(p -> 'answerKey' -> 'unsafe') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'unsafe') <= 6
         and not jsonb_path_exists(p, '$.answerKey.unsafe[*] ? (!(@.type() == "string") || @ == "")')))
    and (p -> 'answerKey' -> 'variant' is null or p -> 'answerKey' ->> 'variant' in ('answer_justify', 'interpretation'))
    and (p -> 'answerKey' -> 'findings' is null or (jsonb_typeof(p -> 'answerKey' -> 'findings') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'findings') between 1 and 12))
    and not jsonb_path_exists(p, '$.answerKey.parts[*] ? (exists(@.role) && !(@.role == "answer" || @.role == "justify" || @.role == "interpret"))')
    and not jsonb_path_exists(p, '$.answerKey.parts[*] ? (exists(@.criteria) && (!(@.criteria.type() == "array") || @.criteria.size() < 1 || @.criteria.size() > 8))')
    and not jsonb_path_exists(p, '$.answerKey.parts[*] ? (exists(@.options) && (!(@.options.type() == "array") || @.options.size() < 2 || @.options.size() > 6))')
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
      when 'calculation' then jsonb_array_length(p -> 'options') = 0 and p -> 'correct_index' is null
        and p -> 'answerKey' ->> 'format' = 'calculation'
        and jsonb_typeof(p -> 'answerKey' -> 'accepted') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'accepted') between 1 and 8
        and not jsonb_path_exists(p, '$.answerKey.accepted[*] ? (!(@.type() == "string") || @ == "")')
        and jsonb_typeof(p -> 'answerKey' -> 'value') = 'number'
        and jsonb_typeof(p -> 'answerKey' -> 'unit') = 'string' and char_length(p -> 'answerKey' ->> 'unit') <= 30
        and (p -> 'answerKey' -> 'equivalentUnits' is null or (jsonb_typeof(p -> 'answerKey' -> 'equivalentUnits') = 'array'
             and jsonb_array_length(p -> 'answerKey' -> 'equivalentUnits') <= 6
             and not jsonb_path_exists(p, '$.answerKey.equivalentUnits[*] ? (!(@.type() == "string") || @ == "")')))
        and (p -> 'answerKey' -> 'rounding' is null or (jsonb_typeof(p -> 'answerKey' -> 'rounding') = 'object'
             and p -> 'answerKey' -> 'rounding' ->> 'mode' in ('decimal_places', 'significant_figures')
             and jsonb_path_exists(p, '$.answerKey.rounding.places ? (@.type() == "number" && @ >= 0 && @ <= 6 && @ == @.floor())')))
        and (p -> 'answerKey' -> 'tolerance' is null or (jsonb_typeof(p -> 'answerKey' -> 'tolerance') = 'object'
             and ((p -> 'answerKey' -> 'tolerance' ->> 'kind' = 'absolute' and jsonb_path_exists(p, '$.answerKey.tolerance.amount ? (@.type() == "number" && @ > 0)'))
               or (p -> 'answerKey' -> 'tolerance' ->> 'kind' = 'percent' and jsonb_path_exists(p, '$.answerKey.tolerance.amount ? (@.type() == "number" && @ > 0 && @ <= 10)')))))
        and (p -> 'answerKey' -> 'safetyCritical' is null or jsonb_typeof(p -> 'answerKey' -> 'safetyCritical') = 'boolean')
        and (p -> 'answerKey' -> 'working' is null or (jsonb_typeof(p -> 'answerKey' -> 'working') = 'string' and char_length(p -> 'answerKey' ->> 'working') <= 1200))
        and p ->> 'marking' = 'deterministic'
      else false end,
    false)
$$;


-- ---- 2. the 800 learner-copy guard, with calculation stored as short ---------------------------------------------

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
  v_kind := case when v_format in ('cloze', 'true_false', 'extended', 'calculation') then 'short' else v_format end;
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
