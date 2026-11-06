import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { loadIndividualPolicy, shownLearnModes, type IndividualPolicy } from "@/lib/individual/policy";
import { scholarResearchOperational } from "@/lib/individual/scholar/learn-research";
import { countDue, getLearningPosition, getLearningPreference, getLearningSession, getRevisionSession, isUuid, learnLessonRecords, learningEvents, librarySchema, listCheckAttempts, listMappings, listMaterials, readConsent, type MaterialRow } from "@/lib/individual/scholar/store";
import type { CheckHistoryItem } from "@/lib/individual/scholar/learn-check-record";
import type { LessonRecord } from "@/lib/individual/scholar/learn-journey";
import { sectionProfiles, sessionTopics } from "@/lib/individual/scholar/learn";
import { offeredActions, sessionView } from "@/lib/individual/scholar/learn-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { LEARN_ACTION_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import { Notice, PageHeader, StatePanel, focusRing, secondaryBtn } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { scholarSpace } from "@/lib/individual/scholar/spaces";
import type { ServerPosition } from "@/lib/individual/scholar/learn-position";
import { LearnWorkspace, type StartScope } from "../_components/learn-client";
import { searchLibraryTolerant } from "@/lib/individual/scholar/tolerant-search";
import { learnLanding, parseSearchParams, topicDetail, displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { LearnSearchBox, MyTopics, RecentlyAdded, SearchResults, TopicDetail, learnHref } from "../_components/learn-landing";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Deferred, SectionLoading } from "../_components/deferred";
import { ContinueCard } from "../_components/study-home";
import { LearningLibrary, MoreToLearnFrom, RecentLessons, StudyNext, recentLessons } from "../_components/learn-home";
import type { IndividualContext } from "@/lib/individual/guard";
import { resumeSession } from "@/lib/individual/scholar/resume-session";
import { scholarModulesOnce } from "@/lib/individual/scholar/module-access";
import { loadToday } from "@/lib/individual/scholar/plan-data";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
// SCHOLAR-SEARCH-HISTORY-01: a submitted search is kept in the learner's own history (policy scholar_search_history, default off).
import { RecordSearch } from "../_components/search-history-client";
import { getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { continueStudy, loadStudy, studySessionsOn } from "@/lib/individual/scholar/study-context";
import { stageHref } from "@/lib/individual/scholar/study-carry";
import type { StudySpace } from "@/lib/individual/scholar/study-session";
import { cleanObjectiveText } from "@/lib/individual/scholar/study-session";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// THE LEARN WORKSPACE -- COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24): Teach Me is the default.
//
// Reached from Stage 2's Start learning (?materials=...), a material (?material=), a section (?section=), a
// competency on Progress (?competency=), a topic (?topic=), or a session to resume (?session=). The page resolves a
// resume on the server (the student's own session, by their id); a new scope is started by the workspace through
// /api/individual/scholar/learn/sessions, which then opens the policy's starting action -- Teach Me by default.
// The original materials and every source stay one click away; the Scholar assistant (Ask) is always there.
//
// SCH-LEARN-UX-01 (owner GO 2026-10-28): with nothing to start or resume, Learn is SEARCH-FIRST and TOPIC-CENTRED --
// the universal search, Continue Learning, My Topics, Recently Added -- and a search (?q=, ?tab=) or a topic
// (?topicView=) shows its results on this page. Searching uses no AI. "Teach me" -- a typed topic (?q=&teach=1), a
// topic (?t=), or sources ticked in the results (?m=, ?s=, ?t=, with what was searched as ?about=) -- starts one
// session through the same workspace and the same Learn engine.
//
// SCHOLAR-SESSION-AI-02 slice B (only where study sessions are on): ?study=new with any start above starts it as a
// connected study session ("Study this"); ?study=<id> is the caller's own open study session (its bar, and with no
// other start it reopens that session); &panel=ask opens the Ask panel first. A foreign or unknown id is ignored.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Learn" });
}

type Search = Record<string, string | string[] | undefined> & { session?: string; materials?: string; material?: string; section?: string; competency?: string; topic?: string; revision?: string; action?: string; study?: string; panel?: string };
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LearnPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Search> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const q = await searchParams;
  const [policy, pref, consent, due, library] = await Promise.all([
    loadIndividualPolicy(ctx.admin), getLearningPreference(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId),
    listMaterials(ctx.admin, ctx.userId),
  ]);
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  // s7: the student's AI standing (IND-007's, through Scholar's one adapter). Limited AI never hides saved learning.
  const standing = await getScholarAiStanding(ctx.admin, ctx.userId);
  const standingMessage = !standing.readable || standing.level === "continuity" ? (standing.message ?? "New AI help is limited right now.") : null;
  const offered = offeredActions(policy, pref?.defaultAction);
  // REVISION-01 R4: from a revision answer, "Explain the answer" opens Explain (if offered) and every link keeps the
  // way back to the same revision session, which resumes at the same question.
  const startAction = q.action && offered.actions.includes(q.action as LearnAction) ? (q.action as LearnAction) : offered.start;
  const fromRevision = q.revision && isUuid(q.revision) ? await getRevisionSession(ctx.admin, ctx.userId, q.revision) : null;
  const backToRevision = fromRevision?.ok && fromRevision.data ? `${experienceHref("scholar", "study/revise")}?session=${fromRevision.data.session.id}` : null;

  // SCHOLAR-SESSION-AI-02: the open study session (database reads only), and whether "Study this" may start one.
  const study = await loadStudy(ctx.admin, ctx.userId, q.study, "learn", policy);
  const studyOn = await studySessionsOn(ctx.admin, ctx.userId, policy);
  const startAsked = !!(q.m || q.s || q.t || q.teach || q.section || q.material || q.materials || q.competency || q.topic);
  const sessionId = q.session ?? (study && !startAsked ? study.session.id : undefined);

  // A session to resume: the student's own, with what was done at each step.
  // SCHOLAR-PERSISTENT-LEARNING-01: and each lesson's server records (saved teaching, attempts) -- the lesson states, no AI.
  let resume: { session: ReturnType<typeof sessionView>; progress: Record<number, { actions: string[]; verdict: string | null }>; position: ServerPosition | null; records: LessonRecord[] } | null = null;
  const initialChecks: Record<number, CheckHistoryItem[]> = {};
  if (sessionId && isUuid(sessionId)) {
    const r = await getLearningSession(ctx.admin, ctx.userId, sessionId);
    if (r.ok && r.data) {
      const chunkIds = r.data.steps.flatMap(s => s.sections.map(y => y.chunkId));
      // SCHOLAR-CONTINUITY-01 (790): where the learner stopped on any device. Absent or unreadable: this device's copy only.
      // LEARNING-CLOSE-2026-11 D01 (CYU-03/04): the session's kept understanding checks, per lesson, so they survive refresh, sign-out and a change of device.
      const [events, topics, profiles, position, records, kept] = await Promise.all([learningEvents(ctx.admin, ctx.userId, sessionId), sessionTopics(ctx.admin, ctx.userId, chunkIds), sectionProfiles(ctx.admin, ctx.userId, chunkIds), getLearningPosition(ctx.admin, ctx.userId, sessionId), learnLessonRecords(ctx.admin, ctx.userId, r.data.steps, startAction).catch(() => []), listCheckAttempts(ctx.admin, ctx.userId, { sessionId, limit: 120 }).catch(() => null)]);
      for (const c of kept?.ok ? kept.data : []) if (c.step !== null) (initialChecks[c.step] ??= []).push(c);
      const progress: Record<number, { actions: string[]; verdict: string | null }> = {};
      for (const e of events.ok ? events.data : []) { const p = (progress[e.step] ??= { actions: [], verdict: null }); if (!p.actions.includes(e.action)) p.actions.push(e.action); if (e.verdict) p.verdict = e.verdict; }
      const s = r.data.session;
      resume = { session: sessionView({ id: s.id, recorded: true, title: displaySessionTitle(s.title), scopeKind: s.scopeKind, currentStep: Math.min(s.currentStep, Math.max(0, r.data.steps.length - 1)), status: s.status, coverage: null, steps: r.data.steps, topics, profiles, titles: r.data.lessonTitles }), progress, position: position.ok ? position.data : null, records };
    }
  }
  const ids = (v?: string) => (v ?? "").split(",").filter(isUuid).slice(0, 10);
  // SCH-LEARN-UX-01: sources ticked in the search results, a topic, or a typed topic to be taught.
  const picked = { m: many(q.m).filter(isUuid).slice(0, 10), s: many(q.s).filter(isUuid).slice(0, 24), t: many(q.t).map(x => x.trim()).filter(x => x.length >= 2).slice(0, 10) };
  const about = one(q.about).replace(/\s+/g, " ").trim().slice(0, 120);
  const typedTopic = one(q.teach) === "1" || (one(q.study) === "new" && one(q.q)) ? one(q.q).replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const start: StartScope | null = resume ? null
    : picked.m.length || picked.s.length || picked.t.length ? { kind: "sources", materialIds: picked.m, chunkIds: picked.s, topics: picked.t, ...(about.length >= 2 ? { topic: about } : {}) }
    : typedTopic.length >= 2 ? { kind: "topic", topic: typedTopic }
    : q.section && isUuid(q.section) ? { kind: "section", chunkId: q.section }
      : q.material && isUuid(q.material) ? { kind: "document", materialId: q.material }
        : ids(q.materials).length ? { kind: "documents", materialIds: ids(q.materials) }
          : q.competency && isUuid(q.competency) ? { kind: "competency", competencyId: q.competency }
            : q.topic && q.topic.trim().length >= 2 ? { kind: "topic", topic: q.topic.trim().slice(0, 120) } : null;

  const materials = library.ok ? library.data.map(m => ({ id: m.id, title: m.title })) : [];
  return (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("learn").eyebrow} title="Learn" intro={scholarSpace("learn").intro} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      {backToRevision && (
        <p className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13.5px] text-gray-800">
          You came here from a revision session. <Link href={backToRevision} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Back to your revision</Link> -- it carries on where you left it.
        </p>
      )}
      {sessionId && !resume ? (
        <StatePanel title="That session could not be found" actions={<Link href={experienceHref("scholar", "study/learn")} className={secondaryBtn}>Start learning</Link>}>
          <p>It may have been removed with the materials it used.</p>
        </StatePanel>
      ) : !resume && !start ? (
        <>
          <Discover ctx={ctx} policy={policy} q={q} library={library.ok ? library.data : null} studyOn={studyOn} historyOn={policy.scholarSearchHistory === "on"} />
          {/* COMPETEN-SCHOLAR-EXAM-PAPERS-01: a past paper is learned from in Apply, question by question, with evidence. */}
          {policy.scholarExams.enabled && (
            <p className="mt-5 text-[13.5px] text-gray-600">
              Studying a past or practice paper? Each suggested answer explains itself from your notes and other evidence, and you can ask follow-up questions:{" "}
              <Link href={experienceHref("scholar", "study/apply")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>open your papers in Apply</Link>.
            </p>
          )}
        </>
      ) : (
        <LearnWorkspace
          initial={resume?.session ?? null} initialProgress={resume?.progress ?? {}} initialPosition={resume?.position ?? null} initialRecords={resume?.records ?? []} start={start}
          initialChecks={initialChecks} checkPlacement={policy.scholarLearnCheckPlacement}
          actions={offered.actions} startAction={startAction} labels={LEARN_ACTION_LABEL}
          consent={status === "on"} offMessage={status ? aiOffMessage(status) ?? null : "Your AI help setting could not be read just now."}
          checks={policy.scholarCheckBehaviour} depth={pref?.depth ?? policy.scholarExplanationDepth} maxTurns={policy.scholarTutorTurns}
          materials={materials} standingMessage={standingMessage} connect={studyOn && one(q.study) === "new" && !!start} objectiveText={studyOn && one(q.study) === "new" && start && start.kind !== "competency" ? cleanObjectiveText(one(q.obj)) ?? undefined : undefined} openAsk={q.panel === "ask"} prepareNext={policy.scholarLearnPrepareNext} ownCards={policy.scholarFlashcards === "on"} applyChunkIds={await applyChunkIds(ctx.admin, ctx.userId)}
          inline={{ recall: policy.scholarLearnInlineRecall, placement: policy.scholarLearnInlineRecallPlacement, minWords: policy.scholarLearnInlineRecallMinWords, checks: policy.scholarLearnInlineChecks, application: policy.scholarLearnInlineApplication, skippable: policy.scholarLearnInlineSkippable, required: policy.scholarLearnCheckRequired, every: policy.scholarLearnCheckEvery, saveMissed: policy.scholarLearnSaveMissedCards }}
          styleOn={{ guide: policy.scholarLearnStyleGuide, challenge: policy.scholarLearnStyleChallenge, moreMenu: policy.scholarLearnMoreMenu }}
          visuals={{ on: policy.scholarLessonVisuals === "on", max: policy.scholarLessonVisualsMaxPerSection }}
          notesOn={policy.scholarLearningLibrary === "on" && await librarySchema(ctx.admin, ctx.userId)} modes={shownLearnModes(policy.scholarResearch, policy.scholarResearch.modes.includes("research") && await scholarResearchOperational(ctx.admin))}
        />
      )}
    </>
  );
}

/**
 * SCH-LEARN-UX-01: what Learn shows with nothing to start or resume -- a topic, a search's results, or the landing.
 * Reads only, no AI. `library` null: the materials could not be read (said so, never shown as empty).
 */
async function Discover({ ctx, policy, q, library, studyOn, historyOn }: { ctx: IndividualContext; policy: IndividualPolicy; q: Search; library: MaterialRow[] | null; studyOn: boolean; historyOn: boolean }) {
  const { admin, userId } = ctx;
  const name = one(q.topicView).trim().slice(0, 200);
  if (name) {
    const page = Math.max(1, Math.min(200, Math.floor(Number(one(q.page)) || 1)));
    const t = await topicDetail(admin, userId, name, page, library ?? []);
    return (
      <>
        <LearnSearchBox studyOn={studyOn} historyOn={historyOn} />
        {t === "unreadable" ? <StatePanel title="Your topics could not be read just now"><p>Try again shortly. Your notes and sessions are unchanged.</p></StatePanel>
          : t === null ? (
            <StatePanel title="That topic is not in your notes" actions={<Link href={learnHref({ tab: "topics" })} className={secondaryBtn}>See your topics</Link>}>
              <p>It may have been renamed. Search for it, or choose from your topics.</p>
            </StatePanel>
          ) : <TopicDetail name={t.name} subject={t.subject} documents={t.documents} sections={t.sections} page={page} total={t.total} competencies={t.competencies} studyOn={studyOn} />}
      </>
    );
  }
  const params = parseSearchParams(q);
  if (params.q || one(q.tab)) {
    const r = await searchLibraryTolerant(admin, userId, params, library ?? []);
    // A submitted search (the form's own key, hk) is kept once in the learner's history; paging and tabs carry no key, so they add nothing.
    const found = Object.values(r.counts).every(c => c === null) ? null : Object.values(r.counts).reduce<number>((n, c) => n + (c ?? 0), 0);
    return (<><LearnSearchBox q={params.q} studyOn={studyOn} historyOn={historyOn} />{r.showingFor && <p role="status" className="mb-3 text-[14px] text-gray-800" data-testid="showing-results-for">Showing results for <span className="font-semibold">{r.showingFor}</span>. You searched for “{params.q}”.</p>}<SearchResults r={r} />{historyOn && params.q && <RecordSearch activity="material_search" query={params.q} requestKey={one(q.hk) || null} resultCount={found} />}</>);
  }
  const [l, cont] = await Promise.all([learnLanding(admin, userId, library), studyOn ? continueStudy(admin, userId) : null]);
  // SCH-HFE-01: the next step takes the most reading, so the rest of the landing shows first and it arrives when it is ready.
  const nextP = nextSection(ctx, policy);
  const [resume, modules] = await Promise.all([resumeSession(admin, userId, library ?? [], cont), scholarModulesOnce(admin, userId)]);
  const session = resume.session;
  const href = session && resume.connectedSpace ? stageHref(resume.connectedSpace as StudySpace, session.id) : session ? learnHref({ session: session.id }) : null;
  return (
    <div className="max-w-[880px] space-y-5" data-learn-home>
      {session && href && <ContinueCard s={session} href={href} more={false} />}
      {!session && resume.blocked && <Notice>Your last lesson can no longer be resumed, because the material it was taught from is no longer available. Your learning record is unchanged. You can start something new below.</Notice>}
      <LearnSearchBox studyOn={studyOn} historyOn={historyOn} />
      {policy.scholarMyPlan === "on" && (
        <Suspense fallback={<SectionLoading label="Working out your next step" rows={2} />}><Deferred content={nextP} /></Suspense>
      )}
      <RecentLessons sessions={recentLessons(l.sessions ?? [], session?.id ?? null)} unreadable={l.sessions === null} total={l.sessionTotal} />
      <LearningLibrary materials={library === null ? null : library.length} savedOn={policy.scholarLearningLibrary === "on"} coursesOn={modules.has("courses")}
        extra={(
          <>
            {l.topicTotal > 0 && <MoreToLearnFrom label={`Your topics (${l.topicTotal})`}><MyTopics groups={l.topicGroups} total={l.topicTotal} bare /></MoreToLearnFrom>}
            {(l.recent === null || l.recent.length > 0) && <MoreToLearnFrom label="Recently added"><RecentlyAdded docs={l.recent} studyOn={studyOn} bare /></MoreToLearnFrom>}
          </>
        )} />
    </div>
  );
}

/** Study next: the plan's own recommendation, read without changing anything. A plan that cannot be read says so. */
async function nextSection(ctx: IndividualContext, policy: IndividualPolicy): Promise<React.ReactNode> {
  if (policy.scholarMyPlan !== "on") return null;
  const hdrs = await headers();
  const t = await loadToday(ctx as never, policy, { now: new Date(), tz: learnerTimeZone(hdrs), today: learnerToday(hdrs), readOnly: true }).catch(() => null);
  if (!t) return <StudyNext item={null} starting={false} unreadable />;
  if (!t.ok) return t.reason === "unreadable" ? <StudyNext item={null} starting={false} unreadable /> : null;
  return <StudyNext item={t.next ? { title: t.next.title, minutes: t.next.minutes ?? null, href: t.next.href ?? null } : null} starting={t.starting} unreadable={false} />;
}

/**
 * SCHOLAR-INLINE-CHECKS-01: the sections the learner has accepted a competency mapping for -- the one reliable signal that content is
 * clinically relevant, so the Apply case is offered only there (never on non-clinical content). Reads only, no AI; empty when the
 * mappings are absent or unreadable, so Apply fails closed.
 */
async function applyChunkIds(admin: unknown, userId: string): Promise<string[]> {
  const m = await listMappings(admin, userId).catch(() => null);
  return m && m.ok ? [...new Set(m.data.mappings.filter(x => x.state === "accepted").map(x => x.chunkId))].slice(0, 2000) : [];
}
