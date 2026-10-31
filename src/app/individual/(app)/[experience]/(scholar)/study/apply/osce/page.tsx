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
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadOsceLibraryStations } from "@/lib/individual/scholar/library-questions";
import { osceAvailability } from "@/lib/individual/scholar/osce-service";
import {
  OSCE_DIFFICULTY_LABEL, OSCE_OFF, OSCE_PRACTICE_LABEL, OSCE_SOURCE_LABEL, OSCE_TEMPLATES, OSCE_UNAVAILABLE, filterStations, parseOsceFilter, scoreSummary, stationFacets,
} from "@/lib/individual/scholar/osce";
import { OsceCreate } from "../../_components/osce-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// OSCE PRACTICE -- SCHOLAR-PRACTICE-EXAMS-01 (720), SCHOLAR-OSCE-01 (721), under Apply. The learner's own practice
// stations (filtered and browsed by topic or body system, competency, programme, difficulty and source, by a plain GET
// form that works without script), and a way to make one: the Competen station library (published and clinically
// approved stations only), the practice template (not clinically reviewed), a competency's outcomes (its content status
// shown), or written by AI from their notes. Simulated practice only -- never an observed clinical skills assessment.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "OSCE practice" });
}

const field = `rounded-lg border border-gray-300 px-2.5 py-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export default async function OscePractice({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const filter = parseOsceFilter(await searchParams);
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

  const [stations, attempts, materials, learner, consent, library, policy] = await Promise.all([
    listOsceStations(ctx.admin, ctx.userId), listOsceAttempts(ctx.admin, ctx.userId, null, 200), listMaterials(ctx.admin, ctx.userId),
    loadLearnerCatalogue(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId), loadOsceLibraryStations(ctx.admin), loadIndividualPolicy(ctx.admin),
  ]);
  const consentOn = consent.ok && consentStatus(consent.data, consentDocuments().published) === "on";
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  const aiNote = !consentOn ? "AI help is off, so stations are not written from your notes. The library, template and competency stations need no AI."
    : !standing.available ? `${standing.message ?? "New AI help is limited right now."} The library, template and competency stations need no AI.` : null;
  // The competency's content status as recorded (never assumed approved because the competency exists).
  const competencies = (learner.competencies ?? []).filter(c => c.outcomes.length >= 2)
    .map(c => ({ id: c.id, title: `${c.code ? `${c.code} ` : ""}${c.title}`, status: CONTENT_STATUS_LABEL[c.contentStatus] ?? CONTENT_STATUS_LABEL.unreviewed }));
  const competencyName = new Map((learner.competencies ?? []).map(c => [c.id, `${c.code ? `${c.code} ` : ""}${c.title}`]));
  const competencyNote = learner.competencies === null ? "Your competency catalogue could not be read just now."
    : !learner.programme ? "Choose your programme in My Learning to build stations from its competencies."
      : competencies.length === 0 ? "No competency in your catalogue records enough learning outcomes to build a station." : null;
  const runs = attempts.ok ? attempts.data : [];
  const all = stations.ok ? stations.data : [];
  const shown = filterStations(all, filter);
  const facets = stationFacets(all);
  const filtered = !!(filter.q || filter.competency || filter.programme || filter.difficulty || filter.source);
  const libraryChoices = library.map(l => ({
    versionId: l.versionId, title: l.title,
    detail: [l.content.definition.topic, l.content.definition.profession, l.content.definition.difficulty ? OSCE_DIFFICULTY_LABEL[l.content.definition.difficulty] : null, `version ${l.versionNo}`].filter(Boolean).join(" · "),
  }));

  return (
    <>
      {head}
      <div className="grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <OsceCreate library={libraryChoices} templates={OSCE_TEMPLATES.map(t => ({ key: t.key, title: t.title }))} competencies={competencies} competencyNote={competencyNote}
          materials={(materials.ok ? materials.data : []).filter(m => m.chunkCount > 0).map(m => ({ id: m.id, title: m.title }))} aiNote={aiNote}
          recoveryMode={policy.scholarRecovery.defaultMode} />
        <section aria-labelledby="osce-list-h" className="rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4 md:p-5">
          <h2 id="osce-list-h" className="text-[16px] font-bold text-gray-900">Your stations</h2>
          {all.length > 0 && (
            <form method="get" role="search" aria-label="Filter your stations" className="mt-2 grid gap-2 md:grid-cols-2">
              <label className="text-[12.5px] font-semibold text-gray-700">Topic or body system
                <input name="q" defaultValue={filter.q ?? ""} list="osce-topics" className={`mt-0.5 block w-full ${field}`} />
                <datalist id="osce-topics">{facets.topics.map(t => <option key={t} value={t} />)}</datalist>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-700">Competency
                <select name="competency" defaultValue={filter.competency ?? ""} className={`mt-0.5 block w-full ${field}`}>
                  <option value="">Any</option>{facets.competencies.map(c => <option key={c} value={c}>{competencyName.get(c) ?? "A competency no longer in your catalogue"}</option>)}
                </select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-700">Programme
                <select name="programme" defaultValue={filter.programme ?? ""} className={`mt-0.5 block w-full ${field}`}>
                  <option value="">Any</option>{facets.programmes.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-700">Difficulty
                <select name="difficulty" defaultValue={filter.difficulty ?? ""} className={`mt-0.5 block w-full ${field}`}>
                  <option value="">Any</option>{facets.difficulties.map(d => <option key={d} value={d}>{OSCE_DIFFICULTY_LABEL[d]}</option>)}
                </select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-700">Station type
                <select name="source" defaultValue={filter.source ?? ""} className={`mt-0.5 block w-full ${field}`}>
                  <option value="">Any</option>{facets.sources.map(s => <option key={s} value={s}>{OSCE_SOURCE_LABEL[s]}</option>)}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-[14px] font-semibold text-white ${focusRing}`} style={{ background: x.accent }}>Filter</button>
                {filtered && <Link href={experienceHref("scholar", "study/apply/osce")} className={`text-[13px] font-semibold underline underline-offset-2 ${focusRing}`}>Clear</Link>}
              </div>
            </form>
          )}
          {!stations.ok ? <Unreadable what="your practice stations" /> : all.length === 0 ? <p className="mt-2 text-[14px] text-gray-600">None yet. Make one to start practising.</p>
            : shown.length === 0 ? <p role="status" className="mt-3 text-[14px] text-gray-600">No station matches these filters.</p> : (
            <ul className="mt-2 divide-y divide-gray-200">
              {filtered && <li className="py-1 text-[12.5px] text-gray-600" role="status">{shown.length} of {all.length} stations</li>}
              {shown.map(s => {
                const mine = runs.filter(r => r.stationId === s.id);
                const last = mine.find(r => r.score !== null);
                const open = mine.some(r => r.status === "in_progress" && !r.finishedAt);
                return (
                  <li key={s.id} className="py-3">
                    <Link href={experienceHref("scholar", `study/apply/osce/${s.id}`)} className={`text-[15px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>{s.title}</Link>
                    <p className="text-[12.5px] text-gray-600">{[s.topic, s.bodySystem, s.difficulty ? OSCE_DIFFICULTY_LABEL[s.difficulty] : null, s.programmeLabel].filter(Boolean).join(" · ") || "Topic not recorded"}</p>
                    <p className="text-[12.5px] text-gray-600">{OSCE_SOURCE_LABEL[s.source]} · {s.contentStatus} · {s.durationMinutes} min · {s.checklist.length} items · version {s.version}</p>
                    <p className="text-[12.5px] text-gray-600">{open ? "A run is in progress: open it to carry on" : mine.length ? `${mine.length} run${mine.length === 1 ? "" : "s"}` : "Not practised yet"}{last ? ` · last: ${scoreSummary({ points: (last.score ?? 0) * s.checklist.length, outOf: s.checklist.length, criticalMissed: last.criticalMissed ?? 0 })}` : ""}</p>
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
