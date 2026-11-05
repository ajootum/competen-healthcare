import Link from "next/link";
import type { LearningIntelligence as LI } from "@/lib/individual/scholar/intelligence";
import { measureGroups, noMeasureLine } from "@/lib/individual/scholar/progress-simplify";
import { LearningIcon, LearningSection, SectionCard } from "@/components/ui/scholar-learning";
import { NotMeasuredLine, sectionLead, toneAction } from "./progress-parts";

// LEARNING INTELLIGENCE -- COMPETEN-SCHOLAR-01 S5. Four measures, each in its own panel, never one blended
// score. A measure without the data to support it says so, in its own words: "Not measured" with the reason,
// or "Too little practice to say" with how much there is and how much is needed. Never a blank, never a 0.
//
// My Plan correction (CE-03): the engagement panel is gone (the one "Your learning activity" block on the page says it, from the shared definition of a
// study day), and a measure that has no figure yet is named in ONE line instead of a "Not measured" panel each.
//
// Presentational only: everything is computed by src/lib/individual/scholar/intelligence.ts.
// DS rollout: one section in the summary tone, each view a light card inside it.

function Panel({ id, title, what, children }: { id: string; title: string; what: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl bg-[var(--cmp-app-surface)] p-4 ring-1 ring-[var(--learn-border)]">
      <h3 id={id} className="cmp-learn-ink text-[15px] font-bold">{title}</h3>
      <p className="mt-0.5 text-[13px] leading-relaxed text-gray-700">{what}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Fig = ({ k, v }: { k: string; v: string }) => (
  <div><dt className="text-[12.5px] font-semibold text-gray-700">{k}</dt><dd className="text-[18px] font-bold tabular-nums text-gray-900">{v}</dd></div>
);

export default function LearningIntelligence({ li }: { li: LI }) {
  const { coverage, knowledge, reasoning } = li;
  const titled = (title: string, m: { state: string }) => ({ id: title, title: m.state === "insufficient" ? `${title.toLowerCase()} (too little practice so far)` : title.toLowerCase(), state: m.state });
  const groups = measureGroups([titled("Knowledge performance", knowledge), titled("Clinical reasoning", reasoning), titled("Competency coverage", coverage)]);
  return (
    <LearningSection caps={false} tone="summary" icon="summary" level={2} headingId="li-h" title="Learning intelligence" className="mt-6">
      <p className={sectionLead}>Separate views of your own study, not combined into a score.</p>

      {li.recommendations.length > 0 && (
        <SectionCard className="mt-3">
          <h3 className="cmp-learn-ink flex items-center gap-2 text-[15px] font-bold"><span className="cmp-learn-accent"><LearningIcon name="target" className="h-4 w-4" /></span>What to do next</h3>
          <ol className="mt-2 space-y-2">
            {li.recommendations.map(r => (
              <li key={r.id} className="text-[14px]">
                {r.href
                  ? <Link href={r.href} className={toneAction.link}>{r.title}</Link>
                  : <span className="font-semibold text-gray-900">{r.title}</span>}
                <span className="block text-[13.5px] leading-relaxed text-gray-700">{r.reason}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      {li.insights.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[13.5px] leading-relaxed text-gray-800 ring-1 ring-[var(--learn-border)]">
          {li.insights.map(s => <li key={s}>{s}</li>)}
        </ul>
      )}

      {groups.none && <div className="mt-3"><NotMeasuredLine text={noMeasureLine("knowledge, reasoning or competency coverage")} /></div>}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {knowledge.state === "measured" && (
          <Panel id="li-know" title="Knowledge performance" what="How your practice questions go, and how well you recall revision cards.">
            <dl className="grid grid-cols-2 gap-3">
              <Fig k="Right on latest try" v={`${knowledge.accuracy}%`} />
              <Fig k="Right first time" v={`${knowledge.firstTryAccuracy}%`} />
              <Fig k="Put right later" v={String(knowledge.corrected)} />
              <Fig k="Recall (0 to 5)" v={knowledge.recall.state === "measured" ? String(knowledge.recall.meanQuality) : knowledge.recall.state === "insufficient" ? "Too few" : "Not measured"} />
            </dl>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
              From {knowledge.answered} practice questions answered.{" "}
              {knowledge.recall.state === "measured" ? `Recall is the average of your own grades over ${knowledge.recall.reviews} recent reviews.` : knowledge.recall.reason}
            </p>
          </Panel>
        )}
        {reasoning.state === "measured" && (
          <Panel id="li-reason" title="Clinical reasoning" what="How your practice scenarios go, tracked apart from practice questions. Scenarios from your notes, not clinically reviewed cases.">
            <dl className="grid grid-cols-3 gap-3">
              <Fig k="Right on latest try" v={`${reasoning.accuracy}%`} />
              <Fig k="Right first time" v={`${reasoning.firstTryAccuracy}%`} />
              <Fig k="Put right later" v={String(reasoning.corrected)} />
            </dl>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-700">From {reasoning.answered} practice scenarios worked through.</p>
          </Panel>
        )}
        {coverage.state === "measured" && (
          <Panel id="li-cov" title="Competency coverage" what="Which competencies in your framework your practice has touched. Practised, not achieved.">
            <dl className="grid grid-cols-2 gap-3">
              <Fig k="Practised" v={`${coverage.covered} of ${coverage.total}`} />
              <Fig k="Practised with a right answer" v={`${coverage.coveredPositive} of ${coverage.total}`} />
            </dl>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-700">{coverage.framework}.{coverage.gaps.length ? ` Not yet practised: ${coverage.gaps.slice(0, 5).map(g => g.expected ? `${g.name} (expected: ${g.expected})` : g.name).join(", ")}${coverage.gaps.length > 5 ? ` and ${coverage.gaps.length - 5} more` : ""}.` : " Every competency has been practised."}</p>
          </Panel>
        )}
      </div>
      {groups.line && <div className="mt-3"><NotMeasuredLine text={groups.line} /></div>}
    </LearningSection>
  );
}
