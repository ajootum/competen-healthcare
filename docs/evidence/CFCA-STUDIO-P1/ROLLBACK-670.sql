-- ROLLBACK 670 (STAGING REHEARSAL ONLY). APPLY THIS FILE WHOLE.
-- Restores the 395 hash, the 660 DACUM wording and removes the two columns. Component tags and source refs
-- of any imported criteria are lost (the criteria themselves stay, untagged).
create or replace function public.competency_content_hash(p_competency uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select md5(jsonb_build_object(
    'name', c.name,
    'description', c.description,
    'learning_outcomes', c.learning_outcomes,
    'expected_level_id', c.expected_level_id,
    'practice_id', c.practice_id,
    'cpu_id', c.cpu_id,
    'risk_category', c.risk_category,
    'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb)
  )::text)
  from framework_competencies c
  where c.id = p_competency
$$;
update scoring_levels l
   set label = v.seeded, description = v.description
  from scoring_scales s,
       (values
         (0, 'Not yet demonstrated', 'No exposure to the competency, or not yet able to perform any part of it.'),
         (1, 'Performs parts with considerable assistance', 'Can perform some parts satisfactorily, but needs considerable assistance and supervision.'),
         (2, 'Performs with periodic assistance', 'Can perform it satisfactorily, but needs periodic assistance and supervision.'),
         (3, 'Performs without assistance', 'Can perform it satisfactorily without assistance or supervision.'),
         (4, 'Performs to a high standard', 'Can perform it without assistance, with more than acceptable speed and quality.'),
         (5, 'Performs with initiative and adaptability', 'Can perform it with initiative and adapt it to problem situations.'),
         (6, 'Leads and guides others', 'Can perform it with initiative and adaptability, and can lead others in performing it.')
       ) as v(score, seeded, description)
 where s.id = l.scale_id and s.name = 'DACUM 0-6' and l.score = v.score
   and l.description = 'Adapted from DACUM level of Achievement (Fearon 1998).';
drop index if exists idx_competency_skills_component;
alter table competency_skills drop constraint if exists competency_skills_source_ref_check;
alter table competency_skills drop column if exists source_ref;
alter table competency_skills drop column if exists component_code;
notify pgrst, 'reload schema';
