import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { clearTopicCorrection, isUuid, setTopicCorrection } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { cleanTopics } from "@/lib/individual/scholar/library";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/topics -- COMPETEN-SCHOLAR-UPLOAD-01 U5, a student corrects the topics of a section.
//
// POST { chunkId, topics: string[] } saves the student's own list for one of THEIR sections (looked up by the
// caller's id: another person's section is 404). It replaces what they see; the AI analysis is kept as the
// record. DELETE { chunkId } removes the correction. No AI call, and nothing reaches a shared catalogue.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.chunkId)) return NextResponse.json({ error: "Choose a section." }, { status: 400 });
  const topics = cleanTopics(body?.topics);
  if (!topics.ok) return NextResponse.json({ error: topics.error }, { status: 400 });
  if (topics.value.some(t => findPatientIdentifiers(t).length))
    return NextResponse.json({ error: "A topic looks like it identifies a patient. Remove it and save again." }, { status: 422 });
  const r = await setTopicCorrection(ctx.admin, ctx.userId, body.chunkId, topics.value);
  if (r === "not_found") return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
  if (r === "not_provisioned") return NextResponse.json({ error: "Correcting topics is not available here yet." }, { status: 409 });
  if (r === "failed") return NextResponse.json({ error: "Your topics could not be saved just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_topics_corrected", "individual_scholar_chunk", body.chunkId, { topics: topics.value.length });
  return NextResponse.json({ ok: true, topics: topics.value });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.chunkId)) return NextResponse.json({ error: "Choose a section." }, { status: 400 });
  const r = await clearTopicCorrection(ctx.admin, ctx.userId, body.chunkId);
  if (r === "failed") return NextResponse.json({ error: "Your topics could not be reset just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_topics_reset", "individual_scholar_chunk", body.chunkId, {});
  return NextResponse.json({ ok: true });
}
