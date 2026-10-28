-- FINGERPRINT-630 (read only). Expect PRE 0 | 0 | 0 | 0 and APPLIED 1 | 0 | 1 | 13.
select
  (select count(*) from hq_capability where code = 'hq.platform.research.manage') as capability,
  (select count(*) from hq_position_capability where capability_code = 'hq.platform.research.manage') as grants,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'plat_research_requests') as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'plat_research_requests') as columns;
