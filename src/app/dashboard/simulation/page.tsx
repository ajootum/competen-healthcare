import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SimulationLab, { type Scenario, type GovernedCase } from "./SimulationLab";

// Simulation Lab (Simulation Lab Redesign spec). Text-based AI simulations
// that genuinely run: each scenario launches an interactive session with the
// AI Clinical Coach (present → decide → consequence → debrief), alongside the
// governed case studies. No fake progress rings, XP, streaks or leaderboards —
// completion tracking, branching engines and vitals monitors are registered
// gaps, not simulated UI.

type Brief = {
  id: number; title: string; category: string; difficulty: string; duration: string;
  patient: string; complaint: string;
  vitals: Record<string, string>;
  skills: string[];
};

const BRIEFS: Brief[] = [
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

function promptFor(b: Brief): string {
  const vitals = Object.entries(b.vitals).map(([k, v]) => `${k} ${v}`).join(", ");
  return `Run an interactive clinical simulation with me, one step at a time.

Scenario: ${b.title} (${b.category}, ${b.difficulty}).
Patient: ${b.patient}.
Presentation: ${b.complaint}
Initial vitals: ${vitals}.
Skills being practised: ${b.skills.join(", ")}.

Present the situation, then ask me what I do FIRST and wait for my answer. React realistically to each of my decisions (including deterioration if I choose poorly), keep each step short, and after the scenario ends give me a structured debrief with evidence-based rationale against each of the target skills.`;
}

export default async function SimulationLabPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: rawCases } = await admin.from("clinical_cases")
    .select("id, title, difficulty, clinical_practice_units(name)")
    .neq("status", "retired").order("created_at", { ascending: false }).limit(8);

  const scenarios: Scenario[] = BRIEFS.map(b => ({
    id: String(b.id), title: b.title, category: b.category, difficulty: b.difficulty,
    duration: b.duration, description: b.complaint, skills: b.skills, prompt: promptFor(b),
  }));
  const cases: GovernedCase[] = ((rawCases ?? []) as unknown as {
    id: string; title: string; difficulty: string | null; clinical_practice_units: { name: string } | null;
  }[]).map(c => ({ id: c.id, title: c.title, difficulty: c.difficulty, cpuName: c.clinical_practice_units?.name ?? null }));

  const STEPS = [
    { n: "1", icon: "📋", title: "Choose Scenario", sub: "Pick a scenario matching your specialty or learning goal" },
    { n: "2", icon: "🔍", title: "Assess & Analyze", sub: "Review the patient, vitals and history the Coach presents" },
    { n: "3", icon: "✅", title: "Make Decisions", sub: "Choose interventions and see realistic consequences" },
    { n: "4", icon: "💬", title: "Debrief & Learn", sub: "Get evidence-based rationale against each target skill" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex items-start gap-3 mb-5">
        <span className="w-11 h-11 rounded-xl bg-teal-50 flex items-center justify-center text-xl shrink-0">🩺</span>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Simulation Lab</h1>
          <p className="text-gray-400 text-sm mt-0.5">Practice clinical decision-making in realistic, risk-free environments.</p>
        </div>
      </div>

      {/* Hero */}
      <div className="bg-[#0a2e38] rounded-2xl p-6 mb-5 text-white">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex-1 min-w-[260px]">
            <span className="text-[9px] font-bold bg-amber-400 text-amber-950 px-2 py-0.5 rounded">AI-POWERED</span>
            <h2 className="text-lg font-bold mt-2">Interactive Clinical Simulations</h2>
            <p className="text-[12px] text-teal-100/70 mt-1 leading-relaxed max-w-lg">
              Text-based scenarios run live by the AI Clinical Coach — it presents the patient, reacts
              realistically to every decision you make, and debriefs you with evidence-based rationale.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-teal-200/70">
              <span>🧾 Evidence-based scenarios</span>
              <span>💬 Realistic consequences</span>
              <span>⚡ Instant debrief</span>
              <span>🏥 {cases.length} governed case stud{cases.length === 1 ? "y" : "ies"}</span>
            </div>
          </div>
          <div className="bg-white/10 rounded-xl p-4 text-center shrink-0">
            <p className="text-3xl font-extrabold text-teal-300">{scenarios.length + cases.length}</p>
            <p className="text-[10px] text-teal-100/70">scenarios available</p>
          </div>
        </div>
      </div>

      <SimulationLab scenarios={scenarios} cases={cases} />

      {/* How it works */}
      <div className="mt-6 bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-4">How Simulation Works</h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-teal-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{s.n}</span>
              <div>
                <p className="text-xs font-semibold text-gray-800">{s.icon} {s.title}</p>
                <p className="text-[10px] text-gray-400 leading-snug mt-0.5">{s.sub}</p>
              </div>
              {i < STEPS.length - 1 && <span className="hidden xl:block text-gray-200 ml-auto">→</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
