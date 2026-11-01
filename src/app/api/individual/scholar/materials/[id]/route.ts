import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { deleteMaterial, fileMaterial, questionIdsOfMaterial, renameMaterial, signedOriginalUrl } from "@/lib/individual/scholar/store";
import { withdrawCasesOf } from "@/lib/individual/scholar/clinical-routes";
import { cleanTitle } from "@/lib/individual/scholar/library";
import { audit } from "@/lib/individual/scholar/http";
import { withdrawOffersOfQuestions } from "@/lib/question-offers/offers";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/materials/[id] -- COMPETEN-IND-004, the owner's own original and its erasure.
//
// GET redirects to a five-minute signed URL for the original file. DELETE erases the material: the
// stored object, then the row, which cascades to its chunks, questions, attempts and review cards.
// Both look the material up by the caller's own id, so another person's id answers 404, not 403 --
// nothing confirms that it exists.
// PATCH (UPLOAD-01 U5) renames it ({ title }) or puts it on one of the caller's collections ({ collectionId },
// null to take it off). The same own-id lookup: another person's material or collection answers 404.

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const url = await signedOriginalUrl(ctx.admin, ctx.userId, id);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(url, 303);
}

export async function PATCH(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const body = await req.json().catch(() => ({}));
  const changed: string[] = [];
  if (body?.title !== undefined) {
    const t = cleanTitle(body.title);
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 400 });
    const r = await renameMaterial(ctx.admin, ctx.userId, id, t.value);
    if (r === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (r === "failed") return NextResponse.json({ error: "The new name could not be saved just now. Try again shortly." }, { status: 500 });
    changed.push("title");
  }
  if (body?.collectionId !== undefined) {
    const r = await fileMaterial(ctx.admin, ctx.userId, id, body.collectionId === null ? null : String(body.collectionId));
    if (r === "not_found") return NextResponse.json({ error: "That material or collection could not be found." }, { status: 404 });
    if (r === "failed") return NextResponse.json({ error: "The material could not be moved just now. Try again shortly." }, { status: 500 });
    changed.push("collection");
  }
  if (!changed.length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  await audit(ctx, "individual_scholar_material_organised", "individual_scholar_material", id, { changed });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  // CLINICAL-REASONING-01 C-e: cases written from it are withdrawn from the shared library first.
  const withdrawn = await withdrawCasesOf(ctx.admin, ctx.userId, id);
  // SQIE-LIBRARY-GAPS-01 (802): and every question offered to the Competen library from it that is not yet taken in (its
  // content is purged, as the learner's own withdrawal does). A taken or promoted offer is the educator's own draft and stays.
  const qIds = await questionIdsOfMaterial(ctx.admin, ctx.userId, id);
  const offers = qIds?.length ? await withdrawOffersOfQuestions(ctx.admin, ctx.userId, qIds) : { withdrawn: 0, failed: qIds === null ? 1 : 0 };
  const r = await deleteMaterial(ctx.admin, ctx.userId, id);
  if (!r.found && r.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!r.ok) return NextResponse.json({ error: "That material could not be deleted just now. Nothing was removed. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_material_erased", "individual_scholar_material", id, { case_candidates_withdrawn: withdrawn.withdrawn, case_withdrawals_failed: withdrawn.failed, question_offers_withdrawn: offers.withdrawn, question_offer_withdrawals_failed: offers.failed });
  return NextResponse.json({ ok: true });
}
