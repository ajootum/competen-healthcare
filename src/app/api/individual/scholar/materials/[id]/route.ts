import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { deleteMaterial, signedOriginalUrl } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";

// /api/individual/scholar/materials/[id] -- COMPETEN-IND-004, the owner's own original and its erasure.
//
// GET redirects to a five-minute signed URL for the original file. DELETE erases the material: the
// stored object, then the row, which cascades to its chunks, questions, attempts and review cards.
// Both look the material up by the caller's own id, so another person's id answers 404, not 403 --
// nothing confirms that it exists.

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const url = await signedOriginalUrl(ctx.admin, ctx.userId, id);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(url, 303);
}

export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const r = await deleteMaterial(ctx.admin, ctx.userId, id);
  if (!r.found && r.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!r.ok) return NextResponse.json({ error: "That material could not be deleted just now. Nothing was removed. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_material_erased", "individual_scholar_material", id, {});
  return NextResponse.json({ ok: true });
}
