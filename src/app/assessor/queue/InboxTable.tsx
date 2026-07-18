"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Assessment Inbox table (Assessment Inbox Redesign spec): the queue engine's
// prioritised tasks with tabs, filters and search. Priority comes from the
// engine's ranking, progress is real CPU readiness, due dates come from
// scheduled sessions (— when none is booked), status from formal assessment
// records. No invented SLAs.

export type InboxRow = {
  nurseId: string; nurseName: string; department: string | null;
  cpuName: string; type: string; reason: string;
  priority: number; readiness: number; estMinutes: number;
  methods: string[];
  dueDate: string | null;      // next scheduled session for this learner
  overdue: boolean;            // has a past-due scheduled session
  inProgress: boolean;         // a formal assessment is underway
};

const TYPE_CHIP: Record<string, { label: string; cls: string }> = {
  renewal:     { label: "Renewal",      cls: "bg-violet-50 text-violet-700" },
  focused:     { label: "Gap Closure",  cls: "bg-amber-50 text-amber-700" },
  remediation: { label: "Remediation",  cls: "bg-red-50 text-red-600" },
  entrustment: { label: "Entrustment",  cls: "bg-blue-50 text-blue-600" },
  full_cpu:    { label: "Full CPU",     cls: "bg-teal-50 text-teal-700" },
};

const prioBand = (p: number): "high" | "medium" | "low" => p <= 3 ? "high" : p <= 6 ? "medium" : "low";
const PRIO_UI = {
  high:   { label: "High",   cls: "bg-red-50 text-red-600" },
  medium: { label: "Medium", cls: "bg-amber-50 text-amber-700" },
  low:    { label: "Low",    cls: "bg-gray-100 text-gray-500" },
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";

const fmtDue = (iso: string) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((dd.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { top: "Overdue", sub: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), cls: "text-red-600 font-bold" };
  if (diff === 0) return { top: "Today", sub: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), cls: "text-red-600 font-bold" };
  if (diff === 1) return { top: "Tomorrow", sub: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), cls: "text-amber-600 font-semibold" };
  return { top: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), sub: `in ${diff} days`, cls: "text-gray-700" };
};

const week = () => new Date(Date.now() + 7 * 86400000).toISOString();

export default function InboxTable({ rows }: { rows: InboxRow[] }) {
  const [tab, setTab] = useState("All");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "not_started" | "in_progress">("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const in7 = week();
  const TABS = [
    { label: "All", test: () => true },
    { label: "High Priority", test: (r: InboxRow) => prioBand(r.priority) === "high" },
    { label: "Due This Week", test: (r: InboxRow) => !!r.dueDate && r.dueDate <= in7 && !r.overdue },
    { label: "Overdue", test: (r: InboxRow) => r.overdue },
    { label: "Gaps", test: (r: InboxRow) => r.type === "focused" || r.type === "remediation" },
    { label: "Renewals", test: (r: InboxRow) => r.type === "renewal" },
  ];

  const filtered = useMemo(() => {
    const activeTab = TABS.find(t => t.label === tab) ?? TABS[0];
    return rows.filter(r => {
      if (!activeTab.test(r)) return false;
      if (status === "not_started" && r.inProgress) return false;
      if (status === "in_progress" && !r.inProgress) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      const t = q.trim().toLowerCase();
      if (t && ![r.nurseName, r.cpuName, r.reason].some(s => s.toLowerCase().includes(t))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TABS is stable per render
  }, [rows, tab, status, typeFilter, q]);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      {/* Tabs + filters */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 flex-1">
          {TABS.map(t => {
            const n = rows.filter(r => t.test(r)).length;
            return (
              <button key={t.label} onClick={() => setTab(t.label)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  tab === t.label ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"
                }`}>
                {t.label} ({n})
              </button>
            );
          })}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search learners, assessments…"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 bg-white focus:outline-none">
          <option value="all">All status</option>
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 bg-white focus:outline-none">
          <option value="all">All types</option>
          {Object.entries(TYPE_CHIP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-12 text-center text-xs text-gray-400">
          {rows.length === 0
            ? "Inbox clear — the queue engine has nothing outstanding for you."
            : "Nothing matches these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="text-[9px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">
                <th className="text-left px-4 py-2.5">Learner & Assessment</th>
                <th className="text-left px-2 py-2.5">Type & Context</th>
                <th className="text-left px-2 py-2.5">Priority</th>
                <th className="text-left px-2 py-2.5">Due Date</th>
                <th className="text-left px-2 py-2.5 w-36">Progress</th>
                <th className="text-left px-2 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((r, i) => {
                const chip = TYPE_CHIP[r.type] ?? { label: r.type, cls: "bg-gray-100 text-gray-500" };
                const prio = PRIO_UI[prioBand(r.priority)];
                const due = r.dueDate ? fmtDue(r.dueDate) : null;
                return (
                  <tr key={`${r.nurseId}-${r.cpuName}-${i}`} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {initials(r.nurseName)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{r.nurseName}</p>
                          <p className="text-[10px] text-gray-400 truncate">RN · {r.department ?? "General"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <p className="text-sm text-gray-800 truncate max-w-[220px]">{r.cpuName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${chip.cls}`}>{chip.label}</span>
                        <span className="text-[9px] text-gray-400 truncate max-w-[150px]" title={r.reason}>{r.reason}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${prio.cls}`}>{prio.label}</span>
                    </td>
                    <td className="px-2 py-3">
                      {due ? (
                        <>
                          <p className={`text-xs ${due.cls}`} suppressHydrationWarning>{due.top}</p>
                          <p className="text-[9px] text-gray-400" suppressHydrationWarning>{due.sub}</p>
                        </>
                      ) : (
                        <p className="text-[10px] text-gray-300">not scheduled</p>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="font-bold text-gray-700">{r.readiness}%</span>
                        <span className="text-gray-300">~{r.estMinutes} min</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${r.readiness >= 75 ? "bg-green-500" : r.readiness >= 40 ? "bg-blue-400" : "bg-amber-400"}`}
                          style={{ width: `${r.readiness}%` }} />
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        r.inProgress ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"
                      }`}>
                        {r.inProgress ? "● In Progress" : "● Not Started"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/assessor/assess?nurse=${r.nurseId}`}
                        className="text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors">
                        Start
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
