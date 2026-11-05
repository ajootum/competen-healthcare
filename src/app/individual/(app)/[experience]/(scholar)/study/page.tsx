import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { Notice, PageHeader, StatePanel, Unreadable } from "../../../../_components/chrome";
import { DialogButton } from "../../../../_components/Dialog";
import { FORMAT_LABEL, FORMAT_OF, uploadRules } from "@/lib/individual/scholar/config";
import { displaySessionTitle, displayTitle, sessionHits } from "@/lib/individual/scholar/learn-search";
import { countDue, listLearningSessions, listMaterials, materialExtras } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { continueStudy, loadStudy } from "@/lib/individual/scholar/study-context";
import { stageHref } from "@/lib/individual/scholar/study-carry";
import { listExamPapers } from "@/lib/individual/scholar/exam-store";
import { EXAM_ATTESTATION, LIVE_EXAM_NOTICE } from "@/lib/individual/scholar/exam-service";
import StudyNav from "./_components/StudyNav";
import { UploadPanel } from "./_components/client";
import { learnHref } from "./_components/learn-landing";
import { headerBtn } from "./_components/shell-pieces";
import { ContinueCard, RecentMaterials, StartLearning, textLink, type MaterialView } from "./_components/study-home";
import { fileTypeOf, materialState, resumableOf } from "./_components/study-home-model";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// THE STUDY HOME -- SCH-HFE-01 (owner GO 5 Nov 2026). Three things at once: continue where I stopped, start something new,
// find my materials. It reads existing records and links to existing pages: Continue resumes the session itself, Start
// Learning hands what was typed to Learn's own search (no AI, and no session is created by navigating), and each material
// opens its own page. Everything the library page offers is in My Library, one tap away (study/library, moved unchanged).
// The link to #upload lands here, so the upload dialog is always in the page.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Study" });
}

const RESUME_LOOK = 30;
const RESUME_CHECK = 5;
export default async function StudyHome({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const policy = await loadIndividualPolicy(ctx.admin);
  const [materials, due, sessions, connected, study, papers] = await Promise.all([
    listMaterials(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId), listLearningSessions(ctx.admin, ctx.userId, RESUME_LOOK),
    continueStudy(ctx.admin, ctx.userId, policy), loadStudy(ctx.admin, ctx.userId, (await searchParams).study, null, policy), listExamPapers(ctx.admin, ctx.userId),
  ]);
  const libraryHref = experienceHref("scholar", "study/library");
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow="Your learning space" title="Study" intro="Continue your learning or start something new." />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
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
  const list = materials.ok ? materials.data : [];

  // The open study session comes first (it reopens in its last stage), as on Scholar's home; then the latest active learning session.
  const rows = sessions.ok ? sessions.data : [];
  const active = rows.filter(r => r.status === "active");
  const ordered = connected ? [...active.filter(r => r.id === connected.id), ...active.filter(r => r.id !== connected.id)] : active;
  const { session: picked, blocked } = resumableOf(await sessionHits(ctx.admin, ctx.userId, ordered.slice(0, RESUME_CHECK), list));
  // One session on its own needs no "started on" to tell it from others with the same name.
  const pickedRow = picked ? rows.find(r => r.id === picked.id) : null;
  const session = picked && pickedRow ? { ...picked, title: displaySessionTitle(pickedRow.title) } : picked;
  const continueHref = session && connected?.id === session.id ? stageHref(connected.space, connected.id) : session ? learnHref({ session: session.id }) : null;

  const shown = list.slice(0, 5);
  const extras = await materialExtras(ctx.admin, ctx.userId, shown.map(m => m.id));
  const recent: MaterialView[] = shown.map(m => ({
    id: m.id, title: displayTitle(m.title), type: fileTypeOf(FORMAT_LABEL[FORMAT_OF[m.mimeType]]),
    state: materialState({ chunkCount: m.chunkCount, emptyUnits: extras.qualityOn ? extras.byId.get(m.id)?.quality?.emptyUnits.length ?? 0 : 0 }),
  }));

  const rules = uploadRules(policy);
  const upload = (
    <DialogButton title="Upload study material" hash="upload" label={list.length ? "+ Add material" : "+ Upload material"} className={list.length ? textLink : headerBtn}>
      <UploadPanel rules={{ mimes: [...rules.mimes], maxMb: rules.maxMb, text: rules.text, describe: rules.describe, sessionFiles: rules.sessionFiles, sessionMb: rules.sessionMb,
        exam: policy.scholarExams.enabled && papers.ok ? { attestation: EXAM_ATTESTATION.text, liveNotice: LIVE_EXAM_NOTICE } : null }} />
    </DialogButton>
  );

  return (
    <>
      {header}
      <div className="max-w-[880px] space-y-5" data-study-home>
        {session && continueHref && <ContinueCard s={session} href={continueHref} more={rows.length > 1} />}
        {!session && blocked && (
          <Notice>Your last session can no longer be resumed, because the material it was taught from is no longer available. Your learning record is unchanged. You can start something new below.</Notice>
        )}
        {!sessions.ok && <Unreadable what="your learning sessions" />}
        <StartLearning hasMaterials={list.length > 0} historyOn={policy.scholarSearchHistory === "on"} sessionsLink={!session && rows.length > 0} libraryHref={libraryHref} />
        <RecentMaterials rows={recent} unreadable={!materials.ok} upload={upload} libraryHref={libraryHref} />
      </div>
    </>
  );
}
