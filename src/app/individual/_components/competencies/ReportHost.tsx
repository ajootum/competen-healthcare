"use client";

import Link from "next/link";
import { AssessmentReport, type EvidenceRef, type ReportListEntry } from "@/components/assessment";
import { Chip, focusRing, mutedText } from "@/components/assessment/ui";
import type { InstrumentDef, Responses, RulesDoc } from "@/lib/assessment/core";
import type { StageView } from "@/lib/assessment/adapters/scholar/progression-view";
import GapActions from "./GapActions";
import StageBlock from "./StageBlock";

// THE REPORT OF ONE ASSESSMENT -- the shared AssessmentReport, with the attestation said beside the outcome and, for the learner's own gaps, what to do
// next through the functions that already exist (Learn, Revise, Apply, Evaluate, Ask about this, Add to My Plan). A self-assessment is the learner's own
// word: the banner says so, and nothing on this page verifies anything.

export type GapAction = { itemKey: string; competencyId: string; competencyTitle: string; wording: string; label: string };

export default function ReportHost(props: {
  def: InstrumentDef; rules: RulesDoc; responses: Responses; attestationLabel: string; bannerTitle: string; bannerText: string; recordedNote: string | null;
  title: string; subtitle: string; metadata: { label: string; value: string | null }[];
  strengths: ReportListEntry[]; gaps: ReportListEntry[]; evidenceRefs: EvidenceRef[]; evidenceCounts: Record<string, number>; generatedAt: string;
  gapActions: GapAction[]; myPlanOn: boolean; study: string | null; listHref: string; showActions: boolean;
  /** The learner's evidence-supported stage for this assessment's checklist or competencies, when a decision exists. */
  stageViews?: StageView[];
}) {
  return (
    <div className="space-y-4">
      <p className="print:hidden"><Link href={props.listHref} className={`text-[13px] font-semibold underline underline-offset-2 text-[var(--cmp-app-text)] ${focusRing}`}>Back to Assessments</Link></p>
      <AssessmentReport
        def={props.def} rules={props.rules} responses={props.responses} attestationLabel={props.attestationLabel} evidenceCounts={props.evidenceCounts}
        banner={<div className="space-y-1"><p className="text-sm font-bold text-[var(--cmp-text-information)]">{props.bannerTitle}</p><p className="text-[13px] text-[var(--cmp-app-text)]">{props.bannerText}</p>{props.recordedNote && <p className="text-[13px] text-[var(--cmp-app-text)]">{props.recordedNote}</p>}</div>}
        title={props.title} subtitle={props.subtitle} metadata={props.metadata} strengths={props.strengths} gaps={props.gaps} evidenceRefs={props.evidenceRefs}
        generatedAt={props.generatedAt} showPrintButton
      />
      {props.stageViews && props.stageViews.length > 0 && <div className="print:hidden"><StageBlock views={props.stageViews} showName /></div>}
      {props.showActions && props.gapActions.length > 0 && (
        <section aria-label="What to do about my gaps" className="rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 print:hidden">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-[var(--cmp-app-text)]">What to do about my gaps</h2><Chip tone="info">Suggestions only</Chip></div>
          <p className={`mt-1 text-[13px] ${mutedText}`}>These open the study tools you already have. They never change your self-rating.</p>
          <ul className="mt-3 divide-y divide-[var(--cmp-app-border)]">
            {props.gapActions.map(g => (
              <li key={g.itemKey} className="py-3">
                <p className="text-[13.5px] font-semibold text-[var(--cmp-app-text)]">{g.wording}</p>
                <p className={`text-[12.5px] ${mutedText}`}>{g.competencyTitle} · {g.label}</p>
                <GapActions competencyId={g.competencyId} title={g.competencyTitle} wording={g.wording} myPlanOn={props.myPlanOn} study={props.study} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
