"use client";

import { useMemo, useState } from "react";

// Feedback feed (My Feedback Workspace spec §3): every narrative comment an
// assessor has left, with tabs, assessor filter and sort. Purely client-side
// over the real records passed from the server.

export type FeedbackItem = {
  id: string;
  assessor: string | null;
  typeLabel: string;
  competency: string | null;
  notes: string;
  score: number | null;      // Benner 0–6
  at: string | null;
  positive: boolean;         // score >= 3 (or unscored narrative)
};

const AVATAR_TINTS = ["bg-teal-600", "bg-indigo-600", "bg-rose-600", "bg-amber-600", "bg-violet-600", "bg-sky-600"];
const tint = (s: string) => AVATAR_TINTS[[...s].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_TINTS.length];
const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];

export default function FeedbackFeed({ items }: { items: FeedbackItem[] }) {
  const [tab, setTab] = useState<"all" | "strengths" | "growth">("all");
  const [assessor, setAssessor] = useState("all");
  const [sort, setSort] = useState<"newest" | "highest" | "lowest">("newest");
  const [shown, setShown] = useState(8);

  const assessors = useMemo(() => [...new Set(items.map(i => i.assessor).filter(Boolean))] as string[], [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (tab === "strengths") list = list.filter(i => i.positive);
    if (tab === "growth") list = list.filter(i => !i.positive);
    if (assessor !== "all") list = list.filter(i => i.assessor === assessor);
    return [...list].sort((a, b) => {
      if (sort === "newest") return (b.at ?? "").localeCompare(a.at ?? "");
      const sa = a.score ?? -1, sb = b.score ?? -1;
      return sort === "highest" ? sb - sa : sa - sb;
    });
  }, [items, tab, assessor, sort]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 px-3 pt-3 border-b border-gray-50">
        {([["all", "All Feedback"], ["strengths", "Strengths"], ["growth", "Areas to Grow"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              tab === k ? "border-teal-600 text-teal-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {l}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-2">
          {assessors.length > 1 && (
            <select value={assessor} onChange={e => setAssessor(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="all">All assessors</option>
              {assessors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="newest">Sort: Newest</option>
            <option value="highest">Sort: Highest score</option>
            <option value="lowest">Sort: Lowest score</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-3xl mb-2">💬</p>
          <p className="text-sm text-gray-400">
            {items.length === 0 ? "Feedback appears here after your assessments." : "Nothing matches the current filters."}
          </p>
        </div>
      ) : (
        <>
          {filtered.slice(0, shown).map(f => (
            <div key={f.id} className="flex items-start gap-3 px-4 py-4 border-b border-gray-50 last:border-0">
              <span className={`w-9 h-9 rounded-full ${tint(f.assessor ?? "?")} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
                {(f.assessor ?? "?")[0]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs">
                  <span className="font-semibold text-gray-800">{f.assessor ?? "Assessor"}</span>
                  <span className={`ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded ${f.positive ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {f.typeLabel}
                  </span>
                  {f.at && <span className="text-[10px] text-gray-400 ml-2" suppressHydrationWarning>{new Date(f.at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</span>}
                </p>
                <p className="text-sm text-gray-700 mt-1">&ldquo;{f.notes}&rdquo;</p>
                {f.competency && (
                  <span className="inline-block mt-1.5 text-[9px] font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{f.competency}</span>
                )}
              </div>
              {f.score !== null && (
                <div className="text-right shrink-0">
                  <p className="text-[9px] text-gray-400">Score</p>
                  <p className="text-lg font-bold" style={{ color: SCORE_COLORS[f.score] ?? "#374151" }}>{f.score}<span className="text-[10px] text-gray-400 font-normal"> /6</span></p>
                </div>
              )}
            </div>
          ))}
          {filtered.length > shown && (
            <button onClick={() => setShown(s => s + 8)}
              className="w-full py-3 text-xs font-semibold text-gray-500 hover:bg-gray-50 border-t border-gray-50">
              Load more feedback ▾
            </button>
          )}
        </>
      )}
    </div>
  );
}
