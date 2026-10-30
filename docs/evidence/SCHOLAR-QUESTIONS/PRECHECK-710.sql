-- PRECHECK 710 (read only). Run BEFORE applying 710. Changes nothing.
-- 1. The dependencies 710 needs: 372, 388, 416 (individual_scholar_question and its columns) and 442 (the CKRI knowledge
--    resources). Every row must say present.
select 'individual_scholar_question.answer (416)' as dependency,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_question' and column_name = 'answer') then 'present' else 'MISSING' end as state
union all
select 'individual_scholar_question.competency_id (388)',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_question' and column_name = 'competency_id') then 'present' else 'MISSING' end
union all
select 'ckri_knowledge_version (442)', case when to_regclass('public.ckri_knowledge_version') is not null then 'present' else 'MISSING' end
union all
select 'ckri_knowledge_resource (442)', case when to_regclass('public.ckri_knowledge_resource') is not null then 'present' else 'MISSING' end
union all
select 'ckri_knowledge_approved(uuid) (442)', case when to_regprocedure('public.ckri_knowledge_approved(uuid)') is not null then 'present' else 'MISSING' end;

-- 2. Whether 710 is already applied (expect none before the first run).
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_scholar_question' and column_name in ('library_resource_id', 'library_version_id')
 order by 1;

-- 3. The current constraint definitions 710 replaces.
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.individual_scholar_question'::regclass
   and conname in ('individual_scholar_question_kind_check', 'individual_scholar_question_options_check', 'individual_scholar_question_revision_check')
 order by conname;

-- 4. Row counts by kind, and the rows that already carry an answer.
select kind, count(*) as questions, count(answer) as with_answer, count(*) filter (where review_status <> 'private_formative') as not_private
  from individual_scholar_question group by kind order by kind;

-- 5. The governed library that 710 lets Revision reuse: knowledge resources of kind revision_question, by state.
select r.kind, v.state, count(*) as versions
  from ckri_knowledge_version v join ckri_knowledge_resource r on r.id = v.resource_id
 group by r.kind, v.state order by 1, 2;
