import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { eraseAllMaterial } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";

// POST /api/individual/scholar/erase -- COMPETEN-IND-002 s3.3: "Personal material is private to its owner
// and erasable by them." Erases every Scholar material the caller owns, and everything derived from it.
// Body { confirm: "ERASE" }, so an accidental request does nothing.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "ERASE") return NextResponse.json({ error: "Confirm the erasure." }, { status: 400 });
  const r = await eraseAllMaterial(ctx.admin, ctx.userId);
  if (!r.ok) return NextResponse.json({ error: "Your material could not be erased just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_material_erased_all", "individual_scholar_material", null, { erased: r.erased });
  return NextResponse.json({ ok: true, erased: r.erased });
}
