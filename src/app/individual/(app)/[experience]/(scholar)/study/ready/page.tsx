import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { AI_LABEL, FORMAT_LABEL, FORMAT_OF, MAPPING_LABEL, UNIT_OF } from "@/lib/individual/scholar/config";
import { analysisStatus, getMaterial, isUuid, libraryTopics, listCollections, listMappings, listMaterials, listProgrammes, materialExtras, readConsent } from "@/lib/individual/scholar/store";
import { competencyAbsence, competencyLabels, loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { qualitySummary } from "@/lib/individual/scholar/extract";
import { topicsState } from "@/lib/individual/scholar/classify-view";
import { materialTopics, relatedMaterials } from "@/lib/individual/scholar/library";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { PageHeader, StatePanel, Unreadable, focusRing, primaryBtn, secondaryBtn } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { AiBadge, ContentStatusTag, ExplainPanel } from "../_components/client";
import { AnalysePanel, LayerTag } from "../_components/competency-client";
import { OrganiseMaterial } from "../_components/library-client";
import { countDue } from "@/lib/individual/scholar/store";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// "YOUR NOTES ARE READY" -- COMPETEN-SCHOLAR-UPLOAD-01 U5.
//
// Where every upload ends: the materials just added, each with how completely it was read, the topics Scholar
// found, the competencies those topics relate to (with their clinical-status labels), what Scholar could NOT do
// and why, the other materials it relates to -- and the next step: Start Learning (the existing material page,
// unchanged: the Stage 3 hold stands), Practise Questions, Explore Competencies, View Original Notes. Rename and
// shelve each one here. Every material is read by the caller's own id: another person's id simply is not shown.
//
// ⚠ NOTHING IS PRESENTED AS MORE THAN IT IS. A partial read says which pages or slides held no text. Topics and
// competency links are AI suggestions from the notes, labelled unreviewed. No link is not "no competency": the
// reason is given (no programme, a programme with no usable catalogue, AI help off, not analysed yet).

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Your notes are ready" });
}

const MAX_SHOWN = 10;

export default async function ReadyPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ ids?: string; study?: string | string[] }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const sp = await searchParams;
  // SCHOLAR-SESSION-AI-02: with a valid ?study= the session bar is shown (database reads only; not a stage, so last_space is untouched).
  const study = await loadStudy(ctx.admin, ctx.userId, sp.study, null);
  const ids = [...new Set((sp.ids ?? "").split(",").filter(isUuid))].slice(0, MAX_SHOWN);

  const [found, consent, due, learner, collections, library, all] = await Promise.all([
    Promise.all(ids.map(id => getMaterial(ctx.admin, ctx.userId, id))),
    readConsent(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId),
    listCollections(ctx.admin, ctx.userId), libraryTopics(ctx.admin, ctx.userId), listMaterials(ctx.admin, ctx.userId),
  ]);
  const materials = found.flatMap(r => (r.ok && r.data ? [r.data] : []));
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  const consentOn = status === "on";

  if (!materials.length) {
    return (
      <>
        <PageHeader accent={x.accent} eyebrow="My Learning" title="Your notes are ready" />
        <StudyNav dueCount={due} study={study?.bar ?? null} />
        <StatePanel title={found.some(r => !r.ok) ? "Your materials could not be read just now" : "There is nothing to show here"}
          actions={<Link href={experienceHref("scholar", "study")} className={secondaryBtn}>Go to My Learning</Link>}>
          <p>{found.some(r => !r.ok) ? "This is not the same as them being gone. Try again shortly." : "Upload your notes in My Learning, and this page shows what Scholar found in them."}</p>
        </StatePanel>
      </>
    );
  }

  const extras = await materialExtras(ctx.admin, ctx.userId, materials.map(m => m.id));
  // P6: with no programme offered at all (production today) the student is not told to choose one.
  const offered = !learner.programme ? await listProgrammes(ctx.admin) : null;
  const absence = competencyAbsence(learner, offered ? (offered.ok ? offered.data.length : null) : null);
  const titleOf = new Map((all.ok ? all.data : []).map(m => [m.id, m.title]));
  const topicsOf = (id: string) => materialTopics(library?.get(id) ?? []);
  const others = [...(library?.keys() ?? [])].map(id => ({ materialId: id, title: titleOf.get(id) ?? "Your material", topics: topicsOf(id).map(t => t.topic) }));

  const cards = await Promise.all(materials.map(async m => {
    const [analysis, mapped] = await Promise.all([analysisStatus(ctx.admin, ctx.userId, m.id), listMappings(ctx.admin, ctx.userId, m.id)]);
    const live = mapped.ok ? mapped.data.mappings.filter(r => r.state !== "rejected") : [];
    const labels = mapped.ok ? await competencyLabels(ctx.admin, learner.competencies, live.map(r => r.competencyId), new Map(live.map(r => [r.competencyId, r.layer]))) : new Map();
    // One line per competency: its best state, how many sections, and an outcome where one was named.
    const byCompetency = new Map<string, { id: string; sections: number; accepted: boolean; outcome: string | null; layer: string }>();
    for (const r of live) {
      const c = byCompetency.get(r.competencyId) ?? { id: r.competencyId, sections: 0, accepted: false, outcome: null, layer: r.layer };
      c.sections++; c.accepted ||= r.state === "accepted"; c.outcome ??= r.outcome;
      byCompetency.set(r.competencyId, c);
    }
    const competencies = [...byCompetency.values()].sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.sections - a.sections).slice(0, 8);
    const topics = topicsOf(m.id);
    return { m, analysis, mapped, competencies, labels, topics, related: relatedMaterials({ materialId: m.id, topics: topics.map(t => t.topic) }, others) };
  }));

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Learning" title="Your notes are ready"
        intro={materials.length === 1 ? "Scholar has read your material. Here is what it found, what it could not do, and where to go next." : `Scholar has read ${materials.length} materials. Here is what it found in each, what it could not do, and where to go next.`} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />

      <div className="space-y-6">
        {cards.map(({ m, analysis, mapped, competencies, labels, topics, related }) => {
          const unit = UNIT_OF(m.mimeType);
          const q = extras.qualityOn ? qualitySummary(extras.byId.get(m.id)?.quality ?? null) : null;
          const analysed = analysis.ok && analysis.data.analysed >= analysis.data.sections;
          // SCHOLAR-UPLOAD-FIX: "none" only once every section was looked at; while finding, how far it has got.
          const topicsLine = topicsState({ consent: consentOn, analysed: analysis.ok ? analysis.data.analysed : null, sections: analysis.ok ? analysis.data.sections : null, topics: topics.length });
          const limits = [
            q?.partial ? q.text : null,
            !consentOn ? `Topics and competencies need AI help, which is off. ${status ? aiOffMessage(status) ?? "" : ""}`.trim() : null,
            consentOn && !analysed ? "Topic finding has not finished for every section yet. It continues below." : null,
            absence,
            competencies.length || topics.length ? `${AI_LABEL}. Accept the links that fit and reject the rest.` : null,
            "Answers come only from your notes. Anything beyond them is shown apart, under its own label, or not at all.",
          ].filter((s): s is string => !!s);
          return (
            <article key={m.id} aria-labelledby={`ready-${m.id}`} className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
              <h2 id={`ready-${m.id}`} className="text-[18px] font-bold text-gray-900">{m.title}</h2>
              <p className="mt-0.5 text-[13px] text-gray-600">
                {FORMAT_LABEL[FORMAT_OF[m.mimeType]]}{m.pageCount !== null ? ` · ${m.pageCount} ${unit}${m.pageCount === 1 ? "" : "s"}` : ""} · {m.chunkCount} section{m.chunkCount === 1 ? "" : "s"} · {m.fileName}
              </p>
              <p className={`mt-2 rounded-lg px-3 py-2 text-[13.5px] ${q?.partial ? "border border-amber-300 bg-amber-50 text-amber-950" : "bg-gray-50 text-gray-800"}`}>
                <span className="font-semibold">{q === null ? "Reading: " : q.partial ? "Partly read. " : "Read. "}</span>
                {q === null ? "How completely this file was read is not recorded here." : q.partial ? q.text.replace(/^Partly read: /, "") : q.text}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {/* LEARN-01 (owner GO 2026-10-24): Start learning opens Teach Me directly, in the Learn workspace. */}
                <Link href={experienceHref("scholar", `study/learn?material=${m.id}`)} className={primaryBtn} style={{ background: x.accent }}>Start learning</Link>
                <Link href={experienceHref("scholar", `study/${m.id}`)} className={secondaryBtn}>Open the material</Link>
                <Link href={`${experienceHref("scholar", `study/${m.id}`)}#sections-h`} className={secondaryBtn}>Practise questions</Link>
                <Link href={experienceHref("scholar", "study/progress")} className={secondaryBtn}>Explore competencies</Link>
                <a href={`/api/individual/scholar/materials/${m.id}`} className={secondaryBtn}>View original notes</a>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <section aria-labelledby={`topics-${m.id}`}>
                  <h3 id={`topics-${m.id}`} className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Topics</h3>
                  {topics.length ? (
                    <>
                      <div className="mt-1.5"><AiBadge /></div>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {topics.map(t => <li key={t.topic} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[12.5px] text-gray-800">{t.topic}{t.sections > 1 ? <span className="text-gray-500"> · {t.sections} sections</span> : null}</li>)}
                      </ul>
                      {topicsLine.text && <p className="mt-2 text-[12.5px] text-gray-600" aria-live="polite">{topicsLine.text}</p>}
                      <p className="mt-2 text-[12.5px] text-gray-600">Wrong? <Link href={`${experienceHref("scholar", `study/${m.id}`)}#sections-h`} className={`font-semibold underline ${focusRing}`}>Correct a section&apos;s topics</Link>.</p>
                    </>
                  ) : <p className="mt-1.5 text-[13.5px] text-gray-700" aria-live="polite">{topicsLine.kind === "off" ? "Not found: AI help is off." : topicsLine.text}</p>}
                </section>

                <section aria-labelledby={`comp-${m.id}`}>
                  <h3 id={`comp-${m.id}`} className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Competencies</h3>
                  {!mapped.ok ? <div className="mt-1.5"><Unreadable what="competency links" /></div>
                    : competencies.length ? (
                      <>
                        <p className="mt-1 text-[12px] text-gray-600">{MAPPING_LABEL}</p>
                        <ul className="mt-2 space-y-1.5">
                          {competencies.map(c => {
                            const l = labels.get(c.id);
                            return (
                              <li key={c.id} className="rounded-lg border border-gray-200 p-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <LayerTag layer={c.layer} />
                                  <span className="text-[13.5px] font-semibold text-gray-900">{l?.code ? `${l.code} ` : ""}{l?.title ?? "Competency"}</span>
                                  <ContentStatusTag status={l?.contentStatus ?? null} />
                                </div>
                                <p className="mt-0.5 text-[12px] text-gray-600">
                                  {l?.structure ? `${l.structure} · ` : ""}{c.accepted ? "accepted by you" : "suggested"} · {c.sections} section{c.sections === 1 ? "" : "s"}
                                </p>
                                {c.outcome && <p className="mt-0.5 text-[12.5px] text-gray-700">Learning outcome: {c.outcome}</p>}
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    ) : <p className="mt-1.5 text-[13.5px] text-gray-700">{absence ?? (consentOn ? (analysed ? "Scholar found no competency these notes clearly support." : "Not linked yet: topic finding is still running.") : "Not linked: AI help is off.")}</p>}
                </section>
              </div>

              {consentOn && analysis.ok && !analysed && (
                <div className="mt-5">
                  <AnalysePanel materialId={m.id} consent={consentOn} sections={analysis.data.sections} analysed={analysis.data.analysed}
                    programmeLabel={absence ? null : learner.programme?.label ?? null} absence={absence} />
                </div>
              )}

              {related.length > 0 && (
                <section aria-labelledby={`rel-${m.id}`} className="mt-5">
                  <h3 id={`rel-${m.id}`} className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Related in your library</h3>
                  <ul className="mt-1.5 space-y-1">
                    {related.map(r => (
                      <li key={r.materialId} className="text-[13.5px] text-gray-800">
                        <Link href={experienceHref("scholar", `study/${r.materialId}`)} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>{r.title}</Link>
                        <span className="text-gray-600"> · shares {r.shared.slice(0, 4).join(", ")}{r.shared.length > 4 ? ` and ${r.shared.length - 4} more` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section aria-labelledby={`lim-${m.id}`} className="mt-5">
                <h3 id={`lim-${m.id}`} className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">What to know</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-gray-700">
                  {limits.map(t => <li key={t}>{t}</li>)}
                </ul>
              </section>

              <div className="mt-5 border-t border-gray-100 pt-4">
                <OrganiseMaterial id={m.id} title={m.title} collectionId={extras.byId.get(m.id)?.collectionId ?? null}
                  collections={extras.collectionsOn && collections.ok ? collections.data.map(c => ({ id: c.id, name: c.name })) : null} />
              </div>
            </article>
          );
        })}
      </div>

      {materials.length > 1 && (
        <p className="mt-6">
          <Link href={experienceHref("scholar", `study/learn?materials=${materials.map(m => m.id).join(",")}`)} className={primaryBtn} style={{ background: x.accent }}>
            Start learning from all {materials.length}
          </Link>
        </p>
      )}
      {materials.length > 1 && (
        <div className="mt-8">
          <ExplainPanel materialIds={materials.map(m => m.id)} consent={consentOn} offMessage={status ? aiOffMessage(status) ?? undefined : undefined}
            title="Ask across these materials" hint="Answers only from the materials on this page, citing each one by name and page, slide or section. Explanations are not saved." />
        </div>
      )}
    </>
  );
}
