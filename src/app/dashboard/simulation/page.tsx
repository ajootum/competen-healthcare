"use client";
import { useState } from "react";

const scenarios = [
  {
    id: 1, title: "Cardiac Arrest — Adult Male, 58yrs", category: "Emergency", difficulty: "Hard", duration: "20 min",
    patient: "Male, 58 years · Kenyatta National Hospital, Medical Ward",
    complaint: "Found unresponsive by ward nurse. No pulse. Last seen 10 minutes ago.",
    vitals: { hr: "0 bpm", bp: "Unrecordable", spo2: "Unmeasurable", rr: "Apnoeic", temp: "36.8°C" },
    skills: ["BLS / CPR initiation", "AED use", "Airway management", "Team leadership & communication", "ROSC recognition"],
  },
  {
    id: 2, title: "Respiratory Distress — Post-op Patient", category: "Critical Care", difficulty: "Medium", duration: "15 min",
    patient: "Female, 44 years · Post-op ward, Day 1 after laparotomy",
    complaint: "Patient is increasingly short of breath and anxious. Dressing intact. IV line in situ.",
    vitals: { hr: "118 bpm", bp: "92/60 mmHg", spo2: "88%", rr: "28 breaths/min", temp: "38.2°C" },
    skills: ["Respiratory assessment", "Oxygen therapy", "Fluid management", "Sepsis recognition", "Escalation protocol"],
  },
  {
    id: 3, title: "Neonatal Resuscitation at Delivery", category: "Pediatrics", difficulty: "Hard", duration: "20 min",
    patient: "Neonate, 0 minutes old · Labour ward, term delivery",
    complaint: "Baby delivered floppy, not breathing, and blue. Mother had prolonged labour.",
    vitals: { hr: "40 bpm", bp: "N/A", spo2: "Unable", rr: "Absent", temp: "36.0°C" },
    skills: ["NRP algorithm", "Bag-mask ventilation", "Chest compressions (neonate)", "Warming & stimulation", "Family communication"],
  },
  {
    id: 4, title: "Anaphylaxis — Penicillin Reaction", category: "Emergency", difficulty: "Medium", duration: "15 min",
    patient: "Female, 31 years · Outpatient clinic, 10 min after IV penicillin",
    complaint: "Patient reports throat tightening, widespread urticaria, dizziness. Administered 1.2g benzylpenicillin 10 min ago.",
    vitals: { hr: "132 bpm", bp: "78/40 mmHg", spo2: "91%", rr: "24 breaths/min", temp: "36.6°C" },
    skills: ["Anaphylaxis recognition", "Adrenaline administration", "Airway positioning", "IV fluid resuscitation", "Incident documentation"],
  },
  {
    id: 5, title: "Safe Medication Administration — Ward Round", category: "Pharmacology", difficulty: "Easy", duration: "10 min",
    patient: "Male, 67 years · Medical ward, on 6 regular medications",
    complaint: "Routine morning medication round. Patient has new confusion noted overnight.",
    vitals: { hr: "88 bpm", bp: "148/92 mmHg", spo2: "96%", rr: "18 breaths/min", temp: "37.1°C" },
    skills: ["Medication 10 Rights", "Drug interaction check", "Capacity assessment", "Medication reconciliation", "Handover communication"],
  },
  {
    id: 6, title: "Sepsis Recognition & Bundle Initiation", category: "Critical Care", difficulty: "Hard", duration: "25 min",
    patient: "Female, 52 years · Medical ward, admitted 6 hours ago with UTI",
    complaint: "Nurse called urgently — patient is confused, shivering, looks unwell. NEWS score has risen to 7.",
    vitals: { hr: "124 bpm", bp: "86/52 mmHg", spo2: "93%", rr: "26 breaths/min", temp: "38.9°C" },
    skills: ["qSOFA / NEWS scoring", "Sepsis 6 bundle", "Blood culture technique", "IV access & fluids", "Senior escalation"],
  },
];

const diffColors: Record<string, string> = {
  Easy:   "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  Hard:   "bg-red-100 text-red-600",
};

type Scenario = typeof scenarios[0];

function PreviewModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0a2e38] to-teal-800 rounded-t-2xl p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${diffColors[scenario.difficulty]}`}>{scenario.difficulty}</span>
                <span className="text-xs text-teal-300">{scenario.category} · ⏱ {scenario.duration}</span>
              </div>
              <h2 className="font-bold text-base leading-tight">{scenario.title}</h2>
              <p className="text-teal-300 text-xs mt-1">{scenario.patient}</p>
            </div>
            <button onClick={onClose} className="text-white/60 hover:text-white text-xl shrink-0 leading-none">✕</button>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Presenting complaint */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1.5">Presenting Complaint</p>
            <p className="text-sm text-gray-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 leading-relaxed">{scenario.complaint}</p>
          </div>

          {/* Vitals */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-2">Initial Vitals</p>
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "HR", value: scenario.vitals.hr },
                { label: "BP", value: scenario.vitals.bp },
                { label: "SpO₂", value: scenario.vitals.spo2 },
                { label: "RR", value: scenario.vitals.rr },
                { label: "Temp", value: scenario.vitals.temp },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 rounded-lg p-2 text-center border border-gray-100">
                  <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">{label}</p>
                  <p className="text-xs font-bold text-gray-800 mt-0.5 leading-tight">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Skills */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-2">Skills Assessed</p>
            <div className="flex flex-col gap-1.5">
              {scenario.skills.map((skill, i) => (
                <div key={skill} className="flex items-center gap-2.5 text-sm text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                  {skill}
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 text-center">
            <p className="text-xs font-semibold text-teal-700 mb-1">Full simulation launching Q3 2026</p>
            <p className="text-xs text-teal-600/70">Branching decisions · AI patient responses · Debrief & scoring</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SimulationPage() {
  const [preview, setPreview] = useState<Scenario | null>(null);

  return (
    <div>
      {preview && <PreviewModal scenario={preview} onClose={() => setPreview(null)} />}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Virtual Simulation Lab</h1>
        <p className="text-gray-400 text-sm mt-0.5">High-fidelity clinical scenarios to practise decision-making in a safe environment.</p>
      </div>

      {/* Coming soon banner */}
      <div className="bg-gradient-to-r from-[#0a2e38] to-teal-800 rounded-2xl p-6 mb-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs bg-amber-400 text-amber-900 font-semibold px-2 py-0.5 rounded mb-3 inline-block">BETA — Q3 2026</span>
            <h2 className="text-lg font-bold mb-1">Interactive 3D Simulation</h2>
            <p className="text-teal-200/80 text-sm max-w-md">
              Immersive clinical scenarios built for East African hospital contexts — no expensive mannequins required. Run on any device.
            </p>
          </div>
          <div className="text-5xl opacity-40">🏥</div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-5">
          {["Branching Scenarios", "AI Patient Responses", "Debrief & Scoring"].map(f => (
            <div key={f} className="bg-white/10 rounded-xl p-3 text-center text-sm text-teal-100">{f}</div>
          ))}
        </div>
      </div>

      {/* Scenario library */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 text-sm">Scenario Library</h2>
        <span className="text-xs text-gray-400">{scenarios.length} scenarios available</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenarios.map(s => (
          <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-xl">🏥</div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${diffColors[s.difficulty] ?? "bg-gray-100 text-gray-500"}`}>{s.difficulty}</span>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">{s.title}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{s.category} · ⏱ {s.duration}</p>
            </div>
            <button onClick={() => setPreview(s)} className="mt-auto w-full text-sm font-medium py-2 rounded-lg border border-teal-200 text-teal-600 hover:bg-teal-50 transition-colors">
              Preview Scenario
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">How Simulation Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: "1", title: "Choose Scenario", desc: "Select a clinical case matching your specialisation" },
            { step: "2", title: "Assess Patient", desc: "Review vitals, history, and presenting complaint" },
            { step: "3", title: "Make Decisions", desc: "Choose interventions — each choice has consequences" },
            { step: "4", title: "Debrief & Learn", desc: "Review your performance against clinical guidelines" },
          ].map(({ step, title, desc }) => (
            <div key={step} className="text-center">
              <div className="w-8 h-8 rounded-full bg-teal-600 text-white text-sm font-bold flex items-center justify-center mx-auto mb-2">{step}</div>
              <p className="text-sm font-semibold text-gray-800">{title}</p>
              <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
