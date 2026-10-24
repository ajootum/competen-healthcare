import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { countDue, learnerProgramme, listCollections, listLearningSessions, listMappings, listMaterials, listProgrammes, materialExtras, readConsent } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { FORMAT_LABEL, FORMAT_OF, UNIT_OF, uploadRules } from "@/lib/individual/scholar/config";
import { contextHistory, contextStamp } from "@/lib/individual/scholar/context";
import { competencyLabels, loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { qualitySummary } from "@/lib/individual/scholar/extract";
import { ProgrammeChooser } from "./_components/competency-client";
import { CollectionsManager } from "./_components/library-client";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../_components/chrome";
import StudyNav from "./_components/StudyNav";
import { ConsentPanel, EraseAll, ExplainPanel, UploadPanel } from "./_components/client";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// MY LEARNING -- COMPETEN-IND-004, the Scholar learning journey's home: Upload, and the way into
// Understand, Assess, Revise, Apply and Improve.
//
// What it shows is what exists. Migration 372 not applied → a governed "not set up" state, not an empty
// list. Material unreadable → said so, not "none yet". Consent off → upload and reading still work, and
// every AI action says it needs consent instead of failing when pressed. The Privacy Notice and Terms of
// Use unpublished → AI help says it is not available yet, and cannot be turned on (consent-gate.ts).

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My Learning" });
}

const JOURNEY = [
  { step: "Upload", text: "Add your notes, slides or guidance." },
  { step: "Understand", text: "Ask about them. Answers cite your pages." },
  { step: "Assess", text: "Practice questions written from a section." },
  { step: "Revise", text: "Anything you miss comes back on a schedule." },
  { step: "Apply", text: "Case questions built from your material." },
  { step: "Improve", text: "See your practice accuracy and what is due." },
];

export default async function MyLearning({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [materials, consent, due, programmes, mine, policy, history] = await Promise.all([
    listMaterials(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId),
    listProgrammes(ctx.admin), learnerProgramme(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin), contextHistory(ctx.admin, ctx.userId),
  ]);
  // Stage 2: what may be uploaded is Individual policy (formats, size), shown and enforced from one place.
  const rules = uploadRules(policy);
  // Stage 2: each material shows the educational context it was uploaded in (402), never today's by default.
  const programmeLabels = new Map((programmes.ok ? programmes.data : []).map(p => [p.code, p.label]));
  const stampOf = (createdAt: string) => (history.ok ? contextStamp(history.periods, createdAt, programmeLabels) : null);
  // COMPETEN-SCHOLAR-01 S2: the programme choice exists only where 387 does (fail closed).
  const programmeOn = programmes.ok && mine.ok;
  // UPLOAD-01 U4/U5: the library -- each material's read quality (406) and collection (407), the collections, and
  // the competencies the notes are linked to (for asking "notes linked to a competency"). Each absent migration
  // removes only its own feature.
  const list = materials.ok ? materials.data : [];
  const [extras, collections, linked, learner] = await Promise.all([
    materialExtras(ctx.admin, ctx.userId, list.map(m => m.id)), listCollections(ctx.admin, ctx.userId),
    listMappings(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId),
  ]);
  const shelves = extras.collectionsOn && collections.ok ? collections.data : null;
  // LEARN-01 L4: sessions to resume (none where 414 is absent: the section then just offers Learn).
  const sessions = await listLearningSessions(ctx.admin, ctx.userId, 3);
  const liveIds = linked.ok ? [...new Set(linked.data.mappings.filter(r => r.state !== "rejected").map(r => r.competencyId))] : [];
  const names = linked.ok ? await competencyLabels(ctx.admin, learner.competencies, liveIds, new Map(linked.data.mappings.map(r => [r.competencyId, r.layer]))) : new Map();
  const scopes = {
    materials: list.map(m => ({ id: m.id, title: m.title })),
    competencies: liveIds.map(id => ({ id, title: `${names.get(id)?.code ? `${names.get(id)!.code} ` : ""}${names.get(id)?.title ?? "Competency"}` })).sort((a, b) => a.title.localeCompare(b.title)),
  };
  const groups = shelves
    ? [...shelves.map(s => ({ key: s.id, name: s.name, items: list.filter(m => extras.byId.get(m.id)?.collectionId === s.id) })),
      { key: "none", name: shelves.length ? "Not in a collection" : "", items: list.filter(m => !extras.byId.get(m.id)?.collectionId) }].filter(g => g.items.length)
    : [{ key: "none", name: "", items: list }];

  if (!materials.ok && materials.notProvisioned) {
    return (
      <>
        <PageHeader accent={x.accent} eyebrow={x.name} title="My Learning" />
        <StatePanel title="My Learning is not set up on this environment yet">
          <p>The study store it needs has not been installed here, so nothing can be uploaded or read back yet. Nothing on your account has changed.</p>
        </StatePanel>
      </>
    );
  }
  const documents = consentDocuments();
  const status = consent.ok ? consentStatus(consent.data, documents.published) : null;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow={x.name} title="My Learning"
        intro="Upload your own study material, have it explained with page citations, practise questions from it and revise what you miss. Everything here is yours alone." />
      <StudyNav dueCount={due} />

      <ol aria-label="How My Learning works" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {JOURNEY.map((j, i) => (
          <li key={j.step} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[12px] font-bold tabular-nums" style={{ color: x.accent }}>{i + 1}. {j.step}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-gray-600">{j.step === "Upload" ? `Add your notes, slides or guidance: ${rules.describe}.` : j.text}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-2">
        <UploadPanel rules={{ mimes: [...rules.mimes], maxMb: rules.maxMb, text: rules.text, describe: rules.describe, sessionFiles: rules.sessionFiles, sessionMb: rules.sessionMb }} />
        {consent.ok
          ? <ConsentPanel status={status!} recorded={consent.data.granted} grantedAt={consent.data.grantedAt} revokedAt={consent.data.revokedAt} legal={documents.links} />
          : <Unreadable what="AI consent setting" />}
      </div>

      {programmeOn && (
        <div className="mt-5"><ProgrammeChooser programmes={programmes.data} current={mine.data?.code ?? null} /></div>
      )}
      {!programmeOn && ((!programmes.ok && !programmes.notProvisioned) || (!mine.ok && !mine.notProvisioned)) && (
        <div className="mt-5"><Unreadable what="your programme" /></div>
      )}

      {materials.ok && materials.data.length > 0 && (
        <section aria-labelledby="learn-h" className="mt-8 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="learn-h" className="text-[16px] font-bold text-gray-900">Learn</h2>
            <Link href={experienceHref("scholar", "study/learn")} className={`text-[13.5px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Teach me something →</Link>
          </div>
          {sessions.ok && sessions.data.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {sessions.data.map(s => (
                <li key={s.id} className="text-[13.5px] text-gray-800">
                  <Link href={experienceHref("scholar", `study/learn?session=${s.id}`)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Continue: {s.title}</Link>
                  <span className="text-gray-500"> · {s.status === "completed" ? "completed" : `step ${s.currentStep + 1}`}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-[13.5px] text-gray-600">Scholar teaches you from your notes, step by step, and you can ask anything as you go.</p>}
        </section>
      )}

      <section aria-labelledby="materials-h" className="mt-8">
        <h2 id="materials-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your library</h2>
        {!materials.ok ? <div className="mt-3"><Unreadable what="study materials" /></div>
          : materials.data.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">
              None yet. Upload {rules.describe} above to start.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {groups.map(g => (
                <div key={g.key}>
                  {g.name && <h3 className="mb-1.5 text-[14px] font-bold text-gray-900">{g.name}</h3>}
                  <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
                    {g.items.map(m => {
                      const unit = UNIT_OF(m.mimeType);
                      const q = extras.qualityOn ? extras.byId.get(m.id)?.quality ?? null : null;
                      const partial = q ? qualitySummary(q).partial : false;
                      return (
                        <li key={m.id}>
                          <Link href={experienceHref("scholar", `study/${m.id}`)} className={`flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-gray-50 sm:p-5 ${focusRing}`}>
                            <span className="min-w-0">
                              <span className="block truncate text-[15px] font-semibold text-gray-900">{m.title}</span>
                              <span className="block text-[12.5px] text-gray-500">
                                {FORMAT_LABEL[FORMAT_OF[m.mimeType]]}{m.pageCount !== null ? ` · ${m.pageCount} ${unit}${m.pageCount === 1 ? "" : "s"}` : ""} · {m.chunkCount} section{m.chunkCount === 1 ? "" : "s"} · added {new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                {stampOf(m.createdAt) ? ` · while studying ${stampOf(m.createdAt)}` : ""}
                              </span>
                              {partial && <span className="mt-1 inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-900">Partly read: {q!.emptyUnits.length} {unit}{q!.emptyUnits.length === 1 ? "" : "s"} without readable text</span>}
                            </span>
                            <span className="text-[13px] font-semibold" style={{ color: x.accent }}>Open →</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        {shelves && materials.ok && materials.data.length > 0 && (
          <div className="mt-4"><CollectionsManager collections={shelves.map(s => ({ id: s.id, name: s.name }))} /></div>
        )}
      </section>

      {materials.ok && materials.data.length > 0 && (
        <div className="mt-8">
          <ExplainPanel consent={status === "on"} offMessage={status ? aiOffMessage(status) ?? undefined : undefined} title="Ask across your library" scopes={scopes}
            hint="Searches your materials and answers only from what it finds, naming each material it used and citing the page, slide or section. Explanations are not saved." />
        </div>
      )}

      {materials.ok && (
        <div className="mt-8"><EraseAll count={materials.data.length} /></div>
      )}
    </>
  );
}
