import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { createRevisionSet, getRevisionSession, isUuid, listRevisionSets, revisionPool } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";
import { REVISION_FORMATS } from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/revision/sets -- COMPETEN-SCHOLAR-REVISION-01 R1: Saved Revision Sets.
//
// POST { sessionId, title } saves a session's questions, in its order, as a set to replay later. Replaying uses the
// stored questions and keys: no AI call, so it works whatever the student's AI standing (s8). GET lists the sets.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  if (title.length < 1 || title.length > 120) return NextResponse.json({ error: "Name the set in up to 120 characters." }, { status: 400 });
  if (findPatientIdentifiers(title).length) return NextResponse.json({ error: "That name looks like it identifies a patient. Choose another." }, { status: 422 });
  if (!isUuid(body?.sessionId)) return NextResponse.json({ error: "Choose a revision session to save." }, { status: 400 });
  const s = await getRevisionSession(ctx.admin, ctx.userId, body.sessionId);
  if (!s.ok) return NextResponse.json({ error: "Your revision session could not be read just now." }, { status: 503 });
  if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pool = await revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] });
  const kinds = new Map((pool.ok ? pool.data.questions : []).map(q => [q.id, q.kind]));
  const ids = s.data.questionIds.filter(id => kinds.has(id));
  const made = await createRevisionSet(ctx.admin, ctx.userId, {
    title, mode: s.data.session.mode, scope: { from: "session" }, formats: [...new Set(ids.map(id => kinds.get(id)!))].filter(k => k !== "case"),
    quantity: ids.length, difficulty: "any", feedback: s.data.session.feedback, questionIds: ids,
  });
  if (!made.ok) return NextResponse.json({ error: made.notProvisioned ? "Saved revision sets are not available here yet." : "The set could not be saved just now." }, { status: made.notProvisioned ? 409 : 500 });
  await audit(ctx, "individual_scholar_revision_set_saved", "individual_scholar_revision_set", made.id, { questions: ids.length });
  return NextResponse.json({ id: made.id });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listRevisionSets(ctx.admin, ctx.userId);
  if (!r.ok) return NextResponse.json({ sets: [], available: r.notProvisioned ? "not_provisioned" : "unreadable" });
  return NextResponse.json({ sets: r.data.map(s => ({ id: s.id, title: s.title, mode: s.mode, questions: s.questionIds.length, lastUsedAt: s.lastUsedAt, createdAt: s.createdAt })), available: "on" });
}
