-- seed-cst-demo.sql — small demo dataset for the new Competency Studio stores so the surfaces show
-- live data instead of empty states. Idempotent (safe to re-run) and self-contained: it picks REAL
-- competencies by row-number, so no hard-coded IDs. Every row is tagged created_by_name = 'Demo Seed'
-- for easy cleanup (see the DELETE block at the bottom — commented out). Plain statements only, no do-blocks.
-- Demo rows are enterprise-wide (hospital_id null) so they are visible in every scope.

-- ── CST-105 Dependencies: a prerequisite chain (comp2←…←comp6) + a co-requisite + a recommended ──
with c as (select id, name, row_number() over (order by created_at, id) rn from framework_competencies)
insert into competency_dependencies (source_competency_id, target_competency_id, dependency_type, notes, created_by_name)
select s.id, t.id,
       case when s.rn between 2 and 6 then 'prerequisite'
            when s.rn = 8 then 'co_requisite'
            when s.rn = 10 then 'recommended' end,
       'Demo: seeded relationship', 'Demo Seed'
from c s join c t on t.rn = s.rn - 1
where s.rn in (2, 3, 4, 5, 6, 8, 10)
on conflict do nothing;

-- ── CST-108 Standards Mapping: map the first few competencies to a spread of standard bodies ──
with c as (select id, name, row_number() over (order by created_at, id) rn from framework_competencies)
insert into competency_standard_mappings (competency_id, standard_body, standard_ref, standard_title, coverage, created_by_name)
select c.id, m.body, m.ref, m.title, m.cov, 'Demo Seed'
from c
join (values
  (1, 'jci',             'PC.01.02.03', 'Patient Assessment',          'full'),
  (2, 'who',             'WHO-PSC-2.1', 'Patient Safety Curriculum',   'partial'),
  (3, 'safecare',        'SC-3.2.1',    'Clinical Care Standard',      'full'),
  (4, 'moh',             'MOH-CG-14',   'Clinical Guideline 14',       'reference'),
  (5, 'nursing_council', 'NC-4.1.2',    'Scope of Practice',           'full')
) m(rn, body, ref, title, cov) on m.rn = c.rn
on conflict do nothing;

-- ── CST-109 Package Manager: one published demo package + its first 5 competencies ──
insert into competency_packages (name, description, package_type, version, status, created_by_name)
select 'Demo: Critical Care Essentials', 'Seeded demo package — a bundle of core competencies.', 'specialty', '1.0.0', 'published', 'Demo Seed'
where not exists (select 1 from competency_packages where name = 'Demo: Critical Care Essentials');

with pkg as (select id from competency_packages where name = 'Demo: Critical Care Essentials' limit 1),
     c as (select id, name, row_number() over (order by created_at, id) rn from framework_competencies)
insert into competency_package_items (package_id, item_type, item_id, item_label, is_required)
select pkg.id, 'competency', c.id, c.name, true
from pkg, c
where c.rn <= 5
  and not exists (select 1 from competency_package_items i where i.package_id = pkg.id and i.item_id = c.id);

-- ── CST-006 Simulation Studio: three demo scenarios linked to real competencies ──
with c as (select id, name, row_number() over (order by created_at, id) rn from framework_competencies)
insert into simulation_scenarios (name, description, scenario_type, competency_id, competency_name, difficulty, participants, duration_min, status, version, created_by_name)
select v.nm, v.descr, v.stype, c.id, c.name, v.diff, v.parts, v.dur, v.status, '1.0.0', 'Demo Seed'
from (values
  ('Demo: Mock Code — Adult Cardiac Arrest', 'Team response to an adult cardiac arrest.',   'mock_code',       1, 'advanced',     5, 25, 'published'),
  ('Demo: Sepsis Recognition',               'Virtual patient with evolving sepsis.',        'virtual_patient', 2, 'intermediate', 1, 20, 'published'),
  ('Demo: Central Line Insertion',           'Procedure simulation with a safety checklist.', 'procedure',      3, 'intermediate', 2, 30, 'draft')
) v(nm, descr, stype, rn, diff, parts, dur, status)
join c on c.rn = v.rn
where not exists (select 1 from simulation_scenarios s where s.name = v.nm);

-- ── CLEANUP (uncomment to remove all demo data) ──
-- delete from competency_packages where name = 'Demo: Critical Care Essentials';  -- items cascade
-- delete from competency_dependencies where created_by_name = 'Demo Seed';
-- delete from competency_standard_mappings where created_by_name = 'Demo Seed';
-- delete from simulation_scenarios where created_by_name = 'Demo Seed';
