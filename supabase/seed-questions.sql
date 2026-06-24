-- COMPETEN HEALTHCARE — Sample Question Bank
-- Run in Supabase SQL Editor to populate the question bank

insert into questions (content, type, options, correct_answer, explanation, category, difficulty)
select content, type, options::jsonb, correct_answer, explanation, category, difficulty
from (values

  -- EMERGENCY
  ('A patient''s SpO2 is 88% on room air. What is the FIRST intervention?',
   'mcq', '["Apply supplemental oxygen","Call the doctor immediately","Reposition the patient","Check the pulse oximeter probe"]',
   'Apply supplemental oxygen',
   'SpO2 below 90% requires immediate oxygen supplementation. Apply oxygen first, then reassess. Only escalate if it does not improve.',
   'Emergency', 'medium'),

  ('What is the correct compression-to-ventilation ratio for adult CPR?',
   'mcq', '["15:2","30:2","30:1","15:1"]',
   '30:2',
   'Per 2020 AHA guidelines: 30 chest compressions to 2 rescue breaths for adult BLS. Rate: 100–120 compressions per minute, depth: 5–6 cm.',
   'Emergency', 'easy'),

  ('Which of the following is NOT a sign of anaphylaxis?',
   'mcq', '["Urticaria","Bradycardia","Stridor","Hypotension"]',
   'Bradycardia',
   'Anaphylaxis causes tachycardia (increased heart rate), not bradycardia. Classic signs include urticaria, stridor, hypotension, and bronchospasm.',
   'Emergency', 'hard'),

  ('A patient has received epinephrine for anaphylaxis. After 5 minutes there is no improvement. What is the NEXT step?',
   'mcq', '["Repeat epinephrine 0.3–0.5 mg IM","Switch to IV antihistamine only","Wait 15 more minutes","Administer corticosteroids as first line"]',
   'Repeat epinephrine 0.3–0.5 mg IM',
   'Epinephrine can be repeated every 5–15 minutes if there is no improvement. It remains first-line treatment. Antihistamines and corticosteroids are adjuncts, not replacements.',
   'Emergency', 'hard'),

  ('What does the A in the ABCDE assessment stand for?',
   'mcq', '["Abdomen","Airway","Assessment","Alert"]',
   'Airway',
   'ABCDE: Airway, Breathing, Circulation, Disability, Exposure. Always assess and secure the airway first — a compromised airway is immediately life-threatening.',
   'Emergency', 'easy'),

  -- SAFETY
  ('According to WHO, at what point in patient care should you perform hand hygiene BEFORE touching a patient?',
   'mcq', '["Moment 1","Moment 2","Moment 3","Moment 4"]',
   'Moment 1',
   'WHO 5 Moments for Hand Hygiene: Moment 1 = Before touching a patient. This protects the patient from organisms carried on the nurse''s hands.',
   'Safety', 'easy'),

  ('Which PPE item should be put on LAST when preparing for a contact isolation patient?',
   'mcq', '["Gloves","Gown","Mask","Goggles"]',
   'Gloves',
   'Correct PPE donning order: Hand hygiene → Gown → Mask/Respirator → Goggles/Face shield → Gloves. Gloves are last so they can be easily changed and to protect other PPE.',
   'Safety', 'medium'),

  ('An IV cannula has been in place for 96 hours. What should you do?',
   'mcq', '["Leave it if no signs of infection","Remove and resite it","Add an antibiotic dressing","Flush it with heparin"]',
   'Remove and resite it',
   'NICE guidelines recommend peripheral IV cannulas be replaced every 72–96 hours, or sooner if signs of phlebitis or infection. Leaving a 96-hour cannula increases infection risk.',
   'Safety', 'medium'),

  -- PHARMACOLOGY
  ('You are about to administer morphine. The prescription reads "10 mg IV stat." The stock is 15 mg/mL. How many mL do you draw up?',
   'mcq', '["0.33 mL","0.67 mL","1.5 mL","1.0 mL"]',
   '0.67 mL',
   'Volume = Dose / Concentration = 10 mg ÷ 15 mg/mL = 0.67 mL. Always double-check opioid calculations with a second nurse.',
   'Pharmacology', 'hard'),

  ('Which of the following is a common sign of digoxin toxicity?',
   'mcq', '["Tachycardia","Visual disturbances (yellow/green halos)","Hypertension","Dry mouth"]',
   'Visual disturbances (yellow/green halos)',
   'Digoxin toxicity signs include bradycardia, heart block, nausea, vomiting, and visual disturbances (classically seeing yellow/green halos). Report immediately.',
   'Pharmacology', 'hard'),

  ('Before administering IV potassium chloride (KCl), what is the MOST important check?',
   'mcq', '["Confirm patient''s name","Verify the infusion rate — never give as IV bolus","Check if patient is allergic to potassium","Ensure patient has eaten"]',
   'Verify the infusion rate — never give as IV bolus',
   'IV KCl must NEVER be given as an undiluted bolus — it can cause fatal cardiac arrhythmias. Always dilute and infuse slowly (max 20 mmol/hour peripherally).',
   'Pharmacology', 'medium'),

  -- PEDIATRICS
  ('A 2-year-old child (12 kg) is in cardiac arrest. What is the correct compression depth?',
   'mcq', '["1 cm","2 cm","4 cm","6 cm"]',
   '4 cm',
   'Pediatric CPR compression depth: at least one-third of the chest AP diameter, approximately 4 cm in infants and 5 cm in children. Use 2 fingers for infants, 1–2 hands for children.',
   'Pediatrics', 'hard'),

  ('A 4-year-old presents with fever, stridor, and drooling. They are sitting upright and appear anxious. What condition do you suspect?',
   'mcq', '["Croup","Epiglottitis","Asthma","Foreign body aspiration"]',
   'Epiglottitis',
   'Epiglottitis classically presents with the 4 Ds: Drooling, Dysphagia, Distress, and tripod position. Do NOT examine the throat or cause distress — call for senior help immediately.',
   'Pediatrics', 'hard'),

  ('At what APGAR score at 5 minutes would you initiate newborn resuscitation?',
   'mcq', '["Below 9","Below 7","Below 5","Below 3"]',
   'Below 7',
   'An APGAR score of 7–10 is normal. A score of 4–6 requires stimulation and supplemental oxygen. A score of 0–3 requires immediate resuscitation.',
   'Pediatrics', 'medium'),

  -- CLINICAL
  ('A patient''s NEWS score is 7. What level of response is required?',
   'mcq', '["Routine nursing care","Urgent review by ward nurse","Emergency — call rapid response immediately","Increase observation frequency only"]',
   'Emergency — call rapid response immediately',
   'NEWS (National Early Warning Score): 0–4 = routine; 5–6 = urgent (ward review within 30 min); 7+ = emergency (immediate rapid response team activation).',
   'Clinical', 'medium'),

  ('During a transfusion, a patient develops a rash, fever, and chills 15 minutes after starting packed red cells. What is the FIRST action?',
   'mcq', '["Slow the transfusion rate","Stop the transfusion immediately","Give antihistamine and continue","Increase IV fluids"]',
   'Stop the transfusion immediately',
   'A suspected transfusion reaction requires immediate cessation. Disconnect the blood, maintain IV access with normal saline, notify the blood bank and senior clinician, and monitor vitals.',
   'Clinical', 'hard'),

  ('What is the normal range for adult serum sodium (Na+)?',
   'mcq', '["125–135 mmol/L","135–145 mmol/L","145–155 mmol/L","130–140 mmol/L"]',
   '135–145 mmol/L',
   'Normal serum sodium: 135–145 mmol/L. <135 = hyponatraemia; >145 = hypernatraemia. Both can cause neurological symptoms and require careful correction.',
   'Clinical', 'easy'),

  ('A patient with a Glasgow Coma Scale (GCS) of 8 needs what airway management?',
   'mcq', '["Simple positioning","Oropharyngeal airway only","Definitive airway (intubation)","Nasopharyngeal airway and oxygen"]',
   'Definitive airway (intubation)',
   'GCS ≤8 indicates inability to protect the airway. A definitive airway (cuffed endotracheal tube) is required. This is a senior/anaesthetics call — alert them immediately.',
   'Clinical', 'hard'),

  -- CRITICAL CARE
  ('What is the target mean arterial pressure (MAP) in septic shock per Surviving Sepsis guidelines?',
   'mcq', '["≥55 mmHg","≥65 mmHg","≥75 mmHg","≥85 mmHg"]',
   '≥65 mmHg',
   'Surviving Sepsis Campaign: target MAP ≥65 mmHg in septic shock, using vasopressors if fluids alone are insufficient. Norepinephrine is the first-line vasopressor.',
   'Critical Care', 'medium'),

  ('A mechanically ventilated patient has a plateau pressure of 34 cmH₂O. What is the clinical concern?',
   'mcq', '["Normal, no action needed","Risk of ventilator-induced lung injury","Insufficient PEEP","Patient is fighting the ventilator"]',
   'Risk of ventilator-induced lung injury',
   'Plateau pressure >30 cmH₂O is associated with ventilator-induced lung injury (volutrauma/barotrauma). Target plateau pressure ≤30 cmH₂O with lung-protective ventilation.',
   'Critical Care', 'hard')

) as t(content, type, options, correct_answer, explanation, category, difficulty)
where not exists (select 1 from questions limit 1);
