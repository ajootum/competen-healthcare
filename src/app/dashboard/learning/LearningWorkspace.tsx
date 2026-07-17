"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Interactive half of the Learning Pathway workspace: search/filter the
// pathway, resume or complete items, and surface the highest-risk gap as
// Priority Learning. Every item shows WHY it was recommended (spec §3) —
// the reason comes from the pathway engine, straight from the decision record.

export type PathwayItem = {
  id: string; competency_name: string | null; reason: string | null;
  resource_title: string | null; resource_type: string | null;
  status: string; sort_order: number;
};

const TYPE_ICON: Record<string, string> = {
  cpu: "🏥", video: "🎬", guideline: "📄", policy: "📜", article: "📰",
  course: "🎓", simulation: "🧪", quiz: "❓", resource: "📘",
};

export const isHighPriority = (i: { reason: string | null }) =>
  /expir|critical|remediat|not yet/i.test(i.reason ?? "");

export default function LearningWorkspace({ items }: { items: PathwayItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("open");
  const [fType, setFType] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const types = useMemo(() => [...new Set(items.map(i => i.resource_type ?? "resource"))].sort(), [items]);

  const filtered = items.filter(i => {
    if (fStatus === "open" && i.status === "completed") return false;
    if (fStatus === "completed" && i.status !== "completed") return false;
    if (fType !== "all" && (i.resource_type ?? "resource") !== fType) return false;
    const s = q.trim().toLowerCase();
    if (s && !(i.resource_title ?? "").toLowerCase().includes(s) && !(i.competency_name ?? "").toLowerCase().includes(s)) return false;
    return true;
  });

  const priority = items.find(i => i.status !== "completed" && isHighPriority(i));

  async function setStatus(id: string, status: string) {
    setBusy(id);
    await fetch("/api/learning/pathway-items", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setBusy(null);
    router.refresh();
  }

  const Row = ({ i }: { i: PathwayItem }) => {
    const done = i.status === "completed";
    const started = i.status === "in_progress";
    return (
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 ${done ? "opacity-60" : ""}`}>
        <span className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">
          {TYPE_ICON[(i.resource_type ?? "resource").toLowerCase()] ?? "📘"}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm text-gray-800 ${done ? "line-through" : ""}`}>
            {i.resource_title ?? i.competency_name}
            {i.resource_type && <span className="ml-1.5 text-[9px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase">{i.resource_type}</span>}
            {isHighPriority(i) && !done && <span className="ml-1.5 text-[9px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded">HIGH PRIORITY</span>}
          </p>
          <p className="text-[10px] text-gray-400 truncate">
            {i.competency_name && i.resource_title ? `${i.competency_name} · ` : ""}Why: {i.reason ?? "assigned to your pathway"}
          </p>
        </div>
        {done ? (
          <button onClick={() => setStatus(i.id, "pending")} disabled={busy === i.id}
            className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0">↺ Reopen</button>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            {!started && (
              <button onClick={() => setStatus(i.id, "in_progress")} disabled={busy === i.id}
                className="text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">Start</button>
            )}
            {started && <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">IN PROGRESS</span>}
            <button onClick={() => setStatus(i.id, "completed")} disabled={busy === i.id}
              className="text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-3 py-1.5 rounded-lg disabled:opacity-50">✓ Done</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Priority Learning (spec §2) */}
      {priority && (
        <div className="bg-white rounded-xl border border-red-100 overflow-hidden">
          <div className="px-4 pt-3.5">
            <span className="text-[9px] font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded">⚠ HIGH PRIORITY</span>
            <p className="text-sm font-bold text-gray-900 mt-2">{priority.competency_name ?? priority.resource_title}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Why: {priority.reason}</p>
          </div>
          <div className="px-4 py-3 flex gap-2">
            <button onClick={() => setStatus(priority.id, "in_progress")} disabled={busy === priority.id}
              className="flex-1 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg disabled:opacity-50">
              Start learning path →
            </button>
            <button onClick={() => setStatus(priority.id, "completed")} disabled={busy === priority.id}
              className="text-xs font-semibold text-gray-500 border border-gray-200 hover:bg-gray-50 px-3 rounded-lg disabled:opacity-50">✓ Done</button>
          </div>
        </div>
      )}

      {/* Continue learning + filters */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-gray-900 text-sm mr-auto">Continue Learning</h2>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search items…"
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
          <select value={fStatus} onChange={e => setFStatus(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
          {types.length > 1 && (
            <select value={fType} onChange={e => setFType(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white capitalize">
              <option value="all">All types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-gray-400">
            {items.length === 0 ? "Nothing assigned — your pathway fills in when an assessment finds a gap." : "No items match the filters."}
          </p>
        ) : filtered.map(i => <Row key={i.id} i={i} />)}
      </div>
    </div>
  );
}
