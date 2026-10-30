import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../../../_components/chrome";
import StudyNav from "../../../_components/StudyNav";
import { countDue, getOsceStation, listOsceAttempts, readConsent } from "@/lib/individual/scholar/store";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { osceAvailability, stationView } from "@/lib/individual/scholar/osce-service";
import { OSCE_MARK_LABEL, OSCE_OFF, OSCE_PRACTICE_LABEL, OSCE_SOURCE_LABEL, OSCE_UNAVAILABLE, formatClock, remediation, scoreSummary } from "@/lib/individual/scholar/osce";
import { studyHref } from "../../../_components/question-view";
import { DeleteStation, OsceRunner } from "../../../_components/osce-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// ONE OSCE PRACTICE STATION -- SCHOLAR-PRACTICE-EXAMS-01 (720): run it (timer, written responses, self-check with optional
// AI feedback), and its past runs with what to revisit. Read by the caller's own id: another person's station is a 404.
// Simulated practice only -- never an observed clinical skills assessment, never verified competence.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "OSCE practice station" });
}

const MARKING_WORDS = { self_graded: "your own marks", ai_evaluation: "your marks, with AI suggestions you confirmed (not verified)" } as const;

export default async function OsceStationPage({ params }: { params: Promise<{ experience: string; stationId: string }> }) {
  const { experience, stationId } = await params;
  const page = await experienceModulePage(experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [due, availability] = await Promise.all([countDue(ctx.admin, ctx.userId), osceAvailability(ctx.admin, ctx.userId)]);
  const back = <p className="mb-2 text-[13px]"><Link href={experienceHref("scholar", "study/apply/osce")} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>← OSCE practice</Link></p>;
  if (availability.state !== "on") {
    return (
      <>{back}<PageHeader accent={x.accent} eyebrow="OSCE practice" title="Practice station" /><StudyNav dueCount={due} />
        <StatePanel title="OSCE practice is not available"><p>{availability.state === "off" ? OSCE_OFF : OSCE_UNAVAILABLE}</p></StatePanel></>
    );
  }
  const station = await getOsceStation(ctx.admin, ctx.userId, stationId);
  if (!station) notFound();
  const [attempts, consent] = await Promise.all([listOsceAttempts(ctx.admin, ctx.userId, station.id, 30), readConsent(ctx.admin, ctx.userId)]);
  const consentOn = consent.ok && consentStatus(consent.data, consentDocuments().published) === "on";
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate");
  const aiNote = !consentOn ? "AI feedback is off because AI help is off. Mark each item yourself."
    : !standing.available ? `${standing.message ?? "AI feedback is limited right now."} Mark each item yourself.` : null;
  const runs = attempts.ok ? attempts.data : [];
  // A run finished but not yet marked (the page was left during the self-check) is picked up where it stopped.
  const open = runs.find(r => r.finishedAt && !r.ticks);
  const lastMarked = runs.find(r => r.ticks);
  const remedies = lastMarked?.ticks ? remediation(station, lastMarked.ticks) : [];
  const remedyHref = (r: { segment: string; query: Record<string, string> }) => { const q = new URLSearchParams(r.query).toString(); return `${studyHref(r.segment)}${q ? `?${q}` : ""}`; };

  return (
    <>
      {back}
      <PageHeader accent={x.accent} eyebrow="OSCE practice" title={station.title} intro={`${station.durationMinutes} minutes · ${station.checklist.length} checklist items`} />
      <StudyNav dueCount={due} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} detail={OSCE_PRACTICE_LABEL} />
      <p className="mb-4 text-[12.5px] text-gray-600">{OSCE_SOURCE_LABEL[station.source]} · {station.contentStatus}</p>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <OsceRunner key={open?.id ?? "new"} station={stationView(station)} aiNote={aiNote} pending={open ? { attemptId: open.id, timeUp: open.timeUp } : null} />
        <aside aria-labelledby="osce-history-h" className="space-y-4">
          <section className="rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4">
            <h2 id="osce-history-h" className="text-[14px] font-bold text-gray-900">Your runs of this station</h2>
            <p className="text-[12px] text-gray-600">Practice scores, not marks of competence.</p>
            {!attempts.ok ? <Unreadable what="your practice runs" /> : runs.length === 0 ? <p className="mt-2 text-[13px] text-gray-600">None yet.</p> : (
              <ul className="mt-2 space-y-2">
                {runs.map(r => (
                  <li key={r.id} className="text-[13px] text-gray-800">
                    <span className="font-semibold">{new Date(r.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                    {" · "}{!r.finishedAt ? "not finished" : `${formatClock(r.durationSeconds ?? 0)}${r.timeUp ? " (time up)" : ""}`}
                    {r.ticks && r.score !== null
                      ? <span className="block text-[12.5px] text-gray-600">{scoreSummary({ points: r.score * station.checklist.length, outOf: station.checklist.length, criticalMissed: r.criticalMissed ?? 0 })} · {r.marking ? MARKING_WORDS[r.marking] : ""}</span>
                      : r.finishedAt ? <span className="block text-[12.5px] text-gray-600">Not marked yet</span> : null}
                    {r.ticks && (
                      <details className="mt-1">
                        <summary className={`cursor-pointer text-[12.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Item by item</summary>
                        <ul className="mt-1 space-y-0.5 text-[12.5px]">{station.checklist.map(i => {
                          const m = r.ticks!.find(t => t.itemId === i.id)?.mark;
                          return <li key={i.id}>{m ? OSCE_MARK_LABEL[m] : "Not marked"} · {i.text}{i.critical ? " (critical)" : ""}</li>;
                        })}</ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {remedies.length > 0 && (
            <section aria-labelledby="osce-next-h" className="rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4">
              <h2 id="osce-next-h" className="text-[14px] font-bold text-gray-900">What to revisit</h2>
              <p className="text-[12px] text-gray-600">From your last marked run: the items you missed or partly did, critical ones first.</p>
              <ul className="mt-2 space-y-1">{remedies.map(r => <li key={r.label}><Link href={remedyHref(r)} className={`text-[13.5px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>{r.label}</Link></li>)}</ul>
            </section>
          )}
          <DeleteStation stationId={station.id} />
        </aside>
      </div>
    </>
  );
}
