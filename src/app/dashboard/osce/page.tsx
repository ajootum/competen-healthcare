"use client";
import { useState } from "react";

type ChecklistItem = { id: string; text: string };
type Station = {
  id: number;
  title: string;
  category: string;
  duration: string;
  difficulty: "Easy" | "Medium" | "Hard";
  status: "available" | "coming_soon";
  checklist: ChecklistItem[];
};

const stations: Station[] = [
  {
    id: 1, title: "IV Cannulation", category: "Clinical Skills", duration: "10 min",
    difficulty: "Medium", status: "available",
    checklist: [
      { id: "iv1",  text: "Wash hands and don PPE (gloves, apron) before preparing equipment" },
      { id: "iv2",  text: "Introduce yourself and verify patient identity (name + DOB)" },
      { id: "iv3",  text: "Explain procedure clearly and obtain verbal consent" },
      { id: "iv4",  text: "Assemble equipment: correct gauge cannula, tourniquet, alcohol swab, transparent dressing" },
      { id: "iv5",  text: "Apply tourniquet 10 cm above intended site; identify suitable vein" },
      { id: "iv6",  text: "Clean site with alcohol swab and allow minimum 30 seconds to dry" },
      { id: "iv7",  text: "Stretch skin taut; insert cannula at 15–30° angle with bevel facing up" },
      { id: "iv8",  text: "Confirm flashback; advance the cannula fully while withdrawing the needle" },
      { id: "iv9",  text: "Release tourniquet; flush with 5 mL normal saline and confirm patency" },
      { id: "iv10", text: "Secure with transparent dressing; label with date, time, and gauge" },
      { id: "iv11", text: "Dispose of sharps immediately into sharps bin without recapping" },
      { id: "iv12", text: "Document insertion in patient notes with site, gauge, and flush confirmation" },
    ],
  },
  {
    id: 2, title: "Airway Assessment & Positioning", category: "Emergency", duration: "8 min",
    difficulty: "Medium", status: "available",
    checklist: [
      { id: "aw1",  text: "Assess responsiveness — call patient by name and observe response" },
      { id: "aw2",  text: "Call for help immediately if patient is unresponsive" },
      { id: "aw3",  text: "Look, listen, and feel for breathing for no more than 10 seconds" },
      { id: "aw4",  text: "Perform head-tilt chin-lift to open airway correctly" },
      { id: "aw5",  text: "Apply jaw thrust technique if cervical spine injury is suspected" },
      { id: "aw6",  text: "Select correctly sized OPA (measure from corner of mouth to earlobe)" },
      { id: "aw7",  text: "Insert OPA using rotation technique without traumatising the palate" },
      { id: "aw8",  text: "Apply supplemental oxygen at appropriate flow rate" },
      { id: "aw9",  text: "Place patient in recovery position (lateral) if breathing spontaneously" },
      { id: "aw10", text: "Reassess airway patency and SpO₂ after every intervention" },
    ],
  },
  {
    id: 3, title: "Basic Life Support (BLS)", category: "Emergency", duration: "10 min",
    difficulty: "Hard", status: "available",
    checklist: [
      { id: "bls1",  text: "Confirm scene safety before approaching the patient" },
      { id: "bls2",  text: "Check responsiveness: tap shoulders firmly and shout" },
      { id: "bls3",  text: "Call for help and activate the emergency response system" },
      { id: "bls4",  text: "Open airway using head-tilt chin-lift" },
      { id: "bls5",  text: "Check for breathing for no more than 10 seconds" },
      { id: "bls6",  text: "Place heel of hand on lower half of sternum, correct hand position" },
      { id: "bls7",  text: "Compress to depth of 5–6 cm at rate of 100–120 per minute" },
      { id: "bls8",  text: "Allow full chest recoil between compressions without leaning" },
      { id: "bls9",  text: "Deliver 2 rescue breaths with visible chest rise (30:2 ratio)" },
      { id: "bls10", text: "Attach AED as soon as available; follow audio/visual prompts" },
      { id: "bls11", text: "Minimise interruptions to CPR — pause <10 seconds only for breaths/AED" },
      { id: "bls12", text: "Continue until ROSC, patient breathes normally, or senior clinician takes over" },
    ],
  },
  {
    id: 4, title: "Medication Administration — IM Injection", category: "Pharmacology", duration: "8 min",
    difficulty: "Easy", status: "available",
    checklist: [
      { id: "im1",  text: "Verify medication against prescription using 10 Rights of Medication Safety" },
      { id: "im2",  text: "Check patient allergy status before preparing medication" },
      { id: "im3",  text: "Wash hands thoroughly; gather all required equipment" },
      { id: "im4",  text: "Draw up correct dose; expel all air bubbles from syringe" },
      { id: "im5",  text: "Select correct injection site (deltoid, vastus lateralis, or dorsogluteal)" },
      { id: "im6",  text: "Clean skin with alcohol swab; allow at least 30 seconds to dry" },
      { id: "im7",  text: "Apply Z-track technique if required by site or medication protocol" },
      { id: "im8",  text: "Insert needle at 90° angle with a smooth, confident motion" },
      { id: "im9",  text: "Aspirate for 5–10 seconds (follow local protocol)" },
      { id: "im10", text: "Inject medication slowly at 1 mL per 10 seconds" },
      { id: "im11", text: "Withdraw needle smoothly; apply gentle pressure (do not rub)" },
      { id: "im12", text: "Dispose of sharps immediately; document administration in medication chart" },
    ],
  },
  {
    id: 5, title: "Patient Assessment (ABCDE)", category: "Assessment", duration: "12 min",
    difficulty: "Hard", status: "available",
    checklist: [
      { id: "ab1",  text: "Introduce yourself to patient; explain assessment and gain consent" },
      { id: "ab2",  text: "A – Airway: confirm patency; look/listen/feel for any obstruction" },
      { id: "ab3",  text: "B – Breathing: count respiratory rate; observe depth and pattern" },
      { id: "ab4",  text: "B – Auscultate both lung fields; measure SpO₂; apply O₂ if <94%" },
      { id: "ab5",  text: "C – Circulation: measure heart rate and blood pressure" },
      { id: "ab6",  text: "C – Assess capillary refill (<2 seconds); check skin colour and temperature" },
      { id: "ab7",  text: "D – Disability: assess AVPU or GCS; check pupils (size, reaction, equality)" },
      { id: "ab8",  text: "D – Perform blood glucose measurement; note any focal neurological deficit" },
      { id: "ab9",  text: "E – Expose patient appropriately; measure temperature; perform pain assessment" },
      { id: "ab10", text: "Calculate NEWS2 score from all observed parameters" },
      { id: "ab11", text: "Identify priority interventions based on findings" },
      { id: "ab12", text: "Communicate findings to senior nurse/doctor using SBAR framework" },
    ],
  },
  { id: 6, title: "Wound Dressing Change",     category: "Clinical Skills", duration: "10 min", difficulty: "Easy",   status: "coming_soon", checklist: [] },
  { id: 7, title: "Neonatal Assessment",       category: "Pediatrics",     duration: "12 min", difficulty: "Hard",   status: "coming_soon", checklist: [] },
  { id: 8, title: "Mental Health Assessment",  category: "Mental Health",  duration: "15 min", difficulty: "Medium", status: "coming_soon", checklist: [] },
];

const diffColors: Record<string, string> = {
  Easy:   "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  Hard:   "bg-red-100 text-red-600",
};

const rubricItems = [
  { criterion: "Clinical Knowledge", weight: "30%", desc: "Correct protocol, drug knowledge, anatomy" },
  { criterion: "Technical Skills",   weight: "30%", desc: "Procedural accuracy and dexterity" },
  { criterion: "Communication",      weight: "20%", desc: "Patient-centred interaction, consent, explanation" },
  { criterion: "Safety & Hygiene",   weight: "20%", desc: "Infection control, PPE, documentation" },
];

function ChecklistModal({ station, onClose }: { station: Station; onClose: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const score = Math.round((checked.size / station.checklist.length) * 100);
  const passed = score >= 70;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0a2e38] to-teal-800 rounded-t-2xl p-5 text-white shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${diffColors[station.difficulty]}`}>{station.difficulty}</span>
                <span className="text-xs text-teal-300">{station.category} · ⏱ {station.duration}</span>
              </div>
              <h2 className="font-bold text-base leading-tight">Station {station.id}: {station.title}</h2>
              <p className="text-teal-300/70 text-xs mt-1">Tick each step as you practise the skill</p>
            </div>
            <button onClick={onClose} className="text-white/60 hover:text-white text-xl shrink-0 leading-none">✕</button>
          </div>
        </div>

        {/* Checklist */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-3">Assessment Checklist</p>
          <div className="flex flex-col gap-2">
            {station.checklist.map((item, i) => (
              <label key={item.id} className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                checked.has(item.id) ? "bg-teal-50 border border-teal-100" : "bg-gray-50 border border-gray-100 hover:border-gray-200"
              }`}>
                <div className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                  checked.has(item.id) ? "bg-teal-600 border-teal-600" : "border-gray-300"
                }`}>
                  {checked.has(item.id) && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <input type="checkbox" className="sr-only" checked={checked.has(item.id)} onChange={() => toggle(item.id)} />
                <div className="flex-1">
                  <span className="text-[10px] text-gray-400 font-semibold mr-1.5">{i + 1}.</span>
                  <span className={`text-sm ${checked.has(item.id) ? "text-teal-700" : "text-gray-700"}`}>{item.text}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Score footer */}
        <div className="shrink-0 border-t border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">{checked.size} of {station.checklist.length} steps completed</span>
            <span className={`text-sm font-bold ${score >= 70 ? "text-green-600" : "text-gray-500"}`}>{score}%</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div className={`h-full rounded-full transition-all duration-300 ${passed ? "bg-green-500" : score >= 50 ? "bg-amber-400" : "bg-gray-300"}`}
              style={{ width: `${score}%` }} />
          </div>
          <div className="flex items-center justify-between">
            {score > 0 && (
              <p className={`text-xs font-semibold ${passed ? "text-green-600" : "text-amber-600"}`}>
                {passed ? "✓ Practice complete — well done!" : "Keep going — aim for 70% to pass"}
              </p>
            )}
            <div className="flex gap-2 ml-auto">
              <button onClick={() => setChecked(new Set())} className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-3 py-1.5">
                Clear all
              </button>
              <button onClick={onClose} className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type Tab = "practice" | "results" | "book";

export default function OSCEPage() {
  const [tab, setTab] = useState<Tab>("practice");
  const [activeStation, setActiveStation] = useState<Station | null>(null);

  const available = stations.filter(s => s.status === "available");

  return (
    <div>
      {activeStation && <ChecklistModal station={activeStation} onClose={() => setActiveStation(null)} />}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Digital OSCE Platform</h1>
        <p className="text-gray-400 text-sm mt-0.5">Objective Structured Clinical Examinations — standardised assessment of clinical skills.</p>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-r from-[#0a2e38] to-teal-800 rounded-2xl p-6 mb-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs bg-amber-400 text-amber-900 font-semibold px-2 py-0.5 rounded mb-3 inline-block">LAUNCHING Q4 2026</span>
            <h2 className="text-lg font-bold mb-1">Remote OSCE Assessment</h2>
            <p className="text-teal-200/80 text-sm max-w-md">
              Video-based OSCE stations assessed by accredited examiners. Receive a digital certificate accepted by nursing councils across East Africa.
            </p>
          </div>
          <div className="text-5xl opacity-40">📋</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {["Video Assessment", "Live Examiner", "Instant Feedback", "Digital Certificate"].map(f => (
            <div key={f} className="bg-white/10 rounded-xl p-2.5 text-center text-xs text-teal-100">{f}</div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: "practice" as Tab, label: "Practice Stations" },
          { key: "results"  as Tab, label: "My Results" },
          { key: "book"     as Tab, label: "Book an OSCE" },
        ]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── PRACTICE TAB ── */}
      {tab === "practice" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">OSCE Stations</h2>
            <span className="text-xs text-gray-400">{available.length} available · {stations.length - available.length} coming soon</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {stations.map(s => (
              <div key={s.id} className={`bg-white rounded-xl border p-5 flex flex-col gap-3 ${s.status === "coming_soon" ? "border-gray-100 opacity-60" : "border-gray-100"}`}>
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-xl">📋</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${diffColors[s.difficulty]}`}>{s.difficulty}</span>
                    {s.status === "coming_soon"
                      ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-400">Coming Soon</span>
                      : <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-100 text-teal-700">Available</span>
                    }
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Station {s.id}: {s.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{s.category} · ⏱ {s.duration} · {s.checklist.length || "—"} checklist items</p>
                </div>
                <button
                  disabled={s.status === "coming_soon"}
                  onClick={() => setActiveStation(s)}
                  className="mt-auto w-full text-sm font-medium py-2 rounded-lg border border-teal-200 text-teal-600 hover:bg-teal-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {s.status === "coming_soon" ? "Coming Soon" : "Start Practice →"}
                </button>
              </div>
            ))}
          </div>

          {/* Marking rubric */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-4">Marking Rubric</h2>
            <div className="flex flex-col gap-3 mb-4">
              {rubricItems.map(({ criterion, weight, desc }) => (
                <div key={criterion} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                  <div className="w-12 h-12 rounded-lg bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0">{weight}</div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{criterion}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 bg-teal-50 rounded-lg text-sm text-teal-800">
              <strong>Pass mark: 70%</strong> · Certificates issued for scores ≥70% · Recognised by NCK, UNMC, TNMC, RNC
            </div>
          </div>
        </>
      )}

      {/* ── RESULTS TAB ── */}
      {tab === "results" && (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4">📋</div>
          <h3 className="font-semibold text-gray-800 mb-1">No OSCE sessions recorded yet</h3>
          <p className="text-sm text-gray-400 max-w-sm mx-auto mb-6">
            Your OSCE results will appear here after you complete a session with an accredited examiner. Full video-based assessments launch Q4 2026.
          </p>
          <button onClick={() => setTab("book")}
            className="inline-flex items-center gap-2 bg-teal-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors">
            Register interest for Q4 2026 →
          </button>
        </div>
      )}

      {/* ── BOOK TAB ── */}
      {tab === "book" && (
        <div className="flex flex-col gap-6">
          <div className="bg-gradient-to-br from-[#0a2e38] to-teal-800 rounded-2xl p-7 text-white">
            <span className="text-xs bg-amber-400 text-amber-900 font-bold px-2.5 py-1 rounded mb-4 inline-block">COMING Q4 2026</span>
            <h2 className="text-xl font-bold mb-2">Book a Formal OSCE</h2>
            <p className="text-teal-200/80 text-sm max-w-lg mb-5">
              Sit a full OSCE assessment remotely. Each station is recorded and reviewed by an accredited East African nursing examiner. Pass all 5 required stations and receive a digital certificate recognised by your nursing council.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { icon: "🎥", label: "Video recorded" },
                { icon: "👩‍⚕️", label: "Accredited examiner" },
                { icon: "📜", label: "Council-recognised cert" },
                { icon: "📱", label: "Any device, anywhere" },
              ].map(({ icon, label }) => (
                <div key={label} className="bg-white/10 rounded-xl p-3 text-center">
                  <p className="text-xl mb-1">{icon}</p>
                  <p className="text-xs text-teal-100">{label}</p>
                </div>
              ))}
            </div>
            <a href="mailto:gabriel@semacast.com?subject=OSCE Registration Interest"
              className="inline-block bg-amber-400 text-amber-900 font-semibold text-sm px-6 py-3 rounded-lg hover:bg-amber-300 transition-colors">
              Register Interest — Email Us
            </a>
          </div>

          {/* How it works */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-900 text-sm mb-5">How the OSCE works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
              {[
                { step: "1", title: "Book a slot", desc: "Choose a date and time that suits you — sessions are 90 minutes" },
                { step: "2", title: "Complete 5 stations", desc: "Each station is a separate clinical task observed via video" },
                { step: "3", title: "Examiner scores", desc: "Accredited examiner reviews your recording against standardised rubric" },
                { step: "4", title: "Receive certificate", desc: "Digital certificate emailed within 5 working days" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="text-center">
                  <div className="w-9 h-9 rounded-full bg-teal-600 text-white text-sm font-bold flex items-center justify-center mx-auto mb-3">{step}</div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">{title}</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">OSCE Session Fee</p>
              <p className="text-xs text-gray-500 mt-0.5">5 stations · accredited examiner · digital certificate · M-Pesa accepted</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-teal-600">$25</p>
              <p className="text-xs text-gray-400">per session</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
