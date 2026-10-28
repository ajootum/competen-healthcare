import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getLearningSession, learningEvents, recordLearningEvent, updateLearningSession } from "@/lib/individual/scholar/store";
import { sessionTopics } from "@/lib/individual/scholar/learn";
import { sessionView } from "@/lib/individual/scholar/learn-view";
import { displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/learn/sessions/[id] -- COMPETEN-SCHOLAR-LEARN-01 L3 and L4, resume and move.
//
// GET: the student's own session (another person's id answers 404) with its steps and, per step, what was done and
// the latest informal check outcome -- so they can resume where they left off. PATCH { currentStep?, status?, move? }:
// go to a step (skip, revisit, reorder by choosing), mark it completed, or record a resume. Structure only.

const MOVES = ["skip", "revisit", "resume"] as const;

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const r = await getLearningSession(ctx.admin, ctx.userId, id);
  if (!r.ok) return NextResponse.json({ error: r.notProvisioned ? "Learning history is not available here." : "Your session could not be read just now." }, { status: r.notProvisioned ? 409 : 503 });
  if (!r.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [events, topics] = await Promise.all([
    learningEvents(ctx.admin, ctx.userId, id),
    sessionTopics(ctx.admin, ctx.userId, r.data.steps.flatMap(s => s.sections.map(x => x.chunkId))),
  ]);
  const byStep: Record<number, { actions: string[]; verdict: string | null }> = {};
  for (const e of events.ok ? events.data : []) {
    const s = (byStep[e.step] ??= { actions: [], verdict: null });
    if (!s.actions.includes(e.action)) s.actions.push(e.action);
    if (e.verdict) s.verdict = e.verdict;
  }
  const s = r.data.session;
  return NextResponse.json({
    session: sessionView({ id: s.id, recorded: true, title: displaySessionTitle(s.title), scopeKind: s.scopeKind, currentStep: Math.min(s.currentStep, Math.max(0, r.data.steps.length - 1)), status: s.status, coverage: null, steps: r.data.steps, topics }),
    progress: byStep, lastActiveAt: s.lastActiveAt,
  });
}

export async function PATCH(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const body = await req.json().catch(() => ({}));
  const r = await getLearningSession(ctx.admin, ctx.userId, id);
  if (!r.ok || !r.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const steps = r.data.steps.map(s => s.step);
  const step = body?.currentStep === undefined ? undefined : Number(body.currentStep);
  if (step !== undefined && !steps.includes(step)) return NextResponse.json({ error: "That step is not in this session." }, { status: 400 });
  const status = body?.status === "completed" || body?.status === "active" ? body.status : undefined;
  const u = await updateLearningSession(ctx.admin, ctx.userId, id, { currentStep: step, status });
  if (u !== "ok") return NextResponse.json({ error: "Your session could not be updated just now." }, { status: 500 });
  const move = (MOVES as readonly string[]).includes(body?.move) ? body.move as string : null;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (move && policy.scholarLearningHistory === "record") {
    const at = step ?? r.data.session.currentStep;
    await recordLearningEvent(ctx.admin, ctx.userId, { sessionId: id, step: at, action: move, verdict: null, chunkIds: r.data.steps.find(s => s.step === at)?.sections.map(x => x.chunkId) ?? [] });
  }
  await audit(ctx, "individual_scholar_learning_moved", "individual_scholar_learning_session", id, { step: step ?? null, status: status ?? null, move });
  return NextResponse.json({ ok: true });
}
