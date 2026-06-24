export type Lesson = {
  title: string;
  icon: string;
  duration: string;
  content: { heading: string; body: string }[];
};

export const lessonContent: Record<string, Lesson[]> = {
  "Basic Life Support (BLS)": [
    {
      title: "Introduction to BLS",
      icon: "❤️",
      duration: "20 min",
      content: [
        { heading: "What is Basic Life Support?", body: "Basic Life Support (BLS) is the foundation of emergency cardiac care. It encompasses the skills of cardiopulmonary resuscitation (CPR), airway management, and the use of an Automated External Defibrillator (AED). Every nurse must be proficient in BLS as cardiac arrest can occur in any clinical or community setting across East Africa." },
        { heading: "The Chain of Survival", body: "The 2020 AHA/ERC Chain of Survival has five links: (1) Early recognition and call for help, (2) Early CPR to buy time, (3) Rapid defibrillation, (4) Advanced resuscitation by EMS or hospital teams, (5) Post-cardiac arrest care and recovery. Each link is equally important — a weak link breaks the chain." },
        { heading: "Recognising Cardiac Arrest", body: "A patient in cardiac arrest will be unresponsive and not breathing normally (may have agonal gasps — do NOT confuse with normal breathing). Check responsiveness: tap shoulders and shout 'Are you alright?' Check breathing: look for chest rise for no more than 10 seconds. If absent or abnormal, begin CPR immediately." },
      ],
    },
    {
      title: "CPR Technique",
      icon: "🫀",
      duration: "30 min",
      content: [
        { heading: "Chest Compressions", body: "Position: heel of your hand on the centre of the chest (lower half of sternum). Interlock fingers and keep arms straight. Compress to a depth of 5–6 cm at a rate of 100–120 compressions per minute. Allow full chest recoil between compressions — do not lean. Minimise interruptions: pause CPR for no more than 10 seconds." },
        { heading: "Rescue Breaths", body: "After 30 compressions, give 2 rescue breaths. Tilt head, lift chin to open airway. Pinch the nose, seal lips over mouth, and give a breath over 1 second — watch for chest rise. If the first breath does not cause chest rise, recheck airway position before attempting the second. Continue 30:2 ratio." },
        { heading: "AED Use", body: "Attach AED pads as soon as the device is available — do not delay CPR to wait for it. Place one pad below the right clavicle and the other in the left lateral position (mid-axillary line, 5th intercostal space). Follow AED prompts. Clear the patient before analysis and shock. Resume CPR immediately after shock without waiting to check pulse." },
      ],
    },
    {
      title: "Special Situations in BLS",
      icon: "🚨",
      duration: "20 min",
      content: [
        { heading: "Drowning", body: "For drowning victims, start with 5 rescue breaths before beginning chest compressions. Hypoxia is the primary cause — oxygenation is the priority. If you are alone with a drowning victim, perform 1 minute of CPR before leaving to call for help." },
        { heading: "Pregnant Patients", body: "For a pregnant patient (uterus above the umbilicus): manually displace the uterus to the left OR tilt the patient 15–30° to the left using a wedge under the right hip. Perform CPR in the same manner. Prepare for emergency caesarean section — delivery within 5 minutes of arrest improves both maternal and foetal outcomes." },
        { heading: "CPR in Resource-Limited Settings", body: "In many East African facilities, AEDs may not be immediately available. Prioritise: early recognition, early call for help, high-quality CPR. Even without equipment, excellent CPR saves lives. Know your facility's resuscitation protocol and the location of emergency equipment." },
      ],
    },
  ],

  "Infection Prevention & Control": [
    {
      title: "Standard Precautions",
      icon: "🛡️",
      duration: "25 min",
      content: [
        { heading: "What Are Standard Precautions?", body: "Standard precautions are the minimum infection control measures applied to ALL patients regardless of diagnosis or infectious status. They are based on the principle that blood, body fluids, secretions, and excretions may contain transmissible infectious agents. Consistent application protects both patients and healthcare workers." },
        { heading: "Hand Hygiene — The WHO 5 Moments", body: "The WHO 5 Moments for Hand Hygiene: (1) BEFORE touching a patient, (2) BEFORE a clean/aseptic procedure, (3) AFTER body fluid exposure risk, (4) AFTER touching a patient, (5) AFTER touching patient surroundings. Use alcohol-based hand rub for 20–30 seconds when hands are visibly clean. Use soap and water for 40–60 seconds when hands are visibly soiled or after caring for patients with C. difficile." },
        { heading: "PPE Selection", body: "Select PPE based on the expected exposure: Gloves for contact with blood, body fluids, mucous membranes, non-intact skin. Apron/Gown for risk of body fluid splashing. Mask for respiratory droplets (surgical mask) or airborne pathogens (N95 respirator). Goggles/Face shield for risk of blood or body fluid splash to eyes. Don PPE before entering, doff immediately after leaving the patient area." },
      ],
    },
    {
      title: "Transmission-Based Precautions",
      icon: "🔴",
      duration: "20 min",
      content: [
        { heading: "Contact Precautions", body: "Used for: MRSA, VRE, C. difficile, scabies, wound infections. Single room or cohorting with patients with the same organism. Gloves and gown on entry. Dedicate equipment (stethoscope, blood pressure cuff) to the patient. Clean and disinfect shared equipment between patients. Hand hygiene with soap and water (not hand rub) for C. difficile." },
        { heading: "Droplet Precautions", body: "Used for: Influenza, meningococcal disease, pertussis, mumps, rubella. Surgical mask when within 1 metre of the patient. Single room preferred; if not available, maintain 1 metre distance between patients. Patient should wear a surgical mask when transported." },
        { heading: "Airborne Precautions", body: "Used for: Tuberculosis (TB), measles, varicella. This is critical in East Africa where TB prevalence is high. Negative pressure room if available. N95 respirator (fit-tested) for all staff. Door must remain closed. Patient wears surgical mask when outside the room. Healthcare workers with HIV should not routinely care for open TB patients without senior guidance." },
      ],
    },
    {
      title: "Aseptic Technique & Sharps Safety",
      icon: "💉",
      duration: "20 min",
      content: [
        { heading: "Aseptic Non-Touch Technique (ANTT)", body: "ANTT is the application of aseptic principles to clinical procedures. Key concept: identify and protect 'key parts' (parts of equipment that if contaminated will introduce infection — e.g., needle, syringe tip, wound interior). Never touch key parts. Use sterile field for invasive procedures. Maintain sterility throughout the procedure." },
        { heading: "Sharps Safety", body: "Never re-cap needles using two hands. Use a single-hand scoop technique if re-capping is unavoidable. Dispose of sharps immediately at the point of use into an approved sharps container (do not overfill beyond the fill line). Never pass sharps directly hand-to-hand. In case of needlestick: encourage bleeding, wash with soap and water, report immediately, follow PEP (Post-Exposure Prophylaxis) protocol for HIV exposure." },
      ],
    },
  ],

  "Pediatric Emergency Care": [
    {
      title: "Paediatric Assessment Triangle",
      icon: "👶",
      duration: "25 min",
      content: [
        { heading: "The PAT Framework", body: "The Pediatric Assessment Triangle (PAT) allows rapid visual assessment in 30–60 seconds without touching the child. Three components: (1) Appearance — tone, interactivity, consolability, look/gaze, speech/cry. (2) Work of Breathing — abnormal sounds, positioning, retractions, nasal flaring. (3) Circulation to Skin — pallor, mottling, cyanosis. The PAT determines the urgency of intervention." },
        { heading: "ETAT+ Triage", body: "Emergency Triage Assessment and Treatment (ETAT+) is the WHO-recommended framework for East African hospitals. Triage children into: EMERGENCY (immediate, life-threatening) → PRIORITY (at risk, should be seen quickly) → QUEUE (stable, can wait). Emergency signs: airway obstruction, severe respiratory distress, central cyanosis, shock, coma, convulsions, severe dehydration." },
        { heading: "Vital Sign Norms by Age", body: "Know normal ranges: Newborn: HR 120–160, RR 30–60, SBP 60–90. Infant (1–12m): HR 100–160, RR 30–60, SBP 70–90. Toddler (1–3y): HR 90–150, RR 24–40, SBP 80–95. Preschool (3–5y): HR 80–140, RR 22–34, SBP 80–100. School age (6–12y): HR 70–120, RR 18–30, SBP 85–110. Any deviation with clinical signs warrants immediate escalation." },
      ],
    },
    {
      title: "Paediatric Resuscitation",
      icon: "🚑",
      duration: "30 min",
      content: [
        { heading: "Paediatric CPR", body: "Compression to ventilation ratio: 15:2 for two-rescuer paediatric CPR (30:2 if alone). Depth: one-third of chest AP diameter (~4 cm infant, ~5 cm child). Technique: two fingers for infants, one or two hands for children. Rate: 100–120/min. Commence with 5 initial rescue breaths before compressions in paediatric cardiac arrest (unlike adults)." },
        { heading: "Neonatal Resuscitation", body: "At birth: Warm, dry, stimulate. Reassess at 60 seconds. If not breathing: open airway, give 5 inflation breaths (pressure 30 cmH₂O, term infant). Reassess HR. If HR <60 or absent: chest compressions at 3:1 ratio with ventilation. Call for senior help. Administer adrenaline if no response. APGAR score at 1 and 5 minutes guides decision-making." },
        { heading: "Fluid Resuscitation in Children", body: "For shock in children: 10–20 mL/kg of isotonic crystalloid (normal saline or Ringer's lactate) over 15–30 minutes. Reassess after each bolus. In severe malnutrition, reduce to 5–10 mL/kg and monitor closely for fluid overload (cardiac failure, hepatomegaly). For dengue or suspected fluid-responsive shock, follow disease-specific protocols." },
      ],
    },
  ],

  "Safe Medication Administration": [
    {
      title: "The 10 Rights of Medication",
      icon: "💊",
      duration: "20 min",
      content: [
        { heading: "Rights 1–5", body: "(1) Right PATIENT — check two identifiers (name + DOB or ID number). (2) Right DRUG — read the label three times (when taking from shelf, when preparing, when administering). Never assume. (3) Right DOSE — calculate carefully; have another nurse double-check high-risk medications. (4) Right ROUTE — oral, IV, IM, SC, sublingual — each has different absorption and risk profile. (5) Right TIME — some medications require exact timing (e.g., insulin before meals, antibiotics at set intervals)." },
        { heading: "Rights 6–10", body: "(6) Right DOCUMENTATION — record immediately after administration, not before. (7) Right RESPONSE — assess the patient after giving medication for therapeutic effect and adverse reactions. (8) Right REASON — understand why the patient is receiving this medication. (9) Right FORM — tablet vs. capsule vs. liquid — do not crush extended-release tablets. (10) Right to REFUSE — respect patient autonomy; document and notify prescriber if refused." },
      ],
    },
    {
      title: "High-Risk Medications",
      icon: "⚠️",
      duration: "25 min",
      content: [
        { heading: "LASA Drugs", body: "Look-Alike Sound-Alike (LASA) drugs are a leading cause of medication errors. Examples relevant to East Africa: Morphine/Midazolam, Hydralazine/Hydroxyzine, Metformin/Metronidazole, Dopamine/Dobutamine. Strategies: read labels carefully, store separately, use tall-man lettering on labels, always check with a second nurse." },
        { heading: "IV Potassium Chloride (KCl)", body: "NEVER administer undiluted IV KCl — it can cause fatal cardiac arrhythmias. Must be diluted (max 40 mmol/L peripherally) and infused slowly (max 10–20 mmol/hour peripherally, up to 40 mmol/hour via central line with cardiac monitoring). Keep concentrated KCl ampoules segregated with clear warning labels." },
        { heading: "Insulin Safety", body: "Insulin requires two-nurse verification. Common errors: wrong type (rapid vs. long-acting), wrong dose (unit vs. mL confusion — use insulin-specific syringes only), wrong timing. Signs of hypoglycaemia: sweating, tremor, confusion, tachycardia. Keep dextrose 50% available. Check BG before and after administration." },
      ],
    },
    {
      title: "Drug Calculations",
      icon: "🧮",
      duration: "20 min",
      content: [
        { heading: "The Basic Formula", body: "Volume to administer = (Dose required ÷ Dose available) × Volume of stock. Example: Prescribed 250 mg of amoxicillin. Stock: 125 mg/5 mL. Volume = (250 ÷ 125) × 5 = 10 mL. Always label the calculation, have it checked for high-risk drugs, and double-check units (mg vs. mcg — 1000× difference)." },
        { heading: "IV Drip Rates", body: "Drops per minute = (Volume in mL × Drop factor) ÷ Time in minutes. Standard giving sets deliver 20 drops/mL (adult). Paediatric sets deliver 60 drops/mL. Example: 500 mL over 4 hours, adult set = (500 × 20) ÷ 240 = 41.7 ≈ 42 drops/min. For infusion pumps: rate (mL/hr) = Volume ÷ Time in hours." },
      ],
    },
  ],

  "Critical Care Fundamentals": [
    {
      title: "Recognising the Deteriorating Patient",
      icon: "📊",
      duration: "30 min",
      content: [
        { heading: "NEWS2 Scoring", body: "The National Early Warning Score 2 (NEWS2) assigns points to six physiological parameters: Respiration rate, Oxygen saturations, Systolic BP, Pulse rate, Level of consciousness (ACVPU), Temperature. Plus supplemental oxygen. Total score determines response: 0–4 routine monitoring; 5–6 urgent ward review; 7+ emergency response team activation. Calculate NEWS2 at every set of observations." },
        { heading: "SBAR Communication", body: "When escalating a deteriorating patient, use SBAR: Situation (who you are, patient name, why you're calling), Background (admission diagnosis, relevant history, current medications), Assessment (what you think is wrong — be specific: 'I think this patient may be in septic shock'), Recommendation (what you want — 'I need you to come and review this patient now'). Practise SBAR for every handover." },
        { heading: "The ABCDE Approach", body: "Systematic assessment of any critically ill patient: Airway (patent? protected? threatened?), Breathing (rate, work, SpO₂, auscultation), Circulation (HR, BP, cap refill, skin, urine output), Disability (GCS, pupils, BG), Exposure (temperature, rashes, wounds, drains). Treat life-threatening problems at each step before moving to the next. Reassess after every intervention." },
      ],
    },
    {
      title: "Sepsis Recognition & Management",
      icon: "🔥",
      duration: "25 min",
      content: [
        { heading: "Sepsis Definition", body: "Sepsis (Sepsis-3 definition): life-threatening organ dysfunction caused by a dysregulated host response to infection. SOFA score ≥2 points from baseline. Septic shock: sepsis + vasopressor requirement to maintain MAP ≥65 mmHg + serum lactate >2 mmol/L despite adequate fluid resuscitation. In-hospital mortality of septic shock exceeds 40% in East Africa." },
        { heading: "The Sepsis 1-Hour Bundle", body: "Within 1 hour of recognising sepsis: (1) Measure lactate — repeat if >2 mmol/L. (2) Blood cultures before antibiotics (do not delay antibiotics for cultures). (3) Broad-spectrum antibiotics immediately. (4) 30 mL/kg crystalloid IV for hypotension or lactate ≥4. (5) Vasopressors (norepinephrine) if MAP <65 mmHg despite fluids. Document time of each action." },
        { heading: "Fluid Resuscitation in Sepsis", body: "Give 30 mL/kg of IV crystalloid (normal saline or Ringer's lactate) for sepsis-induced hypoperfusion within the first 3 hours. Reassess after each 500 mL bolus — stop if signs of fluid overload (increased RR, SpO₂ drop, raised JVP, pulmonary oedema). Balanced crystalloids preferred over normal saline to reduce hyperchloraemic acidosis." },
      ],
    },
  ],

  "Airway Management": [
    {
      title: "Airway Anatomy & Assessment",
      icon: "🫁",
      duration: "20 min",
      content: [
        { heading: "Upper Airway Anatomy", body: "The upper airway includes the nose, mouth, pharynx, and larynx. The glottis is the narrowest part of the adult airway. In children, the narrowest point is the cricoid cartilage (subglottic). Understanding anatomy is essential for effective airway management. Key landmark: thyroid cartilage (Adam's apple) → cricothyroid membrane → cricoid cartilage." },
        { heading: "Airway Assessment — LEMON", body: "Predict a difficult airway using LEMON: L — Look externally (obesity, trauma, beard, small mouth, large teeth, short neck), E — Evaluate 3-3-2 (3 fingers mouth opening, 3 fingers thyromental distance, 2 fingers to hyoid), M — Mallampati score (higher class = more difficult), O — Obstruction (stridor, hoarse voice, drooling), N — Neck mobility (limited = difficult laryngoscopy)." },
        { heading: "Airway Obstruction — Signs", body: "Partial obstruction: noisy breathing (stridor, gurgling, snoring), increased work of breathing, tripod positioning. Complete obstruction: no breath sounds, paradoxical chest movement, cyanosis, rapidly deteriorating consciousness. Act immediately. Call for help and initiate airway manoeuvres." },
      ],
    },
    {
      title: "Basic Airway Manoeuvres",
      icon: "🫁",
      duration: "25 min",
      content: [
        { heading: "Head-Tilt Chin-Lift", body: "For unconscious patients without suspected cervical spine injury: place one hand on the forehead, tilt the head back gently. With two fingers of the other hand under the chin (bony part), lift the chin upward and forward. This moves the tongue away from the posterior pharynx. Do NOT perform if C-spine injury is suspected — use jaw thrust." },
        { heading: "Jaw Thrust", body: "For patients with suspected cervical spine injury (trauma): stand at the patient's head, place fingers behind the mandibular angles, apply upward and forward pressure. Keep mouth open with thumbs. This is the safest airway-opening technique when C-spine injury cannot be excluded. Requires practice — get a senior colleague to demonstrate." },
        { heading: "Oropharyngeal Airway (OPA)", body: "Used in unconscious patients without a gag reflex (GCS ≤8). Sizing: measure from the centre of the lips to the angle of the jaw. Insert upside down (concave up), rotate 180° as it passes the hard palate, until flange rests on the lips. NEVER use in a conscious patient — may cause vomiting and laryngospasm. If patient gags, remove immediately." },
      ],
    },
  ],

  "Wound Care & Dressing Techniques": [
    {
      title: "Wound Assessment",
      icon: "🩹",
      duration: "20 min",
      content: [
        { heading: "The TIME Framework", body: "Assess chronic wounds using TIME: T — Tissue (what is the wound bed? Slough=yellow, necrotic=black, granulation=red, epithelialising=pink). I — Infection/Inflammation (signs: increased pain, odour, exudate, peri-wound erythema, warmth). M — Moisture balance (too dry = dehydrated wound bed; too wet = maceration of surrounding skin). E — Edge (is the wound edge advancing? Undermining or tunnelling?)." },
        { heading: "Wound Measurement", body: "Measure and document: Length × Width in cm (use clock method: 12 o'clock = towards patient's head). Depth using a sterile probe. Presence of undermining (tissue destruction under intact skin at wound edges) and tunnelling (narrow channels extending from the wound). Photograph wounds where possible — with consent — to track progression." },
        { heading: "Signs of Wound Infection", body: "Local signs: increased pain, warmth, erythema extending >2 cm from wound edge, odour, purulent exudate, wound breakdown. Systemic signs: fever, rigors, raised WBC, elevated CRP. Swab for culture BEFORE starting antibiotics (clean wound first, swab from viable tissue — not pus). Biofilm: chronic infection with no systemic signs but wound not healing despite optimal care." },
      ],
    },
    {
      title: "Dressing Selection & Technique",
      icon: "🩼",
      duration: "25 min",
      content: [
        { heading: "Choosing the Right Dressing", body: "Match dressing to wound need: Dry/necrotic: hydrocolloid, hydrogel (donate moisture). Heavily exuding: alginate, hydrofibre (absorb moisture). Infected: silver-containing dressings. Clean granulating: simple non-adherent dressing. Cavity wounds: cavity filler (alginate rope, hydrofibre ribbon). Fragile peri-wound skin: silicone-bordered dressings." },
        { heading: "Aseptic Dressing Change Technique", body: "Prepare: gather equipment, wash hands, don apron and gloves. Remove old dressing with non-dominant hand, discard. Change gloves. Clean wound with normal saline (for most wounds) or potable water in community settings — irrigation with syringe at 8 psi. Apply appropriate dressing. Secure without tension. Document wound appearance, dressing used, and next change date." },
        { heading: "Pressure Injury Prevention", body: "Prevention is better than treatment. Risk assessment: Braden Scale ≤18 = at risk. Prevention bundle: (1) Reposition every 2 hours (offload bony prominences), (2) Skin inspection with each repositioning, (3) Moisture management (incontinence care), (4) Nutrition optimisation, (5) Pressure-redistributing mattress/cushion for high-risk patients. Document repositioning schedule." },
      ],
    },
  ],

  "Patient Assessment Framework": [
    {
      title: "Systematic Patient Assessment",
      icon: "🩺",
      duration: "25 min",
      content: [
        { heading: "Head-to-Toe Assessment", body: "Perform a structured head-to-toe assessment for all admitted patients and as part of shift handover. Sequence: General appearance → Neurological (GCS, pupils) → Respiratory (rate, effort, SpO₂, auscultation) → Cardiovascular (HR, BP, cap refill, peripheral pulses, JVP) → Abdomen (inspection, auscultation, palpation) → Musculoskeletal (mobility, skin integrity) → Lines, tubes, drains. Document findings clearly." },
        { heading: "History Taking — SAMPLE", body: "SAMPLE history: S — Signs and Symptoms (what is the patient experiencing?), A — Allergies (drugs, food, latex — what reaction?), M — Medications (current medications, when last taken), P — Past medical history and Pertinent history, L — Last oral intake (important for anaesthesia), E — Events leading to current presentation. Use open questions first, then closed questions to clarify." },
        { heading: "Pain Assessment", body: "Use validated tools: NRS (0–10 numerical rating) for adults who can communicate. FLACC (Face, Legs, Activity, Cry, Consolability) for children under 7 and non-verbal patients. Abbey Pain Scale for dementia. Assess: location, quality, radiation, severity, timing, aggravating/relieving factors. Reassess 30–60 min after analgesia. Document pre and post-intervention pain scores." },
      ],
    },
    {
      title: "Vital Signs & Early Warning",
      icon: "📈",
      duration: "20 min",
      content: [
        { heading: "Taking Accurate Vital Signs", body: "Temperature: oral preferred (tympanic if oral not possible). Ensure thermometer calibrated and cleaned between patients. Pulse: count apical pulse for 60 seconds in arrhythmia, for 15–30 seconds × multiplier in regular rhythms. Note rate, rhythm, volume. BP: correct cuff size critical — too small gives falsely high readings. Support arm at heart level. Two readings, take average." },
        { heading: "Interpreting Vital Signs", body: "Never interpret a single parameter in isolation. Trends matter more than single readings. A HR of 100 bpm may be normal post-exercise or significant in a post-op patient. Look at the whole picture: a patient with HR 110, RR 24, and systolic BP 88 has three concerning parameters — escalate immediately even if each individually might seem borderline." },
        { heading: "Urine Output Monitoring", body: "Normal urine output: ≥0.5 mL/kg/hour in adults. Oliguria (<400 mL/day) indicates potential renal impairment. Anuria (<100 mL/day) is a medical emergency. For patients at risk (post-op, sepsis, nephrotoxic drugs, pre-existing renal disease): catheterise with urometer and chart hourly. Report sustained low output to the medical team." },
      ],
    },
  ],
};
