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
-- A revision question content (442, formats by 800) MAY carry `meta`, an object of up to three keys, each optional:
--   programmes   1 to 10 individual_scholar_programme codes (the 387 code shape), the programmes it is written for
--   level        certificate, diploma, degree or postgraduate, the qualification level it is written for
--   difficulty   1, 2 or 3 (easier, standard, harder), the same scale 416 records on a learner question
-- Nothing else is allowed in `meta`. It is checked by ckri_question_meta_ok, called by a new BEFORE INSERT OR UPDATE OF
-- content trigger on ckri_knowledge_version for revision_question resources only.
--
-- WHY IN THE CONTENT. `meta` is inside the exact content an educator reviews (educator_reviewed_hash), a clinician
-- approves (395 decisions on the content hash) and a publisher publishes, and it is frozen with it by 442. Changing the
-- programme or level of a published question is a new version, reviewed and approved like any other edit.
--
-- THE LEARNER COPY IS UNCHANGED. The 800 guard rebuilds a copy from answerKey, rubric and marking only, so `meta` never
-- enters a learner answer. The difficulty column of the copy (416, not guarded) takes meta.difficulty (application side).
--
-- FAIL CLOSED WITHOUT IT. Before this file, 442 ignores extra keys, so a draft carrying `meta` is stored unchecked by
-- the database and still checked by the application validator (src/lib/individual/scholar/library-meta.ts
-- checkLibraryMeta, called by validateLibraryQuestion at save, submit and publish).
--
-- RLS: unchanged.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK: docs/evidence/SQIE-HQ/ROLLBACK-995.sql drops the trigger and the function. Stored `meta` keys stay as data
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
    p -> 'meta' is null
    or (
          jsonb_typeof(p -> 'meta') = 'object'
      and not exists (select 1 from jsonb_object_keys(p -> 'meta') as k(key) where k.key not in ('programmes', 'level', 'difficulty'))
      and (p -> 'meta' -> 'programmes' is null or (
            jsonb_typeof(p -> 'meta' -> 'programmes') = 'array'
        and jsonb_array_length(p -> 'meta' -> 'programmes') between 1 and 10
        and not jsonb_path_exists(p, '$.meta.programmes[*] ? (!(@.type() == "string") || !(@ like_regex "^[a-z0-9][a-z0-9-]{1,62}$"))')))
      and (p -> 'meta' -> 'level' is null or (
            jsonb_typeof(p -> 'meta' -> 'level') = 'string'
        and p -> 'meta' ->> 'level' in ('certificate', 'diploma', 'degree', 'postgraduate')))
      and (p -> 'meta' -> 'difficulty' is null or (
            jsonb_typeof(p -> 'meta' -> 'difficulty') = 'number'
        and (p -> 'meta' ->> 'difficulty') in ('1', '2', '3')))
    ),
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
    raise exception 'ckri_knowledge_version: the programme, level and difficulty of this question are not in the shape the library keeps';
  end if;
  return new;
end;
$$;

drop trigger if exists ckri_knowledge_version_meta_guard on ckri_knowledge_version;
create trigger ckri_knowledge_version_meta_guard
  before insert or update of content on ckri_knowledge_version
  for each row execute function public.ckri_knowledge_version_meta_guard();

comment on function public.ckri_question_meta_ok(jsonb) is
  'SQIE-CLOSE-2026-11 WS-E (995). The optional meta of a CKRI revision question: programmes (1-10 programme codes), level (certificate, diploma, degree, postgraduate), difficulty (1-3). Nothing else.';

notify pgrst, 'reload schema';
