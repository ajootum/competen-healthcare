-- VERIFY-620: read-only. Every row must say true.
select 'capability hq.platform.governance.manage exists, granted to no position' as check,
  exists (select 1 from hq_capability where code = 'hq.platform.governance.manage')
  and not exists (select 1 from hq_position_capability where capability_code = 'hq.platform.governance.manage') as ok
union all select 'the capability is platform-sensitive', hq_capability_sensitive_class('hq.platform.governance.manage') = 'platform'
union all select '511 sensitive classes unchanged', hq_capability_sensitive_class('hq.quality.clinical.approve') = 'clinical'
  and hq_capability_sensitive_class('hq.platform.ai.manage') = 'financial' and hq_capability_sensitive_class('hq.platform.users.view') = 'platform'
  and hq_capability_sensitive_class('hq.platform.home.view') is null
union all select 'one structure, scholar, on product line individual',
  (select count(*) = 1 and bool_and(product_line_code = 'individual') from hq_gov_structure where code = 'scholar')
union all select 'version 1 published, effective 27 Oct 2026, no open version',
  (select count(*) = 1 and bool_and(status = 'published' and effective_from = date '2026-10-27') from hq_gov_structure_version where structure_code = 'scholar')
union all select 'version 1 holds the 610 structure: 5 units, 21 positions, 7 relationships, 20 links, 1 pair, 3 levels',
  (select jsonb_array_length(definition -> 'units') = 5 and jsonb_array_length(definition -> 'positions') = 21
      and jsonb_array_length(definition -> 'relationships') = 7 and jsonb_array_length(definition -> 'links') = 20
      and jsonb_array_length(definition -> 'independence_pairs') = 1 and jsonb_array_length(definition -> 'levels') = 3
     from hq_gov_structure_version where structure_code = 'scholar' and version_no = 1)
union all select 'Holdings Technology Services still has no level',
  (select level is null and kind = 'service' from hq_gov_body where code = 'holdings_technology_services')
union all select 'every 610 body belongs to scholar and was introduced by version 1',
  (select bool_and(structure_code = 'scholar' and introduced_version_id is not null) from hq_gov_body)
union all select 'version 1 projects onto the live tables without error',
  hq_gov_studio_check((select id from hq_gov_structure_version where structure_code = 'scholar' and version_no = 1)) is null
union all select 'relationship types 8, and relation is a foreign key now', (select count(*) = 8 from hq_gov_relation_type)
  and exists (select 1 from information_schema.table_constraints where constraint_name = 'hq_gov_delegation_relation_fk')
union all select '610 decisions untouched: 1 interim, 6 pending, 0 approved',
  (select count(*) filter (where status = 'interim') = 1 and count(*) filter (where status = 'pending') = 6
      and count(*) filter (where status = 'approved') = 0 from hq_gov_delegation)
union all select 'nobody appointed', (select count(*) from hq_gov_seat_appointment where status <> 'ended') = 0;
