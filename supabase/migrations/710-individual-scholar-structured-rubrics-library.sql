-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql trigger function between dollar quotes. A runner that splits
-- on the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 710: COMPETEN SCHOLAR -- STRUCTURED QUESTIONS, STORED MCQ AND CASE RUBRICS, GOVERNED LIBRARY REUSE
--
-- SCHOLAR-SQIE-CLOSE-01 (owner, 30 Oct 2026), the two P1 items. Owner GO to prepare and validate on staging.
-- Production application is a separate owner act. Build record: docs/evidence/SCHOLAR-QUESTIONS/710-build-record.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE OR WIDENING. It alters one existing table: two nullable columns, one unique
-- index, three CHECKs replaced by wider ones that every existing row already satisfies, and one trigger. No row is
-- changed. Re-running it is a no-op. OPS-001 s8: proposed Low-Medium (one new trigger function), with rollback SQL.
-- DEPENDS ON 372, 388 and 416 (individual_scholar_question) and 442 (ckri_knowledge_resource, ckri_knowledge_version,
-- ckri_knowledge_approved). Independent of every migration after 442.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
-- A. STRUCTURED QUESTIONS. kind structured: a lead-in (stem), no options, no correct_index, and answer.parts -- two
--    to four parts, each with its prompt and its marks (a whole number from 1 to 5), and its rubric (application).
--    Practice marks are formative, never an assessment.
--
-- B. MCQ AND CASE KEEP THEIR RUBRIC. 416 required answer IS NULL for mcq and case, so the rubric generated with them
--    was used once and thrown away. Now an mcq or case MAY carry answer holding ONLY its rubric (an object under the
--    one key rubric). Its key stays correct_index. A row with answer null is valid exactly as before.
--
-- C. GOVERNED LIBRARY REUSE. Revision may offer a clinically approved, PUBLISHED knowledge resource of kind
--    revision_question (442) before it writes new questions. The learner own copy is an ordinary mcq row that names
--    library_resource_id and library_version_id and carries review_status library_approved. The CHECK binds that
--    status to the version, and the trigger refuses a copy unless, at the moment it is written, the version is the
--    published version of an active revision_question resource, ckri_knowledge_approved says its exact content is
--    clinically approved, and the stem, options and key are that content exactly. So an unpublished, private,
--    unapproved or edited item cannot be stored as a library question by any writer. One copy per learner and version.
--    A copy of a version later superseded or retired stays stored but is no longer offered (application).
--
-- FAIL CLOSED WITHOUT IT. Until it is applied, structured cannot be stored, an mcq or case rubric is not stored, and no
-- library copy can be written. Scholar detects that once and offers what 416 allows, as today.
--
-- RLS: unchanged (the 372 read-own policy). The server writes through the service role.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/SCHOLAR-QUESTIONS/ROLLBACK-710.sql restores the three 416 CHECKs and drops the
--   rest. It refuses while any structured row, mcq or case rubric, or library copy exists, and says what to remove.
-- ====================================================================================================


-- ---- 1. the library provenance columns ---------------------------------------------------------------

alter table individual_scholar_question add column if not exists library_resource_id uuid references ckri_knowledge_resource(id) on delete cascade;
alter table individual_scholar_question add column if not exists library_version_id uuid references ckri_knowledge_version(id) on delete cascade;

create unique index if not exists ux_individual_scholar_question_library
  on individual_scholar_question(user_id, library_version_id);


-- ---- 2. the kind CHECK, widened by structured ----------------------------------------------------------

alter table individual_scholar_question drop constraint if exists individual_scholar_question_kind_check;
alter table individual_scholar_question add constraint individual_scholar_question_kind_check
  check (kind in ('mcq', 'case', 'mrq', 'short', 'flashcard', 'match', 'sequence', 'structured')) not valid;
alter table individual_scholar_question validate constraint individual_scholar_question_kind_check;


-- ---- 3. the options CHECK: mcq and case may carry a rubric only, and the structured shape ---------------

alter table individual_scholar_question drop constraint if exists individual_scholar_question_options_check;
alter table individual_scholar_question add constraint individual_scholar_question_options_check
  check (jsonb_typeof(options) = 'array' and (
       (kind in ('mcq', 'case') and jsonb_array_length(options) = 4
          and correct_index is not null and correct_index between 0 and 3
          and (answer is null or (jsonb_typeof(answer) = 'object' and jsonb_typeof(answer -> 'rubric') = 'object'
                                  and (answer - 'rubric') = '{}'::jsonb)))
    or (kind = 'mrq' and jsonb_array_length(options) between 4 and 6 and correct_index is null
          and jsonb_typeof(answer -> 'correct') = 'array'
          and jsonb_array_length(answer -> 'correct') between 1 and jsonb_array_length(options) - 1
          and (answer -> 'correct') <@ '[0, 1, 2, 3, 4, 5]'::jsonb)
    or (kind = 'short' and jsonb_array_length(options) = 0 and correct_index is null
          and jsonb_typeof(answer -> 'accepted') = 'array'
          and jsonb_array_length(answer -> 'accepted') between 1 and 8)
    or (kind = 'flashcard' and jsonb_array_length(options) = 0 and correct_index is null
          and jsonb_typeof(answer -> 'back') = 'string' and char_length(answer ->> 'back') between 1 and 2000)
    or (kind = 'match' and jsonb_array_length(options) between 3 and 6 and correct_index is null
          and jsonb_typeof(answer -> 'matches') = 'array'
          and jsonb_array_length(answer -> 'matches') = jsonb_array_length(options))
    or (kind = 'sequence' and jsonb_array_length(options) between 3 and 6 and correct_index is null
          and jsonb_typeof(answer -> 'order') = 'array'
          and jsonb_array_length(answer -> 'order') = jsonb_array_length(options)
          and (answer -> 'order') <@ '[0, 1, 2, 3, 4, 5]'::jsonb)
    or (kind = 'structured' and jsonb_array_length(options) = 0 and correct_index is null
          and jsonb_typeof(answer -> 'parts') = 'array'
          and jsonb_array_length(answer -> 'parts') between 2 and 4
          and not jsonb_path_exists(answer, '$.parts[*] ? (!(@.prompt.type() == "string") || !(@.marks.type() == "number") || @.marks < 1 || @.marks > 5 || @.marks != @.marks.floor())'))
  )) not valid;
alter table individual_scholar_question validate constraint individual_scholar_question_options_check;


-- ---- 4. the review status: private_formative, or a library copy bound to its version --------------------

alter table individual_scholar_question drop constraint if exists individual_scholar_question_revision_check;
alter table individual_scholar_question add constraint individual_scholar_question_revision_check
  check ((difficulty is null or difficulty between 1 and 3)
     and review_status in ('private_formative', 'library_approved')
     and ((review_status = 'library_approved') = (library_version_id is not null))
     and ((library_version_id is null) = (library_resource_id is null))
     and (library_version_id is null or (kind = 'mcq' and model = 'competen-library' and provider = 'competen-library'))
     and (answer is null or octet_length(answer::text) <= 16000)) not valid;
alter table individual_scholar_question validate constraint individual_scholar_question_revision_check;


-- ---- 5. a library copy is only ever the published, clinically approved content, exactly ----------------

create or replace function public.individual_scholar_question_library_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v record;
begin
  if new.library_version_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.library_version_id is not distinct from old.library_version_id
     and new.library_resource_id is not distinct from old.library_resource_id
     and new.stem = old.stem and new.options = old.options and new.correct_index is not distinct from old.correct_index then
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
  if new.stem is distinct from (v.content ->> 'stem') or new.options is distinct from (v.content -> 'options')
     or new.correct_index is distinct from (v.content ->> 'correct_index')::int then
    raise exception 'individual_scholar_question: a library question is stored exactly as published';
  end if;
  return new;
end;
$$;

drop trigger if exists individual_scholar_question_library_guard on individual_scholar_question;
create trigger individual_scholar_question_library_guard
  before insert or update on individual_scholar_question
  for each row execute function public.individual_scholar_question_library_guard();

comment on column individual_scholar_question.answer is
  'COMPETEN-SCHOLAR-REVISION-01 (416), SCHOLAR-SQIE-CLOSE-01 (710). The key of a kind that is not single-choice: correct (mrq), accepted (short), back (flashcard), matches (match), order (sequence), parts (structured, each with prompt, marks and rubric), with the item rubric. For mcq and case: null, or their rubric only (their key is correct_index).';
comment on column individual_scholar_question.library_version_id is
  'SCHOLAR-SQIE-CLOSE-01 (710). The published, clinically approved CKRI knowledge version (442, kind revision_question) this learner copy is, exactly. Null for every question Scholar writes. Checked by individual_scholar_question_library_guard.';
comment on column individual_scholar_question.review_status is
  'COMPETEN-SCHOLAR-REVISION-01 (416), SCHOLAR-SQIE-CLOSE-01 (710). private_formative for every AI-written question, never anything else. library_approved only for a copy of a published, clinically approved library version, bound to library_version_id.';

notify pgrst, 'reload schema';
