import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { clearTopicCorrection, isUuid, renameTopic, setTopicCorrection } from "@/lib/individual/scholar/store";
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
//
// SCH-LEARN-UX-01: PATCH { from, to } renames one of the student's topics across THEIR library -- the same personal
// correction, written for every section of theirs that shows it. A governed competency is never renamed here.

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

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const from = typeof body?.from === "string" ? body.from.replace(/\s+/g, " ").trim() : "";
  const to = cleanTopics([body?.to]);
  if (from.length < 2 || from.length > 200) return NextResponse.json({ error: "Choose a topic to rename." }, { status: 400 });
  if (!to.ok || to.value.length !== 1) return NextResponse.json({ error: to.ok ? "Give the new name." : to.error }, { status: 400 });
  if (findPatientIdentifiers(to.value[0]).length)
    return NextResponse.json({ error: "That name looks like it identifies a patient. Name the topic only." }, { status: 422 });
  const r = await renameTopic(ctx.admin, ctx.userId, from, to.value[0]);
  if (!r.ok) return NextResponse.json({ error: r.error === "not_provisioned" ? "Renaming topics is not available here yet." : "Your topic could not be renamed just now. Try again shortly." }, { status: r.error === "not_provisioned" ? 409 : 500 });
  if (r.sections === 0) return NextResponse.json({ error: "That topic could not be found in your notes." }, { status: 404 });
  await audit(ctx, "individual_scholar_topic_renamed", "individual_scholar_chunk", null, { sections: r.sections });
  return NextResponse.json({ ok: true, name: to.value[0], sections: r.sections });
}
