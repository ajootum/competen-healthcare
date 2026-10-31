import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { startCaseSession } from "@/lib/cases/library";
import { isUuid } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { startPrivatePlay } from "@/lib/individual/scholar/clinical-play";
import { viewPlay } from "@/lib/individual/scholar/clinical-routes";
import { linkStudy } from "@/lib/individual/scholar/study-context";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/clinical/sessions -- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR2 and CI6.
// { caseId, mode? } replays one of the student's own stored cases; { versionId, mode? } starts a governed library case
// through the shared delivery (library.ts startCaseSession: published and approved for that version only). Neither
// uses AI, so both work whatever the student's AI allowance (Learning Continuity).

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);
  const mode = body?.mode === "independent" || body?.mode === "guided" ? body.mode : policy.scholarCaseMode;
  if (isUuid(body?.caseId)) {
    const p = await startPrivatePlay(ctx.admin, ctx.userId, body.caseId, mode);
    if ("error" in p) return NextResponse.json({ error: p.error }, { status: p.status });
    await audit(ctx, "individual_scholar_case_started", "individual_scholar_case_session", p.sessionId, { kind: "private", mode });
    // SCHOLAR-SESSION-AI-02: replayed inside a study session, the play is linked to it. A library play lives in the
    // shared case library, not in the learner's own case sessions, so it is not linked.
    await linkStudy(ctx.admin, ctx.userId, body?.studySessionId, "case_session", p.sessionId, policy);
    return NextResponse.json({ kind: "private", play: p });
  }
  if (isUuid(body?.versionId)) {
    if (!policy.scholarCaseEntries.includes("library")) return NextResponse.json({ error: "Library cases are not offered here." }, { status: 403 });
    const s = await startCaseSession(ctx.admin, ctx.userId, body.versionId, { hints: mode === "guided" });
    if ("error" in s) return NextResponse.json({ error: s.error }, { status: 404 });
    await audit(ctx, "individual_scholar_case_started", "case_library_session", s.sessionId, { kind: "library", mode });
    return NextResponse.json({ kind: "library", play: await viewPlay(ctx.admin, ctx.userId, "library", s.sessionId, mode === "guided") });
  }
  return NextResponse.json({ error: "Choose a case." }, { status: 400 });
}
