-- ====================================================================================================
-- CFCA REFERENCE EXPORT -- READ-ONLY. One SELECT, one row, one jsonb document. Writes nothing.
--
-- For the owner to run by hand in the PRODUCTION SQL editor, under an owner GO that names this export.
-- Save the single cell it returns as supabase/reference/cfca-export.json (UTF-8, unchanged) and commit it.
-- scripts/seed-staging-cfca.ts mirrors that file onto STAGING (it refuses production).
--
-- WHAT IT EXPORTS. The non-personal clinical reference structure of the CKCM spine (migration 011):
-- shared frameworks (hospital_id null) that hold a practice or a competency linked to one, with their
-- domains, practices, clinical practice units, assessment blueprints and methods, evidence matrix rows,
-- critical failure rules and framework competencies. Every column is named -- no row is exported whole,
-- so no owner, creator or person column can travel. Hospital-owned frameworks are NOT exported, only
-- counted (hospital_owned_practices), so a gap is visible instead of silent.
--
-- No column added after migration 338 is read, so this runs on production as it is today.
-- ====================================================================================================
with fw as (
  select f.*
    from frameworks f
   where f.hospital_id is null
     and exists (select 1 from framework_domains d where d.framework_id = f.id
       and (exists (select 1 from practices p where p.domain_id = d.id)
         or exists (select 1 from framework_competencies c where c.domain_id = d.id and (c.practice_id is not null or c.cpu_id is not null))))
),
dom as (select d.* from framework_domains d where d.framework_id in (select id from fw)),
pra as (select p.* from practices p where p.domain_id in (select id from dom)),
cpu as (select u.* from clinical_practice_units u where u.practice_id in (select id from pra)),
bp  as (select b.* from assessment_blueprints b where b.cpu_id in (select id from cpu))
select jsonb_build_object(
  'format', 'competen-cfca-export-v1',
  'exported_at', now(),
  'frameworks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'library', library,
      'description', description, 'is_active', is_active, 'sort_order', sort_order, 'pub_status', pub_status,
      'parent_framework_id', parent_framework_id) order by name), '[]'::jsonb) from fw),
  'domains', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'framework_id', framework_id, 'name', name,
      'sort_order', sort_order) order by framework_id, sort_order, name), '[]'::jsonb) from dom),
  'practices', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'domain_id', domain_id, 'name', name,
      'description', description, 'code', code, 'sort_order', sort_order) order by code, name), '[]'::jsonb) from pra),
  'cpus', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'practice_id', practice_id, 'name', name,
      'description', description, 'code', code, 'risk_category', risk_category, 'complexity', complexity,
      'reassessment_months', reassessment_months, 'pub_status', pub_status, 'version_num', version_num,
      'sort_order', sort_order) order by code, name), '[]'::jsonb) from cpu),
  'blueprints', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'cpu_id', cpu_id, 'min_score', min_score,
      'min_assessors', min_assessors, 'consensus_rule', consensus_rule, 'reassessment_months', reassessment_months)
      order by cpu_id), '[]'::jsonb) from bp),
  'blueprint_methods', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'blueprint_id', m.blueprint_id,
      'method', m.method, 'weight', m.weight, 'is_required', m.is_required, 'min_evidence', m.min_evidence)
      order by m.blueprint_id, m.method), '[]'::jsonb) from blueprint_methods m where m.blueprint_id in (select id from bp)),
  'evidence_matrix', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'cpu_id', e.cpu_id,
      'evidence_type', e.evidence_type, 'min_quantity', e.min_quantity, 'weight', e.weight,
      'validity_months', e.validity_months, 'is_critical', e.is_critical, 'min_assessors', e.min_assessors)
      order by e.cpu_id, e.evidence_type), '[]'::jsonb) from evidence_matrix e where e.cpu_id in (select id from cpu)),
  'critical_failure_rules', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'cpu_id', r.cpu_id,
      'description', r.description) order by r.cpu_id, r.description), '[]'::jsonb)
      from critical_failure_rules r where r.cpu_id in (select id from cpu)),
  'competencies', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'domain_id', c.domain_id, 'name', c.name,
      'description', c.description, 'code', c.code, 'sort_order', c.sort_order, 'practice_id', c.practice_id,
      'cpu_id', c.cpu_id, 'risk_category', c.risk_category) order by c.domain_id, c.sort_order, c.name), '[]'::jsonb)
      from framework_competencies c where c.domain_id in (select id from dom)),
  'hospital_owned_practices', (select count(*) from practices p join framework_domains d on d.id = p.domain_id
      join frameworks f on f.id = d.framework_id where f.hospital_id is not null)
) as cfca_export
