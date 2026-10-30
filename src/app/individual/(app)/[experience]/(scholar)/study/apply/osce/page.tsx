import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { countDue, listMaterials, listOsceAttempts, listOsceStations, readConsent } from "@/lib/individual/scholar/store";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { CONTENT_STATUS_LABEL } from "@/lib/individual/scholar/config";
import { consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { osceAvailability } from "@/lib/individual/scholar/osce-service";
import { OSCE_OFF, OSCE_PRACTICE_LABEL, OSCE_SOURCE_LABEL, OSCE_TEMPLATES, OSCE_UNAVAILABLE, scoreSummary } from "@/lib/individual/scholar/osce";
import { OsceCreate } from "../../_components/osce-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// OSCE PRACTICE -- SCHOLAR-PRACTICE-EXAMS-01 (720), under Apply. The learner's own practice stations, and a way to make
// one: the practice template, a competency's outcomes, or written by AI from their notes. Simulated practice only --
// never an observed clinical skills assessment and never verified competence. Where policy turns it off, or 720 is not
// installed here, the page says so plainly and nothing else changes.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "OSCE practice" });
}

export default async function OscePractice({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [due, availability] = await Promise.all([countDue(ctx.admin, ctx.userId), osceAvailability(ctx.admin, ctx.userId)]);
  const head = (
    <>
      <p className="mb-2 text-[13px]"><Link href={experienceHref("scholar", "study/apply")} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>← Apply</Link></p>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("apply").eyebrow} title="OSCE practice" intro="Timed practice stations you do on your own, then check against the station checklist." />
      <StudyNav dueCount={due} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} detail={OSCE_PRACTICE_LABEL} />
    </>
  );
  if (availability.state !== "on") {
    return <>{head}<StatePanel title="OSCE practice is not available"><p>{availability.state === "off" ? OSCE_OFF : OSCE_UNAVAILABLE}</p></StatePanel></>;
  }

  const [stations, attempts, materials, learner, consent] = await Promise.all([
    listOsceStations(ctx.admin, ctx.userId), listOsceAttempts(ctx.admin, ctx.userId, null, 200), listMaterials(ctx.admin, ctx.userId),
    loadLearnerCatalogue(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId),
  ]);
  const consentOn = consent.ok && consentStatus(consent.data, consentDocuments().published) === "on";
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  const aiNote = !consentOn ? "AI help is off, so stations are not written from your notes. The template and competency stations need no AI."
    : !standing.available ? `${standing.message ?? "New AI help is limited right now."} The template and competency stations need no AI.` : null;
  const competencies = (learner.competencies ?? []).filter(c => c.outcomes.length >= 2)
    .map(c => ({ id: c.id, title: `${c.code ? `${c.code} ` : ""}${c.title}`, status: CONTENT_STATUS_LABEL[c.contentStatus] ?? CONTENT_STATUS_LABEL.unreviewed }));
  const competencyNote = learner.competencies === null ? "Your competency catalogue could not be read just now."
    : !learner.programme ? "Choose your programme in My Learning to build stations from its competencies."
      : competencies.length === 0 ? "No competency in your catalogue records enough learning outcomes to build a station." : null;
  const runs = attempts.ok ? attempts.data : [];

  return (
    <>
      {head}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <OsceCreate templates={OSCE_TEMPLATES.map(t => ({ key: t.key, title: t.title }))} competencies={competencies} competencyNote={competencyNote}
          materials={(materials.ok ? materials.data : []).filter(m => m.chunkCount > 0).map(m => ({ id: m.id, title: m.title }))} aiNote={aiNote} />
        <section aria-labelledby="osce-list-h" className="rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4 sm:p-5">
          <h2 id="osce-list-h" className="text-[16px] font-bold text-gray-900">Your stations</h2>
          {!stations.ok ? <Unreadable what="your practice stations" /> : stations.data.length === 0 ? <p className="mt-2 text-[14px] text-gray-600">None yet. Make one to start practising.</p> : (
            <ul className="mt-2 divide-y divide-gray-200">
              {stations.data.map(s => {
                const mine = runs.filter(r => r.stationId === s.id);
                const last = mine.find(r => r.score !== null);
                return (
                  <li key={s.id} className="py-3">
                    <Link href={experienceHref("scholar", `study/apply/osce/${s.id}`)} className={`text-[15px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>{s.title}</Link>
                    <p className="text-[12.5px] text-gray-600">{OSCE_SOURCE_LABEL[s.source]} · {s.contentStatus} · {s.durationMinutes} min · {s.checklist.length} items</p>
                    <p className="text-[12.5px] text-gray-600">{mine.length ? `${mine.length} run${mine.length === 1 ? "" : "s"}` : "Not practised yet"}{last ? ` · last: ${scoreSummary({ points: (last.score ?? 0) * s.checklist.length, outOf: s.checklist.length, criticalMissed: last.criticalMissed ?? 0 })}` : ""}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
