import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal, type IndividualContext } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { addNote, deleteNote, isUuid, librarySchema, listNotes, updateNote } from "@/lib/individual/scholar/store";
import { NOTE_BODY_MAX, NOTE_PROBLEM, validateNote } from "@/lib/individual/scholar/saved-library";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/library/notes -- SCHOLAR-LIBRARY-01 (owner instruction 1 Nov 2026), migration 820.
//
// The learner's OWN notes, bookmarks and highlights on their saved teaching, lessons, materials and sections.
//   GET    ?artefact=<id> | ?session=<id>   their notes on one saved teaching or one session's lessons
//   POST   { kind, targetKind, artefactId? | sessionId+step | materialId (+chunkId), body?, quote? }   (saved-library validateNote)
//   PATCH  { id, body }                      change a note's or a highlight's text
//   DELETE ?id=<id>                          remove one
// Every target is the caller's own (the store keys every statement on their id and 820's composite foreign keys refuse
// anything else: 404). Learner text is screened for patient identifiers like every other learner text (422). Learner-
// authored, private, never shared, never AI. Gated by policy scholar_learning_library (403 when off) and migration 820
// (409 while absent). The audit row holds codes only, never a note's words.

type Ctx = IndividualContext;
async function gate(ctx: Ctx): Promise<NextResponse | null> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarLearningLibrary !== "on") return NextResponse.json({ error: "Notes are not offered here." }, { status: 403 });
  if (!(await librarySchema(ctx.admin, ctx.userId))) return NextResponse.json({ error: "Notes are not available here yet." }, { status: 409 });
  return null;
}
const identifies = (...t: (string | null)[]) => t.some(x => !!x && findPatientIdentifiers(x).length > 0);
const IDENTIFIER = "That looks like it identifies a patient. Remove it and try again.";

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const u = new URL(req.url).searchParams;
  const artefact = u.get("artefact"), session = u.get("session");
  if ((artefact ? 1 : 0) + (session ? 1 : 0) !== 1 || ![artefact, session].filter(Boolean).every(isUuid)) return NextResponse.json({ error: "Choose one saved lesson or one session." }, { status: 400 });
  const r = await listNotes(ctx.admin, ctx.userId, artefact ? { artefactIds: [artefact] } : { sessionIds: [session!] });
  if (!r.ok) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });
  return NextResponse.json({ notes: r.data.rows });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const v = validateNote(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.message, reason: v.problem }, { status: 400 });
  if (identifies(v.note.body, v.note.quote)) return NextResponse.json({ error: IDENTIFIER }, { status: 422 });
  const r = await addNote(ctx.admin, ctx.userId, v.note);
  if (!r.ok) {
    const [status, error] = r.error === "not_found" ? [404, "That could not be found."] : r.error === "limit" ? [409, "You have reached the most notes that can be kept. Remove some to add more."]
      : r.error === "not_provisioned" ? [409, "Notes are not available here yet."] : [500, "Your note could not be saved just now."];
    return NextResponse.json({ error }, { status });
  }
  await audit(ctx, "individual_scholar_note_added", "individual_scholar_note", r.id, { kind: v.note.kind, target: v.note.targetKind, existing: r.existing });
  return NextResponse.json({ ok: true, id: r.id, existing: r.existing });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.id)) return NextResponse.json({ error: "That note could not be found." }, { status: 404 });
  const text = typeof body?.body === "string" ? body.body.replace(/\r\n?/g, "\n").trim() : body?.body === null ? null : undefined;
  if (text === undefined || (text !== null && (!text || text.length > NOTE_BODY_MAX))) return NextResponse.json({ error: NOTE_PROBLEM.body }, { status: 400 });
  if (identifies(text)) return NextResponse.json({ error: IDENTIFIER }, { status: 422 });
  const r = await updateNote(ctx.admin, ctx.userId, body.id, { body: text });
  if (r !== "ok") return NextResponse.json({ error: r === "not_found" ? "That note could not be found." : r === "invalid" ? NOTE_PROBLEM.body : "Your note could not be saved just now." }, { status: r === "not_found" ? 404 : r === "invalid" ? 400 : 500 });
  await audit(ctx, "individual_scholar_note_changed", "individual_scholar_note", body.id, {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "That note could not be found." }, { status: 404 });
  const r = await deleteNote(ctx.admin, ctx.userId, id);
  if (r !== "ok") return NextResponse.json({ error: r === "not_found" ? "That note could not be found." : "That could not be removed just now." }, { status: r === "not_found" ? 404 : 500 });
  await audit(ctx, "individual_scholar_note_removed", "individual_scholar_note", id, {});
  return NextResponse.json({ ok: true });
}
