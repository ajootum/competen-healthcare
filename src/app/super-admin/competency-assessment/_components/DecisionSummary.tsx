import type { DecisionView } from "@/lib/competency/verification";

// A decision as it was recorded (migration 510, 690): outcome, level, stage, components, and where a second assessor's
// confirmation is required, where that stands. Read-only; the stage is the one pinned to the decision, not today's mapping.

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Pure: the confirmation line for a decision, or null when its method asks for no second assessor. */
export function confirmationLine(d: Pick<DecisionView, "confirmationRequired" | "confirmation">): { text: string; tone: "wait" | "ok" | "bad" } | null {
  if (!d.confirmationRequired) return null;
  if (!d.confirmation) return { text: "Waiting for a second assessor", tone: "wait" };
  return d.confirmation.result === "confirmed" ? { text: "Confirmed by a second assessor", tone: "ok" } : { text: "Not confirmed", tone: "bad" };
}

const TONE = { wait: "text-amber-900", ok: "text-[var(--cmp-text-success)]", bad: "text-[var(--cmp-text-critical)]" } as const;

export function DecisionSummary({ d, levelLabel, componentLabels, showRationale = true }: {
  d: DecisionView; levelLabel: (id: string | null) => string | null; componentLabels: Record<string, string>; showRationale?: boolean;
}) {
  const conf = confirmationLine(d);
  const level = levelLabel(d.levelId);
  return (
    <div className="space-y-1 text-[13px] text-gray-800">
      <p>
        <span className="font-semibold">{d.outcomeLabel ?? d.outcomeCode}</span>
        {level && <span> · level {level}</span>}
        {d.stage && <span> · stage {d.stage.label}{d.stage.mappingVersion !== null ? <span className="text-gray-500"> (stage mapping version {d.stage.mappingVersion})</span> : null}</span>}
        <span className="text-gray-500"> · decided {day(d.decidedAt)}</span>
      </p>
      {conf && <p className={`text-[12.5px] font-semibold ${TONE[conf.tone]}`}>{conf.text}{d.confirmation && d.confirmation.rationale ? <span className="font-normal text-gray-700"> · {d.confirmation.rationale}</span> : null}</p>}
      {d.componentResults.length > 0 && (
        <ul className="list-disc pl-5 text-[12.5px] text-gray-700">
          {d.componentResults.map(c => <li key={c.code}>{componentLabels[c.code] ?? c.code}: {c.label ? `${c.score ?? ""} ${c.label}`.trim() : "not assessed"}{c.note ? ` (${c.note})` : ""}</li>)}
        </ul>
      )}
      {showRationale && d.rationale && <p className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-[12.5px] text-gray-700">{d.rationale}</p>}
    </div>
  );
}
