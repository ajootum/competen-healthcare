"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Chip, focusRing, mutedText } from "@/components/assessment/ui";
import { experienceHref } from "@/lib/individual/experiences";
import type { OverviewRow } from "@/lib/assessment/adapters/scholar/competency-overview-model";
import { BAND_LABEL } from "@/lib/assessment/adapters/scholar/compare";
import { TREND_TEXT } from "@/lib/assessment/adapters/scholar/history";
import { EXPECTED_NOT_SET, NOT_IN_PROGRAMME_NOTE } from "@/lib/assessment/adapters/scholar/competency-overview-model";
import { COMPARE_CLASS_LABEL, EVIDENCE_CLASS_LABEL, NO_SELF_RATING, SELF_CLASS_LABEL } from "@/lib/assessment/adapters/scholar/vocab";
import type { StageView } from "@/lib/assessment/adapters/scholar/progression-view";
import StartButton from "./StartButton";
import StageBlock from "./StageBlock";
import GapActions from "./GapActions";

// MY COMPETENCIES OVERVIEW -- the four classes, side by side on a wide screen and one at a time (a sticky segmented switch) on a narrow one.
//
//   How I rate myself                    the learner's own self-assessments. Always labelled "Self-reported - Not independently verified".
//   What my learning evidence shows      ONLY practice linked to the competency (the existing progress readers). Never a rating.
//   Compare                              the two together, in fixed wording. It never changes a rating.
//   Verified competency                  from the Passport. A self-assessment never produces it.
//
// Tablet-first: 44px targets, no hover-only controls, nothing wider than the screen.

type View = "self" | "evidence" | "compare";
const VIEWS: { key: View; label: string }[] = [{ key: "self", label: "How I rate myself" }, { key: "evidence", label: "What my learning evidence shows" }, { key: "compare", label: COMPARE_CLASS_LABEL }];

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const card = "rounded-2xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)]";

function Spark({ points, max }: { points: (number | null)[]; max: number }) {
  const shown = points.slice(-8);
  if (shown.length < 2) return null;
  return (
    <span className="inline-flex h-6 items-end gap-0.5" role="img" aria-label={`Self ratings over time: ${shown.map(p => (p === null ? "no rating" : p)).join(", ")}`}>
      {shown.map((p, i) => <span key={i} aria-hidden className="w-1.5 rounded-sm bg-[var(--cmp-theme-accent)]" style={{ height: `${p === null ? 12 : Math.max(12, Math.round((p / Math.max(1, max)) * 100))}%`, opacity: p === null ? 0.3 : 1 }} />)}
    </span>
  );
}

function SelfSection({ row, scaleMax, reportHref, assessmentsBase }: { row: OverviewRow; scaleMax: number; reportHref: (id: string) => string; assessmentsBase: string }) {
  const s = row.self;
  return (
    <section aria-label={`${row.competency.title}: how I rate myself`} className={`${card} p-3`}>
      <div className="flex flex-wrap items-center gap-2"><h4 className="text-[13px] font-bold text-[var(--cmp-app-text)]">How I rate myself</h4><Chip tone="info">{SELF_CLASS_LABEL}</Chip></div>
      {!s || s.history.attempts.length === 0 ? (
        <div className="mt-2 space-y-2">
          <p className={`text-[13px] ${mutedText}`}>{NO_SELF_RATING}.{row.competency.expected ? ` Your programme expects level ${row.competency.expected.score}.` : ""}</p>
          {s?.openInstanceId && <Link href={`${assessmentsBase}/${s.openInstanceId}`} className={`inline-flex min-h-9 items-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-[13px] font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Continue my self-assessment</Link>}
          {s?.canRepeat && !s.openInstanceId && <StartButton code={s.canRepeat.code} label="Start Self-Assessment" />}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-bold tabular-nums text-[var(--cmp-app-text)]">{s.rating === null ? "No rating" : s.rating}</span>
            {s.rating !== null && <span className={`text-[12.5px] ${mutedText}`}>of {scaleMax}</span>}
            {s.deltaText && <Chip tone={s.delta && s.delta > 0 ? "success" : s.delta && s.delta < 0 ? "warning" : "neutral"}>{s.deltaText === "no change" ? "No change" : `${s.deltaText} since previous`}</Chip>}
            <Spark points={s.points} max={scaleMax} />
          </p>
          {s.descriptor && <p className="line-clamp-3 text-[13px] text-[var(--cmp-app-text)]">{s.descriptor}</p>}
          <p className={`text-[12.5px] ${mutedText}`}>
            {s.rating === null ? "Every criterion was left unjudged or unanswered." : s.range ? `Across your criteria: ${s.range}.` : null}
            {row.competency.expected ? ` Expected for your programme: ${row.competency.expected.score}.` : ` ${EXPECTED_NOT_SET}.`}
            {s.unjudged > 0 || s.unanswered > 0 ? ` ${s.unjudged} unable to judge, ${s.unanswered} not answered.` : ""}
          </p>
          <p className={`text-[12.5px] ${mutedText}`}>{TREND_TEXT[s.trend]}.</p>
          {s.history.attempts.length > 1 && (
            <details className="text-[12.5px]">
              <summary className={`cursor-pointer font-semibold ${focusRing}`}>Previous ratings ({s.history.attempts.length - 1})</summary>
              <ul className={`mt-1 space-y-0.5 ${mutedText}`}>
                {[...s.history.attempts].reverse().slice(1).map(a => <li key={a.instanceId}>{date(a.submittedAt)}: {a.rating.rating === null ? "no rating" : a.rating.rating} ({a.instrumentName})</li>)}
              </ul>
            </details>
          )}
          {(s.strengths.length > 0 || s.gaps.length > 0) && (
            <details className="text-[12.5px]">
              <summary className={`cursor-pointer font-semibold ${focusRing}`}>My strengths ({s.strengths.length}) and gaps ({s.gaps.length})</summary>
              {s.strengths.length > 0 && <><p className="mt-1 font-semibold text-[var(--cmp-app-text)]">Strengths I identified</p><ul className={`list-disc pl-5 ${mutedText}`}>{s.strengths.slice(0, 6).map(f => <li key={f.itemKey}>{f.code ? `${f.code} ` : ""}{f.prompt}</li>)}</ul></>}
              {s.gaps.length > 0 && <><p className="mt-1 font-semibold text-[var(--cmp-app-text)]">Gaps I identified</p><ul className={`list-disc pl-5 ${mutedText}`}>{s.gaps.slice(0, 6).map(f => <li key={f.itemKey}>{f.code ? `${f.code} ` : ""}{f.prompt} <span className="font-semibold">({f.label})</span></li>)}</ul></>}
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {s.latestInstanceId && <Link href={reportHref(s.latestInstanceId)} className={`inline-flex min-h-9 items-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-[13px] font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Review report</Link>}
            {s.openInstanceId && <Link href={`${assessmentsBase}/${s.openInstanceId}`} className={`inline-flex min-h-9 items-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-[13px] font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Continue my self-assessment</Link>}
            {s.canRepeat && !s.openInstanceId && <StartButton code={s.canRepeat.code} label="Repeat self-assessment" primary={false} />}
          </div>
        </div>
      )}
    </section>
  );
}

function EvidenceSection({ row, study }: { row: OverviewRow; study: string | null }) {
  const e = row.evidence;
  const withStudy = (seg: string) => `${experienceHref("scholar", `study/${seg}`)}${study ? `?study=${study}` : ""}`;
  return (
    <section aria-label={`${row.competency.title}: what my learning evidence shows`} className={`${card} p-3`}>
      <div className="flex flex-wrap items-center gap-2"><h4 className="text-[13px] font-bold text-[var(--cmp-app-text)]">{EVIDENCE_CLASS_LABEL}</h4><Chip>Formative practice, not verified</Chip></div>
      {e.state === "none" ? <p className={`mt-2 text-[13px] ${mutedText}`}>{e.text}.</p> : (
        <div className="mt-2 space-y-1.5 text-[13px]">
          <p className="font-semibold text-[var(--cmp-app-text)]">Practice questions from your notes</p>
          <p className="text-[var(--cmp-app-text)]">{e.outcome}.</p>
          <p className={`text-[12.5px] ${mutedText}`}>
            {e.sectionsAccepted} section{e.sectionsAccepted === 1 ? "" : "s"} of your notes linked to this competency
            {e.lastAt ? `. Last learning activity ${date(e.lastAt)}${e.lastVerdict ? `, last check: ${e.lastVerdict.replace(/_/g, " ")}` : ""}` : ""}.
          </p>
          <p className="flex flex-wrap gap-3 text-[13px]">
            <Link href={withStudy("progress")} className={`font-semibold underline underline-offset-2 ${focusRing}`}>See my practice in Progress</Link>
            <Link href={withStudy("revise")} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Revise</Link>
          </p>
        </div>
      )}
    </section>
  );
}

function CompareSection({ row, myPlanOn, study }: { row: OverviewRow; myPlanOn: boolean; study: string | null }) {
  const c = row.compare;
  const gap = row.self?.gaps[0] ?? null;
  const showActions = c.differs || (row.self?.gaps.length ?? 0) > 0;
  return (
    <section aria-label={`${row.competency.title}: compare`} className={`${card} p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-bold text-[var(--cmp-app-text)]">{COMPARE_CLASS_LABEL}</h4>
        <Chip tone="info">Self: {c.selfBand ? BAND_LABEL[c.selfBand] : "not rated"}</Chip>
        <Chip>Practice: {c.evidenceBand ? BAND_LABEL[c.evidenceBand] : "not enough yet"}</Chip>
      </div>
      <p className="mt-2 text-[13px] text-[var(--cmp-app-text)]" role="note">{c.text}</p>
      <p className={`mt-1 text-[12px] ${mutedText}`}>This never changes your self-rating.</p>
      {showActions && <GapActions competencyId={row.competency.id} title={row.competency.title} wording={gap?.prompt ?? null} myPlanOn={myPlanOn} study={study} />}
    </section>
  );
}

export default function OverviewPanels({ rows, others, scaleMax, myPlanOn, study, topLine, verifiedClass, reportBase, stageViews = [] }: {
  rows: OverviewRow[]; others: OverviewRow[]; scaleMax: number; myPlanOn: boolean; study: string | null; topLine: string; verifiedClass: "not_yet" | "verified" | "unreadable"; reportBase: string;
  /** Every evidence-supported stage decision of the learner (one per rule set), for the short block above the rows. */
  stageViews?: StageView[];
}) {
  const [view, setView] = useState<View>("self");
  const uid = useId();
  const reportHref = (id: string) => `${reportBase}/${id}/report`;
  const list = (items: OverviewRow[]) => items.map(row => (
    <li key={row.competency.id} id={`c-${row.competency.id}`} className={`${card} p-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[14.5px] font-bold text-[var(--cmp-app-text)]">{row.competency.code ? `${row.competency.code} ` : ""}{row.competency.title}</h3>
        <p className={`text-[12.5px] ${mutedText}`}>{[row.competency.domain, row.competency.framework].filter(Boolean).join(" · ")}{row.competency.expected ? ` · Expected level ${row.competency.expected.score}` : row.competency.inProgramme === false ? ` · ${EXPECTED_NOT_SET}` : ""}</p>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">{row.competency.inProgramme === false && <Chip>{NOT_IN_PROGRAMME_NOTE}</Chip>}<Chip tone={row.verification.state === "verified" ? "success" : "neutral"}>{row.verification.line}</Chip>{row.verification.detail && <span className={`text-[12px] ${mutedText}`}>{row.verification.detail}</span>}</p>
      {row.stages.length > 0 && <div className="mt-3"><StageBlock views={row.stages} compact /></div>}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className={view === "self" ? "block" : "hidden lg:block"}><SelfSection row={row} scaleMax={scaleMax} reportHref={reportHref} assessmentsBase={reportBase} /></div>
        <div className={view === "evidence" ? "block" : "hidden lg:block"}><EvidenceSection row={row} study={study} /></div>
        <div className={`lg:col-span-2 ${view === "compare" ? "block" : "hidden lg:block"}`}><CompareSection row={row} myPlanOn={myPlanOn} study={study} /></div>
      </div>
    </li>
  ));
  return (
    <div>
      <p role="status" className={`mb-3 rounded-xl border px-3 py-2 text-[13.5px] font-semibold ${verifiedClass === "verified" ? "border-[var(--cmp-app-border)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "border-[var(--cmp-app-border)] bg-[var(--cmp-surface-neutral)] text-[var(--cmp-text-neutral)]"}`}>{topLine}</p>
      {stageViews.length > 0 && <div className="mb-3"><StageBlock views={stageViews} showName /></div>}
      <div role="tablist" aria-label="What to look at" className="sticky top-0 z-10 mb-3 flex gap-1 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-1 lg:hidden">
        {VIEWS.map(v => (
          <button key={v.key} type="button" role="tab" id={`${uid}-${v.key}`} aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={`min-h-[var(--cmp-touch-min)] flex-1 rounded-lg px-2 text-[12.5px] font-semibold leading-tight ${view === v.key ? "bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)]" : "text-[var(--cmp-app-text)]"} ${focusRing}`}>
            {v.label}
          </button>
        ))}
      </div>
      {rows.length === 0 && <p className={`text-[13.5px] ${mutedText}`}>None of the competencies in your programme has a self-assessment, an assessment to start or linked practice yet.</p>}
      <ul className="space-y-3">{list(rows)}</ul>
      {others.length > 0 && (
        <details className="mt-4">
          <summary className={`cursor-pointer text-[13.5px] font-semibold text-[var(--cmp-app-text)] ${focusRing}`}>Other competencies in your programme ({others.length})</summary>
          <ul className="mt-3 space-y-3">{list(others)}</ul>
        </details>
      )}
    </div>
  );
}
