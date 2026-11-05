import Link from "next/link";
import { experienceHref } from "@/lib/individual/experiences";
import { noProgrammeText } from "@/lib/individual/scholar/classify-view";
import type { LearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import type { CompetencyProgress, CompetencyProgressRow } from "@/lib/individual/scholar/competency-progress";
import { LAYER_LABEL } from "@/lib/individual/scholar/catalogue";
import { CHECK_VERDICT_LABEL, NO_APPROVED_COMPETENCIES, type CheckVerdict } from "@/lib/individual/scholar/config";
import type { CompetencyCoverage } from "@/lib/competency/progress-model";
import { listSummary } from "@/lib/individual/scholar/progress-simplify";
import { StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import { LayerTag } from "./competency-client";
import { ContentStatusTag } from "./client";
import { LearningSection } from "@/components/ui/scholar-learning";
import { Fold, sectionLead, toneAction } from "./progress-parts";

// ── PROGRESS BY COMPETENCY: ONE SECTION, TWO PLACES ── extracted from study/progress/page.tsx (scholar modules) ──
// Read by My Learning > Progress and by My Competencies > My Competency Profile, so the two cannot drift.
// Formative practice only: never a judgement of competence. DS rollout: the sources tone, as the framework view in Evaluate.

const STATUS_TEXT: Record<CompetencyProgressRow["status"], string> = {
  no_notes: "No notes linked yet",
  notes_linked: "Notes linked, not practised yet",
  practising: "Practising",
};

/** COMPETEN-SCHOLAR-01 S4. Practice against each competency of the programme -- never a judgement of competence. */
/**
 * The totals and the measure state come from S5's coverage (li.coverage) -- ONE computation, read by both this
 * section and the Learning Intelligence panel (COMPETEN-SCHOLAR-01 P0). The rows below are this section's own
 * detail from the same accepted links (a unit test pins that each row's figures equal coverage's).
 */
export function CompetencySection({ learner, progress, coverage, unreadable, accent, activity, offered }: {
  learner: LearnerCatalogue | null; progress: CompetencyProgress | null; coverage: CompetencyCoverage | null; unreadable: boolean; accent: string;
  /** P6: programmes Competen offers (null: unreadable). None offered: nothing to choose, and the page does not ask. */
  offered: number | null;
  /** LEARN-01 L4: learning activity on sections linked to each competency. Null: not recorded here (414 absent). */
  activity: Map<string, { actions: number; lastVerdict: string | null; lastAt: string }> | null;
}) {
  if (!learner?.provisioned) return null;
  return (
    <LearningSection caps={false} tone="sources" icon="layers" level={2} headingId="competency-h" title={`By competency${learner.programme ? ` · ${learner.programme.label}` : ""}`} className="mt-6">
      <p className={sectionLead}>
        Which competencies of your programme your notes cover, and how you did on practice questions written for each. Practice counts once you have accepted the link from a section to a competency, so suggestions you have not decided on, and rejected links, are not counted.
      </p>
      <div className="mt-3">
        {!learner.programme ? (
          <StatePanel title={offered === 0 ? "No competency framework is set up for Scholar yet" : "No programme chosen"}>
            <p>{noProgrammeText(offered)}</p>
            {offered !== 0 && <p><Link href={experienceHref("scholar", "study/library")} className={`font-semibold underline ${focusRing}`} style={{ color: accent }}>Go to My Learning</Link></p>}
          </StatePanel>
        ) : unreadable ? <Unreadable what="progress by competency" />
          : progress && progress.totals.competencies === 0 ? (
            <StatePanel title={learner.belowFloor > 0 ? NO_APPROVED_COMPETENCIES : "Your programme has no competencies to show yet"}>
              <p>{learner.belowFloor > 0
                ? `Only clinically approved content is offered, and none of the ${learner.belowFloor} competencies in your programme is approved yet. Nothing about your study has changed.`
                : "None of the frameworks your programme uses is published yet, so there is nothing to measure against. Nothing about your study has changed."}</p>
            </StatePanel>
          ) : progress && (
            <>
              <p className="mb-3 text-[13.5px] text-gray-800 tabular-nums">
                {coverage?.state === "measured"
                  ? <>Practised {coverage.covered} of {coverage.total} competencies · right on the latest try for {coverage.coveredPositive}</>
                  : <span className="text-gray-600">{coverage ? coverage.reason : "Coverage could not be measured just now."}</span>}
                {" · "}notes linked to {progress.totals.withNotes}
                {progress.outsideProgramme ? ` · ${progress.outsideProgramme} question${progress.outsideProgramme === 1 ? "" : "s"} practise competencies outside this programme` : ""}
              </p>
              {coverage?.state === "measured" && coverage.gaps.length > 0 && (
                <p className="mb-3 text-[13px] text-gray-700">
                  <span className="font-semibold">Not practised yet, highest expected level first: </span>
                  {coverage.gaps.slice(0, 5).map(g => `${g.name}${g.expected ? ` (${g.expected})` : ""}`).join(" · ")}{coverage.gaps.length > 5 ? ` and ${coverage.gaps.length - 5} more` : ""}
                </p>
              )}
              <Fold summary={listSummary({ one: "competency", many: "competencies" }, progress.totals.competencies, `notes linked to ${progress.totals.withNotes}`)}>
              <div className="divide-y divide-gray-100">
                {progress.layers.map(l => (
                  <details key={l.layer} open={l.rows.some(r => r.status !== "no_notes")}>
                    <summary className={`flex cursor-pointer flex-wrap items-center gap-2 p-4 ${focusRing}`}>
                      <LayerTag layer={l.layer} />
                      <span className="text-[14px] font-semibold text-gray-900">{LAYER_LABEL[l.layer]} competencies</span>
                      <span className="text-[12.5px] text-gray-600 tabular-nums">{l.rows.filter(r => r.status !== "no_notes").length} of {l.rows.length} with notes</span>
                    </summary>
                    <ul className="divide-y divide-gray-100 border-t border-gray-100">
                      {l.rows.map(r => (
                        <li key={r.id} className="px-4 py-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-gray-900">{r.code ? `${r.code} ` : ""}{r.title}<ContentStatusTag status={r.contentStatus} /></span>
                            <span className={`text-[13px] font-semibold tabular-nums ${r.latestAccuracy === null ? "" : "cmp-learn-ink"}`}>
                              {r.latestAccuracy === null ? <span className="text-gray-600">{STATUS_TEXT[r.status]}</span> : `${r.latestAccuracy}% practice accuracy`}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12.5px] text-gray-600 tabular-nums">
                            {r.domain}{r.structure ? ` · ${r.structure}` : ""} · {r.sectionsAccepted} section{r.sectionsAccepted === 1 ? "" : "s"} accepted, {r.sectionsProposed} suggested
                            {r.questions ? ` · ${r.answered} of ${r.questions} question${r.questions === 1 ? "" : "s"} answered` : ""}
                          </p>
                          {(r.sectionsAccepted + r.sectionsProposed > 0 || activity?.get(r.id)) && (
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-700">
                              {r.sectionsAccepted + r.sectionsProposed > 0 && (
                                <Link href={experienceHref("scholar", `study/learn?competency=${r.id}`)} className={toneAction.link}>Learn this competency</Link>
                              )}
                              {activity?.get(r.id) && (
                                <span>
                                  Learning activity: {activity.get(r.id)!.actions} action{activity.get(r.id)!.actions === 1 ? "" : "s"}
                                  {activity.get(r.id)!.lastVerdict ? ` · last check: ${CHECK_VERDICT_LABEL[activity.get(r.id)!.lastVerdict as CheckVerdict] ?? activity.get(r.id)!.lastVerdict}` : ""}
                                </span>
                              )}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
              </Fold>
            </>
          )}
      </div>
    </LearningSection>
  );
}
