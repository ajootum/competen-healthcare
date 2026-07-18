"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Educator Validation Centre (COMPETEN Educator Validation Centre spec +
// approved mockup). Queue tabs, validation cards, in-page review workspace,
// structured verification checklist, real AI validation assistant and
// live analytics — every figure from live records.
//
// Honest departures (no backing store — labelled, not faked): escalation and
// due-date states aren't tracked (Escalated tab disabled, no "due" chips);
// evidence files aren't linked to competency scores, so the evidence list
// shows assessor records and criteria instead; "Request Additional Evidence"
// and moderator escalation are omitted until those workflows exist. Priority
// is derived: failed scores review first. Verification and quality checklists
// are educator attestations stored in the validation notes.

export type AssessmentRow = { id: string; assessor: string; method: string; score: number | null; notes: string | null; assessedAt: string | null };
export type HistoryRow = { id: string; score: number; assessedAt: string; validated: boolean };
export type QueueItem = {
  id: string; competencyId: string; cycleId: string; nurseId: string;
  competency: string; framework: string; domain: string; criteria: string[];
  nurse: string; score: number; label: string | null; isPassing: boolean;
  assessedAt: string; attempt: number; returned: boolean; educatorNotes: string | null;
  assessments: AssessmentRow[]; history: HistoryRow[]; spread: number | null;
};
export type ArchiveItem = { id: string; competency: string; nurse: string; score: number; isPassing: boolean; assessedAt: string; validatedAt: string | null };
export type CentreStats = {
  pending: number; highPriority: number; overdue: number; validatedToday: number; returned: number;
  avgReviewDays: number | null; approvalRate: number | null; returnRate: number | null;
  passRate: number | null; validationRate: number | null; spreadAvg: number | null;
};

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];
const SCORE_LABELS = ["Training Required", "Novice", "Advanced Beginner", "Competent", "Competent+", "Proficient", "Expert"];
const METHOD_LABELS: Record<string, string> = {
  knowledge: "Knowledge", direct_observation: "Direct Obs.", simulation: "Simulation",
  osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Retro. Audit", logbook: "Logbook",
};

const VERIFICATION = [
  "Learning outcomes met",
  "Evidence complete",
  "Assessment rubric followed",
  "Assessor comments reviewed",
  "Standards met",
  "Competency ready",
  "Passport eligible",
];

const QUALITY = [
  "Evidence authenticity", "Clinical safety", "Professional behaviour", "Documentation quality",
  "Consistency", "Knowledge demonstrated", "Skills demonstrated", "Decision making",
  "Communication", "Critical thinking",
];

type Tab = "pending" | "revision" | "archive";

export default function ValidationCentre({ queue, archive, stats }: {
  queue: QueueItem[]; archive: ArchiveItem[]; stats: CentreStats;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [q, setQ] = useState("");
  const [prio, setPrio] = useState<"all" | "high" | "normal">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("oldest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [quality, setQuality] = useState<Set<string>>(new Set());
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [ai, setAi] = useState<Record<string, { text: string; loading?: boolean; error?: string }>>({});

  const pendingItems = queue.filter(i => !i.returned);
  const revisionItems = queue.filter(i => i.returned);

  const rows = useMemo(() => {
    let items = tab === "pending" ? pendingItems : tab === "revision" ? revisionItems : [];
    if (prio !== "all") items = items.filter(i => prio === "high" ? !i.isPassing : i.isPassing);
    const term = q.trim().toLowerCase();
    if (term) items = items.filter(i => i.competency.toLowerCase().includes(term) || i.nurse.toLowerCase().includes(term));
    return [...items].sort((a, b) => sort === "oldest"
      ? a.assessedAt.localeCompare(b.assessedAt)
      : b.assessedAt.localeCompare(a.assessedAt));
  }, [tab, pendingItems, revisionItems, prio, q, sort]);

  const archiveRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? archive.filter(i => i.competency.toLowerCase().includes(term) || i.nurse.toLowerCase().includes(term)) : archive;
  }, [archive, q]);

  const selected = queue.find(i => i.id === selectedId) ?? null;

  function select(id: string | null) {
    setSelectedId(id);
    setChecks(new Set()); setQuality(new Set());
    setStrengths(""); setImprovements(""); setConditions("");
    setDone(null);
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n);
  };

  const allVerified = VERIFICATION.every(v => checks.has(v));

  function buildNotes(kind: string) {
    const parts = [`[Educator validation — ${kind}]`];
    parts.push(`Verification: ${checks.size}/${VERIFICATION.length} confirmed${checks.size < VERIFICATION.length ? ` (missing: ${VERIFICATION.filter(v => !checks.has(v)).join("; ")})` : ""}.`);
    if (quality.size) parts.push(`Quality checks confirmed: ${[...quality].join("; ")}.`);
    if (strengths.trim()) parts.push(`Strengths: ${strengths.trim()}`);
    if (improvements.trim()) parts.push(`Areas requiring improvement: ${improvements.trim()}`);
    if (conditions.trim()) parts.push(`Conditions: ${conditions.trim()}`);
    return parts.join("\n");
  }

  async function act(action: "validate" | "return", kind: string) {
    if (!selected) return;
    setBusy(true);
    const res = await fetch("/api/educator/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competency_score_id: selected.id, action, notes: buildNotes(kind) }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(kind);
      router.refresh();
    }
  }

  async function runAi() {
    if (!selected) return;
    const id = selected.id;
    setAi(prev => ({ ...prev, [id]: { text: "", loading: true } }));
    try {
      const res = await fetch("/api/educator/ai-validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competency_score_id: id }),
      });
      const body = await res.json();
      setAi(prev => ({ ...prev, [id]: res.ok ? { text: body.answer } : { text: "", error: body.error ?? "Assistant failed" } }));
    } catch {
      setAi(prev => ({ ...prev, [id]: { text: "", error: "Assistant unreachable" } }));
    }
  }

  function exportCsv() {
    const items = tab === "archive" ? archiveRows : rows;
    const head = tab === "archive"
      ? "Competency,Learner,Score,Passing,Assessed,Validated\n"
      : "Competency,Learner,Score,Passing,Assessed,Attempt,Status\n";
    const body = tab === "archive"
      ? archiveRows.map(i => [i.competency, i.nurse, i.score, i.isPassing, i.assessedAt.slice(0, 10), i.validatedAt?.slice(0, 10) ?? ""].map(v => `"${v}"`).join(",")).join("\n")
      : (items as QueueItem[]).map(i => [i.competency, i.nurse, i.score, i.isPassing, i.assessedAt.slice(0, 10), i.attempt, i.returned ? "returned" : "pending"].map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([head + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `validation-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const SUMMARY = [
    { icon: "🕐", tint: "bg-purple-50", label: "Pending Reviews", v: String(stats.pending), sub: "awaiting your review" },
    { icon: "🚩", tint: "bg-red-50", label: "High Priority", v: String(stats.highPriority), sub: "failed — review first" },
    { icon: "⏰", tint: "bg-amber-50", label: "Overdue", v: String(stats.overdue), sub: "waiting >7 days" },
    { icon: "✅", tint: "bg-green-50", label: "Validated Today", v: String(stats.validatedToday), sub: "by you" },
    { icon: "↩️", tint: "bg-orange-50", label: "Returned for Revision", v: String(stats.returned), sub: "needs re-assessment" },
    { icon: "⬆️", tint: "bg-gray-50", label: "Escalated", v: "—", sub: "not tracked yet" },
  ];

  const aiState = selected ? ai[selected.id] : undefined;

  return (
    <div className="max-w-[1500px]">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-lg shrink-0">🛡️</span>
        <div className="mr-auto">
          <h1 className="text-xl font-bold text-gray-900">Validation Centre</h1>
          <p className="text-gray-400 text-sm">Review and validate learner evidence against competency standards</p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 focus-within:border-purple-400 transition-colors">
          <span className="text-gray-400 text-sm">🔍</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search learners, competencies…"
            className="w-48 text-sm outline-none placeholder:text-gray-300 bg-transparent" aria-label="Search queue" />
        </div>
        <button onClick={exportCsv}
          className="text-xs font-semibold text-gray-700 border border-gray-200 bg-white hover:border-purple-300 rounded-xl px-3.5 py-2.5 transition-colors">
          ⬇ Export Report
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {SUMMARY.map(c => (
          <div key={c.label} className={`${c.tint} border border-gray-100 rounded-2xl p-3.5`}>
            <p className="text-base">{c.icon}</p>
            <p className="text-[10px] font-semibold text-gray-600 mt-1 leading-tight">{c.label}</p>
            <p className="text-xl font-extrabold text-gray-900 leading-tight">{c.v}</p>
            <p className="text-[9px] text-gray-400">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs + toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {([
          { key: "pending" as Tab, label: `Pending Validation (${pendingItems.length})` },
          { key: "revision" as Tab, label: `Needs Revision (${revisionItems.length})` },
        ]).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); select(null); }}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.key ? "bg-purple-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-purple-300"
            }`}>{t.label}</button>
        ))}
        <span title="Escalation isn't tracked yet — no escalation state exists on validation records"
          className="rounded-full px-4 py-1.5 text-xs font-semibold bg-gray-50 text-gray-300 cursor-default select-none">
          Escalated <span className="text-[8px] font-bold uppercase tracking-wider bg-gray-100 text-gray-400 rounded px-1 py-0.5 ml-0.5">soon</span>
        </span>
        <button onClick={() => { setTab("archive"); select(null); }}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
            tab === "archive" ? "bg-purple-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-purple-300"
          }`}>Validated Archive ({archive.length})</button>
        <span className="flex-1" />
        <select value={prio} onChange={e => setPrio(e.target.value as typeof prio)}
          className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600" aria-label="Filter by priority">
          <option value="all">Priority: All</option>
          <option value="high">High (failed)</option>
          <option value="normal">Normal (passing)</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
          className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600" aria-label="Sort order">
          <option value="oldest">Sort: Oldest first</option>
          <option value="newest">Sort: Newest first</option>
        </select>
      </div>

      {tab === "archive" ? (
        /* ---------- Archive table ---------- */
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          {archiveRows.length === 0 ? (
            <p className="p-10 text-center text-sm text-gray-400">No validated records yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {["Competency", "Learner", "Score", "Result", "Assessed", "Validated"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {archiveRows.map(i => (
                    <tr key={i.id}>
                      <td className="px-4 py-2.5 text-[13px] text-gray-800">{i.competency}</td>
                      <td className="px-4 py-2.5 text-[12px] text-gray-500">{i.nurse}</td>
                      <td className="px-4 py-2.5">
                        <span className="w-6 h-6 rounded-full inline-flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ backgroundColor: SCORE_COLORS[i.score] ?? "#9ca3af" }}>{i.score}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${i.isPassing ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
                          {i.isPassing ? "Pass" : "Fail"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-gray-400">{i.assessedAt.slice(0, 10)}</td>
                      <td className="px-4 py-2.5 text-[11px] text-gray-400">{i.validatedAt ? i.validatedAt.slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* ---------- Queue + workspace ---------- */
        <div className={`grid grid-cols-1 gap-5 items-start ${selected ? "xl:grid-cols-[320px_minmax(0,1fr)_300px] lg:grid-cols-[320px_minmax(0,1fr)]" : ""}`}>
          {/* Queue cards */}
          <div className="flex flex-col gap-2.5 min-w-0">
            {rows.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="text-sm font-semibold text-gray-700">
                  {tab === "pending" ? "Queue clear" : "Nothing awaiting revision"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {q || prio !== "all" ? "Try clearing the search or filters." : "New submissions land here as assessors complete their work."}
                </p>
              </div>
            ) : rows.map(i => (
              <button key={i.id} onClick={() => select(i.id === selectedId ? null : i.id)}
                className={`text-left bg-white border rounded-2xl p-4 transition-colors ${
                  i.id === selectedId ? "border-purple-400 ring-1 ring-purple-200" : "border-gray-100 hover:border-purple-200"
                }`}>
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: SCORE_COLORS[i.score] ?? "#9ca3af" }}>{i.score}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-gray-900 leading-snug">{i.competency}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{i.nurse}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded shrink-0 ${i.isPassing ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600"}`}>
                    {i.isPassing ? "Medium" : "High"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  {i.assessments[0] && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
                      {METHOD_LABELS[i.assessments[0].method] ?? i.assessments[0].method}
                    </span>
                  )}
                  <span className="text-[9px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Attempt {i.attempt}</span>
                  <span className="text-[9px] text-gray-300 ml-auto">{i.assessedAt.slice(0, 10)}</span>
                </div>
              </button>
            ))}
            <p className="text-[9px] text-gray-300">Priority derives from pass/fail; due dates aren&apos;t tracked on validations yet.</p>
          </div>

          {/* Review workspace */}
          {selected ? (
            <>
              <div className="bg-white border border-gray-100 rounded-2xl p-5 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider bg-purple-100 text-purple-700 rounded px-2 py-0.5">
                    {selected.returned ? "Returned" : "Reviewing"}
                  </span>
                  <h2 className="text-base font-bold text-gray-900">{selected.competency}</h2>
                  {selected.assessments[0] && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-teal-50 text-teal-700 rounded px-2 py-0.5">
                      {METHOD_LABELS[selected.assessments[0].method] ?? selected.assessments[0].method}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-y border-gray-50 py-3 my-3">
                  {[
                    { l: "Learner", v: selected.nurse },
                    { l: "Framework", v: `${selected.framework} › ${selected.domain}` },
                    { l: "Submitted", v: selected.assessedAt.slice(0, 10) },
                    { l: "Attempt", v: `${selected.attempt} · score ${selected.score}/6 (${SCORE_LABELS[selected.score] ?? "—"})` },
                  ].map(m => (
                    <div key={m.l} className="min-w-0">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{m.l}</p>
                      <p className="text-[11px] text-gray-800 font-medium truncate" title={m.v}>{m.v}</p>
                    </div>
                  ))}
                </div>

                {/* Individual assessments */}
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2">Assessment Results ({selected.assessments.length})</p>
                {selected.assessments.length === 0 ? (
                  <p className="text-xs text-gray-400 mb-3">No individual assessment records for this cycle.</p>
                ) : (
                  <div className="flex flex-col gap-2 mb-3">
                    {selected.assessments.map(a => (
                      <div key={a.id} className="flex items-start gap-2.5 bg-gray-50/60 rounded-xl px-3 py-2">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: SCORE_COLORS[a.score ?? 0] ?? "#9ca3af" }}>{a.score ?? "?"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold text-gray-800">{a.assessor} <span className="font-normal text-gray-400">· {METHOD_LABELS[a.method] ?? a.method}</span></p>
                          {a.notes ? <p className="text-[11px] text-gray-600 italic leading-snug">&ldquo;{a.notes}&rdquo;</p>
                            : <p className="text-[10px] text-gray-300">No assessor notes.</p>}
                        </div>
                        <span className="text-[9px] text-gray-300 shrink-0">{a.assessedAt?.slice(0, 10) ?? "—"}</span>
                      </div>
                    ))}
                    {selected.spread !== null && (
                      <p className={`text-[10px] ${selected.spread >= 2 ? "text-amber-600 font-semibold" : "text-gray-400"}`}>
                        Assessor scoring spread: {selected.spread} point{selected.spread === 1 ? "" : "s"}{selected.spread >= 2 ? " — review for consistency" : ""}
                      </p>
                    )}
                  </div>
                )}

                {/* Performance criteria */}
                {selected.criteria.length > 0 && (
                  <>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2">Performance Criteria</p>
                    <div className="flex flex-col gap-1 mb-3">
                      {selected.criteria.map((c, i) => (
                        <p key={i} className="text-[11px] text-gray-600 flex gap-2"><span className="text-gray-300 shrink-0">{i + 1}.</span>{c}</p>
                      ))}
                    </div>
                  </>
                )}

                {/* Learning history */}
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2">Learning History</p>
                {selected.history.length <= 1 ? (
                  <p className="text-xs text-gray-400">First recorded attempt on this competency.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.history.map(h => (
                      <span key={h.id} className="flex items-center gap-1.5 bg-gray-50 rounded-full pl-1 pr-2.5 py-0.5">
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                          style={{ backgroundColor: SCORE_COLORS[h.score] ?? "#9ca3af" }}>{h.score}</span>
                        <span className="text-[9px] text-gray-500">{h.assessedAt.slice(0, 10)}{h.validated ? " ✓" : ""}</span>
                      </span>
                    ))}
                  </div>
                )}

                {selected.returned && selected.educatorNotes && (
                  <div className="mt-3 bg-orange-50 border border-orange-100 rounded-xl p-3">
                    <p className="text-[9px] font-bold text-orange-600 uppercase tracking-widest mb-1">Previous return notes</p>
                    <p className="text-[11px] text-gray-700 whitespace-pre-line leading-snug">{selected.educatorNotes}</p>
                  </div>
                )}

                <p className="text-[9px] text-gray-300 mt-3">
                  Evidence files aren&apos;t linked to competency scores in the current data model — video, reflection and document review happens in the assessor evidence workspace.
                </p>
              </div>

              {/* Decision panel */}
              <div className="flex flex-col gap-4 min-w-0 lg:col-span-2 xl:col-span-1">
                {done ? (
                  <div className="bg-white border-2 border-green-500 rounded-2xl p-5 text-center">
                    <p className="text-2xl mb-1">✅</p>
                    <p className="text-sm font-bold text-gray-900">Decision recorded</p>
                    <p className="text-xs text-gray-400 mt-1 capitalize">{done}</p>
                    <button onClick={() => select(null)}
                      className="mt-3 text-xs font-semibold text-purple-700 border border-purple-200 hover:bg-purple-50 px-4 py-2 rounded-lg transition-colors">
                      Back to queue
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Competency Verification</p>
                      <div className="flex flex-col gap-1.5">
                        {VERIFICATION.map(v => (
                          <label key={v} className="flex items-center gap-2 text-[11px] text-gray-700 cursor-pointer">
                            <input type="checkbox" checked={checks.has(v)} onChange={() => toggle(checks, setChecks, v)}
                              className="accent-purple-600" />
                            {v}
                          </label>
                        ))}
                      </div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-3 mb-2">Quality Checks <span className="font-normal text-gray-300 normal-case">(optional attestations)</span></p>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                        {QUALITY.map(v => (
                          <label key={v} className="flex items-center gap-1.5 text-[10px] text-gray-600 cursor-pointer">
                            <input type="checkbox" checked={quality.has(v)} onChange={() => toggle(quality, setQuality, v)}
                              className="accent-green-600" />
                            {v}
                          </label>
                        ))}
                      </div>
                      <p className="text-[9px] text-gray-300 mt-2">Your attestations are saved into the validation record.</p>
                    </div>

                    <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
                      <p className="text-[10px] font-bold text-violet-900 uppercase tracking-widest mb-1.5">✨ AI Validation Assistant</p>
                      {aiState?.loading ? (
                        <p className="text-[11px] text-violet-900/70">Reviewing the record…</p>
                      ) : aiState?.text ? (
                        <p className="text-[11px] text-violet-900/90 whitespace-pre-line leading-snug max-h-56 overflow-y-auto">{aiState.text}</p>
                      ) : aiState?.error ? (
                        <p className="text-[11px] text-red-600">{aiState.error}</p>
                      ) : (
                        <p className="text-[11px] text-violet-900/70">
                          Grounded review of this record — attempt history, assessor agreement and scoring spread — with an advisory suggestion.
                        </p>
                      )}
                      <button onClick={runAi} disabled={aiState?.loading}
                        className="mt-2 w-full text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors disabled:opacity-40">
                        {aiState?.text ? "Run again" : "Run AI review"}
                      </button>
                      <p className="text-[9px] text-violet-900/50 mt-1.5">AI suggestions are advisory. The decision rests with you.</p>
                    </div>

                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Feedback to Learner</p>
                      <textarea rows={2} value={strengths} onChange={e => setStrengths(e.target.value)} placeholder="Strengths…"
                        className="w-full rounded-lg border border-gray-200 p-2 text-[11px] outline-none focus:border-purple-400 mb-1.5" />
                      <textarea rows={2} value={improvements} onChange={e => setImprovements(e.target.value)} placeholder="Areas requiring improvement…"
                        className="w-full rounded-lg border border-gray-200 p-2 text-[11px] outline-none focus:border-purple-400 mb-1.5" />
                      <textarea rows={2} value={conditions} onChange={e => setConditions(e.target.value)} placeholder="Conditions / mandatory corrections (required for conditional approval)…"
                        className="w-full rounded-lg border border-gray-200 p-2 text-[11px] outline-none focus:border-purple-400" />
                    </div>

                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Validation Actions</p>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => act("validate", "approved")} disabled={busy || !allVerified}
                          title={allVerified ? "" : "Confirm all seven verification items first"}
                          className="w-full text-xs font-bold text-white bg-green-600 hover:bg-green-700 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          ✓ Approve Competency
                        </button>
                        <button onClick={() => act("validate", "approved with conditions")} disabled={busy || !allVerified || !conditions.trim()}
                          title={!conditions.trim() ? "State the conditions first" : !allVerified ? "Confirm all seven verification items first" : ""}
                          className="w-full text-xs font-semibold text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          ☑ Approve with Conditions
                        </button>
                        <button onClick={() => act("return", "returned for revision")} disabled={busy || !improvements.trim()}
                          title={!improvements.trim() ? "Tell the learner what needs improving first" : ""}
                          className="w-full text-xs font-semibold text-orange-700 border border-orange-200 bg-orange-50 hover:bg-orange-100 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          ↩ Return for Revision
                        </button>
                      </div>
                      <p className="text-[9px] text-gray-300 mt-2 leading-snug">
                        Escalation, moderator referral and additional-evidence requests arrive with their workflows — no escalation state exists yet.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            rows.length > 0 && (
              <div className="hidden xl:flex bg-white border border-dashed border-gray-200 rounded-2xl p-10 items-center justify-center xl:col-span-2">
                <p className="text-sm text-gray-300">Select a submission to open the review workspace.</p>
              </div>
            )
          )}
        </div>
      )}

      {/* Analytics strip */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 mt-5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Today&apos;s Validation Analytics</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          {[
            { l: "Validation Rate", v: stats.validationRate !== null ? `${stats.validationRate}%` : "—", sub: "of all scores validated" },
            { l: "Avg Review Time", v: stats.avgReviewDays !== null ? `${stats.avgReviewDays.toFixed(1)}d` : "—", sub: "assessment → validation" },
            { l: "Approval Rate", v: stats.approvalRate !== null ? `${stats.approvalRate}%` : "—", sub: "of reviewed" },
            { l: "Return Rate", v: stats.returnRate !== null ? `${stats.returnRate}%` : "—", sub: "of reviewed" },
            { l: "Pass Rate", v: stats.passRate !== null ? `${stats.passRate}%` : "—", sub: "all scores" },
            { l: "Score Spread", v: stats.spreadAvg !== null ? stats.spreadAvg.toFixed(1) : "—", sub: "avg across assessors" },
            { l: "Escalation Rate", v: "—", sub: "not tracked yet" },
            { l: "Evidence Quality", v: "—", sub: "not tracked yet" },
          ].map(s => (
            <div key={s.l} className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-[9px] font-semibold text-gray-400 leading-tight">{s.l}</p>
              <p className="text-base font-extrabold text-gray-900 leading-tight">{s.v}</p>
              <p className="text-[8px] text-gray-400 leading-tight">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
