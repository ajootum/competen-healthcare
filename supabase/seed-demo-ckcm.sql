-- ============================================================
-- DEMO SEED: complete CKCM structure for end-to-end testing
-- Creates: Framework → Domain → Practice → CPU (with Assessment
-- Blueprint, Evidence Matrix, Critical Failures) → Competencies →
-- Skills → linked Learning Resource.
-- Safe to run once; skips itself if the demo framework already exists.
-- Delete the "Demo: Oxygen Therapy (CKCM)" framework to remove everything
-- (cascades), plus the demo learning resource.
-- ============================================================

do $$
declare
  v_fw   uuid;
  v_dom  uuid;
  v_pra  uuid;
  v_cpu  uuid;
  v_bp   uuid;
  v_c1   uuid;
  v_c2   uuid;
  v_c3   uuid;
  v_res  uuid;
begin
  if exists (select 1 from frameworks where name = 'Demo: Oxygen Therapy (CKCM)') then
    raise notice 'Demo framework already exists — skipping seed.';
    return;
  end if;

  -- Framework (published so it is assessable immediately)
  insert into frameworks (name, library, description, is_active, sort_order, pub_status)
  values ('Demo: Oxygen Therapy (CKCM)', 'core',
          'Demonstration framework showing the full CKCM hierarchy: Domain → Practice → CPU → Competency → Skill.',
          true, 99, 'published')
  returning id into v_fw;

  -- Domain
  insert into framework_domains (framework_id, name, sort_order)
  values (v_fw, 'Breathing', 1)
  returning id into v_dom;

  -- Practice
  insert into practices (domain_id, name, description, code, sort_order)
  values (v_dom, 'Oxygen Therapy', 'Safe assessment, delivery and monitoring of supplemental oxygen.', 'PRA-OXY-001', 1)
  returning id into v_pra;

  -- Clinical Practice Unit
  insert into clinical_practice_units
    (practice_id, name, description, code, risk_category, complexity, reassessment_months, pub_status, sort_order)
  values
    (v_pra, 'Safe Oxygen Administration',
     'Assess oxygen requirement, select and apply delivery devices, titrate flow, monitor saturation, escalate deterioration and document therapy.',
     'CPU-OXYSAFE-001', 'high', 2, 12, 'published', 1)
  returning id into v_cpu;

  -- Assessment Blueprint (multi-method, 2 assessors, majority consensus)
  insert into assessment_blueprints (cpu_id, min_score, min_assessors, consensus_rule, reassessment_months)
  values (v_cpu, 4, 2, 'majority', 12)
  returning id into v_bp;

  insert into blueprint_methods (blueprint_id, method, weight, is_required, min_evidence) values
    (v_bp, 'knowledge',          20, true, 1),
    (v_bp, 'skills_checklist',   25, true, 1),
    (v_bp, 'simulation',         25, true, 1),
    (v_bp, 'direct_observation', 30, true, 2);

  -- Evidence Matrix (Book I Ch.9 hierarchy)
  insert into evidence_matrix (cpu_id, evidence_type, min_quantity, weight, validity_months, is_critical, min_assessors) values
    (v_cpu, 'direct_observation', 2, 40, 12, true,  2),
    (v_cpu, 'simulation',         1, 25, 12, false, 1),
    (v_cpu, 'skills_checklist',   1, 20, 12, false, 1),
    (v_cpu, 'knowledge',          1, 15, 24, false, 1);

  -- Critical failures (block competency regardless of score)
  insert into critical_failure_rules (cpu_id, description) values
    (v_cpu, 'Failure to verify patient identity before commencing oxygen therapy'),
    (v_cpu, 'Failure to escalate SpO2 below prescribed target range'),
    (v_cpu, 'Administering oxygen against a documented prescription limit (e.g. CO2-retainer target)');

  -- Competencies (assigned into the CPU)
  insert into framework_competencies (domain_id, name, description, sort_order, practice_id, cpu_id, code, risk_category)
  values (v_dom, 'Assess oxygen requirement',
          'Recognise indications for supplemental oxygen using respiratory assessment and SpO2 targets.',
          1, v_pra, v_cpu, 'COMP-OXY-001', 'high')
  returning id into v_c1;

  insert into framework_competencies (domain_id, name, description, sort_order, practice_id, cpu_id, code, risk_category)
  values (v_dom, 'Administer oxygen via delivery devices',
          'Select, apply and titrate nasal cannula, simple face mask and non-rebreather devices safely.',
          2, v_pra, v_cpu, 'COMP-OXY-002', 'high')
  returning id into v_c2;

  insert into framework_competencies (domain_id, name, description, sort_order, practice_id, cpu_id, code, risk_category)
  values (v_dom, 'Monitor, escalate and document oxygen therapy',
          'Monitor response, recognise deterioration, escalate appropriately and document therapy accurately.',
          3, v_pra, v_cpu, 'COMP-OXY-003', 'standard')
  returning id into v_c3;

  -- Skills
  insert into competency_skills (competency_id, name, sort_order) values
    (v_c1, 'Perform respiratory assessment', 1),
    (v_c1, 'Interpret SpO2 against prescribed target', 2),
    (v_c2, 'Apply nasal cannula', 1),
    (v_c2, 'Apply face mask', 2),
    (v_c2, 'Adjust oxygen flow rate', 3),
    (v_c3, 'Monitor oxygen saturation trends', 1),
    (v_c3, 'Escalate deterioration', 2),
    (v_c3, 'Document oxygen therapy', 3);

  -- Learning resource linked to all three competencies (feeds Learning Pathways)
  insert into learning_resources (title, resource_type, description, is_active)
  values ('Oxygen Therapy Essentials (demo course)', 'course',
          'Covers indications, delivery devices, titration, monitoring and escalation for supplemental oxygen.', true)
  returning id into v_res;

  insert into resource_competencies (resource_id, competency_id) values
    (v_res, v_c1), (v_res, v_c2), (v_res, v_c3);

  raise notice 'Demo CKCM seeded: framework %, CPU %', v_fw, v_cpu;
end $$;
