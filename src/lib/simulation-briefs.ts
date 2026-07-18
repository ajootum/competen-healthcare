// Curated simulation scenario briefs — shared by the learner Simulation Lab
// (/dashboard/simulation) and the assessor Simulation & OSCE Centre
// (/assessor/simulation). Static governed content, not user data.

export type Brief = {
  id: number; title: string; category: string; difficulty: string; duration: string;
  patient: string; complaint: string;
  vitals: Record<string, string>;
  skills: string[];
};

export const BRIEFS: Brief[] = [
  {
    id: 1, title: "Cardiac Arrest — Adult Male, 58yrs", category: "Emergency", difficulty: "Hard", duration: "20 min",
    patient: "Male, 58 years · Medical Ward",
    complaint: "Found unresponsive by ward nurse. No pulse. Last seen 10 minutes ago.",
    vitals: { HR: "0 bpm", BP: "Unrecordable", SpO2: "Unmeasurable", RR: "Apnoeic", Temp: "36.8°C" },
    skills: ["BLS / CPR initiation", "AED use", "Airway management", "Team leadership", "ROSC recognition"],
  },
  {
    id: 2, title: "Respiratory Distress — Post-op Patient", category: "Critical Care", difficulty: "Medium", duration: "15 min",
    patient: "Female, 44 years · Post-op ward, Day 1 after laparotomy",
    complaint: "Increasingly short of breath and anxious. Dressing intact. IV line in situ.",
    vitals: { HR: "118 bpm", BP: "92/60 mmHg", SpO2: "88%", RR: "28/min", Temp: "38.2°C" },
    skills: ["Respiratory assessment", "Oxygen therapy", "Fluid management", "Sepsis recognition", "Escalation"],
  },
  {
    id: 3, title: "Neonatal Resuscitation at Delivery", category: "Pediatrics", difficulty: "Hard", duration: "20 min",
    patient: "Neonate, 0 minutes old · Labour ward, term delivery",
    complaint: "Baby delivered floppy, not breathing, and blue. Mother had prolonged labour.",
    vitals: { HR: "40 bpm", BP: "N/A", SpO2: "Unable", RR: "Absent", Temp: "36.0°C" },
    skills: ["NRP algorithm", "Bag-mask ventilation", "Neonatal compressions", "Warming & stimulation", "Family communication"],
  },
  {
    id: 4, title: "Anaphylaxis — Penicillin Reaction", category: "Emergency", difficulty: "Medium", duration: "15 min",
    patient: "Female, 31 years · Outpatient clinic, 10 min after IV penicillin",
    complaint: "Throat tightening, widespread urticaria, dizziness after 1.2g benzylpenicillin.",
    vitals: { HR: "132 bpm", BP: "78/40 mmHg", SpO2: "91%", RR: "24/min", Temp: "36.6°C" },
    skills: ["Anaphylaxis recognition", "Adrenaline administration", "Airway positioning", "IV fluids", "Documentation"],
  },
  {
    id: 5, title: "Safe Medication Administration — Ward Round", category: "Pharmacology", difficulty: "Easy", duration: "10 min",
    patient: "Male, 67 years · Medical ward, on 6 regular medications",
    complaint: "Routine morning medication round. New confusion noted overnight.",
    vitals: { HR: "88 bpm", BP: "148/92 mmHg", SpO2: "96%", RR: "18/min", Temp: "37.1°C" },
    skills: ["Medication 10 Rights", "Interaction check", "Capacity assessment", "Reconciliation", "Handover"],
  },
  {
    id: 6, title: "Sepsis Recognition & Bundle Initiation", category: "Critical Care", difficulty: "Hard", duration: "25 min",
    patient: "Female, 52 years · Medical ward, admitted 6 hours ago with UTI",
    complaint: "Urgent call — patient confused, shivering, looks unwell. NEWS score risen to 7.",
    vitals: { HR: "124 bpm", BP: "86/52 mmHg", SpO2: "93%", RR: "26/min", Temp: "38.9°C" },
    skills: ["qSOFA / NEWS scoring", "Sepsis 6 bundle", "Blood cultures", "IV access & fluids", "Senior escalation"],
  },
];

export function promptFor(b: Brief): string {
  const vitals = Object.entries(b.vitals).map(([k, v]) => `${k} ${v}`).join(", ");
  return `Run an interactive clinical simulation with me, one step at a time.

Scenario: ${b.title} (${b.category}, ${b.difficulty}).
Patient: ${b.patient}.
Presentation: ${b.complaint}
Initial vitals: ${vitals}.
Skills being practised: ${b.skills.join(", ")}.

Present the situation, then ask me what I do FIRST and wait for my answer. React realistically to each of my decisions (including deterioration if I choose poorly), keep each step short, and after the scenario ends give me a structured debrief with evidence-based rationale against each of the target skills.`;
}
