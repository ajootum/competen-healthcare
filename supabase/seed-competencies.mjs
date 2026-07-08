import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const DATA = [
  {
    name: "Core Nursing", library: "core", domains: [
      { name: "Domain 1: Assessment", competency: "Performs Comprehensive Patient Assessment", skills: [
        "Initial patient assessment","Focused patient assessment","Ongoing patient assessment",
        "Clinical deterioration assessment","Pain assessment","Functional assessment",
        "Temperature measurement","Pulse assessment","Respiratory rate assessment",
        "Blood pressure measurement","Oxygen saturation assessment",
        "Nursing documentation","Progress notes","Escalation documentation","Care plan documentation",
        "Trend analysis","Prioritization","Escalation of findings",
      ]},
      { name: "Domain 2: Airway", competency: "Maintains Airway Safety", skills: [
        "Airway assessment","Airway positioning","Airway adjunct insertion",
        "Oropharyngeal airway management","Nasopharyngeal airway management",
        "Oral suctioning","Nasopharyngeal suctioning","Tracheostomy suctioning",
        "Tracheostomy care","Recognition of airway obstruction","Emergency airway response",
      ]},
      { name: "Domain 3: Breathing", competency: "Provides Safe Respiratory Care", skills: [
        "Respiratory assessment","Pulse oximetry","Oxygen administration","Oxygen device selection",
        "Humidified oxygen management","Nebulizer administration","Chest physiotherapy monitoring",
        "Incentive spirometry","ABG sampling assistance","Respiratory distress recognition",
        "Respiratory deterioration escalation",
      ]},
      { name: "Domain 4: Circulation", competency: "Provides Safe Hemodynamic Care", skills: [
        "Cardiovascular assessment","Peripheral perfusion assessment","Capillary refill assessment",
        "Fluid balance monitoring","IV insertion","IV maintenance","Blood administration",
        "Blood sampling","Shock recognition","Fluid resuscitation monitoring",
      ]},
      { name: "Domain 5: Disability (Neuro)", competency: "Performs Neurological Assessment and Monitoring", skills: [
        "GCS assessment","AVPU assessment","Pupil assessment","Motor assessment","Sensory assessment",
        "Seizure monitoring","Seizure management","Raised ICP recognition",
        "Neuro deterioration escalation","Neuro documentation",
      ]},
      { name: "Domain 6: Exposure / Skin / Wound Care", competency: "Manages Skin and Wound Care", skills: [
        "Skin assessment","Pressure injury risk assessment","Pressure injury prevention",
        "Wound assessment","Wound dressing","Surgical wound care","Burn assessment",
        "Burn dressing","Device-related pressure prevention","Ostomy care",
      ]},
      { name: "Domain 7: Renal", competency: "Manages Renal Care", skills: [
        "Fluid balance monitoring","Urinary catheter insertion","Urinary catheter care",
        "Urine output assessment","Renal deterioration recognition","Dialysis access observation",
        "Electrolyte monitoring","AKI recognition",
      ]},
      { name: "Domain 8: GI & Nutrition", competency: "Manages GI and Nutritional Care", skills: [
        "Nutritional assessment","Anthropometric measurements","NG tube insertion",
        "NG tube verification","Enteral feeding","Feeding pump management",
        "Gastrostomy care","Aspiration prevention","Bowel assessment","Ostomy management",
      ]},
      { name: "Domain 9: Medication Safety", competency: "Administers Medications Safely", skills: [
        "Medication administration","High-alert medication administration","IV medication administration",
        "Medication reconciliation","Dosage calculation","Smart pump operation",
        "Medication documentation","Adverse drug reaction recognition","Medication error reporting",
      ]},
      { name: "Domain 10: Infection Prevention & Control", competency: "Applies Infection Prevention and Control", skills: [
        "Hand hygiene","PPE use","Isolation precautions","Aseptic technique","Sterile technique",
        "Environmental cleaning verification","Specimen collection","Sharps management","Exposure management",
      ]},
      { name: "Domain 11: Family, Psychosocial & Mental Health", competency: "Provides Psychosocial and Family Care", skills: [
        "Family assessment","Family education","Emotional support","Mental health screening",
        "Crisis intervention","Bereavement support","Family-centered rounds","Difficult conversations",
      ]},
      { name: "Domain 12: Quality & Safety", competency: "Contributes to Quality and Safety", skills: [
        "Incident reporting","Root cause participation","Risk identification","Falls prevention",
        "Safety rounds","Quality indicator monitoring","Audit participation",
      ]},
      { name: "Domain 13: Communication & Teamwork", competency: "Communicates and Collaborates Effectively", skills: [
        "SBAR communication","Clinical handover","Multidisciplinary rounds","Conflict resolution",
        "Escalation communication","Documentation communication","Team leadership",
      ]},
      { name: "Domain 14: End-of-Life & Palliative Care", competency: "Provides End-of-Life and Palliative Care", skills: [
        "Pain assessment","Symptom management","End-of-life care planning","Family support",
        "Comfort care measures","Cultural support","Bereavement care",
      ]},
      { name: "Domain 15: Neonatal Care", competency: "Provides Neonatal Care", skills: [
        "Neonatal assessment","Neonatal thermoregulation","Feeding support",
        "Neonatal resuscitation support","Growth monitoring","Developmental care","Family education",
      ]},
    ],
  },
  {
    name: "Intensive and Progressive Care", library: "specialty", domains: [
      { name: "Advanced Airway", competency: "Manages Advanced Airway", skills: [
        "ETT care","Cuff pressure management","Advanced suctioning","Airway emergency response",
      ]},
      { name: "Ventilation", competency: "Manages Mechanical Ventilation", skills: [
        "Ventilator setup","Ventilator checks","Ventilator troubleshooting",
        "ABG interpretation","Weaning monitoring",
      ]},
      { name: "Hemodynamics", competency: "Manages Hemodynamic Monitoring", skills: [
        "Arterial line management","CVP monitoring","Waveform interpretation","Vasoactive monitoring",
      ]},
      { name: "Neurocritical Care", competency: "Manages Neurocritical Care", skills: [
        "ICP monitoring","CPP calculation","EVD management","Continuous neuro assessment",
      ]},
    ],
  },
  {
    name: "Neurosurgical Nursing", library: "specialty", domains: [
      { name: "Neurosurgical Skills", competency: "Provides Neurosurgical Care", skills: [
        "EVD management","VP shunt assessment","ICP monitoring","Seizure management",
        "Post-neurosurgical assessment","Craniotomy care","Hydrocephalus assessment",
        "Neuro rehabilitation support",
      ]},
    ],
  },
  {
    name: "Operating Room Nursing", library: "specialty", domains: [
      { name: "Perioperative Skills", competency: "Provides Perioperative Care", skills: [
        "Scrubbing","Gowning","Gloving","Surgical counts","Instrument identification",
        "Sterile field maintenance","Positioning","Specimen management",
      ]},
    ],
  },
  {
    name: "Emergency Nursing", library: "specialty", domains: [
      { name: "Emergency Skills", competency: "Provides Emergency Care", skills: [
        "Triage","Trauma assessment","Defibrillation","Resuscitation support",
        "Emergency pharmacology","Mass casualty response",
      ]},
    ],
  },
  {
    name: "Rehabilitation Nursing", library: "specialty", domains: [
      { name: "Rehabilitation Skills", competency: "Provides Rehabilitation Care", skills: [
        "Functional assessment","Mobility support","Assistive device use",
        "Neurorehabilitation techniques","Discharge planning",
      ]},
    ],
  },
  {
    name: "Charge Nurse", library: "role", domains: [
      { name: "Leadership Skills", competency: "Leads Charge Nurse Functions", skills: [
        "Shift coordination","Patient flow management","Staffing allocation",
        "Escalation management","Bed management","Incident management","Team coaching",
      ]},
    ],
  },
  {
    name: "Nurse Educator", library: "role", domains: [
      { name: "Education Skills", competency: "Facilitates Nursing Education", skills: [
        "Needs assessment","Curriculum development","Competency assessment",
        "Teaching facilitation","Learning evaluation","LMS administration",
      ]},
    ],
  },
  {
    name: "Shift Supervisor", library: "role", domains: [
      { name: "Supervisory Skills", competency: "Manages Shift Supervision", skills: [
        "Operational oversight","Workforce management","Performance management",
        "Quality monitoring","Incident review",
      ]},
    ],
  },
  {
    name: "IPC Coordinator", library: "role", domains: [
      { name: "IPC Skills", competency: "Coordinates Infection Prevention", skills: [
        "Surveillance","Outbreak investigation","Audit management","Data analysis","IPC education",
      ]},
    ],
  },
];

async function seed() {
  // Get all framework IDs
  const { data: frameworks } = await db.from("frameworks").select("id,name");
  const fwMap = Object.fromEntries(frameworks.map(f => [f.name, f.id]));

  // Clear existing domains (cascades to competencies and skills)
  const fwIds = Object.values(fwMap);
  await db.from("framework_domains").delete().in("framework_id", fwIds);
  console.log("Cleared existing domains/competencies/skills");

  let totalDomains = 0, totalComps = 0, totalSkills = 0;

  for (const fw of DATA) {
    const fwId = fwMap[fw.name];
    if (!fwId) { console.warn(`Framework not found: ${fw.name}`); continue; }

    for (let di = 0; di < fw.domains.length; di++) {
      const dom = fw.domains[di];

      // Insert domain
      const { data: domRow, error: domErr } = await db
        .from("framework_domains")
        .insert({ framework_id: fwId, name: dom.name, sort_order: di + 1 })
        .select("id").single();
      if (domErr) { console.error(`Domain error (${dom.name}):`, domErr.message); continue; }
      totalDomains++;

      // Insert competency
      const { data: compRow, error: compErr } = await db
        .from("framework_competencies")
        .insert({ domain_id: domRow.id, name: dom.competency, sort_order: 1 })
        .select("id").single();
      if (compErr) { console.error(`Competency error (${dom.competency}):`, compErr.message); continue; }
      totalComps++;

      // Insert skills
      const skillRows = dom.skills.map((s, si) => ({
        competency_id: compRow.id,
        name: s,
        sort_order: si + 1,
      }));
      const { error: skillErr } = await db.from("competency_skills").insert(skillRows);
      if (skillErr) { console.error(`Skills error (${dom.name}):`, skillErr.message); continue; }
      totalSkills += dom.skills.length;
    }

    console.log(`✓ ${fw.name} (${fw.library})`);
  }

  console.log(`\nDone: ${totalDomains} domains, ${totalComps} competencies, ${totalSkills} skills`);
}

seed().catch(console.error);
