import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { loadIndividualPolicy, shownLearnModes } from "@/lib/individual/policy";
import { scholarResearchOperational } from "@/lib/individual/scholar/learn-research";
import { countDue, getLearningPreference, getLearningSession, getRevisionSession, isUuid, learningEvents, listMaterials, readConsent, type MaterialRow } from "@/lib/individual/scholar/store";
import { sectionProfiles, sessionTopics } from "@/lib/individual/scholar/learn";
import { offeredActions, sessionView } from "@/lib/individual/scholar/learn-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { LEARN_ACTION_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, focusRing, secondaryBtn } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { scholarSpace } from "@/lib/individual/scholar/spaces";
import { LearnWorkspace, type StartScope } from "../_components/learn-client";
import { learnLanding, parseSearchParams, searchLibrary, topicDetail, displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { ContinueLearning, LearnSearchBox, MyTopics, RecentlyAdded, SearchResults, TopicDetail, learnHref } from "../_components/learn-landing";
import { getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";

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

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Learn" });
}

type Search = Record<string, string | string[] | undefined> & { session?: string; materials?: string; material?: string; section?: string; competency?: string; topic?: string; revision?: string; action?: string };
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

  // A session to resume: the student's own, with what was done at each step.
  let resume: { session: ReturnType<typeof sessionView>; progress: Record<number, { actions: string[]; verdict: string | null }> } | null = null;
  if (q.session && isUuid(q.session)) {
    const r = await getLearningSession(ctx.admin, ctx.userId, q.session);
    if (r.ok && r.data) {
      const chunkIds = r.data.steps.flatMap(s => s.sections.map(y => y.chunkId));
      const [events, topics, profiles] = await Promise.all([learningEvents(ctx.admin, ctx.userId, q.session), sessionTopics(ctx.admin, ctx.userId, chunkIds), sectionProfiles(ctx.admin, ctx.userId, chunkIds)]);
      const progress: Record<number, { actions: string[]; verdict: string | null }> = {};
      for (const e of events.ok ? events.data : []) { const p = (progress[e.step] ??= { actions: [], verdict: null }); if (!p.actions.includes(e.action)) p.actions.push(e.action); if (e.verdict) p.verdict = e.verdict; }
      const s = r.data.session;
      resume = { session: sessionView({ id: s.id, recorded: true, title: displaySessionTitle(s.title), scopeKind: s.scopeKind, currentStep: Math.min(s.currentStep, Math.max(0, r.data.steps.length - 1)), status: s.status, coverage: null, steps: r.data.steps, topics, profiles }), progress };
    }
  }
  const ids = (v?: string) => (v ?? "").split(",").filter(isUuid).slice(0, 10);
  // SCH-LEARN-UX-01: sources ticked in the search results, a topic, or a typed topic to be taught.
  const picked = { m: many(q.m).filter(isUuid).slice(0, 10), s: many(q.s).filter(isUuid).slice(0, 24), t: many(q.t).map(x => x.trim()).filter(x => x.length >= 2).slice(0, 10) };
  const about = one(q.about).replace(/\s+/g, " ").trim().slice(0, 120);
  const typedTopic = one(q.teach) === "1" ? one(q.q).replace(/\s+/g, " ").trim().slice(0, 120) : "";
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
      <StudyNav dueCount={due} />
      {backToRevision && (
        <p className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13.5px] text-gray-800">
          You came here from a revision session. <Link href={backToRevision} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Back to your revision</Link> -- it carries on where you left it.
        </p>
      )}
      {q.session && !resume ? (
        <StatePanel title="That session could not be found" actions={<Link href={experienceHref("scholar", "study/learn")} className={secondaryBtn}>Start learning</Link>}>
          <p>It may have been removed with the materials it used.</p>
        </StatePanel>
      ) : !resume && !start ? (
        <>
          <Discover admin={ctx.admin} userId={ctx.userId} q={q} library={library.ok ? library.data : null} />
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
          initial={resume?.session ?? null} initialProgress={resume?.progress ?? {}} start={start}
          actions={offered.actions} startAction={startAction} labels={LEARN_ACTION_LABEL}
          consent={status === "on"} offMessage={status ? aiOffMessage(status) ?? null : "Your AI help setting could not be read just now."}
          checks={policy.scholarCheckBehaviour} depth={pref?.depth ?? policy.scholarExplanationDepth} maxTurns={policy.scholarTutorTurns}
          materials={materials} standingMessage={standingMessage} modes={shownLearnModes(policy.scholarResearch, policy.scholarResearch.modes.includes("research") && await scholarResearchOperational(ctx.admin))}
        />
      )}
    </>
  );
}

/**
 * SCH-LEARN-UX-01: what Learn shows with nothing to start or resume -- a topic, a search's results, or the landing.
 * Reads only, no AI. `library` null: the materials could not be read (said so, never shown as empty).
 */
async function Discover({ admin, userId, q, library }: { admin: unknown; userId: string; q: Search; library: MaterialRow[] | null }) {
  const name = one(q.topicView).trim().slice(0, 200);
  if (name) {
    const page = Math.max(1, Math.min(200, Math.floor(Number(one(q.page)) || 1)));
    const t = await topicDetail(admin, userId, name, page, library ?? []);
    return (
      <>
        <LearnSearchBox />
        {t === "unreadable" ? <StatePanel title="Your topics could not be read just now"><p>Try again shortly. Your notes and sessions are unchanged.</p></StatePanel>
          : t === null ? (
            <StatePanel title="That topic is not in your notes" actions={<Link href={learnHref({ tab: "topics" })} className={secondaryBtn}>See your topics</Link>}>
              <p>It may have been renamed. Search for it, or choose from your topics.</p>
            </StatePanel>
          ) : <TopicDetail name={t.name} subject={t.subject} documents={t.documents} sections={t.sections} page={page} total={t.total} competencies={t.competencies} />}
      </>
    );
  }
  const params = parseSearchParams(q);
  if (params.q || one(q.tab)) {
    const r = await searchLibrary(admin, userId, params, library ?? []);
    return (<><LearnSearchBox q={params.q} /><SearchResults r={r} /></>);
  }
  const l = await learnLanding(admin, userId, library);
  return (
    <>
      <LearnSearchBox />
      <ContinueLearning sessions={l.sessions} total={l.sessionTotal} />
      <MyTopics groups={l.topicGroups} total={l.topicTotal} />
      <RecentlyAdded docs={l.recent} />
    </>
  );
}
