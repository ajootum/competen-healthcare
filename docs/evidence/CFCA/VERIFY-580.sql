-- VERIFY 580. Part A is read-only. Part B runs in a transaction that ends in ROLLBACK.

-- A1. The capability exists once, and its only live grant is quality_council_member. Expect 1 row.
select position_code, capability_code from hq_position_capability
 where capability_code = 'hq.quality.competency.publish' and effective_to is null;

-- A2. Fifteen exclusion pairs, the last being competency author / competency publish. Expect 15, then 1.
select count(*) as pairs from hq_capability_exclusions();
select * from hq_capability_exclusions()
 where capability_a = 'hq.quality.competency.author' and capability_b = 'hq.quality.competency.publish';

-- A3. No position holds an excluded pair live. Expect zero rows.
select g1.position_code, g1.capability_code, g2.capability_code
  from hq_position_capability g1
  join hq_position_capability g2 on g2.position_code = g1.position_code
  join hq_capability_exclusions() e on e.capability_a = g1.capability_code and e.capability_b = g2.capability_code
 where g1.effective_to is null and g2.effective_to is null;

-- B. The 500 guard refuses granting publish to the Competency Author position. Expect an exception
-- naming 'a competency author cannot publish competency frameworks'.
begin;
insert into hq_position_capability (position_code, capability_code, source)
values ('competency_author', 'hq.quality.competency.publish', 'position_default');
rollback;
