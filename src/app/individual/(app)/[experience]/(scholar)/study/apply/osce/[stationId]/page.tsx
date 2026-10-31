import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { withStudy } from "@/lib/individual/scholar/study-carry";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../../../_components/chrome";
import StudyNav from "../../../_components/StudyNav";
import { countDue, getOsceStation, listOsceAttempts, readConsent } from "@/lib/individual/scholar/store";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { servableOsceStation } from "@/lib/individual/scholar/library-questions";
import { checklistView, osceAvailability, resultExtras, stationSnapshot, stationView } from "@/lib/individual/scholar/osce-service";
import {
  LIBRARY_STATION_LABEL, OSCE_DIFFICULTY_LABEL, OSCE_OFF, OSCE_PRACTICE_LABEL, OSCE_SOURCE_LABEL, OSCE_UNAVAILABLE, formatClock, marksCompared, readFeedbackParts, readSnapshot,
  remediation, resultOf, scoreExplanation, scoreSummary, type OsceTick,
} from "@/lib/individual/scholar/osce";
import { DeleteStation, OsceRunner, ResultView, type OsceResultView } from "../../../_components/osce-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// ONE OSCE PRACTICE STATION -- SCHOLAR-PRACTICE-EXAMS-01 (720), SCHOLAR-OSCE-01 (721): the station's definition (who it
// is for, what it practises, where it came from, its review status and version), the focused run (timer, written
// responses autosaved, resumed after a reload on the server's clock), the self-check with optional AI feedback, and the
// last result (critical misses first, the score explained, strengths, gaps, guidance, next steps). Read by the caller's
// own id: another person's station is a 404. Simulated practice only -- never an observed clinical skills assessment.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "OSCE practice station" });
}

const MARKING_WORDS = { self_graded: "your own marks", ai_evaluation: "your marks, with AI suggestions you confirmed (not verified)" } as const;
const dt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function OsceStationPage({ params, searchParams }: { params: Promise<{ experience: string; stationId: string }>; searchParams: Promise<{ study?: string }> }) {
  const { experience, stationId } = await params;
  const page = await experienceModulePage(experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [due, availability] = await Promise.all([countDue(ctx.admin, ctx.userId), osceAvailability(ctx.admin, ctx.userId)]);
  // SCHOLAR-SESSION-AI-02: the open study session (database reads only); a run started here is linked to it.
  const study = await loadStudy(ctx.admin, ctx.userId, (await searchParams).study, "apply");
  const back = <p className="mb-2 text-[13px]"><Link href={withStudy(experienceHref("scholar", "study/apply/osce"), study?.session.id)} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>← OSCE practice</Link></p>;
  if (availability.state !== "on") {
    return (
      <>{back}<PageHeader accent={x.accent} eyebrow="OSCE practice" title="Practice station" /><StudyNav dueCount={due} study={study?.bar ?? null} />
        <StatePanel title="OSCE practice is not available"><p>{availability.state === "off" ? OSCE_OFF : OSCE_UNAVAILABLE}</p></StatePanel></>
    );
  }
  const station = await getOsceStation(ctx.admin, ctx.userId, stationId);
  if (!station) notFound();
  const [attempts, consent, stillPublished] = await Promise.all([
    listOsceAttempts(ctx.admin, ctx.userId, station.id, 30), readConsent(ctx.admin, ctx.userId),
    station.source === "library" && station.libraryVersionId ? servableOsceStation(ctx.admin, station.libraryVersionId).then(Boolean) : Promise.resolve(true),
  ]);
  const consentOn = consent.ok && consentStatus(consent.data, consentDocuments().published) === "on";
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate");
  const aiNote = !consentOn ? "AI feedback is off because AI help is off. Mark each item yourself."
    : !standing.available ? `${standing.message ?? "AI feedback is limited right now."} Mark each item yourself.` : null;
  const runs = attempts.ok ? attempts.data : [];
  const fallback = stationSnapshot(station);
  // A run finished but not yet marked (the page was left during the self-check) is picked up where it stopped, and a
  // run still open (left during the timer) is resumed by the runner on the server's clock.
  const pending = runs.find(r => r.finishedAt && !r.ticks);
  const openRun = runs.find(r => r.status === "in_progress" && !r.finishedAt);
  const pendingSnap = pending ? readSnapshot(pending.snapshot, fallback) : null;
  const lastMarked = runs.find(r => r.ticks);
  let last: OsceResultView | null = null;
  if (lastMarked?.ticks && lastMarked.score !== null) {
    const snap = readSnapshot(lastMarked.snapshot, fallback);
    const ticks = lastMarked.ticks as OsceTick[];
    const result = resultOf(snap.checklist, ticks);
    const points = lastMarked.score * snap.checklist.length;
    last = {
      summary: scoreSummary({ points, outOf: snap.checklist.length, criticalMissed: lastMarked.criticalMissed ?? 0 }),
      explanation: scoreExplanation({ points, outOf: snap.checklist.length, criticalMissed: result.criticalMissed.length, criticalPartly: result.criticalPartly.length, criticalTotal: snap.checklist.filter(i => i.critical).length }),
      marking: lastMarked.marking ?? "self_graded", remediation: remediation({ checklist: snap.checklist, materialId: station.materialId, competencyId: station.competencyId }, ticks),
      result, marks: marksCompared(snap.checklist, ticks, Array.isArray(lastMarked.feedback?.suggested) ? lastMarked.feedback!.suggested : null),
      version: lastMarked.stationVersion ?? snap.version, feedback: lastMarked.marking === "ai_evaluation" ? readFeedbackParts(lastMarked.feedback?.parts) : null,
      ...resultExtras(snap),
    };
  }
  const facts: [string, string | null][] = [
    ["Profession", station.profession ?? "Any healthcare profession"], ["Programme", station.programmeLabel ?? station.programmeCode],
    ["Topic", station.topic], ["Body system", station.bodySystem], ["Difficulty", station.difficulty ? OSCE_DIFFICULTY_LABEL[station.difficulty] : null],
    ["Source", OSCE_SOURCE_LABEL[station.source]], ["Review status", station.contentStatus], ["Version", String(station.version)],
  ];

  return (
    <>
      {back}
      <PageHeader accent={x.accent} eyebrow="OSCE practice" title={station.title} intro={`${station.durationMinutes} minutes · ${station.checklist.length} checklist items · version ${station.version}`} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} detail={OSCE_PRACTICE_LABEL} />
      {!stillPublished && <p role="status" className="mb-4 rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-900">This station&rsquo;s library version is no longer published, so it cannot be practised again. Your earlier runs are kept below.</p>}

      {/* Two columns only where the MAIN AREA has room for both (a 20rem work column beside a 14rem aside), not at a
          viewport edge: on a 768px tablet the shell sidebar leaves about 517px, so the aside wraps below the run and the
          checklist keeps the full width (coordinator browser check, 31 Oct 2026). CPR-MOB-001 keeps its single md edge. */}
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[3_1_20rem] space-y-5">
          {stillPublished || pending || openRun ? (
            <OsceRunner key={pending?.id ?? openRun?.id ?? "new"} station={stationView(station)}
              checklist={pendingSnap ? checklistView(pendingSnap.checklist) : null}
              aiNote={aiNote} pending={pending ? { attemptId: pending.id, timeUp: pending.timeUp } : null} hasOpenRun={!!openRun} />
          ) : null}
          {last && (
            <section aria-labelledby="osce-last-h" className="rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4 md:p-5">
              <h2 id="osce-last-h" className="text-[16px] font-bold text-gray-900">Your last marked run</h2>
              <ResultView r={last} />
            </section>
          )}
        </div>
        <aside aria-labelledby="osce-about-h" className="min-w-0 flex-[2_1_14rem] space-y-4">
          <section className="rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4">
            <h2 id="osce-about-h" className="text-[14px] font-bold text-gray-900">About this station</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              {facts.map(([k, v]) => <Fragment key={k}><dt className="font-semibold text-gray-700">{k}</dt><dd className="text-gray-800">{v ?? <span className="text-gray-500">Not recorded</span>}</dd></Fragment>)}
            </dl>
            {station.learningOutcomes.length > 0 && (
              <><p className="mt-2 text-[12.5px] font-semibold text-gray-700">Learning outcomes</p><ul className="list-disc pl-5 text-[13px]">{station.learningOutcomes.map(o => <li key={o}>{o}</li>)}</ul></>
            )}
            {station.references.length > 0 && (
              <><p className="mt-2 text-[12.5px] font-semibold text-gray-700">Where it came from</p>
                <ul className="list-disc pl-5 text-[13px]">{station.references.map((r, i) => (
                  <li key={i}>{r.kind === "notes" ? `Your notes: ${r.citation}` : r.kind === "competency" ? `Competency: ${r.label}` : r.kind === "library" ? `${LIBRARY_STATION_LABEL}, version ${r.versionNo}` : r.url ? <a href={r.url} className="underline" rel="noreferrer" target="_blank">{r.label}</a> : r.label}</li>
                ))}</ul></>
            )}
          </section>
          <section className="rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4">
            <h2 id="osce-history-h" className="text-[14px] font-bold text-gray-900">Your runs of this station</h2>
            <p className="text-[12px] text-gray-600">Practice scores, not marks of competence.</p>
            {!attempts.ok ? <Unreadable what="your practice runs" /> : runs.length === 0 ? <p className="mt-2 text-[13px] text-gray-600">None yet.</p> : (
              <ul className="mt-2 space-y-2">
                {runs.map(r => {
                  const snap = readSnapshot(r.snapshot, fallback);
                  return (
                    <li key={r.id} className="text-[13px] text-gray-800">
                      <span className="font-semibold">{dt(r.startedAt)}</span>
                      {" · "}version {r.stationVersion ?? snap.version}
                      {" · "}{r.status === "abandoned" ? "discarded" : !r.finishedAt ? "in progress" : `${formatClock(r.durationSeconds ?? 0)}${r.timeUp ? " (time up)" : ""}`}
                      {r.ticks && r.score !== null
                        ? <span className="block text-[12.5px] text-gray-600">{scoreSummary({ points: r.score * snap.checklist.length, outOf: snap.checklist.length, criticalMissed: r.criticalMissed ?? 0 })} · {r.marking ? MARKING_WORDS[r.marking] : ""}</span>
                        : r.finishedAt ? <span className="block text-[12.5px] text-gray-600">Not marked yet</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <DeleteStation stationId={station.id} />
        </aside>
      </div>
    </>
  );
}
