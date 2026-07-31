"use client";

import { useState } from "react";
import { cardClass } from "@/components/ui/primitives";

// AI Insights & Recommendations (LDS-006) — the recommendations are generated server-side from live state
// (rule-based + explainable, each with a "why"); this client shell just buckets them by audience tab. No
// fabricated insight — an audience with no live signal shows an honest empty state.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS: { key: string; label: string }[] = [
  { key: "learners", label: "For Learners" },
  { key: "managers", label: "For Managers" },
  { key: "educators", label: "For Educators" },
  { key: "executives", label: "For Executives" },
];
const tone: Record<string, string> = {
  high: "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]/40",
  medium: "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]/40",
  low: "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)]/40",
};
const dot: Record<string, string> = { high: "bg-[var(--cmp-color-error)]", medium: "bg-[var(--cmp-color-warning)]", low: "bg-[var(--cmp-color-success)]" };

export default function AiInsights({ items }: { items: any[] }) {
  const [tab, setTab] = useState("learners");
  const shown = items.filter(i => i.audience === tab);
  const count = (k: string) => items.filter(i => i.audience === k).length;

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm">🤖</span>
        <h3 className="font-semibold text-gray-900 text-sm">AI Insights &amp; Recommendations</h3>
        <span className="text-[10px] text-gray-400 ml-1">rule-based · explainable</span>
      </div>
      <div className="flex gap-1 border-b border-gray-100 mb-3 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`shrink-0 text-xs px-3 py-1.5 border-b-2 -mb-px font-medium transition-colors ${tab === t.key ? "border-violet-600 text-violet-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {t.label}{count(t.key) ? <span className="ml-1.5 text-[10px] text-gray-400">{count(t.key)}</span> : null}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No recommendations for this audience right now — signals are generated from live compliance, competency and progression state.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((r, i) => (
            <div key={i} className={`rounded-lg border p-3 ${tone[r.priority] ?? "border-gray-200"}`}>
              <div className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dot[r.priority] ?? "bg-gray-300"}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 leading-snug">{r.text}</p>
                  <p className="text-[10px] text-gray-500 mt-1">{r.why}</p>
                  <span className="inline-block mt-2 text-[10px] font-semibold text-violet-700">{r.action} →</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
