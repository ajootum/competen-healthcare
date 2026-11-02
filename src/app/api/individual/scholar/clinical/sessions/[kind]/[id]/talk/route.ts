// Allow up to 60s: a turn is one short AI reply.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isPlayKind } from "@/lib/individual/scholar/clinical-routes";
import { askPatient, communicationNote, loadTalkSource, talkState, TALK_UNAVAILABLE } from "@/lib/individual/scholar/case-talk";

// Request-time only: it reads the policy, the AI standing and the session.
export const dynamic = "force-dynamic";

// SCHOLAR-CE-2026 CE-04. "Talk to the patient" in a case that defines a patient or caregiver voice.
//
// GET  /api/individual/scholar/clinical/sessions/[kind]/[id]/talk            the conversation so far, the stage's remaining questions,
//                                                                              why it is unavailable if it is, and, after the case, the key-question review
// POST ... /talk { action: "ask", question }                                  one question: the reply is the AI voicing the person from what the case says
//                                                                              they know NOW (conversation.ts), through the same AI path as case feedback
// POST ... /talk { action: "note" }                                           after the case: the labelled AI note on communication (once)
//
// An unavailable conversation is a 200 with `unavailable` (the plain reason), never an error page: the case plays on.

export async function GET(_req: Request, ctx2: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { kind, id } = await ctx2.params;
  if (!isPlayKind(kind)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const src = await loadTalkSource(ctx.admin, ctx.userId, kind, id);
  if (!src) return NextResponse.json({ error: "No such session." }, { status: 404 });
  const s = await talkState(ctx, src);
  if ("error" in s) return NextResponse.json({ error: s.error }, { status: s.status });
  return NextResponse.json({ talk: s });
}

export async function POST(req: Request, ctx2: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { kind, id } = await ctx2.params;
  if (!isPlayKind(kind)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const src = await loadTalkSource(ctx.admin, ctx.userId, kind, id);
  if (!src) return NextResponse.json({ error: "No such session." }, { status: 404 });
  if (body?.action === "ask") {
    const r = await askPatient(ctx, req, src, body?.question);
    if (!r.ok) return NextResponse.json({ error: r.error, ...(r.unavailable ? { unavailable: r.error, title: TALK_UNAVAILABLE } : {}) }, { status: r.status });
    return NextResponse.json({ turn: r.turn, stage: r.stage, label: r.label });
  }
  if (body?.action === "note") {
    const r = await communicationNote(ctx, req, src);
    if ("error" in r) return NextResponse.json({ error: r.error, ...(r.unavailable ? { unavailable: r.error, title: TALK_UNAVAILABLE } : {}) }, { status: r.status });
    return NextResponse.json({ talk: r });
  }
  return NextResponse.json({ error: "Ask the patient a question." }, { status: 400 });
}
