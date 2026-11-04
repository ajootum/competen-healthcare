-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains functions between dollar quotes (one sql, one plpgsql trigger function).
-- A runner that splits on the statement separator would cut a function in half, so paste and run the entire
-- file at once.
-- ====================================================================================================
-- MIGRATION 995: CKRI LIBRARY QUESTIONS SAY WHO THEY ARE FOR -- PROGRAMME, QUALIFICATION LEVEL, DIFFICULTY
--
-- SQIE-CLOSE-2026-11 workstream WS-E (owner directive SQIE-CLOSE-2026-11 s4, 4 Nov 2026: "view question type, programme,
-- level and difficulty"). Tracker rows SQIE-05, SQIE-06, C-10, C-11. Build record: docs/evidence/SQIE-HQ/995-996-build-record.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. ADDITIVE. One new sql function and
-- one new trigger. No table, column, constraint or existing function is changed. No row is changed. Re-running it is a
-- no-op. DEPENDS ON 442 (ckri_knowledge_version, ckri_knowledge_resource). Independent of 800, 801, 802 and of any later
-- widening of ckri_question_format_ok: it checks ONE key and replaces nothing they own.
-- OPS-001 s8: proposed Low (additive trigger), with rollback SQL (ROLLBACK-995.sql drops exactly what this adds).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
-- A revision question content (442, formats by 800) MAY carry these top-level keys, each optional. The names are the
-- ones the 721 OSCE station content and the SQIE pilot batch already use, so one vocabulary covers both kinds:
--   programme_code        an individual_scholar_programme code (the 387 code shape)
--   programme_label       its words, 1 to 200 characters
--   qualification_level   a qualification code, lower case with underscores (for example pre_registration_diploma)
--   qualification_label   its words, 1 to 200 characters
--   difficulty            introductory, intermediate or advanced (the 721 vocabulary)
-- and provenance kept as given, each only checked for its type:
--   references            a list of up to 40 objects
--   source_verification   an object
--   competency_mapping    an object (framework version, competency, learning objective, draft or not). Owner decision
--                         4 Nov item 3: a draft mapping is allowed while publication is pending, never shown as evidence.
--   misconception_tags    a list of up to 20 strings of 1 to 80 characters
--   topic                 a string of 1 to 160 characters, question_type a lower-case code, pilot_batch 1 to 80 characters
--   calculation           an object (its fields are the calculation format contract, checked where that format is)
-- They are checked by ckri_question_meta_ok, called by a new BEFORE INSERT OR UPDATE OF content trigger on
-- ckri_knowledge_version for revision_question resources only.
--
-- WHY IN THE CONTENT. These keys are inside the exact content an educator reviews (educator_reviewed_hash), a clinician
-- approves (395 decisions on the content hash) and a publisher publishes, and they are frozen with it by 442. Changing
-- the programme or level of a published question is a new version, reviewed and approved like any other edit.
--
-- THE LEARNER COPY IS UNCHANGED. The 800 guard rebuilds a copy from answerKey, rubric and marking only, so none of these
-- keys enters a learner answer. The difficulty column of the copy (416, 1 to 3, not guarded) takes the item difficulty
-- (application side).
--
-- FAIL CLOSED WITHOUT IT. Before this file, 442 ignores extra keys, so these keys are stored unchecked by the database and
-- still checked by the application validator (src/lib/individual/scholar/library-meta.ts checkLibraryMeta, called by
-- validateLibraryQuestion at save, submit and publish).
--
-- RLS: unchanged.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK: docs/evidence/SQIE-HQ/ROLLBACK-995.sql drops the trigger and the function. The stored keys stay as data
--   (442 ignores them), so the rollback never refuses.
-- ====================================================================================================


-- ---- 1. the shape of a library question meta ------------------------------------------------------

create or replace function public.ckri_question_meta_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(
        jsonb_typeof(p) = 'object'
    and (p -> 'programme_code' is null or (jsonb_typeof(p -> 'programme_code') = 'string' and (p ->> 'programme_code') ~ '^[a-z0-9][a-z0-9-]{1,62}$'))
    and (p -> 'programme_label' is null or (jsonb_typeof(p -> 'programme_label') = 'string' and char_length(btrim(p ->> 'programme_label')) between 1 and 200))
    and (p -> 'qualification_level' is null or (jsonb_typeof(p -> 'qualification_level') = 'string' and (p ->> 'qualification_level') ~ '^[a-z][a-z0-9_]{1,60}$'))
    and (p -> 'qualification_label' is null or (jsonb_typeof(p -> 'qualification_label') = 'string' and char_length(btrim(p ->> 'qualification_label')) between 1 and 200))
    and (p -> 'difficulty' is null or (jsonb_typeof(p -> 'difficulty') = 'string' and p ->> 'difficulty' in ('introductory', 'intermediate', 'advanced')))
    and (p -> 'references' is null or (jsonb_typeof(p -> 'references') = 'array' and jsonb_array_length(p -> 'references') <= 40
         and not jsonb_path_exists(p, '$.references[*] ? (!(@.type() == "object"))')))
    and (p -> 'source_verification' is null or jsonb_typeof(p -> 'source_verification') = 'object')
    and (p -> 'competency_mapping' is null or jsonb_typeof(p -> 'competency_mapping') = 'object')
    and (p -> 'calculation' is null or jsonb_typeof(p -> 'calculation') = 'object')
    and (p -> 'misconception_tags' is null or (jsonb_typeof(p -> 'misconception_tags') = 'array' and jsonb_array_length(p -> 'misconception_tags') <= 20
         and not jsonb_path_exists(p, '$.misconception_tags[*] ? (!(@.type() == "string"))')
         and not exists (select 1 from jsonb_array_elements_text(p -> 'misconception_tags') as t(v) where char_length(t.v) not between 1 and 80)))
    and (p -> 'topic' is null or (jsonb_typeof(p -> 'topic') = 'string' and char_length(btrim(p ->> 'topic')) between 1 and 160))
    and (p -> 'question_type' is null or (jsonb_typeof(p -> 'question_type') = 'string' and (p ->> 'question_type') ~ '^[a-z_]{1,40}$'))
    and (p -> 'pilot_batch' is null or (jsonb_typeof(p -> 'pilot_batch') = 'string' and char_length(btrim(p ->> 'pilot_batch')) between 1 and 80)),
    false)
$$;


-- ---- 2. checked on every write of a revision question content --------------------------------------

create or replace function public.ckri_knowledge_version_meta_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from ckri_knowledge_resource r where r.id = new.resource_id and r.kind = 'revision_question')
     and not ckri_question_meta_ok(new.content) then
    raise exception 'ckri_knowledge_version: the programme, level, difficulty or provenance of this question are not in the shape the library keeps';
  end if;
  return new;
end;
$$;

drop trigger if exists ckri_knowledge_version_meta_guard on ckri_knowledge_version;
create trigger ckri_knowledge_version_meta_guard
  before insert or update of content on ckri_knowledge_version
  for each row execute function public.ckri_knowledge_version_meta_guard();

comment on function public.ckri_question_meta_ok(jsonb) is
  'SQIE-CLOSE-2026-11 WS-E (995). The optional metadata and provenance keys of a CKRI revision question: programme_code and _label, qualification_level and _label, difficulty (introductory, intermediate, advanced), references, source_verification, competency_mapping, calculation, misconception_tags, topic, question_type, pilot_batch.';

notify pgrst, 'reload schema';
