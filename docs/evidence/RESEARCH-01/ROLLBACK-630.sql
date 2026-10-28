-- ROLLBACK 630 (COMPETEN-RESEARCH-01 ADDENDUM V2). Staging first. Research usage rows are lost with the table.
drop table if exists plat_research_requests;
delete from hq_position_capability where capability_code = 'hq.platform.research.manage';
delete from hq_capability where code = 'hq.platform.research.manage';
notify pgrst, 'reload schema';
