"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { METHOD_LABELS, OUTCOME_CONFIG, type AssessmentMethod, type DecisionOutcome } from "@/lib/ckcm";
import { outcomeFor } from "@/lib/engines/outcomes";
import { SignaturePad, VoiceNoteButton, ScanButton } from "./CaptureTools";

// Conduct Assessment cockpit (client). Everything shown is backed by live data
// or the assessor's own in-session input; assistant signals are rule-derived
// from real records and labeled as such — no generative AI runs in-session.

export type CockpitLevel = { score: number; label: string; desc: string | null; color: string; passing: boolean };
export type CockpitItem = { id: string; item: string; critical: boolean };
export type CockpitSkill = { id: string; name: string; items: CockpitItem[] };
export type CockpitComp = {
  id: string; name: string; description: string | null;
  criteria: { id: string; text: string }[];
  skills: CockpitSkill[];
  methods: { method: string; required: boolean }[];
  prevScore: number | null; prevBy: string | null; prevAt: string | null;
  priorOutcome: string | null; evidenceCount: number;
};
export type CockpitDomain = { id: string; name: string; comps: CockpitComp[] };
export type CockpitFramework = { id: string; name: string; domains: CockpitDomain[] };

type Session = { id: string; method: string; location: string | null; at: string } | null;

type Props = {
  cycleId: string; cycleType: string;
  nurseId: string; nurseName: string; nurseSpec: string | null; nurseAvatar: string | null;
  assessorName: string;
  frameworks: CockpitFramework[];
  levels: CockpitLevel[];
  riskLevel: "high" | "medium" | "low";
  riskNotes: string[]; focusAreas: string[]; expiringSoon: string[];
  evidenceTotal: number;
  session: Session;
};

// assessments.method DB check constraint — only these 7 are storable.
const DB_METHODS = ["direct_observation", "simulation", "osce", "knowledge", "concurrent_audit", "retrospective_audit", "logbook"] as const;

const RISK_UI = {
  high:   { label: "High",   cls: "bg-red-100 text-red-700" },
  medium: { label: "Medium", cls: "bg-amber-100 text-amber-700" },
  low:    { label: "Low",    cls: "bg-green-100 text-green-700" },
};

const STEPS: { key: string; label: string; auto?: boolean; hint: string }[] = [
  { key: "prep",        label: "Preparation",          hint: "Brief the learner and review the framework" },
  { key: "identity",    label: "Learner Identity",     hint: "Confirm who you are assessing" },
  { key: "consent",     label: "Consent",              hint: "Learner consents to the assessment" },
  { key: "equipment",   label: "Equipment",            hint: "Required equipment checked" },
  { key: "observation", label: "Observation",          auto: true, hint: "Completes when you score a competency" },
  { key: "questioning", label: "Questioning",          hint: "Underpinning knowledge probed" },
  { key: "docs",        label: "Documentation Review", hint: "Learner documentation reviewed" },
  { key: "evidence",    label: "Evidence Upload",      auto: true, hint: "Completes when a file is attached" },
  { key: "feedback",    label: "Feedback",             auto: true, hint: "Completes when feedback is written" },
  { key: "decision",    label: "Decision",             auto: true, hint: "Completes with scores + attestation" },
  { key: "validation",  label: "Validation",           auto: true, hint: "Educator validates after submission" },
  { key: "complete",    label: "Complete",             auto: true, hint: "Session submitted" },
];

const RECOMMENDATION_OPTS: { key: string; label: string; danger?: boolean }[] = [
  { key: "competent",                  label: "Competent" },
  { key: "competent_with_supervision", label: "Competent with Supervision" },
  { key: "needs_development",          label: "Needs Development" },
  { key: "reassessment_required",      label: "Reassessment Required" },
  { key: "critical_failure",           label: "Critical Failure", danger: true },
];

const noopSubscribe = () => () => {};
const fmtElapsed = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function ConductCockpit({
  cycleId, cycleType, nurseId, nurseName, nurseSpec, nurseAvatar, assessorName,
  frameworks, levels, riskLevel, riskNotes, focusAreas, expiringSoon, evidenceTotal, session,
}: Props) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [checklist, setChecklist] = useState<Record<string, "yes" | "no" | "na">>({});
  const [manualSteps, setManualSteps] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<string>(
    session && (DB_METHODS as readonly string[]).includes(session.method) ? session.method : "direct_observation");
  const [location, setLocation] = useState(session?.location ?? "");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [attest, setAttest] = useState(false);
  const [activeFw, setActiveFw] = useState(frameworks[0]?.id ?? null);
  const [openDomain, setOpenDomain] = useState<string | null>(frameworks[0]?.domains[0]?.id ?? null);
  const [openComp, setOpenComp] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{ at: string; label: string }[]>([]);
  const [uploads, setUploads] = useState<{ id: string; name: string; compName: string }[]>([]);
  const [uploadBusy, setUploadBusy] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ scored: number; actions: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reqNote, setReqNote] = useState("");
  const [reqSent, setReqSent] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [sigAssessor, setSigAssessor] = useState<string | null>(null);
  const [sigLearner, setSigLearner] = useState<string | null>(null);
  const [sigWitness, setSigWitness] = useState<string | null>(null);
  const [witnessName, setWitnessName] = useState("");
  const [msgTo, setMsgTo] = useState<"learner" | "educators">("learner");
  const [msgText, setMsgText] = useState("");
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgSent, setMsgSent] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  const draftKey = `competen-conduct-${cycleId}`;
  const draftRaw = useSyncExternalStore(
    noopSubscribe,
    () => { try { return localStorage.getItem(draftKey); } catch { return null; } },
    () => null,
  );

  // Session timer — counts active (unpaused) seconds; stops after submission.
  useEffect(() => {
    if (paused || result) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [paused, result]);

  const logEvent = useCallback((label: string) => {
    const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setTimeline(prev => [...prev, { at, label }].slice(-14));
  }, []);

  const allComps = useMemo(() => frameworks.flatMap(f => f.domains.flatMap(d => d.comps)), [frameworks]);
  const totalComps = allComps.length;
  const scoredCount = Object.keys(scores).length;
  const pct = totalComps ? Math.round((scoredCount / totalComps) * 100) : 0;
  const avg = scoredCount ? Object.values(scores).reduce((s, v) => s + v, 0) / scoredCount : null;

  // Critical checklist items on scored competencies not yet confirmed "yes".
  const criticalRemaining = useMemo(() =>
    allComps.reduce((n, c) => scores[c.id] === undefined ? n :
      n + c.skills.reduce((m, s) => m + s.items.filter(i => i.critical && checklist[i.id] !== "yes").length, 0), 0),
  [allComps, scores, checklist]);

  const stepDone = (key: string): boolean => {
    switch (key) {
      case "observation": return scoredCount > 0;
      case "evidence":    return uploads.length > 0;
      case "feedback":    return !!(strengths.trim() || improvements.trim());
      case "decision":    return scoredCount > 0 && attest;
      case "validation":  return false; // educator step, after submission
      case "complete":    return !!result;
      default:            return !!manualSteps[key];
    }
  };
  const doneCount = STEPS.filter(s => stepDone(s.key)).length;

  // Projected outcomes from entered scores — engine rules, pre-validation.
  const projected = useMemo(() => {
    const counts = new Map<DecisionOutcome, number>();
    for (const c of allComps) {
      const sc = scores[c.id];
      if (sc === undefined) continue;
      const passing = levels.find(l => l.score === sc)?.passing ?? sc >= 3;
      const o = outcomeFor(sc, passing, false, sc === 0);
      counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [allComps, scores, levels]);

  const setScore = (comp: CockpitComp, score: number) => {
    setScores(prev => {
      if (prev[comp.id] === undefined) logEvent(`Scored — ${comp.name}`);
      return { ...prev, [comp.id]: score };
    });
    setOpenComp(comp.id);
  };

  const markStep = (key: string) => {
    setManualSteps(prev => {
      const next = { ...prev, [key]: !prev[key] };
      if (next[key]) logEvent(`${STEPS.find(s => s.key === key)?.label ?? key} confirmed`);
      return next;
    });
  };

  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        scores, notes, checklist, manualSteps, method, location, strengths, improvements,
        recommendation, witnessName, savedAt: new Date().toISOString(),
      }));
      setDraftSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      logEvent("Draft saved");
    } catch { setError("Could not save draft locally"); }
  }

  function resumeDraft() {
    try {
      const d = JSON.parse(draftRaw ?? "{}");
      if (d.scores) setScores(d.scores);
      if (d.notes) setNotes(d.notes);
      if (d.checklist) setChecklist(d.checklist);
      if (d.manualSteps) setManualSteps(d.manualSteps);
      if (typeof d.method === "string" && (DB_METHODS as readonly string[]).includes(d.method)) setMethod(d.method);
      if (typeof d.location === "string") setLocation(d.location);
      if (typeof d.strengths === "string") setStrengths(d.strengths);
      if (typeof d.improvements === "string") setImprovements(d.improvements);
      if (typeof d.recommendation === "string" && RECOMMENDATION_OPTS.some(o => o.key === d.recommendation)) setRecommendation(d.recommendation);
      if (typeof d.witnessName === "string") setWitnessName(d.witnessName);
      logEvent("Draft resumed");
    } catch { /* corrupt draft — ignore */ }
    setDraftDismissed(true);
  }

  function discardDraft() {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setDraftDismissed(true);
  }

  async function uploadEvidence(comp: CockpitComp, file: File) {
    setUploadBusy(comp.id); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("competency_id", comp.id);
    fd.append("note", `Conduct Assessment session — ${comp.name}`);
    const res = await fetch("/api/evidence", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.evidence) {
      setUploads(prev => [...prev, { id: d.evidence.id, name: d.evidence.file_name, compName: comp.name }]);
      logEvent(`Evidence attached — ${comp.name}`);
    } else {
      setError(d.error ?? "Upload failed");
    }
    setUploadBusy(null);
  }

  async function requestEvidence() {
    setReqBusy(true); setError(null);
    const res = await fetch("/api/passports/request-evidence", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nurse_id: nurseId, note: reqNote.trim() || undefined }),
    });
    if (res.ok) { setReqSent(true); logEvent("Additional evidence requested"); }
    else setError((await res.json().catch(() => ({})))?.error ?? "Request failed");
    setReqBusy(false);
  }

  async function askAi() {
    setAiBusy(true); setAiError(null);
    const res = await fetch("/api/ai/assess", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nurse_id: nurseId, competency_id: openComp ?? undefined, method }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.answer) { setAiText(d.answer); logEvent("AI suggestions generated"); }
    else setAiError(d.error ?? "AI request failed");
    setAiBusy(false);
  }

  async function sendMessage() {
    setMsgBusy(true); setError(null);
    const res = await fetch("/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msgTo === "educators" ? { to_educators: true, text: msgText } : { recipient_id: nurseId, text: msgText }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsgSent(msgTo === "educators" ? `Sent to ${d.recipients} educator${d.recipients === 1 ? "" : "s"}` : `Sent to ${nurseName}`);
      setMsgText("");
      logEvent(msgTo === "educators" ? "Message sent to educators" : `Message sent to ${nurseName}`);
    } else {
      setMsgSent(null);
      setError(d.error ?? "Message failed");
    }
    setMsgBusy(false);
  }

  async function submit() {
    setSubmitting(true); setError(null);
    const payload = {
      cycle_id: cycleId, nurse_id: nurseId, session_id: session?.id ?? null,
      method, location: location.trim() || null, attest, strengths, improvements,
      recommendation, duration_seconds: elapsed,
      witness_name: witnessName.trim() || null,
      signatures: { assessor: sigAssessor, learner: sigLearner, witness: sigWitness },
      workflow: STEPS.filter(s => stepDone(s.key)).map(s => s.key),
      scores: allComps.filter(c => scores[c.id] !== undefined).map(c => ({
        competency_id: c.id,
        score: scores[c.id],
        notes: (notes[c.id] ?? "").trim() || undefined,
        checklist: c.skills.flatMap(s => s.items).filter(i => checklist[i.id])
          .map(i => ({ item_id: i.id, response: checklist[i.id] })),
      })),
    };
    const res = await fetch("/api/assess/submit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setResult({ scored: d.scored ?? scoredCount, actions: d.actions ?? [] });
      setPaused(true);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      logEvent("Assessment submitted");
    } else {
      setError(d.error ?? "Submit failed");
    }
    setSubmitting(false);
  }

  const fw = frameworks.find(f => f.id === activeFw) ?? frameworks[0] ?? null;
  const risk = RISK_UI[riskLevel];
  const copilotPrompt = `I'm conducting a ${METHOD_LABELS[method as AssessmentMethod] ?? method} assessment for ${nurseName}${nurseSpec ? ` (${nurseSpec})` : ""} in their ${cycleType} cycle. Suggest observation prompts and probing questions${focusAreas.length ? `, focusing on previously not-passed areas: ${focusAreas.join(", ")}` : ""}.`;

  return (
    <div className="space-y-4">
      {/* Draft banner */}
      {draftRaw && !draftDismissed && !result && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-indigo-900">📝 A saved draft exists for this session.</span>
          <button onClick={resumeDraft} className="text-xs font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700">Resume draft</button>
          <button onClick={discardDraft} className="text-xs font-semibold text-indigo-700 border border-indigo-300 px-3 py-1.5 rounded-lg hover:bg-indigo-100">Discard</button>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 border-b border-gray-100">
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Assessment</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{fw?.name ?? "Competency Assessment"}</p>
            <p className="text-[10px] text-gray-400 capitalize">{cycleType} cycle</p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Learner</p>
            <div className="flex items-center gap-2 mt-1">
              {nurseAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
                <img src={nurseAvatar} alt="" className="w-6 h-6 rounded-full object-cover" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-teal-500 text-white text-[10px] font-bold flex items-center justify-center">{nurseName[0]}</span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{nurseName}</p>
                {nurseSpec && <p className="text-[10px] text-gray-400 truncate">{nurseSpec}</p>}
              </div>
            </div>
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Assessor</p>
            <p className="text-sm font-semibold text-gray-900 mt-1">{assessorName}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Type</p>
            <select value={method} onChange={e => setMethod(e.target.value)} disabled={!!result}
              className="mt-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-full text-gray-700 bg-white focus:outline-none focus:border-indigo-400">
              {DB_METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m as AssessmentMethod] ?? m}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Location</p>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Ward 3A" disabled={!!result}
              className="mt-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-full text-gray-700 focus:outline-none focus:border-indigo-400" />
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Risk Level</p>
            <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-1 rounded ${risk.cls}`}>{risk.label}</span>
            <p className="text-[9px] text-gray-400 mt-0.5">from decision records</p>
          </div>
        </div>
        <div className="px-5 py-2.5 flex items-center gap-4 flex-wrap bg-gray-50/60">
          <span className="text-[11px] text-gray-500" suppressHydrationWarning>
            📅 {new Date().toLocaleDateString()}{session ? ` · scheduled ${new Date(session.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${result ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
            {result ? "Submitted" : "In Progress"}
          </span>
          <span className="flex-1" />
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Session Duration</span>
          <span className="font-mono text-sm font-bold text-gray-900">⏱ {fmtElapsed(elapsed)}</span>
          {!result && (
            <>
              <button onClick={() => setPaused(p => !p)} title={paused ? "Resume timer" : "Pause timer"}
                className="w-8 h-8 rounded-lg border border-gray-200 text-xs hover:bg-gray-100">{paused ? "▶" : "⏸"}</button>
              <button onClick={() => { setPaused(true); document.getElementById("decision-band")?.scrollIntoView({ behavior: "smooth" }); }}
                title="End observation and go to decision"
                className="w-8 h-8 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs hover:bg-red-100">⏹</button>
            </>
          )}
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_290px]">
        {/* Workflow */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Assessment Workflow</p>
          <ol className="space-y-1">
            {STEPS.map((s, i) => {
              const done = stepDone(s.key);
              const locked = s.key === "validation";
              return (
                <li key={s.key}>
                  <button onClick={() => !s.auto && !result && markStep(s.key)} disabled={!!s.auto || !!result} title={s.hint}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12px] transition-colors ${
                      done ? "text-gray-900" : "text-gray-500"} ${!s.auto && !result ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                      done ? "bg-green-500 text-white" : locked ? "bg-gray-100 text-gray-400" : "bg-gray-100 text-gray-500 border border-gray-200"}`}>
                      {done ? "✓" : locked ? "🔒" : i + 1}
                    </span>
                    <span className="flex-1">{s.label}</span>
                    {s.auto && <span className="text-[8px] font-bold uppercase text-gray-300">auto</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[11px] text-gray-500 mb-1.5">{doneCount} / {STEPS.length} completed</p>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.round(doneCount / STEPS.length * 100)}%` }} />
            </div>
            <p className="text-[9px] text-gray-400 mt-2">Validation is completed by an educator after submission.</p>
          </div>
        </div>

        {/* Domains */}
        <div className="space-y-3 min-w-0">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900">Assessment Domains</p>
            <span className="flex-1" />
            {frameworks.length > 1 && frameworks.map(f => (
              <button key={f.id} onClick={() => { setActiveFw(f.id); setOpenDomain(f.domains[0]?.id ?? null); }}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                  f.id === (fw?.id ?? null) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
                {f.name}
              </button>
            ))}
          </div>

          {/* Scoring legend from real scoring_levels */}
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {levels.map(l => (
              <span key={l.score} className="flex items-center gap-1.5 text-[10px] text-gray-600" title={l.desc ?? undefined}>
                <span className="w-4 h-4 rounded-full text-white text-[8px] font-bold flex items-center justify-center" style={{ backgroundColor: l.color }}>{l.score}</span>
                {l.label}{l.passing && <span className="text-green-500">✓</span>}
              </span>
            ))}
          </div>

          {(fw?.domains ?? []).map((d, di) => {
            const dScored = d.comps.filter(c => scores[c.id] !== undefined).length;
            const open = openDomain === d.id;
            return (
              <div key={d.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button onClick={() => setOpenDomain(open ? null : d.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50/60 transition-colors">
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center">{di + 1}</span>
                  <span className="text-sm font-semibold text-gray-900 flex-1 text-left">{d.name}</span>
                  <span className="text-[10px] text-gray-400">{dScored}/{d.comps.length} scored</span>
                  <span className="text-gray-300 text-xs">{open ? "▲" : "▼"}</span>
                </button>
                {open && (
                  <div className="divide-y divide-gray-50 border-t border-gray-100">
                    {d.comps.map(c => {
                      const sc = scores[c.id];
                      const expanded = openComp === c.id;
                      const prior = c.priorOutcome ? OUTCOME_CONFIG[c.priorOutcome as DecisionOutcome] : null;
                      return (
                        <div key={c.id} className="px-4 py-3">
                          <div className="flex items-start gap-3 flex-wrap">
                            <button onClick={() => setOpenComp(expanded ? null : c.id)} className="flex-1 min-w-[200px] text-left">
                              <p className="text-sm font-medium text-gray-800">{c.name}</p>
                              <span className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {c.prevScore != null && (
                                  <span className="text-[9px] text-gray-400">prev {c.prevScore}/6 · {c.prevBy}{c.prevAt ? ` · ${c.prevAt}` : ""}</span>
                                )}
                                {prior && !prior.passing && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${prior.cls}`}>{prior.label}</span>
                                )}
                                {c.evidenceCount > 0 && <span className="text-[9px] text-gray-400">📎 {c.evidenceCount} evidence</span>}
                                {(c.criteria.length > 0 || c.skills.some(s => s.items.length)) && (
                                  <span className="text-[9px] text-indigo-400">{expanded ? "hide detail ▲" : "criteria & checklist ▼"}</span>
                                )}
                              </span>
                            </button>
                            <span className="flex items-center gap-1 shrink-0">
                              {levels.map(l => (
                                <button key={l.score} onClick={() => !result && setScore(c, l.score)} title={`${l.label}${l.desc ? ` — ${l.desc}` : ""}`}
                                  disabled={!!result}
                                  className={`w-7 h-7 rounded text-xs font-bold border transition-all ${
                                    sc === l.score ? "text-white border-transparent ring-2 ring-offset-1" : "border-gray-200 bg-white text-gray-400 hover:border-gray-400"}`}
                                  style={sc === l.score ? { backgroundColor: l.color } : undefined}>
                                  {l.score}
                                </button>
                              ))}
                              {sc !== undefined && !result && (
                                <button onClick={() => setScores(prev => { const n = { ...prev }; delete n[c.id]; return n; })}
                                  className="w-7 h-7 rounded text-xs text-gray-400 hover:text-red-500 border border-transparent hover:border-red-200" title="Clear score">×</button>
                              )}
                            </span>
                          </div>

                          {expanded && (
                            <div className="mt-3 space-y-3">
                              {c.description && <p className="text-xs text-gray-500">{c.description}</p>}

                              {c.criteria.length > 0 && (
                                <div className="bg-gray-50 rounded-lg p-3">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Performance Criteria</p>
                                  <ul className="space-y-1">
                                    {c.criteria.map((pc, i) => (
                                      <li key={pc.id} className="text-xs text-gray-600 flex gap-2">
                                        <span className="text-gray-400 shrink-0">{di + 1}.{i + 1}</span>{pc.text}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {c.skills.filter(s => s.items.length > 0).map(s => (
                                <div key={s.id} className="bg-gray-50 rounded-lg p-3">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Checklist — {s.name}</p>
                                  <ul className="space-y-1.5">
                                    {s.items.map(it => (
                                      <li key={it.id} className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs text-gray-700 flex-1 min-w-[160px]">
                                          {it.item}
                                          {it.critical && <span className="ml-1.5 text-[8px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 uppercase">Critical</span>}
                                        </span>
                                        <span className="flex gap-1">
                                          {(["yes", "no", "na"] as const).map(v => (
                                            <button key={v} disabled={!!result}
                                              onClick={() => setChecklist(prev => ({ ...prev, [it.id]: prev[it.id] === v ? undefined : v } as Record<string, "yes" | "no" | "na">))}
                                              className={`text-[9px] font-bold uppercase px-2 py-1 rounded border transition-colors ${
                                                checklist[it.id] === v
                                                  ? v === "yes" ? "bg-green-500 text-white border-green-500"
                                                    : v === "no" ? "bg-red-500 text-white border-red-500"
                                                    : "bg-gray-400 text-white border-gray-400"
                                                  : "bg-white text-gray-400 border-gray-200 hover:border-gray-400"}`}>
                                              {v === "na" ? "N/A" : v}
                                            </button>
                                          ))}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}

                              {c.methods.length > 0 && (
                                <p className="text-[10px] text-gray-400">
                                  Methods: {c.methods.map(m => `${METHOD_LABELS[m.method as AssessmentMethod] ?? m.method}${m.required ? " (required)" : ""}`).join(" · ")}
                                </p>
                              )}

                              <div className="flex items-center gap-2 flex-wrap">
                                <input
                                  className="flex-1 min-w-[200px] text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400"
                                  placeholder="Observation note (saved with the score)…"
                                  value={notes[c.id] ?? ""} disabled={!!result}
                                  onChange={e => setNotes(prev => ({ ...prev, [c.id]: e.target.value }))} />
                                <label className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                                  uploadBusy === c.id ? "text-gray-400 border-gray-200" : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"}`}>
                                  {uploadBusy === c.id ? "Uploading…" : "📎 Attach evidence"}
                                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mp3,.m4a,.wav,.ogg" className="hidden" disabled={uploadBusy === c.id || !!result}
                                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadEvidence(c, f); e.target.value = ""; }} />
                                </label>
                                <VoiceNoteButton disabled={uploadBusy === c.id || !!result}
                                  onFile={f => uploadEvidence(c, f)} onError={m => setError(m)} />
                                <ScanButton disabled={!!result}
                                  onResult={code => {
                                    setNotes(prev => ({ ...prev, [c.id]: `${prev[c.id] ? `${prev[c.id]} ` : ""}[Scanned: ${code}]` }));
                                    logEvent(`Code scanned — ${c.name}`);
                                  }}
                                  onError={m => setError(m)} />
                              </div>
                              <p className="text-[9px] text-gray-400">Photos, PDFs, video (≤50MB), voice notes; scanned codes are saved into the observation note.</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {(fw?.domains ?? []).length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
              No active framework content is assigned to this cycle.
            </div>
          )}
        </div>

        {/* Rail */}
        <div className="space-y-3 lg:col-span-2 xl:col-span-1 grid gap-3 md:grid-cols-2 xl:grid-cols-1 xl:block">
          <div className="bg-white border border-gray-200 rounded-xl p-4 xl:mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Key Metrics</p>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between"><span className="text-gray-500">Completion</span><span className="font-bold text-gray-900">{pct}%</span></div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
              <div className="flex items-center justify-between"><span className="text-gray-500">Competencies scored</span><span className="font-bold text-gray-900">{scoredCount}/{totalComps}</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-500">Average score</span><span className="font-bold text-gray-900">{avg != null ? avg.toFixed(1) : "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-500">Critical items unconfirmed</span>
                <span className={`font-bold ${criticalRemaining > 0 ? "text-red-600" : "text-gray-900"}`}>{criticalRemaining}</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-500">Evidence files (learner + session)</span><span className="font-bold text-gray-900">{evidenceTotal + uploads.length}</span></div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 xl:mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Assessment Assistant</p>
            <p className="text-[9px] text-gray-400 mb-2.5">Rule-based signals from this learner&apos;s records — no generative AI runs in-session.</p>
            <ul className="space-y-1.5 text-xs text-gray-600">
              {riskNotes.map((n, i) => <li key={`r${i}`} className="flex gap-1.5"><span>🚩</span>{n}</li>)}
              {focusAreas.map((n, i) => <li key={`f${i}`} className="flex gap-1.5"><span>🎯</span>Previously not passed: {n}</li>)}
              {expiringSoon.map((n, i) => <li key={`e${i}`} className="flex gap-1.5"><span>⏳</span>Renewal due soon: {n}</li>)}
              {criticalRemaining > 0 && <li className="flex gap-1.5 text-red-600"><span>⚠️</span>{criticalRemaining} critical checklist item{criticalRemaining === 1 ? "" : "s"} not yet confirmed</li>}
              {riskNotes.length + focusAreas.length + expiringSoon.length === 0 && criticalRemaining === 0 && (
                <li className="text-gray-400">No risk signals on this learner&apos;s decision record.</li>
              )}
            </ul>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <button onClick={askAi} disabled={aiBusy || !!result}
                className="w-full text-[11px] font-bold text-white bg-indigo-600 rounded-lg px-3 py-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {aiBusy ? "Thinking…" : openComp ? "✨ AI suggestions for this competency" : "✨ Get AI suggestions"}
              </button>
              {aiError && <p className="text-[10px] text-red-600 mt-1.5">{aiError}</p>}
              {aiText && (
                <div className="mt-2 bg-indigo-50/60 border border-indigo-100 rounded-lg p-2.5">
                  <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{aiText}</p>
                  <p className="text-[8px] text-gray-400 mt-1.5">Generated by Claude from governed framework content — advisory only; the decision is yours.</p>
                </div>
              )}
              <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
                className="mt-2 block text-center text-[10px] font-semibold text-indigo-500 hover:underline">
                Open full AI Copilot →
              </Link>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 xl:mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Related Resources</p>
            <div className="space-y-1 text-xs">
              <Link href={`/assessor/passports?n=${nurseId}`} className="block text-indigo-600 hover:underline">🛂 Learner passport</Link>
              <Link href="/assessor/logbook" className="block text-indigo-600 hover:underline">🖊️ Evidence Validation Centre</Link>
              <Link href="/assessor/frameworks" className="block text-indigo-600 hover:underline">🗂️ Assessment frameworks</Link>
              <Link href="/dashboard/knowledge" className="block text-indigo-600 hover:underline">🔬 Knowledge Hub</Link>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 xl:mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Session Timeline</p>
            <ul className="space-y-1.5 text-[11px] text-gray-600">
              <li className="flex gap-2"><span className="text-gray-400 font-mono shrink-0">—</span>Assessment session opened</li>
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-2"><span className="text-gray-400 font-mono shrink-0">{t.at}</span>{t.label}</li>
              ))}
            </ul>
            {uploads.length > 0 && (
              <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-50">
                {uploads.length} file{uploads.length === 1 ? "" : "s"} attached this session
              </p>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Communication</p>
            <div className="flex gap-1 mb-2">
              {(["learner", "educators"] as const).map(t => (
                <button key={t} onClick={() => { setMsgTo(t); setMsgSent(null); }}
                  className={`flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
                    msgTo === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300"}`}>
                  {t === "learner" ? `💬 ${nurseName.split(" ")[0]}` : "💬 Educators"}
                </button>
              ))}
            </div>
            <textarea value={msgText} onChange={e => setMsgText(e.target.value)} rows={2} maxLength={1000}
              placeholder={msgTo === "learner" ? `Message ${nurseName}…` : "Message the hospital educators…"}
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
            <button onClick={sendMessage} disabled={msgBusy || !msgText.trim()}
              className="mt-1 w-full text-[11px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-3 py-2 hover:bg-indigo-50 disabled:opacity-50 transition-colors">
              {msgBusy ? "Sending…" : "Send message"}
            </button>
            {msgSent && <p className="text-[10px] text-green-600 mt-1">✓ {msgSent}</p>}

            <div className="mt-3 pt-3 border-t border-gray-100">
              {reqSent ? (
                <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">✓ Evidence request sent to {nurseName}.</p>
              ) : (
                <div className="space-y-2">
                  <input value={reqNote} onChange={e => setReqNote(e.target.value)} placeholder="What evidence do you need? (optional)"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
                  <button onClick={requestEvidence} disabled={reqBusy}
                    className="w-full text-[11px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-3 py-2 hover:bg-indigo-50 disabled:opacity-50 transition-colors">
                    {reqBusy ? "Sending…" : "📎 Request additional evidence"}
                  </button>
                </div>
              )}
            </div>
            <p className="text-[9px] text-gray-400 mt-2">Messages deliver as one-way notifications — threaded chat is a future module.</p>
          </div>
        </div>
      </div>

      {/* ── Decision band ──────────────────────────────────────────────────── */}
      <div id="decision-band" className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Overall Decision — Assessor Recommendation</p>
            <div className="space-y-1">
              {RECOMMENDATION_OPTS.map(o => (
                <label key={o.key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  recommendation === o.key
                    ? o.danger ? "border-red-400 bg-red-50 text-red-700 font-semibold" : "border-indigo-400 bg-indigo-50 text-indigo-800 font-semibold"
                    : "border-gray-100 text-gray-600 hover:border-gray-300"}`}>
                  <input type="radio" name="recommendation" checked={recommendation === o.key} disabled={!!result}
                    onChange={() => setRecommendation(o.key)} className="accent-indigo-600" />
                  {o.label}
                </label>
              ))}
              {recommendation && !result && (
                <button onClick={() => setRecommendation(null)} className="text-[9px] text-gray-400 hover:text-red-500 px-2.5">clear selection</button>
              )}
            </div>
            <p className="text-[9px] text-gray-400 mt-2">
              Advisory — recorded with the session and shown to the educator. The formal decision run (educator/admin) issues outcomes and updates the passport.
            </p>
          </div>

          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Projected Outcomes</p>
            {projected.length === 0 ? (
              <p className="text-xs text-gray-400">Score at least one competency to see projected outcomes.</p>
            ) : (
              <div className="space-y-1.5">
                {projected.map(([o, n]) => (
                  <div key={o} className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded ${OUTCOME_CONFIG[o].cls}`}>{OUTCOME_CONFIG[o].label}</span>
                    <span className="text-xs font-bold text-gray-900">{n}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-gray-400 mt-2.5">
              Projected from entered scores by the decision engine. Formal decisions — and the Competency Passport — update when an educator or admin runs the cycle decision process after validation.
            </p>
          </div>

          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Feedback &amp; Development</p>
            <textarea value={strengths} onChange={e => setStrengths(e.target.value)} disabled={!!result} rows={2}
              placeholder="Strengths observed…"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:border-indigo-400 mb-2" />
            <textarea value={improvements} onChange={e => setImprovements(e.target.value)} disabled={!!result} rows={2}
              placeholder="Areas to develop…"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:border-indigo-400" />
            <p className="text-[9px] text-gray-400 mt-1">Included in the learner&apos;s notification and the audit trail.</p>
          </div>

          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Signatures</p>
            <div className="space-y-3">
              <SignaturePad label={`Assessor — ${assessorName}`} disabled={!!result} onChange={setSigAssessor} />
              <SignaturePad label={`Learner — ${nurseName} (signs on this device)`} disabled={!!result} onChange={setSigLearner} />
              <details>
                <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600">Witness signature (optional)</summary>
                <input value={witnessName} onChange={e => setWitnessName(e.target.value)} placeholder="Witness name" disabled={!!result}
                  className="mt-2 mb-2 w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
                <SignaturePad label="Witness" disabled={!!result} onChange={setSigWitness} />
              </details>
            </div>
            <p className="text-[9px] text-gray-400 mt-2">Stored as PNGs in the private evidence store with the session record.</p>
          </div>

          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Attestation &amp; Submit</p>
            <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} disabled={!!result} className="mt-0.5" />
              I attest that this assessment reflects my own direct professional judgement of {nurseName}&apos;s practice.
            </label>
            <p className="text-[9px] text-gray-400 mt-1.5">Recorded with your name, signature and timestamp in the session record and audit trail.</p>
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={saveDraft} disabled={!!result}
                className="flex-1 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg px-3 py-2.5 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                {draftSavedAt ? `Draft saved ${draftSavedAt}` : "Save Draft"}
              </button>
              <button onClick={submit} disabled={submitting || scoredCount === 0 || !attest || !!result}
                className="flex-1 text-xs font-bold text-white bg-indigo-600 rounded-lg px-3 py-2.5 hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                {result ? "Submitted ✓" : submitting ? "Submitting…" : `Submit (${scoredCount})`}
              </button>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Automatic Actions on Submit</p>
            {result ? (
              <>
                <ul className="space-y-1.5 text-xs text-green-700">
                  {result.actions.map((a, i) => <li key={i} className="flex gap-1.5"><span>✅</span>{a}</li>)}
                </ul>
                <div className="flex gap-2 mt-3">
                  <Link href={`/assessor/passports?n=${nurseId}`} className="flex-1 text-center text-[11px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2 py-2 hover:bg-indigo-50">View Passport</Link>
                  <Link href="/assessor/queue" className="flex-1 text-center text-[11px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2 py-2 hover:bg-indigo-50">Back to Inbox</Link>
                </div>
              </>
            ) : (
              <ul className="space-y-1.5 text-xs text-gray-600">
                <li className="flex gap-1.5"><span>📝</span>Record scores &amp; checklist responses</li>
                <li className="flex gap-1.5"><span>🧮</span>Recompute consensus &amp; rollups</li>
                <li className="flex gap-1.5"><span>🗃️</span>Save session record, recommendation &amp; signatures</li>
                <li className="flex gap-1.5"><span>🔔</span>Notify the learner</li>
                <li className="flex gap-1.5"><span>🧾</span>Write the audit trail</li>
                {session && <li className="flex gap-1.5"><span>📅</span>Mark the scheduled session complete</li>}
                <li className="flex gap-1.5 text-gray-400"><span>🛂</span>Passport updates after educator decision-run</li>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
