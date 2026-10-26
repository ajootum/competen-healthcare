-- VERIFY 570 (coordinator, read-only): table | RLS | policies | rows
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', c.relname), false, true, '')))[1]::text as rows
from pg_class c where c.relkind = 'r' and c.relname in ('individual_scholar_exam_paper', 'individual_scholar_exam_question', 'individual_scholar_exam_answer', 'individual_scholar_research_cache') order by 1;
