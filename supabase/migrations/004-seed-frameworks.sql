-- ============================================================
-- MIGRATION 004: SEED COMPETENCY FRAMEWORK DATA
-- Seeds all three libraries from Competency Frameworks 2.0.xlsx
-- Safe to run multiple times (guarded by NOT EXISTS check)
-- ============================================================

do $$ begin
  if exists (select 1 from frameworks limit 1) then
    raise notice 'Frameworks already seeded, skipping.';
    return;
  end if;

-- ════════════════════════════════════════════════════════════
-- LIBRARY 1: CORE NURSING COMPETENCY FRAMEWORK
-- ════════════════════════════════════════════════════════════

with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Core Nursing', 'core', 'Foundational competencies applicable to all registered nurses across all care settings', 1)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1,  'Domain 1: Assessment'),
    (2,  'Domain 2: Airway'),
    (3,  'Domain 3: Breathing'),
    (4,  'Domain 4: Circulation'),
    (5,  'Domain 5: Disability (Neurological)'),
    (6,  'Domain 6: Exposure / Skin / Wound Care'),
    (7,  'Domain 7: Renal'),
    (8,  'Domain 8: GI and Nutrition'),
    (9,  'Domain 9: Medication Safety'),
    (10, 'Domain 10: Infection Prevention and Control'),
    (11, 'Domain 11: Family, Psychosocial and Mental Health'),
    (12, 'Domain 12: Quality and Safety'),
    (13, 'Domain 13: Communication and Teamwork'),
    (14, 'Domain 14: End-of-Life and Palliative Care'),
    (15, 'Domain 15: Neonatal Care')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Assessment',                        1, 'Performs Comprehensive Patient Assessment'),
  ('Domain 1: Assessment',                        2, 'Prioritizes Clinical Findings'),
  ('Domain 1: Assessment',                        3, 'Recognizes Clinical Deterioration'),
  ('Domain 1: Assessment',                        4, 'Documents Assessment Findings'),
  ('Domain 1: Assessment',                        5, 'Escalates Concerns Appropriately'),
  ('Domain 2: Airway',                            1, 'Maintains Airway Safety'),
  ('Domain 2: Airway',                            2, 'Recognizes Airway Compromise'),
  ('Domain 2: Airway',                            3, 'Performs Basic Airway Interventions'),
  ('Domain 2: Airway',                            4, 'Escalates Airway Emergencies'),
  ('Domain 3: Breathing',                         1, 'Provides Safe Respiratory Care'),
  ('Domain 3: Breathing',                         2, 'Monitors Respiratory Status'),
  ('Domain 3: Breathing',                         3, 'Recognizes Respiratory Deterioration'),
  ('Domain 3: Breathing',                         4, 'Implements Respiratory Interventions'),
  ('Domain 4: Circulation',                       1, 'Assesses Hemodynamic Status'),
  ('Domain 4: Circulation',                       2, 'Maintains Circulatory Stability'),
  ('Domain 4: Circulation',                       3, 'Recognizes Shock States'),
  ('Domain 4: Circulation',                       4, 'Implements Circulatory Interventions'),
  ('Domain 5: Disability (Neurological)',         1, 'Performs Neurological Assessment'),
  ('Domain 5: Disability (Neurological)',         2, 'Recognizes Neurological Deterioration'),
  ('Domain 5: Disability (Neurological)',         3, 'Implements Neuroprotective Interventions'),
  ('Domain 5: Disability (Neurological)',         4, 'Escalates Neurological Emergencies'),
  ('Domain 6: Exposure / Skin / Wound Care',      1, 'Maintains Skin Integrity'),
  ('Domain 6: Exposure / Skin / Wound Care',      2, 'Performs Wound Assessment'),
  ('Domain 6: Exposure / Skin / Wound Care',      3, 'Implements Wound Care Interventions'),
  ('Domain 6: Exposure / Skin / Wound Care',      4, 'Prevents Pressure Injuries'),
  ('Domain 7: Renal',                             1, 'Assesses Renal Function'),
  ('Domain 7: Renal',                             2, 'Maintains Fluid Balance'),
  ('Domain 7: Renal',                             3, 'Recognizes Renal Deterioration'),
  ('Domain 7: Renal',                             4, 'Implements Renal Care Interventions'),
  ('Domain 8: GI and Nutrition',                  1, 'Assesses Nutritional Status'),
  ('Domain 8: GI and Nutrition',                  2, 'Administers Enteral Nutrition'),
  ('Domain 8: GI and Nutrition',                  3, 'Monitors GI Function'),
  ('Domain 8: GI and Nutrition',                  4, 'Supports Nutritional Recovery'),
  ('Domain 9: Medication Safety',                 1, 'Administers Medications Safely'),
  ('Domain 9: Medication Safety',                 2, 'Prevents Medication Errors'),
  ('Domain 9: Medication Safety',                 3, 'Monitors Medication Effects'),
  ('Domain 9: Medication Safety',                 4, 'Manages High-Risk Medications'),
  ('Domain 10: Infection Prevention and Control', 1, 'Implements IPC Measures'),
  ('Domain 10: Infection Prevention and Control', 2, 'Prevents Healthcare Associated Infections'),
  ('Domain 10: Infection Prevention and Control', 3, 'Manages Isolation Precautions'),
  ('Domain 10: Infection Prevention and Control', 4, 'Supports Antimicrobial Stewardship'),
  ('Domain 11: Family, Psychosocial and Mental Health', 1, 'Provides Family-Centered Care'),
  ('Domain 11: Family, Psychosocial and Mental Health', 2, 'Supports Psychosocial Wellbeing'),
  ('Domain 11: Family, Psychosocial and Mental Health', 3, 'Recognizes Mental Health Concerns'),
  ('Domain 11: Family, Psychosocial and Mental Health', 4, 'Facilitates Effective Family Communication'),
  ('Domain 12: Quality and Safety',               1, 'Promotes Patient Safety'),
  ('Domain 12: Quality and Safety',               2, 'Participates in Quality Improvement'),
  ('Domain 12: Quality and Safety',               3, 'Reports Safety Events'),
  ('Domain 12: Quality and Safety',               4, 'Uses Evidence-Based Practice'),
  ('Domain 13: Communication and Teamwork',       1, 'Communicates Effectively'),
  ('Domain 13: Communication and Teamwork',       2, 'Collaborates Within Teams'),
  ('Domain 13: Communication and Teamwork',       3, 'Manages Clinical Handover'),
  ('Domain 13: Communication and Teamwork',       4, 'Resolves Conflict Professionally'),
  ('Domain 14: End-of-Life and Palliative Care',  1, 'Provides Compassionate End-of-Life Care'),
  ('Domain 14: End-of-Life and Palliative Care',  2, 'Manages Comfort Measures'),
  ('Domain 14: End-of-Life and Palliative Care',  3, 'Supports Families During End-of-Life Care'),
  ('Domain 14: End-of-Life and Palliative Care',  4, 'Facilitates Goals-of-Care Discussions'),
  ('Domain 15: Neonatal Care',                    1, 'Assesses the Neonate'),
  ('Domain 15: Neonatal Care',                    2, 'Supports Neonatal Stability'),
  ('Domain 15: Neonatal Care',                    3, 'Recognizes Neonatal Deterioration'),
  ('Domain 15: Neonatal Care',                    4, 'Supports Family-Centered Neonatal Care')
) as v(dname, ord, comp) on d.name = v.dname;

-- ════════════════════════════════════════════════════════════
-- LIBRARY 2: SPECIALTY FRAMEWORKS
-- ════════════════════════════════════════════════════════════

-- ── Intensive and Progressive Care ──────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Intensive and Progressive Care', 'specialty', 'Advanced competencies for ICU and progressive care nurses', 1)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1, 'Domain 1: Advanced Airway Management'),
    (2, 'Domain 2: Mechanical Ventilation'),
    (3, 'Domain 3: Hemodynamic Monitoring'),
    (4, 'Domain 4: Critical Care Pharmacology'),
    (5, 'Domain 5: Advanced Neurological Monitoring'),
    (6, 'Domain 6: Sepsis Management'),
    (7, 'Domain 7: Emergency Response'),
    (8, 'Domain 8: End-of-Life Critical Care')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Advanced Airway Management',     1, 'Performs Advanced Airway Assessment'),
  ('Domain 1: Advanced Airway Management',     2, 'Maintains Artificial Airways Safely'),
  ('Domain 1: Advanced Airway Management',     3, 'Performs Airway Clearance Interventions'),
  ('Domain 1: Advanced Airway Management',     4, 'Responds to Airway Emergencies'),
  ('Domain 2: Mechanical Ventilation',         1, 'Manages Mechanically Ventilated Patients'),
  ('Domain 2: Mechanical Ventilation',         2, 'Monitors Ventilator Effectiveness'),
  ('Domain 2: Mechanical Ventilation',         3, 'Prevents Ventilator-Associated Complications'),
  ('Domain 2: Mechanical Ventilation',         4, 'Supports Ventilator Weaning'),
  ('Domain 3: Hemodynamic Monitoring',         1, 'Performs Hemodynamic Assessment'),
  ('Domain 3: Hemodynamic Monitoring',         2, 'Monitors Invasive Hemodynamic Devices'),
  ('Domain 3: Hemodynamic Monitoring',         3, 'Interprets Hemodynamic Data'),
  ('Domain 3: Hemodynamic Monitoring',         4, 'Implements Hemodynamic Interventions'),
  ('Domain 4: Critical Care Pharmacology',     1, 'Administers High-Risk Medications Safely'),
  ('Domain 4: Critical Care Pharmacology',     2, 'Manages Continuous Medication Infusions'),
  ('Domain 4: Critical Care Pharmacology',     3, 'Monitors Therapeutic and Adverse Effects'),
  ('Domain 4: Critical Care Pharmacology',     4, 'Promotes Medication Safety in Critical Care'),
  ('Domain 5: Advanced Neurological Monitoring', 1, 'Performs Advanced Neurological Assessment'),
  ('Domain 5: Advanced Neurological Monitoring', 2, 'Monitors Intracranial Dynamics'),
  ('Domain 5: Advanced Neurological Monitoring', 3, 'Manages Neurological Monitoring Devices'),
  ('Domain 5: Advanced Neurological Monitoring', 4, 'Responds to Neurological Deterioration'),
  ('Domain 6: Sepsis Management',              1, 'Recognizes Sepsis and Septic Shock'),
  ('Domain 6: Sepsis Management',              2, 'Implements Sepsis Management Bundles'),
  ('Domain 6: Sepsis Management',              3, 'Monitors Response to Sepsis Treatment'),
  ('Domain 6: Sepsis Management',              4, 'Prevents Sepsis-Related Complications'),
  ('Domain 7: Emergency Response',             1, 'Recognizes Clinical Deterioration'),
  ('Domain 7: Emergency Response',             2, 'Participates in Resuscitation'),
  ('Domain 7: Emergency Response',             3, 'Coordinates Emergency Care'),
  ('Domain 7: Emergency Response',             4, 'Supports Post-Resuscitation Care'),
  ('Domain 8: End-of-Life Critical Care',      1, 'Provides Compassionate End-of-Life Care'),
  ('Domain 8: End-of-Life Critical Care',      2, 'Manages End-of-Life Symptoms'),
  ('Domain 8: End-of-Life Critical Care',      3, 'Supports Patients and Families During End-of-Life Care'),
  ('Domain 8: End-of-Life Critical Care',      4, 'Facilitates Ethical and Goal-Concordant Care')
) as v(dname, ord, comp) on d.name = v.dname;

-- ── Neurosurgical Nursing ────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Neurosurgical Nursing', 'specialty', 'Competencies for nurses in neurosurgical and neuro-critical care settings', 2)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1, 'Domain 1: Neurological Assessment'),
    (2, 'Domain 2: ICP Management'),
    (3, 'Domain 3: EVD Management'),
    (4, 'Domain 4: Hydrocephalus Care'),
    (5, 'Domain 5: Seizure Management'),
    (6, 'Domain 6: Neuro Trauma Care'),
    (7, 'Domain 7: Postoperative Neurosurgical Care'),
    (8, 'Domain 8: Neuro Rehabilitation Support')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Neurological Assessment',          1, 'Performs Comprehensive Neurological Assessment'),
  ('Domain 1: Neurological Assessment',          2, 'Recognizes Neurological Deterioration'),
  ('Domain 1: Neurological Assessment',          3, 'Documents and Communicates Neurological Findings'),
  ('Domain 1: Neurological Assessment',          4, 'Supports Clinical Decision-Making in Neuro Care'),
  ('Domain 2: ICP Management',                   1, 'Monitors Intracranial Pressure'),
  ('Domain 2: ICP Management',                   2, 'Implements ICP Reduction Strategies'),
  ('Domain 2: ICP Management',                   3, 'Recognizes ICP Emergencies'),
  ('Domain 2: ICP Management',                   4, 'Evaluates Response to ICP Interventions'),
  ('Domain 3: EVD Management',                   1, 'Manages External Ventricular Drains Safely'),
  ('Domain 3: EVD Management',                   2, 'Maintains EVD Sterility'),
  ('Domain 3: EVD Management',                   3, 'Recognizes EVD Complications'),
  ('Domain 3: EVD Management',                   4, 'Documents EVD Monitoring'),
  ('Domain 4: Hydrocephalus Care',               1, 'Assesses Functionality of CSF Diversion'),
  ('Domain 4: Hydrocephalus Care',               2, 'Recognizes Complications'),
  ('Domain 4: Hydrocephalus Care',               3, 'Implements Protocols'),
  ('Domain 4: Hydrocephalus Care',               4, 'Educates Patients and Families'),
  ('Domain 5: Seizure Management',               1, 'Recognizes Seizure Activity'),
  ('Domain 5: Seizure Management',               2, 'Implements Seizure Precautions'),
  ('Domain 5: Seizure Management',               3, 'Provides Acute Seizure Management'),
  ('Domain 5: Seizure Management',               4, 'Monitors Post-Ictal Recovery'),
  ('Domain 6: Neuro Trauma Care',                1, 'Assesses Neurotrauma Patients'),
  ('Domain 6: Neuro Trauma Care',                2, 'Implements Neuroprotective Care'),
  ('Domain 6: Neuro Trauma Care',                3, 'Recognizes Secondary Brain Injury'),
  ('Domain 6: Neuro Trauma Care',                4, 'Supports Trauma Recovery'),
  ('Domain 7: Postoperative Neurosurgical Care', 1, 'Monitors Postoperative Recovery'),
  ('Domain 7: Postoperative Neurosurgical Care', 2, 'Recognizes Postoperative Complications'),
  ('Domain 7: Postoperative Neurosurgical Care', 3, 'Manages Neurosurgical Drains and Devices'),
  ('Domain 7: Postoperative Neurosurgical Care', 4, 'Facilitates Recovery Following Surgery'),
  ('Domain 8: Neuro Rehabilitation Support',     1, 'Promotes Functional Recovery'),
  ('Domain 8: Neuro Rehabilitation Support',     2, 'Supports Mobility and Positioning'),
  ('Domain 8: Neuro Rehabilitation Support',     3, 'Facilitates Family Engagement'),
  ('Domain 8: Neuro Rehabilitation Support',     4, 'Coordinates Rehabilitation Services')
) as v(dname, ord, comp) on d.name = v.dname;

-- ── Operating Room Nursing ───────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Operating Room Nursing', 'specialty', 'Perioperative competencies for scrub and circulating nurses', 3)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1, 'Domain 1: Perioperative Assessment'),
    (2, 'Domain 2: Surgical Asepsis'),
    (3, 'Domain 3: Surgical Instrument Management'),
    (4, 'Domain 4: Patient Positioning'),
    (5, 'Domain 5: Surgical Safety'),
    (6, 'Domain 6: Sterile Technique'),
    (7, 'Domain 7: Specimen Management')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Perioperative Assessment',         1, 'Performs Preoperative Assessment'),
  ('Domain 1: Perioperative Assessment',         2, 'Verifies Surgical Readiness'),
  ('Domain 1: Perioperative Assessment',         3, 'Identifies Surgical Risks'),
  ('Domain 1: Perioperative Assessment',         4, 'Coordinates Perioperative Planning'),
  ('Domain 2: Surgical Asepsis',                 1, 'Maintains Surgical Sterility'),
  ('Domain 2: Surgical Asepsis',                 2, 'Applies Aseptic Principles'),
  ('Domain 2: Surgical Asepsis',                 3, 'Prevents Surgical Site Infection'),
  ('Domain 2: Surgical Asepsis',                 4, 'Recognizes Breaks in Sterility'),
  ('Domain 3: Surgical Instrument Management',   1, 'Manages Surgical Instruments'),
  ('Domain 3: Surgical Instrument Management',   2, 'Maintains Instrument Integrity'),
  ('Domain 3: Surgical Instrument Management',   3, 'Performs Instrument Counts'),
  ('Domain 3: Surgical Instrument Management',   4, 'Coordinates Instrument Availability'),
  ('Domain 4: Patient Positioning',              1, 'Positions Patients Safely'),
  ('Domain 4: Patient Positioning',              2, 'Prevents Positioning Injuries'),
  ('Domain 4: Patient Positioning',              3, 'Maintains Physiological Stability During Positioning'),
  ('Domain 4: Patient Positioning',              4, 'Evaluates Positioning Outcomes'),
  ('Domain 5: Surgical Safety',                  1, 'Implements Surgical Safety Standards'),
  ('Domain 5: Surgical Safety',                  2, 'Conducts Surgical Safety Checklists'),
  ('Domain 5: Surgical Safety',                  3, 'Promotes Team Situational Awareness'),
  ('Domain 5: Surgical Safety',                  4, 'Manages Intraoperative Risks'),
  ('Domain 6: Sterile Technique',                1, 'Functions as a Scrub Nurse'),
  ('Domain 6: Sterile Technique',                2, 'Functions as a Circulating Nurse'),
  ('Domain 6: Sterile Technique',                3, 'Supports Surgical Procedures'),
  ('Domain 6: Sterile Technique',                4, 'Maintains Sterile Workflow'),
  ('Domain 7: Specimen Management',              1, 'Handles Surgical Specimens Safely'),
  ('Domain 7: Specimen Management',              2, 'Maintains Specimen Integrity'),
  ('Domain 7: Specimen Management',              3, 'Documents Specimen Collection'),
  ('Domain 7: Specimen Management',              4, 'Coordinates Laboratory Transfer')
) as v(dname, ord, comp) on d.name = v.dname;

-- ── Emergency Nursing ────────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Emergency Nursing', 'specialty', 'Competencies for emergency department nurses', 4)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1, 'Domain 1: Triage'),
    (2, 'Domain 2: Resuscitation'),
    (3, 'Domain 3: Trauma Management'),
    (4, 'Domain 4: Emergency Stabilization'),
    (5, 'Domain 5: Disaster Preparedness'),
    (6, 'Domain 6: Emergency Pharmacology')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Triage',                    1, 'Performs Emergency Triage'),
  ('Domain 1: Triage',                    2, 'Prioritizes Patients Based on Acuity'),
  ('Domain 1: Triage',                    3, 'Recognizes Time-Critical Conditions'),
  ('Domain 1: Triage',                    4, 'Coordinates Patient Flow'),
  ('Domain 2: Resuscitation',             1, 'Performs Initial Resuscitation'),
  ('Domain 2: Resuscitation',             2, 'Participates in Advanced Resuscitation'),
  ('Domain 2: Resuscitation',             3, 'Manages Airway Emergencies'),
  ('Domain 2: Resuscitation',             4, 'Supports Post-Resuscitation Care'),
  ('Domain 3: Trauma Management',         1, 'Performs Trauma Assessment'),
  ('Domain 3: Trauma Management',         2, 'Implements Trauma Interventions'),
  ('Domain 3: Trauma Management',         3, 'Coordinates Trauma Team Activities'),
  ('Domain 3: Trauma Management',         4, 'Monitors Trauma Recovery'),
  ('Domain 4: Emergency Stabilization',   1, 'Stabilizes Critically Ill Patients'),
  ('Domain 4: Emergency Stabilization',   2, 'Recognizes Deterioration'),
  ('Domain 4: Emergency Stabilization',   3, 'Escalates Emergency Care'),
  ('Domain 4: Emergency Stabilization',   4, 'Evaluates Stabilization Outcomes'),
  ('Domain 5: Disaster Preparedness',     1, 'Implements Disaster Plans'),
  ('Domain 5: Disaster Preparedness',     2, 'Participates in Emergency Responses'),
  ('Domain 5: Disaster Preparedness',     3, 'Manages Resource Allocation'),
  ('Domain 5: Disaster Preparedness',     4, 'Maintains Operational Readiness'),
  ('Domain 6: Emergency Pharmacology',    1, 'Administers Emergency Medications Safely'),
  ('Domain 6: Emergency Pharmacology',    2, 'Monitors Medication Response'),
  ('Domain 6: Emergency Pharmacology',    3, 'Prevents Medication Errors'),
  ('Domain 6: Emergency Pharmacology',    4, 'Supports Medication Preparedness')
) as v(dname, ord, comp) on d.name = v.dname;

-- ── Acute Care Nursing ───────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Acute Care Nursing', 'specialty', 'Competencies for general acute ward and step-down nurses', 5)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1, 'Domain 1: Acute Illness Management'),
    (2, 'Domain 2: Clinical Deterioration Recognition'),
    (3, 'Domain 3: Early Warning Systems'),
    (4, 'Domain 4: Escalation of Care'),
    (5, 'Domain 5: Acute Pharmacology')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Acute Illness Management',          1, 'Assesses Acutely Ill Patients'),
  ('Domain 1: Acute Illness Management',          2, 'Implements Acute Care Interventions'),
  ('Domain 1: Acute Illness Management',          3, 'Evaluates Patient Response'),
  ('Domain 1: Acute Illness Management',          4, 'Coordinates Acute Care Plans'),
  ('Domain 2: Clinical Deterioration Recognition',1, 'Recognizes Deterioration'),
  ('Domain 2: Clinical Deterioration Recognition',2, 'Escalates Care'),
  ('Domain 2: Clinical Deterioration Recognition',3, 'Implements Stabilization Measures'),
  ('Domain 2: Clinical Deterioration Recognition',4, 'Evaluates Outcomes'),
  ('Domain 3: Early Warning Systems',             1, 'Utilizes Early Warning Scores'),
  ('Domain 3: Early Warning Systems',             2, 'Interprets Trends'),
  ('Domain 3: Early Warning Systems',             3, 'Initiates Escalation Pathways'),
  ('Domain 3: Early Warning Systems',             4, 'Monitors Patient Recovery'),
  ('Domain 4: Escalation of Care',                1, 'Activates Rapid Response Systems'),
  ('Domain 4: Escalation of Care',                2, 'Coordinates Escalation'),
  ('Domain 4: Escalation of Care',                3, 'Communicates Effectively During Escalation'),
  ('Domain 4: Escalation of Care',                4, 'Supports Transition to Higher Levels of Care'),
  ('Domain 5: Acute Pharmacology',                1, 'Administers Acute Care Medications'),
  ('Domain 5: Acute Pharmacology',                2, 'Monitors Therapeutic Effects'),
  ('Domain 5: Acute Pharmacology',                3, 'Recognizes Adverse Reactions'),
  ('Domain 5: Acute Pharmacology',                4, 'Promotes Medication Safety')
) as v(dname, ord, comp) on d.name = v.dname;

-- ── Rehabilitation Nursing ───────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Rehabilitation Nursing', 'specialty', 'Competencies for nurses in rehabilitation and recovery settings', 6)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1, 'Domain 1: Functional Assessment'),
    (2, 'Domain 2: Mobility Promotion'),
    (3, 'Domain 3: Neuro Rehabilitation'),
    (4, 'Domain 4: Self-Care Training'),
    (5, 'Domain 5: Community Reintegration')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Functional Assessment',   1, 'Performs Functional Assessment'),
  ('Domain 1: Functional Assessment',   2, 'Identifies Rehabilitation Needs'),
  ('Domain 1: Functional Assessment',   3, 'Establishes Functional Goals'),
  ('Domain 1: Functional Assessment',   4, 'Evaluates Progress'),
  ('Domain 2: Mobility Promotion',      1, 'Supports Safe Mobility'),
  ('Domain 2: Mobility Promotion',      2, 'Prevents Mobility Complications'),
  ('Domain 2: Mobility Promotion',      3, 'Promotes Independence'),
  ('Domain 2: Mobility Promotion',      4, 'Evaluates Mobility Outcomes'),
  ('Domain 3: Neuro Rehabilitation',    1, 'Supports Neurological Recovery'),
  ('Domain 3: Neuro Rehabilitation',    2, 'Facilitates Neuroplasticity-Based Interventions'),
  ('Domain 3: Neuro Rehabilitation',    3, 'Prevents Secondary Complications'),
  ('Domain 3: Neuro Rehabilitation',    4, 'Monitors Rehabilitation Progress'),
  ('Domain 4: Self-Care Training',      1, 'Promotes Activities of Daily Living'),
  ('Domain 4: Self-Care Training',      2, 'Supports Adaptive Strategies'),
  ('Domain 4: Self-Care Training',      3, 'Educates Patients and Families'),
  ('Domain 4: Self-Care Training',      4, 'Monitors Self-Care Progress'),
  ('Domain 5: Community Reintegration', 1, 'Facilitates Discharge Planning'),
  ('Domain 5: Community Reintegration', 2, 'Coordinates Community Resources'),
  ('Domain 5: Community Reintegration', 3, 'Supports Social Participation'),
  ('Domain 5: Community Reintegration', 4, 'Evaluates Reintegration Outcomes')
) as v(dname, ord, comp) on d.name = v.dname;

-- ── Ambulatory Nursing ───────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Ambulatory Nursing', 'specialty', 'Competencies for outpatient and ambulatory care nurses', 7)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, v.name, v.ord from f, (values
    (1, 'Domain 1: Outpatient Assessment'),
    (2, 'Domain 2: Chronic Disease Management'),
    (3, 'Domain 3: Patient Education'),
    (4, 'Domain 4: Care Coordination'),
    (5, 'Domain 5: Preventive Care')
  ) as v(ord, name)
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d join (values
  ('Domain 1: Outpatient Assessment',      1, 'Performs Comprehensive Ambulatory Assessment'),
  ('Domain 1: Outpatient Assessment',      2, 'Identifies Risks'),
  ('Domain 1: Outpatient Assessment',      3, 'Develops Care Plans'),
  ('Domain 1: Outpatient Assessment',      4, 'Monitors Outcomes'),
  ('Domain 2: Chronic Disease Management', 1, 'Supports Chronic Disease Control'),
  ('Domain 2: Chronic Disease Management', 2, 'Promotes Self-Management'),
  ('Domain 2: Chronic Disease Management', 3, 'Monitors Disease Progression'),
  ('Domain 2: Chronic Disease Management', 4, 'Coordinates Follow-Up Care'),
  ('Domain 3: Patient Education',          1, 'Assesses Learning Needs'),
  ('Domain 3: Patient Education',          2, 'Provides Health Education'),
  ('Domain 3: Patient Education',          3, 'Evaluates Understanding'),
  ('Domain 3: Patient Education',          4, 'Reinforces Self-Care'),
  ('Domain 4: Care Coordination',          1, 'Coordinates Multidisciplinary Care'),
  ('Domain 4: Care Coordination',          2, 'Facilitates Referrals'),
  ('Domain 4: Care Coordination',          3, 'Supports Continuity of Care'),
  ('Domain 4: Care Coordination',          4, 'Monitors Care Transitions'),
  ('Domain 5: Preventive Care',            1, 'Promotes Health Screening'),
  ('Domain 5: Preventive Care',            2, 'Supports Immunization Programs'),
  ('Domain 5: Preventive Care',            3, 'Conducts Risk Reduction Counseling'),
  ('Domain 5: Preventive Care',            4, 'Evaluates Preventive Outcomes')
) as v(dname, ord, comp) on d.name = v.dname;

-- ════════════════════════════════════════════════════════════
-- LIBRARY 3: ROLE-BASED FRAMEWORKS
-- ════════════════════════════════════════════════════════════

-- ── Charge Nurse ─────────────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Charge Nurse', 'role', 'Leadership competencies for nurses in charge nurse positions', 1)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, 'Charge Nurse Competencies', 1 from f
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d cross join (values
  (1, 'Leads Clinical Operations'),
  (2, 'Coordinates Staffing'),
  (3, 'Manages Patient Flow'),
  (4, 'Supports Clinical Decision Making'),
  (5, 'Facilitates Team Communication'),
  (6, 'Escalates Operational Risks'),
  (7, 'Supports Quality and Safety')
) as v(ord, comp);

-- ── Nurse Educator ───────────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Nurse Educator', 'role', 'Educational competencies for nurse educators and clinical facilitators', 2)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, 'Nurse Educator Competencies', 1 from f
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d cross join (values
  (1, 'Assesses Learning Needs'),
  (2, 'Designs Educational Activities'),
  (3, 'Facilitates Learning'),
  (4, 'Evaluates Competence'),
  (5, 'Supports Professional Development'),
  (6, 'Uses Educational Technology')
) as v(ord, comp);

-- ── Shift Supervisor ─────────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Shift Supervisor', 'role', 'Operational competencies for shift supervisors and nurse managers', 3)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, 'Shift Supervisor Competencies', 1 from f
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d cross join (values
  (1, 'Oversees Clinical Operations'),
  (2, 'Manages Workforce Performance'),
  (3, 'Supports Patient Safety'),
  (4, 'Manages Escalations'),
  (5, 'Leads Incident Response'),
  (6, 'Monitors Quality Metrics')
) as v(ord, comp);

-- ── Spina Bifida Nurse Coordinator ───────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Spina Bifida Nurse Coordinator', 'role', 'Specialist coordination competencies for spina bifida nurse coordinators', 4)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, 'Spina Bifida Coordinator Competencies', 1 from f
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d cross join (values
  (1, 'Coordinates Multidisciplinary Care'),
  (2, 'Provides Family Education'),
  (3, 'Monitors Longitudinal Outcomes'),
  (4, 'Facilitates Care Transitions'),
  (5, 'Supports Community Integration')
) as v(ord, comp);

-- ── Nutrition Coordinator ────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('Nutrition Coordinator', 'role', 'Specialist competencies for nurse nutrition coordinators', 5)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, 'Nutrition Coordinator Competencies', 1 from f
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d cross join (values
  (1, 'Leads Nutrition Screening Programs'),
  (2, 'Coordinates Nutrition Interventions'),
  (3, 'Monitors Nutritional Outcomes'),
  (4, 'Supports Feeding Safety')
) as v(ord, comp);

-- ── IPC Coordinator ──────────────────────────────────────────
with f as (
  insert into frameworks (name, library, description, sort_order)
  values ('IPC Coordinator', 'role', 'Infection prevention and control coordinator competencies', 6)
  returning id
),
d as (
  insert into framework_domains (framework_id, name, sort_order)
  select f.id, 'IPC Coordinator Competencies', 1 from f
  returning id, name
)
insert into framework_competencies (domain_id, name, sort_order)
select d.id, v.comp, v.ord from d cross join (values
  (1, 'Leads Infection Prevention Programs'),
  (2, 'Conducts Surveillance'),
  (3, 'Investigates Outbreaks'),
  (4, 'Supports IPC Education'),
  (5, 'Monitors Compliance'),
  (6, 'Drives Improvement Initiatives')
) as v(ord, comp);

end $$;
