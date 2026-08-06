"use client";

import type { PatientPathwayView } from "@/lib/practice/pathways";

// The comp's dotted stage track -- "Stage 3 of 5" drawn as filled, current and ahead.
//
// ⚠ IT IS DRAWN FROM THE PATIENT'S OWN HISTORY, NOT FROM THE POSITION NUMBER. Filling every dot up to
// the current position would draw a straight run of completed stages over a journey that was actually
// skipped, repeated and cancelled -- which is exactly the history migration 239 keeps a row per visit
// in order to preserve. A skipped stage is a HOLLOW dot with a slash tint; a cancelled one is grey; a
// repeated one appears twice because it happened twice.
//
// THREE STATES ARE NOT ENOUGH AND THAT IS WHY THIS IS NOT A PROGRESS BAR. A bar can only say "this far";
// the point of a pathway's record is what happened on the way.

const DOT: Record<string, string> = {
  completed: "bg-emerald-500 ring-emerald-200",
  entered: "bg-[var(--cp-primary)] ring-[var(--cp-primary)]/30",
  skipped: "bg-white ring-amber-400 border border-amber-400",
  cancelled: "bg-slate-200 ring-slate-200",
  ahead: "bg-white ring-slate-200 border border-slate-200",
};

const STATE_WORD: Record<string, string> = {
  completed: "completed", entered: "in progress", skipped: "skipped", cancelled: "cancelled",
};

export default function StageTrack({ pathway, compact = false }: { pathway: PatientPathwayView; compact?: boolean }) {
  const visited = pathway.history;
  // Stages of the template not yet reached. Drawn hollow so the track shows the whole plan, not only
  // the part that has happened -- "stage 2 of 6" is meaningless without the six.
  const reachedPositions = new Set(visited.map(h => h.position));
  const ahead = Math.max(0, pathway.stageCount - reachedPositions.size);

  const size = compact ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <div className="flex items-center gap-1">
      {visited.map((h, i) => (
        <span key={h.id} className="flex items-center">
          {i > 0 && <span aria-hidden className="mr-1 h-px w-3 bg-slate-200" />}
          <span
            title={`${h.stageName} — ${STATE_WORD[h.state] ?? h.state}${h.due_on ? `, due ${h.due_on}` : ""}${h.note ? ` — ${h.note}` : ""}`}
            className={`${size} rounded-full ring-2 ${DOT[h.state] ?? DOT.ahead}`}
          />
        </span>
      ))}
      {Array.from({ length: ahead }).map((_, i) => (
        <span key={`ahead-${i}`} className="flex items-center">
          <span aria-hidden className="mr-1 h-px w-3 bg-slate-200" />
          <span title="Not reached yet" className={`${size} rounded-full ring-2 ${DOT.ahead}`} />
        </span>
      ))}
      <span className="ml-1.5 whitespace-nowrap text-[11px] font-semibold text-gray-500">
        {pathway.stagePosition === null
          ? `${visited.length} of ${pathway.stageCount} stages`
          : `Stage ${pathway.stagePosition} of ${pathway.stageCount}`}
      </span>
    </div>
  );
}
