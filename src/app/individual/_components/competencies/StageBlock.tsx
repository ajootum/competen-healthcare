import { Chip, mutedText } from "@/components/assessment/ui";
import type { StageView } from "@/lib/assessment/adapters/scholar/progression-view";
import { STAGE_BLOCK_TITLE, STAGE_STALE_NOTE } from "@/lib/assessment/adapters/scholar/vocab";

// THE LEARNER'S EVIDENCE-SUPPORTED STAGE -- worked out from assessor-led assessments by the published rule set, with the stage scale's own labels.
// It is always beside "Evidence-supported, not formally verified". It is not the self rating and not the Verified competency line, which stay apart.

const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function StageBlock({ views, showName = false, compact = false }: { views: readonly StageView[]; showName?: boolean; compact?: boolean }) {
  if (!views.length) return null;
  return (
    <section aria-label={STAGE_BLOCK_TITLE} className="rounded-2xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2"><h4 className="text-[13px] font-bold text-[var(--cmp-app-text)]">{STAGE_BLOCK_TITLE}</h4><Chip tone="info">{views[0].note}</Chip></div>
      <ul className={`mt-2 ${compact ? "space-y-1.5" : "space-y-2.5"}`}>
        {views.map(v => (
          <li key={v.ruleSetId} className="text-[13px] text-[var(--cmp-app-text)]">
            {showName && <p className="font-semibold">{v.ruleSetName}</p>}
            <p>{v.summary}</p>
            <p className={`text-[12px] ${mutedText}`}>Worked out {dateOf(v.computedAt)}.{v.stale ? ` ${STAGE_STALE_NOTE}` : ""}</p>
          </li>
        ))}
      </ul>
      <p className={`mt-2 text-[12px] ${mutedText}`}>{views[0].note}.</p>
    </section>
  );
}
