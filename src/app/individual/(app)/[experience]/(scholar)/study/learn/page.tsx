import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { loadIndividualPolicy, shownLearnModes } from "@/lib/individual/policy";
import { scholarResearchOperational } from "@/lib/individual/scholar/learn-research";
import { countDue, getLearningPreference, getLearningSession, getRevisionSession, isUuid, learningEvents, listLearningSessions, listMaterials, readConsent } from "@/lib/individual/scholar/store";
import { sessionTopics } from "@/lib/individual/scholar/learn";
import { offeredActions, sessionView } from "@/lib/individual/scholar/learn-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { LEARN_ACTION_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, focusRing, secondaryBtn } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { scholarSpace } from "@/lib/individual/scholar/spaces";
import { LearnWorkspace, type StartScope } from "../_components/learn-client";
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

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Learn" });
}

type Search = { session?: string; materials?: string; material?: string; section?: string; competency?: string; topic?: string; revision?: string; action?: string };

export default async function LearnPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Search> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const q = await searchParams;
  const [policy, pref, consent, due, recent, library] = await Promise.all([
    loadIndividualPolicy(ctx.admin), getLearningPreference(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId),
    listLearningSessions(ctx.admin, ctx.userId, 5), listMaterials(ctx.admin, ctx.userId),
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
      const [events, topics] = await Promise.all([learningEvents(ctx.admin, ctx.userId, q.session), sessionTopics(ctx.admin, ctx.userId, r.data.steps.flatMap(s => s.sections.map(y => y.chunkId)))]);
      const progress: Record<number, { actions: string[]; verdict: string | null }> = {};
      for (const e of events.ok ? events.data : []) { const p = (progress[e.step] ??= { actions: [], verdict: null }); if (!p.actions.includes(e.action)) p.actions.push(e.action); if (e.verdict) p.verdict = e.verdict; }
      const s = r.data.session;
      resume = { session: sessionView({ id: s.id, recorded: true, title: s.title, scopeKind: s.scopeKind, currentStep: Math.min(s.currentStep, Math.max(0, r.data.steps.length - 1)), status: s.status, coverage: null, steps: r.data.steps, topics }), progress };
    }
  }
  const ids = (v?: string) => (v ?? "").split(",").filter(isUuid).slice(0, 10);
  const start: StartScope | null = resume ? null
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
          <StartPicker materials={materials} recent={recent.ok ? recent.data.map(s => ({ id: s.id, title: s.title, lastActiveAt: s.lastActiveAt, status: s.status })) : null} />
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

function StartPicker({ materials, recent }: { materials: { id: string; title: string }[]; recent: { id: string; title: string; lastActiveAt: string; status: string }[] | null }) {
  const href = (q: string) => experienceHref("scholar", `study/learn?${q}`);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section aria-labelledby="resume-h" className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="resume-h" className="text-[16px] font-bold text-gray-900">Continue learning</h2>
        {recent === null ? <p className="mt-2 text-[13.5px] text-gray-600">Learning history is not available here, so sessions cannot be resumed.</p>
          : recent.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-600">No sessions yet. Start one from your materials.</p>
            : (
              <ul className="mt-2 space-y-1.5">
                {recent.map(s => (
                  <li key={s.id}><Link href={href(`session=${s.id}`)} className={`text-[14px] font-semibold underline underline-offset-2 ${focusRing}`}>{s.title}</Link>
                    <span className="text-[12.5px] text-gray-500"> · {s.status === "completed" ? "completed" : "in progress"} · last {new Date(s.lastActiveAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>
                ))}
              </ul>
            )}
      </section>
      <section aria-labelledby="new-h" className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="new-h" className="text-[16px] font-bold text-gray-900">Learn something</h2>
        {materials.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-600">Upload your notes in My Learning first.</p> : (
          <>
            <ul className="mt-2 space-y-1.5">
              {materials.slice(0, 12).map(m => <li key={m.id}><Link href={href(`material=${m.id}`)} className={`text-[14px] font-semibold underline underline-offset-2 ${focusRing}`}>{m.title}</Link></li>)}
            </ul>
            <form action={experienceHref("scholar", "study/learn")} className="mt-4 flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <label htmlFor="learn-topic" className="block text-[12.5px] font-semibold text-gray-700">Or a topic across all your notes</label>
                <input id="learn-topic" name="topic" maxLength={120} placeholder="For example: oxygen therapy" className={`mt-1 block w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
              </div>
              <button type="submit" className={secondaryBtn}>Teach me this topic</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
