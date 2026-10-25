-- VERIFY 438. Read-only. Every line should read true.
-- Proves: the competency author capability and position exist, the capability is granted to the new position ONLY
-- (no existing position gains authoring), and the position holds nothing else beyond the HQ landing page.

select 'capability exists' as check, exists (select 1 from hq_capability where code = 'hq.quality.competency.author') as ok
union all select 'position exists', exists (select 1 from hq_position where code = 'competency_curator')
union all select 'granted to no existing position', not exists (
  select 1 from hq_position_capability where capability_code = 'hq.quality.competency.author' and effective_to is null and position_code <> 'competency_curator')
union all select 'the position holds exactly author and home', (
  select coalesce(array_agg(capability_code order by capability_code), '{}') = array['hq.platform.home.view', 'hq.quality.competency.author']
  from hq_position_capability where position_code = 'competency_curator' and effective_to is null)
union all select 'no clinical approve or publish right on it', not exists (
  select 1 from hq_position_capability where position_code = 'competency_curator' and effective_to is null
    and capability_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'hq.quality.case.publish'))
union all select 'nobody is appointed by the migration', not exists (
  select 1 from ogs_office_appointments where role = 'competency_curator');
