-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains functions between dollar quotes (two sql, one plpgsql trigger function).
-- A runner that splits on the statement separator would cut a function in half, so paste and run the entire
-- file at once.
-- ====================================================================================================
-- MIGRATION 800: CKRI LIBRARY QUESTIONS IN EVERY REVISION FORMAT, WITH KEYS, RUBRICS AND MARKING RULES
--
-- SQIE-LIBRARY-EXPANSION-01, owner GO 31 Oct 2026 (Scholar Release Decisions, item F). Owner GO to prepare and validate
-- on staging. Production application is a separate owner act. Build record: docs/evidence/SQIE-LIBRARY/800-802-build-record.md.
--
-- APPLY ON STAGING FIRST, AFTER 721. ADDITIVE OR WIDENING. One new sql function, the 442 content-shape function replaced
-- by one that answers every existing kind and every existing revision question exactly as before, one 710 CHECK replaced
-- by a wider one every existing row already satisfies, and the 710 library-copy guard replaced by one that checks MORE
-- (the kind and the answer as well as the stem, options and key). No row is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Low-Medium (two replaced functions), with rollback SQL.
-- DEPENDS ON 442 (ckri_knowledge_*), 710 (the library columns and guard) and 721 (the osce_station branch kept below).
-- Application order: 442, 710, 721, then 800.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
-- A. FORMATS. A revision_question content WITHOUT a format key is the 442 question exactly (stem, four options,
--    correct_index, rationale), checked by the 442 expression unchanged. A content WITH a format key is checked by
--    ckri_question_format_ok: mcq, mrq, short, cloze, true_false, extended, flashcard, match, sequence or structured,
--    each with its answerKey (exactly the learner answer of that format in 416 and 710, without its rubric), an
--    optional rubric object, a marking rule (deterministic, self, or rubric_ai_formative for extended only) and its
--    rationale. The application validator (src/lib/individual/scholar/library-format.ts validateLibraryQuestion) is
--    stricter. Versioning is the existing 442 versions: nothing about review, approval or publication changes.
--
-- B. LEARNER COPIES OF MORE KINDS. The 710 revision CHECK allowed a library copy only of kind mcq. It now allows mcq,
--    mrq, short, flashcard, match, sequence and structured (cloze, true_false and extended are short with answer.format).
--    Never case.
--
-- C. THE COPY GUARD IS NOT WEAKENED. individual_scholar_question_library_guard still refuses a copy unless, when it is
--    written, the version is the published version of an active revision_question resource and ckri_knowledge_approved
--    says its exact content is approved. And the copy must now be EXACTLY the content in every part: kind (from the
--    format), stem, options, correct_index (mcq only) and answer (answerKey plus the rubric plus, for every kind but
--    mcq, the marking rule). A legacy copy (mcq, answer null) is exactly what it was. An update that leaves the copy
--    unchanged passes as before, and an update that changes the kind or the answer of a copy is now checked too.
--
-- FAIL CLOSED WITHOUT IT. Until it is applied, a draft with a format key is refused by 442 (the HQ editor says so) and no
-- non-mcq copy can be stored. Scholar reads only what it can copy, so it offers mcq library items as before.
--
-- RLS: unchanged. The server writes through the service role.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): RELEASE-2026-10-25/PENDING-31/ROLLBACK-800.sql restores the 721 function, the 710 CHECK and the
--   710 guard exactly, and drops ckri_question_format_ok. It refuses while any version carries a format key or any
--   library copy is not of kind mcq.
-- ====================================================================================================


-- ---- 1. the shape of a revision question that names its format ----------------------------------------

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


-- ---- 2. the shape of each kind: every 442 and 721 branch unchanged, a format-named question added -------

create or replace function public.ckri_knowledge_content_ok(p_kind text, p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_kind
    when 'explanation' then jsonb_typeof(p -> 'body') = 'string' and char_length(p ->> 'body') between 20 and 20000
    when 'targeted_resource' then jsonb_typeof(p -> 'body') = 'string' and char_length(p ->> 'body') between 20 and 20000
      and (p -> 'links' is null or (jsonb_typeof(p -> 'links') = 'array' and jsonb_array_length(p -> 'links') <= 20))
    when 'revision_question' then case when p -> 'format' is null then
          jsonb_typeof(p -> 'stem') = 'string' and char_length(p ->> 'stem') between 10 and 2000
      and jsonb_typeof(p -> 'options') = 'array' and jsonb_array_length(p -> 'options') = 4
      and jsonb_typeof(p -> 'correct_index') = 'number' and (p ->> 'correct_index')::int between 0 and 3
      and jsonb_typeof(p -> 'rationale') = 'string' and char_length(p ->> 'rationale') between 10 and 4000
      else ckri_question_format_ok(p) end
    when 'osce_station' then case
      when jsonb_typeof(p -> 'scenario') = 'string' and jsonb_typeof(p -> 'candidate_instructions') = 'string' and jsonb_typeof(p -> 'checklist') = 'array' then
            char_length(btrim(p ->> 'scenario')) between 20 and 4000
        and char_length(btrim(p ->> 'candidate_instructions')) between 10 and 2000
        and jsonb_path_exists(p, '$.duration_minutes ? (@.type() == "number" && @ >= 3 && @ <= 20 && @ == @.floor())')
        and jsonb_array_length(p -> 'checklist') between 1 and 60
        and octet_length((p -> 'checklist')::text) <= 64000
        and not jsonb_path_exists(p -> 'checklist', '$[*] ? (!(@.type() == "object") || !(@.id.type() == "string") || @.id == "" || !(@.text.type() == "string") || @.text == "" || !(@.critical.type() == "boolean") || (exists(@.outcome) && !(@.outcome.type() == "string")))')
        and (case when jsonb_typeof(p -> 'sections') = 'array' then jsonb_array_length(p -> 'sections') between 1 and 6
               and not jsonb_path_exists(p -> 'sections', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'sections' is null end)
        and (case when jsonb_typeof(p -> 'objectives') = 'array' then jsonb_array_length(p -> 'objectives') <= 30
               and not jsonb_path_exists(p -> 'objectives', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'objectives' is null end)
        and (case when jsonb_typeof(p -> 'expected_activities') = 'array' then jsonb_array_length(p -> 'expected_activities') <= 60
               and not jsonb_path_exists(p -> 'expected_activities', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'expected_activities' is null end)
        and (case when jsonb_typeof(p -> 'learning_outcomes') = 'array' then jsonb_array_length(p -> 'learning_outcomes') <= 60
               and not jsonb_path_exists(p -> 'learning_outcomes', '$[*] ? (!(@.type() == "string") || @ == "")') else p -> 'learning_outcomes' is null end)
        and (case when jsonb_typeof(p -> 'references') = 'array' then jsonb_array_length(p -> 'references') <= 40
               and not jsonb_path_exists(p -> 'references', '$[*] ? (!(@.type() == "object"))') else p -> 'references' is null end)
        and (p -> 'guidance' is null or jsonb_typeof(p -> 'guidance') = 'object')
        and (p -> 'difficulty' is null or (jsonb_typeof(p -> 'difficulty') = 'string' and p ->> 'difficulty' in ('introductory', 'intermediate', 'advanced')))
        and (p -> 'profession' is null or (jsonb_typeof(p -> 'profession') = 'string' and char_length(btrim(p ->> 'profession')) between 1 and 80))
        and (p -> 'programme_code' is null or (jsonb_typeof(p -> 'programme_code') = 'string' and char_length(btrim(p ->> 'programme_code')) between 1 and 80))
        and (p -> 'programme_label' is null or (jsonb_typeof(p -> 'programme_label') = 'string' and char_length(btrim(p ->> 'programme_label')) between 1 and 200))
        and (p -> 'topic' is null or (jsonb_typeof(p -> 'topic') = 'string' and char_length(btrim(p ->> 'topic')) between 1 and 160))
        and (p -> 'body_system' is null or (jsonb_typeof(p -> 'body_system') = 'string' and char_length(btrim(p ->> 'body_system')) between 1 and 80))
      else false end
    else false end
$$;


-- ---- 3. the 710 revision CHECK: a library copy of any copyable kind, never a case ------------------------

alter table individual_scholar_question drop constraint if exists individual_scholar_question_revision_check;
alter table individual_scholar_question add constraint individual_scholar_question_revision_check
  check ((difficulty is null or difficulty between 1 and 3)
     and review_status in ('private_formative', 'library_approved')
     and ((review_status = 'library_approved') = (library_version_id is not null))
     and ((library_version_id is null) = (library_resource_id is null))
     and (library_version_id is null or (kind in ('mcq', 'mrq', 'short', 'flashcard', 'match', 'sequence', 'structured')
                                         and model = 'competen-library' and provider = 'competen-library'))
     and (answer is null or octet_length(answer::text) <= 16000)) not valid;
alter table individual_scholar_question validate constraint individual_scholar_question_revision_check;


-- ---- 4. a library copy is only ever the published, clinically approved content, exactly, in every part ----

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

comment on column individual_scholar_question.library_version_id is
  'SCHOLAR-SQIE-CLOSE-01 (710), SQIE-LIBRARY-EXPANSION-01 (800). The published, clinically approved CKRI knowledge version (442, kind revision_question) this learner copy is, exactly: kind from its format, stem, options, key and answer (answerKey, rubric, marking). Null for every question Scholar writes. Checked by individual_scholar_question_library_guard.';

notify pgrst, 'reload schema';
