-- ROLLBACK 570 (COMPETEN-SCHOLAR-EXAM-PAPERS-01). Removes the four tables 570 created, children first.
-- Nothing else in the schema depends on them. Uploaded materials, sections and revision questions are untouched.
drop table if exists individual_scholar_exam_answer;
drop table if exists individual_scholar_exam_question;
drop table if exists individual_scholar_exam_paper;
drop table if exists individual_scholar_research_cache;
notify pgrst, 'reload schema';
