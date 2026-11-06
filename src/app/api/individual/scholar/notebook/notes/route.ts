import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal, type IndividualContext } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";
import { NOTE_IDENTIFIER_REFUSAL, validateCreate } from "@/lib/individual/scholar/personal-notebook";
import { createNotebookNote, lessonNotes, notebookOffered, notebookSchema } from "@/lib/individual/scholar/personal-notebook-store";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/notebook/notes -- COMPETEN-NOTEBOOK-001 P1, SCHOLAR-NOTEBOOK-UX-002 (owner, 6 Nov 2026), migration 1000.
//
//   GET  ?session=<id>&step=<n>&chunks=<id,id>   the caller's notes on one lesson and on its sections
//   POST { clientKey, body, title?, tags?, context? }   the first save of a note. A retry with the same key finds the same note
// Learner-authored and private. Their own rows only: the guard's user id, never a body field. Nothing here calls a model, and the audit row
// holds codes only, never a note's words. Gated by policy scholar_personal_notebook (403) and migration 1000 (409).

const noStore = { "Cache-Control": "private, no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: noStore });

async function gate(ctx: IndividualContext): Promise<NextResponse | null> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarPersonalNotebook !== "on" || policy.scholarLearningLibrary !== "on") return json({ error: "My Notebook is not offered here." }, 403);
  if (!notebookOffered(policy, await notebookSchema(ctx.admin))) return json({ error: "My Notebook is not available here yet." }, 409);
  return null;
}

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const u = new URL(req.url).searchParams;
  const sessionId = u.get("session") ?? "", step = Number(u.get("step"));
  if (!sessionId || !Number.isInteger(step) || step < 0 || step > 199) return json({ error: "Choose one lesson." }, 400);
  const r = await lessonNotes(ctx.admin, ctx.userId, { sessionId, step, chunkIds: (u.get("chunks") ?? "").split(",").filter(Boolean) });
  if (!r.ok) return json({ error: "Your notes could not be read just now." }, 503);
  return json({ notes: r.data });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const v = validateCreate(await req.json().catch(() => null));
  if (!v.ok) return json({ error: v.message, reason: v.problem }, 400);
  if ([v.note.body, v.note.title ?? "", v.note.tags.join(" ")].some(t => findPatientIdentifiers(t).length > 0)) return json({ error: NOTE_IDENTIFIER_REFUSAL, reason: "identifier" }, 422);
  const r = await createNotebookNote(ctx.admin, ctx.userId, v.note);
  if (!r.ok) {
    const [status, error] = r.error === "not_found" ? [404, "That lesson or section could not be found."] : r.error === "limit" ? [409, "You have reached the most notes that can be kept. Remove some to add more."] : [503, "Your note could not be saved just now."];
    return json({ error, reason: r.error }, status);
  }
  if (!r.existing) await audit(ctx, "individual_scholar_note_added", "individual_scholar_note", r.id, { kind: "note", target: v.note.context.link.targetKind, via: "notebook", capturedIn: v.note.context.capturedIn });
  return json({ ok: true, id: r.id, revision: r.revision, existing: r.existing, ...(r.stored ? { stored: r.stored } : {}) });
}
