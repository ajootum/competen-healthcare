"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Interactive table of the Assessment Centre: category tabs, search, status
// filter. Rows unify governed knowledge tests and assessor-led assessments —
// each with the spec's status system, only for states the record can produce.

export type CentreRow = {
  id: string;
  category: "knowledge" | "practical" | "workplace" | "simulation" | "self";
  title: string;
  typeLabel: string;
  cpu: string | null;
  domain: string | null;
  meta: string | null;          // "25 questions · pass 75%" or assessor name
  due: string | null;           // ISO date (reassessment/bank deadline) if any
  status: "ready" | "in_progress" | "awaiting_review" | "retake" | "completed" | "validated";
  score: string | null;
  href: string | null;
  action: string | null;
};

const STATUS_UI: Record<CentreRow["status"], { label: string; cls: string }> = {
  ready:           { label: "Ready",           cls: "bg-blue-50 text-blue-600" },
  in_progress:     { label: "In Progress",     cls: "bg-orange-50 text-orange-600" },
  awaiting_review: { label: "Awaiting Review", cls: "bg-amber-50 text-amber-700" },
  retake:          { label: "Retake Available", cls: "bg-amber-50 text-amber-700" },
  completed:       { label: "Completed",       cls: "bg-teal-50 text-teal-700" },
  validated:       { label: "Validated",       cls: "bg-green-50 text-green-700" },
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "knowledge", label: "Knowledge" },
  { key: "practical", label: "Practical Skills" },
  { key: "workplace", label: "Workplace" },
  { key: "simulation", label: "Simulation" },
  { key: "self", label: "Self" },
];

const CAT_ICON: Record<CentreRow["category"], string> = {
  knowledge: "📘", practical: "🩺", workplace: "🏥", simulation: "🧪", self: "🪞",
};

export default function AssessmentCentre({ rows }: { rows: CentreRow[] }) {
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.category] = (c[r.category] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = rows.filter(r => {
    if (tab !== "all" && r.category !== tab) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    const s = q.trim().toLowerCase();
    if (s && ![r.title, r.cpu, r.domain, r.typeLabel].some(v => (v ?? "").toLowerCase().includes(s))) return false;
    return true;
  });

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Category tabs */}
      <div className="flex items-center gap-1 px-3 pt-3 border-b border-gray-50 overflow-x-auto">
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setTab(c.key)}
            className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === c.key ? "border-teal-600 text-teal-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {c.label} <span className="text-[9px] font-normal">{counts[c.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search + status filter */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-50">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search assessments, CPUs, domains…"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="all">Status: All</option>
          {Object.entries(STATUS_UI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Rows */}
      {filtered.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs text-gray-400">
          {rows.length === 0 ? "No assessments yet — they appear when tests are published or an assessor schedules you." : "No matches."}
        </p>
      ) : filtered.map(r => {
        const st = STATUS_UI[r.status];
        return (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/40">
            <span className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">{CAT_ICON[r.category]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 truncate">{r.title}</p>
              <p className="text-[10px] text-gray-400 truncate">
                {r.typeLabel}{r.meta ? ` · ${r.meta}` : ""}
              </p>
            </div>
            <div className="hidden md:block w-40 shrink-0 min-w-0">
              <p className="text-[11px] text-gray-600 truncate">{r.cpu ?? "—"}</p>
              <p className="text-[9px] text-gray-400 truncate">{r.domain ?? ""}</p>
            </div>
            <div className="hidden sm:block w-24 shrink-0 text-[10px] text-gray-500" suppressHydrationWarning>
              {r.due ? new Date(r.due).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
            </div>
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded shrink-0 ${st.cls}`}>{st.label}</span>
            <span className="w-12 text-right text-xs font-bold text-gray-700 shrink-0">{r.score ?? "—"}</span>
            {r.href && r.action
              ? <Link href={r.href} className="text-[11px] font-semibold bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg shrink-0">{r.action}</Link>
              : <span className="w-16 shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}
