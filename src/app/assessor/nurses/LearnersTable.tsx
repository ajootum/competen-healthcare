"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Learners table (Learners Page Redesign spec): search, filters, priority
// tabs, sortable queue, selection with real bulk actions (CSV export,
// scheduling link) and a live learner side panel. Assign-learner, reminders,
// certificate generation and archiving have no backing stores — omitted.

export type LearnerRow = {
  id: string; name: string; department: string; joined: string; avatarUrl: string | null;
  framework: string | null;
  currentAssessment: string | null;
  taskType: string | null;
  priority: "high" | "medium" | "low" | null;
  due: { when: string; method: string } | null;
  overdue: boolean;
  status: "In Progress" | "Overdue" | "Scheduled" | "Awaiting Assessment" | "Up to date";
  pass: number; total: number; expSoon: number;
  risk: "high" | "medium" | "low";
  pendingEvidence: number;
  avgScore: number | null;
  feedback: { text: string; by: string | null; at: string | null } | null;
  upcomingSessions: number;
};

export type LearnerKpis = {
  learners: number; dueToday: number; awaitingEvidence: number; overdue: number; passRate: number | null;
};

const TASK_CHIP: Record<string, string> = {
  renewal: "Renewal", focused: "Gap Closure", remediation: "Remediation",
  entrustment: "Entrustment", full_cpu: "Full CPU",
};

const PRIO_UI = {
  high:   { label: "High",   cls: "bg-red-50 text-red-600" },
  medium: { label: "Medium", cls: "bg-amber-50 text-amber-700" },
  low:    { label: "Low",    cls: "bg-gray-100 text-gray-500" },
};

const STATUS_CLS: Record<LearnerRow["status"], string> = {
  "In Progress": "bg-blue-50 text-blue-600",
  "Overdue": "bg-red-50 text-red-600",
  "Scheduled": "bg-indigo-50 text-indigo-600",
  "Awaiting Assessment": "bg-amber-50 text-amber-700",
  "Up to date": "bg-green-50 text-green-700",
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";

const fmtDue = (iso: string) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((dd.getTime() - today.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return { top: "Today", sub: time, cls: "text-red-600 font-bold" };
  if (diff === 1) return { top: "Tomorrow", sub: time, cls: "text-amber-600 font-semibold" };
  return { top: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), sub: time, cls: "text-gray-700" };
};

export default function LearnersTable({ rows, kpis }: { rows: LearnerRow[]; kpis: LearnerKpis }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState("all");
  const [prioTab, setPrioTab] = useState<"all" | "high" | "medium" | "low">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const perPage = 10;

  const departments = [...new Set(rows.map(r => r.department))].sort();

  const filtered = useMemo(() => rows.filter(r => {
    if (prioTab !== "all" && r.priority !== prioTab) return false;
    if (dept !== "all" && r.department !== dept) return false;
    if (status !== "all" && r.status !== status) return false;
    const t = q.trim().toLowerCase();
    if (t && ![r.name, r.department, r.framework ?? "", r.currentAssessment ?? ""].some(s => s.toLowerCase().includes(t))) return false;
    return true;
  }), [rows, prioTab, dept, status, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageRows = filtered.slice(page * perPage, (page + 1) * perPage);
  const open = openId ? rows.find(r => r.id === openId) ?? null : null;

  const toggle = (id: string) =>
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const prioCount = (p: "high" | "medium" | "low") => rows.filter(r => r.priority === p).length;

  const KPI_TILES = [
    { icon: "👥", value: String(kpis.learners), label: "Assigned Learners", sub: "in your hospital", tint: "bg-indigo-50" },
    { icon: "📅", value: String(kpis.dueToday), label: "Assessments Due Today", sub: "scheduled sessions", tint: "bg-blue-50" },
    { icon: "🖊️", value: String(kpis.awaitingEvidence), label: "Awaiting Evidence Review", sub: "logbook entries", tint: "bg-amber-50" },
    { icon: "🔴", value: String(kpis.overdue), label: "Overdue Assessments", sub: "past scheduled time", tint: "bg-red-50" },
    { icon: "🛡️", value: kpis.passRate !== null ? `${kpis.passRate}%` : "—", label: "Competency Pass Rate", sub: kpis.passRate !== null ? "of latest decisions" : "no decisions yet", tint: "bg-green-50" },
  ];

  return (
    <div className="max-w-[1400px]">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Learners</h1>
          <p className="text-gray-400 text-sm mt-0.5">Your assessment queue and learner management.</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/reports/learners"
            className="text-xs font-semibold text-gray-600 border border-gray-200 bg-white hover:border-indigo-300 px-3 py-2 rounded-lg transition-colors">
            ⬇ Export
          </a>
          <Link href="/assessor/calendar"
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors">
            📅 Schedule Assessment
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPI_TILES.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-xl ${k.tint} flex items-center justify-center text-lg`}>{k.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 mt-2 leading-none">{k.value}</p>
            <p className="text-[11px] font-semibold text-gray-700 mt-1 leading-tight">{k.label}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + filters + priority tabs */}
      <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => { setQ(e.target.value); setPage(0); }}
          placeholder="Search learner, department, framework…"
          className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        <select value={dept} onChange={e => { setDept(e.target.value); setPage(0); }}
          className="border border-gray-200 rounded-lg px-2 py-2 text-xs text-gray-600 bg-white focus:outline-none">
          <option value="all">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}
          className="border border-gray-200 rounded-lg px-2 py-2 text-xs text-gray-600 bg-white focus:outline-none">
          <option value="all">All statuses</option>
          {Object.keys(STATUS_CLS).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="w-full flex flex-wrap gap-1.5 pt-1">
          {([
            { key: "all", label: `All (${rows.length})` },
            { key: "high", label: `🔴 High Priority (${prioCount("high")})` },
            { key: "medium", label: `🟠 Medium Priority (${prioCount("medium")})` },
            { key: "low", label: `🟢 Low Priority (${prioCount("low")})` },
          ] as const).map(t => (
            <button key={t.key} onClick={() => { setPrioTab(t.key); setPage(0); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                prioTab === t.key ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="bg-gray-900 text-white rounded-xl px-4 py-2.5 mb-3 flex flex-wrap items-center gap-3">
          <p className="text-xs font-semibold flex-1">{selected.size} learner{selected.size === 1 ? "" : "s"} selected</p>
          <Link href="/assessor/calendar" className="text-xs font-semibold bg-white text-gray-900 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors">
            📅 Schedule
          </Link>
          <a href="/api/reports/learners" className="text-xs font-semibold border border-white/30 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors">
            ⬇ Export list
          </a>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-300 hover:text-white">Clear</button>
        </div>
      )}

      <div className={`grid grid-cols-1 ${open ? "xl:grid-cols-[minmax(0,1fr)_300px]" : ""} gap-5 items-start`}>
        {/* Table */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden min-w-0">
          {pageRows.length === 0 ? (
            <p className="px-5 py-12 text-center text-xs text-gray-400">
              {rows.length === 0 ? "No learners in your hospital yet." : "Nothing matches these filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className="text-[9px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">
                    <th className="px-4 py-2.5 w-8" />
                    <th className="text-left px-2 py-2.5">Learner</th>
                    <th className="text-left px-2 py-2.5">Department</th>
                    <th className="text-left px-2 py-2.5">Framework</th>
                    <th className="text-left px-2 py-2.5">Current Assessment</th>
                    <th className="text-left px-2 py-2.5">Due</th>
                    <th className="text-left px-2 py-2.5">Priority</th>
                    <th className="text-left px-2 py-2.5">Status</th>
                    <th className="text-left px-2 py-2.5 w-32">Progress</th>
                    <th className="text-left px-2 py-2.5">Risk</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map(r => {
                    const due = r.overdue ? { top: "Overdue", sub: "", cls: "text-red-600 font-bold" } : r.due ? fmtDue(r.due.when) : null;
                    const pct = r.total ? Math.round((r.pass / r.total) * 100) : 0;
                    return (
                      <tr key={r.id} className={`transition-colors cursor-pointer ${openId === r.id ? "bg-indigo-50/40" : "hover:bg-gray-50/60"}`}
                        onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                            className="accent-indigo-600" aria-label={`Select ${r.name}`} />
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2.5">
                            {r.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                              <img src={r.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            ) : (
                              <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                                {initials(r.name)}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{r.name}</p>
                              <p className="text-[10px] text-gray-400">Staff Nurse</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-xs text-gray-600">{r.department}</td>
                        <td className="px-2 py-3 text-xs text-gray-600 truncate max-w-[140px]">{r.framework ?? "—"}</td>
                        <td className="px-2 py-3">
                          {r.currentAssessment ? (
                            <>
                              <p className="text-xs text-gray-800 truncate max-w-[180px]">{r.currentAssessment}</p>
                              {r.taskType && <span className="text-[9px] font-bold bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">{TASK_CHIP[r.taskType] ?? r.taskType}</span>}
                            </>
                          ) : <p className="text-[10px] text-gray-300">nothing queued</p>}
                        </td>
                        <td className="px-2 py-3">
                          {due ? (
                            <>
                              <p className={`text-xs ${due.cls}`} suppressHydrationWarning>{due.top}</p>
                              {due.sub && <p className="text-[9px] text-gray-400" suppressHydrationWarning>{due.sub}</p>}
                            </>
                          ) : <p className="text-[10px] text-gray-300">—</p>}
                        </td>
                        <td className="px-2 py-3">
                          {r.priority
                            ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${PRIO_UI[r.priority].cls}`}>{PRIO_UI[r.priority].label}</span>
                            : <span className="text-[10px] text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-3">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_CLS[r.status]}`}>{r.status}</span>
                        </td>
                        <td className="px-2 py-3">
                          {r.total > 0 ? (
                            <>
                              <div className="flex items-center justify-between text-[10px] mb-0.5">
                                <span className="font-bold text-gray-700">{pct}%</span>
                                <span className="text-gray-300">{r.pass}/{r.total}</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${pct >= 75 ? "bg-green-500" : pct >= 40 ? "bg-blue-400" : "bg-amber-400"}`}
                                  style={{ width: `${pct}%` }} />
                              </div>
                            </>
                          ) : <p className="text-[10px] text-gray-300">no decisions</p>}
                        </td>
                        <td className="px-2 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${PRIO_UI[r.risk].cls}`}>{PRIO_UI[r.risk].label}</span>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <Link href={`/assessor/assess?nurse=${r.id}`}
                            className="text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors">
                            {r.status === "In Progress" ? "Continue" : "Start"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {/* Pagination */}
          {filtered.length > perPage && (
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-[10px] text-gray-400">
                Showing {page * perPage + 1}–{Math.min((page + 1) * perPage, filtered.length)} of {filtered.length} learners
              </p>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-30">‹</button>
                {Array.from({ length: pages }, (_, i) => (
                  <button key={i} onClick={() => setPage(i)}
                    className={`text-xs px-2.5 py-1 rounded-lg ${i === page ? "bg-indigo-600 text-white" : "border border-gray-200 text-gray-500"}`}>{i + 1}</button>
                ))}
                <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page === pages - 1}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-30">›</button>
              </div>
            </div>
          )}
        </div>

        {/* Learner side panel */}
        {open && (
          <div className="bg-white border border-gray-100 rounded-2xl p-4 xl:sticky xl:top-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {open.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                  <img src={open.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
                ) : (
                  <span className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold flex items-center justify-center">
                    {initials(open.name)}
                  </span>
                )}
                <div>
                  <p className="text-sm font-bold text-gray-900">{open.name}</p>
                  <p className="text-[10px] text-gray-400">Staff Nurse · {open.department}</p>
                  <p className="text-[9px] text-gray-300" suppressHydrationWarning>
                    Joined {new Date(open.joined).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
              </div>
              <button onClick={() => setOpenId(null)} className="text-gray-300 hover:text-gray-600 text-sm">✕</button>
            </div>

            {/* Summary donut */}
            <div className="border-t border-gray-50 pt-3 mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Assessment Summary</p>
              <div className="flex items-center gap-4">
                <div className="relative w-16 shrink-0">
                  <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="14" />
                    {open.total > 0 && (
                      <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="14"
                        strokeDasharray={`${(open.pass / open.total) * 2 * Math.PI * 40} ${2 * Math.PI * 40}`} />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-[11px] font-extrabold text-gray-900">{open.total ? Math.round((open.pass / open.total) * 100) : 0}%</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{open.pass} / {open.total}</p>
                  <p className="text-[10px] text-gray-400">competencies passing</p>
                  {open.avgScore !== null && <p className="text-[10px] text-gray-500 mt-0.5">Avg score <b>{open.avgScore}/6</b></p>}
                </div>
              </div>
            </div>

            {/* Next session */}
            <div className="border-t border-gray-50 pt-3 mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Next Assessment</p>
              {open.due ? (
                <div className="bg-indigo-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] font-bold text-indigo-700" suppressHydrationWarning>
                    {new Date(open.due.when).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="text-[10px] text-indigo-900/60 capitalize">{open.due.method.replace(/_/g, " ")}</p>
                </div>
              ) : (
                <p className="text-[10px] text-gray-400">Nothing scheduled — <Link href="/assessor/calendar" className="text-indigo-600 hover:underline">book a session</Link>.</p>
              )}
            </div>

            {/* Recent feedback */}
            <div className="border-t border-gray-50 pt-3 mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Recent Feedback</p>
              {open.feedback ? (
                <blockquote className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-gray-700 italic leading-snug">&ldquo;{open.feedback.text}&rdquo;</p>
                  <p className="text-[9px] text-gray-400 mt-1">
                    — {open.feedback.by ?? "Verifier"}{open.feedback.at ? `, ${new Date(open.feedback.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </p>
                </blockquote>
              ) : (
                <p className="text-[10px] text-gray-400">No verifier comments recorded yet.</p>
              )}
            </div>

            {/* Alerts */}
            <div className="border-t border-gray-50 pt-3 mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Alerts</p>
              <div className="flex flex-col gap-1">
                {open.pendingEvidence > 0 && <p className="text-[10px] text-amber-700">🖊️ {open.pendingEvidence} logbook entr{open.pendingEvidence === 1 ? "y" : "ies"} awaiting verification</p>}
                {open.expSoon > 0 && <p className="text-[10px] text-red-600">⏳ {open.expSoon} competenc{open.expSoon === 1 ? "y" : "ies"} expiring within 60 days</p>}
                {open.upcomingSessions > 0 && <p className="text-[10px] text-blue-600">📅 {open.upcomingSessions} session{open.upcomingSessions === 1 ? "" : "s"} scheduled</p>}
                {open.pendingEvidence === 0 && open.expSoon === 0 && open.upcomingSessions === 0 && (
                  <p className="text-[10px] text-gray-400">Nothing needing attention.</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Link href={`/assessor/assess?nurse=${open.id}`}
                className="text-center text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg transition-colors">
                {open.status === "In Progress" ? "Continue Assessment" : "Start Assessment"}
              </Link>
              <div className="grid grid-cols-2 gap-1.5">
                <Link href="/assessor/logbook" className="text-center text-[11px] font-semibold text-gray-600 border border-gray-200 hover:border-indigo-300 py-1.5 rounded-lg transition-colors">Evidence</Link>
                <Link href="/assessor/calendar" className="text-center text-[11px] font-semibold text-gray-600 border border-gray-200 hover:border-indigo-300 py-1.5 rounded-lg transition-colors">Schedule</Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-300 mt-4">
        Risk is derived from live decisions (critical failures, non-passing, expiries). Assign-learner, reminders,
        certificate generation and archiving aren&apos;t available yet.
      </p>
    </div>
  );
}
