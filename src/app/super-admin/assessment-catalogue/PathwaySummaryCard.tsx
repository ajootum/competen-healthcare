"use client";

import type { PathwaySummary } from "@/lib/assessment/studio/pathway";
import { btnPrimary } from "./ui";

// ASMT-PATHWAY-01 -- the pathway to publication as the catalogue shows it: the stage strip, the next action in plain words,
// who can act (by name, from the live appointments), what blocks it, and the way into Checklist Studio where the action is
// taken. The catalogue decides nothing: this is the Studio's pathway, read, not copied.

const TONE: Record<PathwaySummary["stages"][number]["status"], string> = {
  done: "border-green-600 bg-green-50 text-green-900", current: "border-blue-600 bg-blue-50 text-blue-900", waiting: "border-amber-500 bg-amber-50 text-amber-900",
  blocked: "border-red-500 bg-red-50 text-red-900", not_started: "border-gray-200 bg-white text-gray-500",
};
const WORD: Record<PathwaySummary["stages"][number]["status"], string> = { done: "Done", current: "Current", waiting: "Waiting", blocked: "Blocked", not_started: "Not yet" };

export default function PathwaySummaryCard({ summary: s, studioHref, studioLabel = "Open in Checklist Studio", canStudio = true, compact = false }: {
  summary: PathwaySummary; studioHref: string; studioLabel?: string; canStudio?: boolean; compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-3" data-testid="pathway-summary">
      <p className="text-[11px] font-bold uppercase tracking-wide text-teal-900">Pathway to publication · {s.stageLabel}</p>
      <ol className="mt-2 grid grid-cols-3 gap-1" aria-label="Pathway stages">
        {s.stages.map((st, i) => (
          <li key={st.key} className={`rounded-md border border-l-4 px-1.5 py-1 ${TONE[st.status]}`}>
            <p className="text-[10px] font-bold uppercase leading-tight">{i + 1}. {st.label}</p>
            {!compact && <p className="text-[10.5px]">{WORD[st.status]}</p>}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[13.5px] font-bold text-gray-900">Next: {s.headline}</p>
      {!compact && s.detail && <p className="text-[12.5px] text-gray-800">{s.detail}</p>}
      <p className="mt-1 text-[12px] text-gray-700">
        {s.responsible ? <><b>{s.responsible}</b>{s.who.length ? `: ${s.who.join(", ")}` : s.whoNote ? ` · ${s.whoNote}` : ""}.</> : null}
      </p>
      {s.blockers.length > 0 && <ul className="mt-1 list-disc pl-5 text-[12px] text-red-900">{s.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      <p className="mt-1 text-[12.5px] text-gray-800" role="status">{s.prompt}</p>
      {canStudio
        ? <a href={studioHref} className={`${btnPrimary} mt-2`}>{studioLabel}</a>
        : <p className="mt-2 text-[12px] text-gray-600">The action is taken in Checklist Studio, which needs its own right.</p>}
    </div>
  );
}
