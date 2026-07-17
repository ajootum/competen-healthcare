"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ASSESSMENT_SECTIONS, GRADE_LABELS, avgToLevel, LEVEL_COLORS,
  CommentsSection, generateAssessmentReport,
} from "./shared";

// Clinical Competency Assessment workspace (Enterprise Clinical Assessment
// Engine spec §3): session details with a real nurse picker and the logged-in
// assessor, a five-phase workflow stepper, guided section-by-section scoring
// with a live competency summary, and Save Draft / Submit Assessment. Honest
// gaps (not faked): patient-encounter lookup, scheduling records, evidence
// uploads (photo/video/audio), trend history and server-side session storage.

export type NurseOption = { id: string; full_name: string; role: string };

type Grade = number | "na";

const SECTION_META: { short: string; icon: string }[] = [
  { short: "Safety & Prep",    icon: "🛡️" },
  { short: "First Impression", icon: "👀" },
  { short: "A – Airway",       icon: "🫁" },
  { short: "B – Breathing",    icon: "💨" },
  { short: "C – Circulation",  icon: "❤️" },
  { short: "D – Disability",   icon: "🧠" },
  { short: "E – Exposure",     icon: "🌡️" },
  { short: "GI & Renal",       icon: "🍼" },
  { short: "SAMPLE History",   icon: "📋" },
  { short: "Intervention",     icon: "🩺" },
  { short: "Escalation",       icon: "🚨" },
  { short: "Documentation",    icon: "📝" },
];

const REVIEW_STEP = ASSESSMENT_SECTIONS.length;

const PHASES: { label: string; sections: number[] }[] = [
  { label: "Session Details",            sections: [] },
  { label: "Primary Survey",             sections: [0, 1, 2, 3, 4, 5, 6, 7] },
  { label: "Secondary Assessment",       sections: [8, 9] },
  { label: "Escalation & Documentation", sections: [10, 11] },
  { label: "Review & Submit",            sections: [] },
];

const REASONS = ["Annual Competency", "New Hire Baseline", "Return to Practice", "Remediation", "Ad-hoc Observation"];

const DRAFT_KEY = "competen-assessment-session-draft";

type SessionDraft = {
  grades?: Record<number, Grade>; nurseId?: string; nurseName?: string;
  unit?: string; patient?: string; reason?: string;
  assessorComments?: string; nurseComments?: string;
  step?: number; startedAt?: number | null; savedAt?: number;
};

// Draft presence is read via useSyncExternalStore (server snapshot: none), so
// the server render stays clean and restoring is an explicit user action.
const noopSubscribe = () => () => {};
const readDraftRaw = () => { try { return localStorage.getItem(DRAFT_KEY); } catch { return null; } };

// Server component renders once per request; helpers keep impure date reads
// out of component render bodies.
const todayStr = () => new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const nowMs = () => Date.now();

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function AssessmentSession({
  assessorName, assessorRole, nurses,
}: {
  assessorName: string; assessorRole: string; nurses: NurseOption[];
}) {
  const [grades, setGrades]                     = useState<Record<number, Grade>>({});
  const [nurseId, setNurseId]                   = useState("");
  const [nurseName, setNurseName]               = useState("");
  const [unit, setUnit]                         = useState("");
  const [patient, setPatient]                   = useState("");
  const [reason, setReason]                     = useState(REASONS[0]);
  const [assessorComments, setAssessorComments] = useState("");
  const [nurseComments, setNurseComments]       = useState("");
  const [step, setStep]                         = useState(0);
  const [startedAt, setStartedAt]               = useState<number | null>(null);
  const [nowTick, setNowTick]                   = useState<number | null>(null);
  const [draftNote, setDraftNote]               = useState<string | null>(null);
  const [draftHandled, setDraftHandled]         = useState(false);

  // Session timer — ticks once a second while the session is running.
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const draftRaw = useSyncExternalStore(noopSubscribe, readDraftRaw, () => null);
  let pendingDraft: SessionDraft | null = null;
  if (!draftHandled && draftRaw) {
    try { pendingDraft = JSON.parse(draftRaw); } catch { /* corrupt draft — ignore */ }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const allItems   = ASSESSMENT_SECTIONS.flatMap(s => s.items);
  const totalItems = allItems.length;
  const entries    = Object.values(grades);
  const valued     = entries.length;
  const numeric    = entries.filter((v): v is number => typeof v === "number");
  const naCount    = valued - numeric.length;
  const avgScore   = numeric.length > 0 ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
  const overallLevel = avgScore !== null ? avgToLevel(avgScore) : null;
  const overallPct   = avgScore !== null ? Math.round((avgScore / 6) * 100) : null;
  const progressPct  = Math.round((valued / totalItems) * 100);

  const nurseDisplay = nurseId === "other" ? nurseName.trim()
    : nurses.find(n => n.id === nurseId)?.full_name ?? "";
  const detailsComplete = nurseDisplay !== "" && unit.trim() !== "";

  const sectionStat = (i: number) => {
    const items = ASSESSMENT_SECTIONS[i].items;
    const vals = items.map(it => grades[it.num]).filter(v => v !== undefined);
    const nums = vals.filter((v): v is number => typeof v === "number");
    const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    return { valued: vals.length, total: items.length, avg, complete: vals.length === items.length };
  };

  const phaseStatus = (i: number): "Complete" | "In Progress" | "Pending" => {
    if (i === 0) return detailsComplete ? "Complete" : "In Progress";
    if (i === PHASES.length - 1) return step === REVIEW_STEP ? "In Progress" : "Pending";
    const secs = PHASES[i].sections;
    const stats = secs.map(sectionStat);
    if (stats.every(s => s.complete)) return "Complete";
    if (secs.includes(step) || stats.some(s => s.valued > 0)) return "In Progress";
    return "Pending";
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const setGrade = (num: number, raw: string) => {
    if (startedAt === null && raw !== "") setStartedAt(nowMs());
    setGrades(prev => {
      if (raw === "") {
        const rest = { ...prev };
        delete rest[num];
        return rest;
      }
      return { ...prev, [num]: raw === "na" ? "na" : Number(raw) };
    });
  };

  const saveDraft = () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      grades, nurseId, nurseName, unit, patient, reason,
      assessorComments, nurseComments, step, startedAt, savedAt: Date.now(),
    } satisfies SessionDraft));
    setDraftNote(`Draft saved ${new Date().toLocaleTimeString()}`);
    setDraftHandled(true);
  };

  const resumeDraft = () => {
    if (!pendingDraft) return;
    if (pendingDraft.grades) setGrades(pendingDraft.grades);
    if (typeof pendingDraft.nurseId === "string") setNurseId(pendingDraft.nurseId);
    if (typeof pendingDraft.nurseName === "string") setNurseName(pendingDraft.nurseName);
    if (typeof pendingDraft.unit === "string") setUnit(pendingDraft.unit);
    if (typeof pendingDraft.patient === "string") setPatient(pendingDraft.patient);
    if (typeof pendingDraft.reason === "string" && pendingDraft.reason) setReason(pendingDraft.reason);
    if (typeof pendingDraft.assessorComments === "string") setAssessorComments(pendingDraft.assessorComments);
    if (typeof pendingDraft.nurseComments === "string") setNurseComments(pendingDraft.nurseComments);
    if (typeof pendingDraft.step === "number") setStep(Math.min(pendingDraft.step, REVIEW_STEP));
    if (typeof pendingDraft.startedAt === "number") setStartedAt(pendingDraft.startedAt);
    setDraftNote(pendingDraft.savedAt ? `Draft resumed — saved ${new Date(pendingDraft.savedAt).toLocaleString()}` : "Draft resumed");
    setDraftHandled(true);
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDraftHandled(true);
  };

  const resetSession = () => {
    setGrades({}); setNurseId(""); setNurseName(""); setUnit(""); setPatient("");
    setReason(REASONS[0]); setAssessorComments(""); setNurseComments("");
    setStep(0); setStartedAt(null); setNowTick(null); setDraftNote(null);
    setDraftHandled(true);
    localStorage.removeItem(DRAFT_KEY);
  };

  const submitReport = () => {
    const numericGrades: Record<number, number> = {};
    for (const [k, v] of Object.entries(grades)) if (typeof v === "number") numericGrades[Number(k)] = v;
    generateAssessmentReport(
      { nurse: nurseDisplay, assessor: assessorName, unit, date: todayStr(), coworker: "", patient },
      numericGrades, assessorComments, nurseComments,
    );
  };

  // Real AI handoffs — send live results to the AI Clinical Coach.
  const overallPrompt = () => {
    const lines = ASSESSMENT_SECTIONS.map((s, i) => {
      const st = sectionStat(i);
      return st.avg !== null ? `${s.title}: ${st.avg.toFixed(1)}/6 (${avgToLevel(st.avg)})` : `${s.title}: not scored`;
    }).join("; ");
    return `I am an assessor running a live clinical competency assessment (ABCDE patient assessment, items scored 0–6 on the Benner scale). Live section results — ${lines}. Overall average so far: ${avgScore?.toFixed(2) ?? "n/a"}/6 (${overallLevel ?? "not started"}). Give me targeted insights: which sections are weakest, what specific behaviours to observe next, and coaching recommendations for the nurse's development plan.`;
  };
  const sectionPrompt = (i: number) => {
    const s = ASSESSMENT_SECTIONS[i];
    const scored = s.items.map(it => {
      const g = grades[it.num];
      return g === undefined ? null : `"${it.text}": ${g === "na" ? "N/A" : `${g}/6`}`;
    }).filter(Boolean).join("; ");
    return `I am an assessor observing a nurse during the "${s.title}" part of an ABCDE patient assessment. ${scored ? `Scores so far — ${scored}.` : "No items scored yet."} As a clinical educator, what should I watch for in this section, what does best practice look like for each item, and what coaching points apply?`;
  };

  const active = step < REVIEW_STEP ? ASSESSMENT_SECTIONS[step] : null;
  const activeStat = active ? sectionStat(step) : null;

  const stepperJump = (i: number) => {
    if (i === 0) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (i === PHASES.length - 1) { setStep(REVIEW_STEP); return; }
    setStep(PHASES[i].sections[0]);
  };

  return (
    <div className="max-w-[1500px]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Assessments · Assessment Session</p>
          <h1 className="text-xl font-bold text-gray-900 mt-1">Clinical Competency Assessment</h1>
          <p className="text-gray-400 text-sm mt-0.5">Observe clinical practice, collect evidence and assess competency using the standardised framework.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button onClick={saveDraft}
              className="text-xs font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
              Save Draft
            </button>
            <button onClick={() => setStep(REVIEW_STEP)}
              className="text-xs font-semibold bg-[#0a2e38] text-white hover:bg-[#12414f] px-4 py-2 rounded-lg transition-colors">
              Submit Assessment
            </button>
          </div>
          {draftNote && <p className="text-[10px] text-gray-400">{draftNote}</p>}
        </div>
      </div>

      {/* Saved-draft banner */}
      {pendingDraft && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Saved draft found</p>
            <p className="text-xs text-amber-800/70 mt-0.5" suppressHydrationWarning>
              {pendingDraft.savedAt ? `Saved ${new Date(pendingDraft.savedAt).toLocaleString()} · ` : ""}
              {Object.keys(pendingDraft.grades ?? {}).length} of {totalItems} items scored
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={resumeDraft}
              className="text-xs font-semibold bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors">
              Resume draft
            </button>
            <button onClick={discardDraft}
              className="text-xs text-amber-700 border border-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors">
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
        {/* ── Main column ─────────────────────────────────────────────────── */}
        <div className="min-w-0 flex flex-col gap-5">

          {/* Session details */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Assessment Session Details</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-teal-50 text-teal-700 font-bold text-[11px] flex items-center justify-center shrink-0">
                  {initials(nurseDisplay) || "🧑‍⚕️"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">Nurse Being Assessed</p>
                  <select value={nurseId} onChange={e => setNurseId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-800 bg-white focus:outline-none focus:border-teal-500">
                    <option value="">Select nurse…</option>
                    {nurses.map(n => <option key={n.id} value={n.id}>{n.full_name}</option>)}
                    <option value="other">Other (type name)</option>
                  </select>
                  {nurseId === "other" && (
                    <input value={nurseName} onChange={e => setNurseName(e.target.value)} placeholder="Full name"
                      className="mt-1.5 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-teal-500" />
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px] flex items-center justify-center shrink-0">
                  {initials(assessorName) || "👤"}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 mb-1">Assessor / Supervisor</p>
                  <p className="text-sm font-semibold text-gray-900">{assessorName}</p>
                  <p className="text-[11px] text-gray-400 capitalize">{assessorRole}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0">🧾</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">Patient (de-identified)</p>
                  <input value={patient} onChange={e => setPatient(e.target.value)} placeholder="e.g. Bed 4, Rm 12"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-teal-500" />
                  <p className="text-[9px] text-gray-300 mt-1">Encounter lookup isn&apos;t tracked yet — use a de-identified reference.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0">🏥</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">Unit / Ward</p>
                  <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. Paediatric ICU"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-teal-500" />
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0">📋</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">Reason for Assessment</p>
                  <select value={reason} onChange={e => setReason(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-800 bg-white focus:outline-none focus:border-teal-500">
                    {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0">📄</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 mb-1">Assessment Type</p>
                  <span className="inline-block text-[11px] font-semibold text-teal-700 border border-teal-200 bg-teal-50 px-2 py-0.5 rounded-lg">
                    Live Patient Observation
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0">🗂️</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 mb-1">Framework / Domain</p>
                  <p className="text-sm font-semibold text-gray-900">ABCDE Patient Assessment</p>
                  <p className="text-[11px] text-gray-400">{totalItems} items · Benner 0–6 scale</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0">📅</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 mb-1">Date</p>
                  <p className="text-sm font-semibold text-gray-900" suppressHydrationWarning>{todayStr()}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-base shrink-0">⏱️</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 mb-1">Time Started</p>
                  {startedAt !== null ? (
                    <>
                      <p className="text-sm font-semibold text-teal-700">{new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                      <p className="text-[11px] text-gray-400">⏱ {fmtElapsed((nowTick ?? startedAt) - startedAt)}</p>
                    </>
                  ) : (
                    <p className="text-[11px] text-gray-300">Starts with your first score</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Workflow stepper */}
          <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {PHASES.map((p, i) => {
                const st = phaseStatus(i);
                return (
                  <button key={p.label} onClick={() => stepperJump(i)} className="flex items-center gap-2.5 text-left group">
                    <span className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 transition-colors ${
                      st === "Complete" ? "bg-green-500 text-white"
                      : st === "In Progress" ? "bg-teal-600 text-white"
                      : "bg-gray-100 text-gray-400 group-hover:bg-gray-200"
                    }`}>
                      {st === "Complete" ? "✓" : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-gray-800 leading-tight">{p.label}</span>
                      <span className={`block text-[9px] mt-0.5 ${
                        st === "Complete" ? "text-green-600" : st === "In Progress" ? "text-teal-600" : "text-gray-300"
                      }`}>{st}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {active ? (
            <div className="grid grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)] gap-4 items-start">
              {/* Section navigator */}
              <nav className="bg-white border border-gray-100 rounded-2xl p-2 lg:sticky lg:top-4">
                <div className="flex flex-col gap-0.5">
                  {ASSESSMENT_SECTIONS.map((s, i) => {
                    const st = sectionStat(i);
                    return (
                      <button key={s.title} onClick={() => setStep(i)}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors border ${
                          step === i ? "bg-teal-50 border-teal-200" : "border-transparent hover:bg-gray-50"
                        }`}>
                        <span className="text-sm shrink-0">{SECTION_META[i].icon}</span>
                        <span className={`min-w-0 flex-1 text-[11px] leading-tight truncate ${step === i ? "font-semibold text-teal-800" : "text-gray-600"}`}>
                          {SECTION_META[i].short}
                        </span>
                        {st.complete ? (
                          <span className="w-4 h-4 rounded-full bg-green-500 text-white text-[8px] font-bold flex items-center justify-center shrink-0">✓</span>
                        ) : st.valued > 0 ? (
                          <span className="text-[9px] font-bold text-amber-600 shrink-0">{st.valued}/{st.total}</span>
                        ) : step === i ? (
                          <span className="text-teal-500 text-[10px] shrink-0">→</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* Active section */}
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
                  <span className="text-xl">{SECTION_META[step].icon}</span>
                  <h2 className="font-bold text-gray-900">{SECTION_META[step].short}</h2>
                  <span className="text-[9px] font-bold bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{active.items.length} items</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(sectionPrompt(step))}`}
                      className="text-[11px] font-semibold text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors">
                      ✨ AI Insights
                    </Link>
                  </div>
                  <p className="w-full text-[10px] text-gray-400">{active.title}</p>
                </div>

                <details className="border-b border-gray-50">
                  <summary className="px-5 py-2 text-[10px] text-gray-400 cursor-pointer select-none hover:text-gray-600">
                    ⓘ Grading scale (0–6)
                  </summary>
                  <div className="px-5 pb-2.5 flex flex-wrap gap-1.5">
                    {Object.entries(GRADE_LABELS).map(([g, { level, color }]) => (
                      <span key={g} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${color}`}>{g} — {level}</span>
                    ))}
                  </div>
                </details>

                {/* Scoring table */}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[9px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">
                        <th className="text-left px-5 py-2.5 w-10">#</th>
                        <th className="text-left px-2 py-2.5">Assessment Item</th>
                        <th className="text-left px-2 py-2.5 w-24">Score</th>
                        <th className="text-center px-5 py-2.5 w-16">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {active.items.map(item => {
                        const g = grades[item.num];
                        return (
                          <tr key={item.num}>
                            <td className="px-5 py-3 text-[10px] font-bold text-gray-300 align-top">{item.num}</td>
                            <td className="px-2 py-3 text-sm text-gray-800">{item.text}</td>
                            <td className="px-2 py-3">
                              <select value={g === undefined ? "" : String(g)} onChange={e => setGrade(item.num, e.target.value)}
                                className={`border rounded-lg px-2 py-1.5 text-xs font-bold bg-white focus:outline-none focus:border-teal-500 ${
                                  typeof g === "number" ? "border-teal-200 text-teal-800" : "border-gray-200 text-gray-500"
                                }`}>
                                <option value="">—</option>
                                {[6, 5, 4, 3, 2, 1, 0].map(n => <option key={n} value={n}>{n}</option>)}
                                <option value="na">N/A</option>
                              </select>
                            </td>
                            <td className="px-5 py-3 text-center">
                              {typeof g === "number" ? (
                                <span className="inline-flex w-5 h-5 rounded-full bg-green-100 text-green-600 text-[10px] font-bold items-center justify-center">✓</span>
                              ) : g === "na" ? (
                                <span className="text-[10px] font-semibold text-gray-300">N/A</span>
                              ) : (
                                <span className="text-gray-200">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500">Section Score (Average)</span>
                  {activeStat && activeStat.avg !== null ? (
                    <span className="text-sm font-bold bg-green-50 text-green-700 px-3 py-1 rounded-lg">
                      {activeStat.avg.toFixed(1)} / 6 ({Math.round((activeStat.avg / 6) * 100)}%)
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-300">No scores yet</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Review & Submit */
            <div className="flex flex-col gap-4">
              <div className="bg-[#0a2e38] rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-teal-300/70 text-xs font-semibold uppercase tracking-widest mb-1">Overall Competency Level</p>
                  <p className="text-teal-200 text-sm">{valued} of {totalItems} items scored{naCount > 0 ? ` (${naCount} N/A)` : ""}</p>
                  {avgScore !== null && <p className="text-white text-sm mt-0.5">Average: <strong>{avgScore.toFixed(2)} / 6</strong></p>}
                </div>
                {overallLevel ? (
                  <span className={`text-lg font-bold px-4 py-2 rounded-xl border ${LEVEL_COLORS[overallLevel]}`}>{overallLevel}</span>
                ) : (
                  <span className="text-teal-400/50 text-sm">Score items to see level</span>
                )}
              </div>

              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900">Section Results</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {valued < totalItems
                      ? `${totalItems - valued} item${totalItems - valued === 1 ? "" : "s"} outstanding — click a section to go back`
                      : "All items addressed"}
                  </p>
                </div>
                <div className="divide-y divide-gray-50">
                  {ASSESSMENT_SECTIONS.map((s, i) => {
                    const st = sectionStat(i);
                    return (
                      <div key={s.title} className="px-5 py-2.5 flex items-center gap-3">
                        <span className="text-sm shrink-0">{SECTION_META[i].icon}</span>
                        <button onClick={() => setStep(i)} className="flex-1 min-w-0 text-left text-xs text-gray-700 hover:text-teal-700 truncate transition-colors">
                          {s.title}
                        </button>
                        <span className="text-[10px] text-gray-400 shrink-0">{st.valued}/{st.total}</span>
                        {st.avg !== null ? (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 ${LEVEL_COLORS[avgToLevel(st.avg)]}`}>
                            {st.avg.toFixed(1)} · {avgToLevel(st.avg)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300 shrink-0">not scored</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <CommentsSection
                assessorVal={assessorComments}
                assesseeLabel="Nurse"
                assesseeVal={nurseComments}
                onAssessor={setAssessorComments}
                onAssessee={setNurseComments}
              />

              <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <button onClick={submitReport} disabled={numeric.length === 0}
                  className="text-xs font-semibold bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg transition-colors">
                  🖨 Submit &amp; Generate Report
                </button>
                <button onClick={() => setStep(ASSESSMENT_SECTIONS.length - 1)}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-800 border border-gray-200 px-4 py-2.5 rounded-lg transition-colors">
                  ← Back to scoring
                </button>
                <p className="text-[10px] text-gray-400 sm:ml-auto sm:text-right leading-snug">
                  Generates the print report for signing and filing.<br className="hidden sm:block" />
                  Server-side assessment storage is not yet available.
                </p>
              </div>
            </div>
          )}

          {/* Footer navigation */}
          {active && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-3 flex items-center gap-4">
              <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}
                className="text-xs font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed border border-gray-200 px-3 py-2 rounded-lg transition-colors shrink-0">
                ‹ Previous Section
              </button>
              <div className="flex-1 hidden sm:flex items-center gap-3 min-w-0">
                <span className="text-[10px] text-gray-400 shrink-0">Overall Progress: {progressPct}%</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <button onClick={() => setStep(s => Math.min(REVIEW_STEP, s + 1))}
                className="text-xs font-semibold bg-[#0a2e38] text-white hover:bg-[#12414f] px-3 py-2 rounded-lg transition-colors shrink-0 ml-auto sm:ml-0">
                {step === ASSESSMENT_SECTIONS.length - 1 ? "Review & Submit ›" : "Next Section ›"}
              </button>
            </div>
          )}

          {/* Other instruments */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <p className="text-xs text-gray-400 flex-1 min-w-[220px]">
              <strong className="text-gray-600">Other audit instruments</strong> — the match-based audits now live in their own workspaces.
            </p>
            <Link href="/dashboard/audit/concurrent"
              className="text-[11px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-3 py-1.5 rounded-lg transition-colors">
              Concurrent Audit →
            </Link>
            <Link href="/dashboard/audit/chart"
              className="text-[11px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-3 py-1.5 rounded-lg transition-colors">
              Retrospective Chart Audit →
            </Link>
          </div>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 xl:sticky xl:top-4">
          {/* Competency summary */}
          <div className="bg-[#0a2e38] rounded-2xl p-5">
            <p className="text-teal-300/70 text-[10px] font-bold uppercase tracking-widest mb-2">Competency Summary</p>
            <div className="relative w-40 mx-auto">
              <svg viewBox="0 0 120 66" className="w-full block">
                <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="9" strokeLinecap="round" />
                {overallPct !== null && (
                  <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#2dd4bf" strokeWidth="9" strokeLinecap="round"
                    strokeDasharray={`${(overallPct / 100) * 157} 157`} />
                )}
              </svg>
              <div className="absolute inset-x-0 bottom-0 text-center">
                {overallPct !== null ? (
                  <p className="text-2xl font-extrabold text-white leading-none">{overallPct}%</p>
                ) : (
                  <p className="text-sm font-bold text-teal-400/50 leading-none pb-1">—</p>
                )}
              </div>
            </div>
            <p className="text-center text-[10px] text-teal-100/60 mt-1.5">Overall Competency</p>
            <p className="text-center text-sm font-bold text-teal-300">{overallLevel ?? "Not started"}</p>

            <div className="mt-4 flex flex-col gap-1.5">
              {ASSESSMENT_SECTIONS.map((s, i) => {
                const st = sectionStat(i);
                const pct = st.avg !== null ? Math.round((st.avg / 6) * 100) : null;
                return (
                  <button key={s.title} onClick={() => setStep(i)} className="group text-left w-full">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          pct === null ? "bg-white/20" : pct >= 75 ? "bg-green-400" : pct >= 50 ? "bg-amber-400" : "bg-red-400"
                        }`} />
                        <span className="text-[9px] text-teal-100/60 group-hover:text-teal-100 truncate transition-colors">{SECTION_META[i].short}</span>
                      </span>
                      <span className="text-[9px] text-teal-200/80 shrink-0">{pct !== null ? `${pct}%` : "—"}</span>
                    </span>
                    <span className="block h-1 bg-white/10 rounded-full overflow-hidden mt-0.5">
                      {pct !== null && (
                        <span className={`block h-full rounded-full ${pct >= 75 ? "bg-green-400" : pct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                          style={{ width: `${pct}%` }} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
              <span className="text-[10px] text-teal-100/60">Trend</span>
              <span className="text-[10px] text-teal-100/40">Not tracked yet — first recorded session</span>
            </div>
          </div>

          {/* AI insights */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
            <p className="text-xs font-bold text-violet-900 mb-1.5">✨ AI Assistant Insights</p>
            {valued > 0 ? (
              <>
                <p className="text-[10px] text-violet-900/70 leading-snug mb-2">
                  Send the live section results to the AI Clinical Coach for weakest-area analysis and coaching recommendations.
                </p>
                <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(overallPrompt())}`}
                  className="block text-center text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors">
                  View Recommendations →
                </Link>
              </>
            ) : (
              <p className="text-[10px] text-violet-900/60 leading-snug">
                Score some items first — the Coach analyses your live results and suggests coaching points.
              </p>
            )}
          </div>

          {/* Session status */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-xs font-bold text-gray-800 mb-2.5">Session</p>
            <div className="flex flex-col gap-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-gray-400">Items scored</span><span className="font-semibold text-gray-700">{valued}/{totalItems}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Marked N/A</span><span className="font-semibold text-gray-700">{naCount}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Time elapsed</span>
                <span className="font-semibold text-gray-700">{startedAt !== null ? fmtElapsed((nowTick ?? startedAt) - startedAt) : "—"}</span>
              </div>
            </div>
            <button onClick={resetSession}
              className="mt-3 w-full text-[11px] font-semibold text-gray-400 hover:text-red-600 border border-gray-200 py-1.5 rounded-lg transition-colors">
              Reset session
            </button>
            <p className="text-[9px] text-gray-300 mt-2 leading-snug">
              Drafts save to this browser only — server-side session storage isn&apos;t available yet.
            </p>
          </div>

          {/* Evidence gap */}
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <p className="text-[10px] text-gray-400 leading-relaxed">
              <strong className="text-gray-500">Evidence collection</strong> (photos, video, audio) isn&apos;t available yet —
              no evidence store exists. Record observations in the comments at Review &amp; Submit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
