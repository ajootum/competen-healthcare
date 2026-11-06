import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal, type IndividualContext } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";
import { NOTE_IDENTIFIER_REFUSAL, PROBLEM, validatePatch } from "@/lib/individual/scholar/personal-notebook";
import { notebookOffered, notebookSchema, updateNotebookNote } from "@/lib/individual/scholar/personal-notebook-store";
import { deleteNote } from "@/lib/individual/scholar/store";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/notebook/notes/[id] -- COMPETEN-NOTEBOOK-001 P1, migration 1000.
//   PATCH  { expectedRevision, body?, title?, tags?, pinned?, link?, sectionLabel?, sectionAnchor?, competencyId?, studyId? }
//          autosave and organising. 409 { conflict, current } when the note changed since that revision: nothing is overwritten unseen
//   DELETE removes it, at the learner's own request
// Their own rows only. Nothing here calls a model. An autosave is not audited, since it is the learner typing. Moving a link, pinning and
// removing are, by code only, never a note's words.

const noStore = { "Cache-Control": "private, no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: noStore });

async function gate(ctx: IndividualContext): Promise<NextResponse | null> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarPersonalNotebook !== "on" || policy.scholarLearningLibrary !== "on") return json({ error: "My Notebook is not offered here." }, 403);
  if (!notebookOffered(policy, await notebookSchema(ctx.admin))) return json({ error: "My Notebook is not available here yet." }, 409);
  return null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const { id } = await params;
  const v = validatePatch(await req.json().catch(() => null));
  if (!v.ok) return json({ error: v.message }, 400);
  const p = v.patch;
  if ([p.body ?? "", p.title ?? "", (p.tags ?? []).join(" ")].some(t => findPatientIdentifiers(t).length > 0)) return json({ error: NOTE_IDENTIFIER_REFUSAL, reason: "identifier" }, 422);
  // A framework competency is not a learner row, so 1000 keeps it as a hint: only one the learner can see may be linked.
  if (p.competencyId) {
    const list = (await loadLearnerCatalogue(ctx.admin, ctx.userId)).competencies;
    if (!list?.some(c => c.id === p.competencyId)) return json({ error: PROBLEM.target }, 404);
  }
  const r = await updateNotebookNote(ctx.admin, ctx.userId, id, p);
  if (!r.ok) {
    if (r.error === "conflict") return json({ conflict: true, current: r.current, error: "This note was changed somewhere else." }, 409);
    if (r.error === "not_found") return json({ error: "That note could not be found.", reason: "not_found" }, 404);
    if (r.error === "invalid") return json({ error: "That cannot be saved on this note.", reason: "invalid" }, 422);
    return json({ error: "Your note could not be saved just now." }, 503);
  }
  if (p.link || p.pinned !== undefined) await audit(ctx, "individual_scholar_note_changed", "individual_scholar_note", id, { ...(p.link ? { target: p.link.targetKind } : {}), ...(p.pinned !== undefined ? { pinned: p.pinned } : {}) });
  return json({ ok: true, id: r.id, revision: r.revision });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const { id } = await params;
  const r = await deleteNote(ctx.admin, ctx.userId, id);
  if (r !== "ok") return json({ error: r === "not_found" ? "That note could not be found." : "That could not be removed just now." }, r === "not_found" ? 404 : 503);
  await audit(ctx, "individual_scholar_note_removed", "individual_scholar_note", id, { via: "notebook" });
  return json({ ok: true });
}
