import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { countDue, learnerProgramme, listCollections, listMappings, listMaterials, listProgrammes, materialExtras } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { uploadRules } from "@/lib/individual/scholar/config";
import { contextHistory, contextStamp } from "@/lib/individual/scholar/context";
import { competencyLabels, loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { scholarSpace } from "@/lib/individual/scholar/spaces";
import { ProgrammeChooser } from "./_components/competency-client";
import { CollectionsManager } from "./_components/library-client";
import { Notice, PageHeader, StatePanel, Unreadable, focusRing } from "../../../../_components/chrome";
import { DialogButton } from "../../../../_components/Dialog";
import StudyNav from "./_components/StudyNav";
import { EraseAll, ExplainPanel, UploadPanel } from "./_components/client";
import { aiOffMessage } from "@/lib/individual/scholar/consent-gate";
import { AiHelpBody, headerBtn, linkBtn, readAiHelp } from "./_components/shell-pieces";
import { LibraryBrowser, type LibraryGroup } from "./_components/library-list";
import { libraryRow } from "./_components/library-rows";
import { listExamPapers } from "@/lib/individual/scholar/exam-store";
import { EXAM_ATTESTATION, LIVE_EXAM_NOTICE } from "@/lib/individual/scholar/exam-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// MY LEARNING · LIBRARY -- COMPETEN-IND-004, the Scholar learning journey's home: Upload, Classify, and the way
// into Learn, Revise, Apply, Evaluate and Progress (Scholar HFE redesign, 2026-10-26).
//
// What it shows is what exists. Migration 372 not applied → a governed "not set up" state, not an empty
// list. Material unreadable → said so, not "none yet". Consent off → upload and reading still work, and
// every AI action says it needs consent instead of failing when pressed. The Privacy Notice and Terms of
// Use unpublished → AI help says it is not available yet, and cannot be turned on (consent-gate.ts).
//
// The upload form and the consent panel sit in dialogs, always in the page: a link to #upload opens the form.

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My Learning" });
}

const card = "rounded-2xl border border-gray-200 bg-white p-6";

export default async function MyLearning({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const space = scholarSpace("library");
  const [materials, help, due, programmes, mine, policy, history] = await Promise.all([
    listMaterials(ctx.admin, ctx.userId), readAiHelp(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId),
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
  const [extras, collections, linked, learner, papers] = await Promise.all([
    materialExtras(ctx.admin, ctx.userId, list.map(m => m.id)), listCollections(ctx.admin, ctx.userId),
    listMappings(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId), listExamPapers(ctx.admin, ctx.userId),
  ]);
  // COMPETEN-SCHOLAR-EXAM-PAPERS-01: a material studied as a paper says so (nothing where 570 is absent).
  const paperIds = new Set(papers.ok ? papers.data.map(p => p.materialId) : []);
  const shelves = extras.collectionsOn && collections.ok ? collections.data : null;
  const liveIds = linked.ok ? [...new Set(linked.data.mappings.filter(r => r.state !== "rejected").map(r => r.competencyId))] : [];
  const names = linked.ok ? await competencyLabels(ctx.admin, learner.competencies, liveIds, new Map(linked.data.mappings.map(r => [r.competencyId, r.layer]))) : new Map();
  const scopes = {
    materials: list.map(m => ({ id: m.id, title: m.title })),
    competencies: liveIds.map(id => ({ id, title: `${names.get(id)?.code ? `${names.get(id)!.code} ` : ""}${names.get(id)?.title ?? "Competency"}` })).sort((a, b) => a.title.localeCompare(b.title)),
  };
  const rowOf = (m: (typeof list)[number]) => libraryRow(m, { quality: extras.qualityOn ? extras.byId.get(m.id)?.quality ?? null : null, stamp: stampOf(m.createdAt), paper: paperIds.has(m.id) });
  const groups: LibraryGroup[] = shelves
    ? [...shelves.map(s => ({ key: s.id, name: s.name, rows: list.filter(m => extras.byId.get(m.id)?.collectionId === s.id).map(rowOf) })),
      { key: "none", name: shelves.length ? "Not in a collection" : "", rows: list.filter(m => !extras.byId.get(m.id)?.collectionId).map(rowOf) }].filter(g => g.rows.length)
    : [{ key: "none", name: "", rows: list.map(rowOf) }];
  // Stage 3 Classify: suggested competency links waiting for the learner's decision, per material (388).
  const waiting = new Map<string, number>();
  if (linked.ok) for (const r of linked.data.mappings) if (r.state === "proposed") waiting.set(r.materialId, (waiting.get(r.materialId) ?? 0) + 1);
  const waitingTotal = [...waiting.values()].reduce((n, v) => n + v, 0);

  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow={space.eyebrow} title={space.title} intro={space.intro} />
      <StudyNav dueCount={due} />
    </>
  );

  if (!materials.ok && materials.notProvisioned) {
    return (
      <>
        {header}
        <StatePanel title="My Learning is not set up here yet">
          <p>The study store it needs has not been installed here, so nothing can be uploaded or read back yet. Nothing on your account has changed.</p>
        </StatePanel>
      </>
    );
  }
  const status = help.status;

  const upload = (
    <DialogButton title="Upload study material" hash="upload" label="+ Upload material"
      className={`${headerBtn} border-transparent text-white hover:opacity-90`} style={{ background: x.accent }}>
      <UploadPanel rules={{ mimes: [...rules.mimes], maxMb: rules.maxMb, text: rules.text, describe: rules.describe, sessionFiles: rules.sessionFiles, sessionMb: rules.sessionMb,
        exam: policy.scholarExams.enabled && papers.ok ? { attestation: EXAM_ATTESTATION.text, liveNotice: LIVE_EXAM_NOTICE } : null }} />
    </DialogButton>
  );
  const suggestions = (
    <DialogButton title="Suggested links" className={headerBtn} label={`Mapping suggestions · ${linked.ok ? waitingTotal : "–"}`}>
      <h2 className="text-[21px] font-bold tracking-tight text-gray-900">Classify · Suggested links</h2>
      <p className="mt-1.5 text-[15px] text-gray-600">
        Concepts and competency links Scholar has suggested from your material. Each is a suggestion until you accept or reject it, and your decision is kept. It does not certify competency.
      </p>
      {!linked.ok ? (linked.notProvisioned
        ? <p className="mt-3 text-[14px] text-gray-700">Suggested links are not set up here yet.</p>
        : <div className="mt-3"><Unreadable what="suggested links" /></div>)
        : waitingTotal === 0 ? (
          <p className="mt-3 text-[14px] text-gray-700">Nothing is waiting for your review. Suggestions appear when you analyse a material, with AI help on.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-200">
            {list.filter(m => waiting.has(m.id)).map(m => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-gray-900">{m.title}</span>
                  <span className="text-[12.5px] text-gray-600">{waiting.get(m.id)} suggested link{waiting.get(m.id) === 1 ? "" : "s"} to review</span>
                </span>
                <Link href={experienceHref("scholar", `study/${m.id}`)} className={linkBtn} style={{ color: x.accent }}>Review →</Link>
              </li>
            ))}
          </ul>
        )}
    </DialogButton>
  );
  const empty = (
    <section className={`${card} mb-5 text-center`}>
      <h2 className="text-[21px] font-bold tracking-tight text-gray-900">Start with your material</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[15px] text-gray-600">Upload {rules.describe}, then choose how you want to study. No programme or competency is needed first.</p>
    </section>
  );

  return (
    <>
      {header}

      {!materials.ok ? <div className="mb-5"><Unreadable what="study materials" /></div> : (
        <LibraryBrowser groups={groups} actions={<>{suggestions}{upload}</>} empty={empty} />
      )}
      {!materials.ok && <div className="mb-5 flex flex-wrap gap-2.5">{upload}</div>}

      <Notice>Scholar can suggest concepts and competency links from your material when you analyse it with AI help on. Review them when useful; you can study without a programme.</Notice>

      <div className="grid gap-[22px] lg:grid-cols-[1.7fr_1fr]">
        {programmeOn ? <ProgrammeChooser programmes={programmes.data} current={mine.data?.code ?? null} /> : (
          <section aria-labelledby="programme-h" className={card}>
            <h2 id="programme-h" className="text-[16px] font-bold text-gray-900">Your programme</h2>
            {(!programmes.ok && !programmes.notProvisioned) || (!mine.ok && !mine.notProvisioned)
              ? <div className="mt-2"><Unreadable what="your programme" /></div>
              : <p className="mt-1.5 text-[15px] text-gray-600">Choosing a programme is not available here. Your notes can still be studied without one.</p>}
          </section>
        )}
        <section aria-labelledby="ai-choice-h" className={card}>
          <h2 id="ai-choice-h" className="text-[16px] font-bold text-gray-900">AI is your choice</h2>
          <p className="mt-1.5 text-[15px] text-gray-600">
            {status === "on" ? "AI help is on: explanations, questions and cases can be made from your material."
              : status === "awaiting_legal" ? "AI help is not available yet. You can upload and read your material, and replay what you have saved."
                : "AI help is off. You can still read your material and replay what you have saved."}
          </p>
          <DialogButton title="AI help with your material" className={linkBtn} style={{ color: x.accent }} label="Manage consent">
            <AiHelpBody help={help} />
          </DialogButton>
        </section>
      </div>

      {shelves && materials.ok && materials.data.length > 0 && (
        <div className="mt-5"><CollectionsManager collections={shelves.map(s => ({ id: s.id, name: s.name }))} /></div>
      )}

      {materials.ok && materials.data.length > 0 && (
        <div className="mt-5">
          <ExplainPanel consent={status === "on"} offMessage={status ? aiOffMessage(status) ?? undefined : undefined} title="Ask across your library" scopes={scopes}
            hint="Searches your materials and answers only from what it finds, naming each material it used and citing the page, slide or section. Explanations are not saved." />
        </div>
      )}

      {materials.ok && (
        <div className="mt-8"><EraseAll count={materials.data.length} /></div>
      )}
      <p className="mt-6 text-[13px] text-gray-600">
        Your learning sessions are in <Link href={experienceHref("scholar", "study/learn")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Learn</Link>, and everything your study has kept is in <Link href={experienceHref("scholar", "study/saved")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Saved learning</Link>.
      </p>
    </>
  );
}
