import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/professional/validate";
import { signDocument } from "@/lib/individual/professional/documents";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// GET /api/individual/professional/documents?type=cpd|evidence&id=<uuid> -- the ONLY download path for a
// document attached to a Professional record (migration 373 s7).
//
// The owner, and nobody else: the row is matched on id AND the caller's user id, and only then is a
// five-minute signed URL issued. There is no verifier or hospital path, unlike the estate evidence route.
//
// ⚠ GATE 3 ONLY, NOT THE PROFESSIONAL ENTITLEMENT. The record belongs to the person (COMPETEN-IND-002
// s5.1): someone whose Professional period ended can still open their own certificate from the Passport.

const TABLE = { cpd: "individual_professional_cpd", evidence: "individual_professional_evidence" } as const;

export async function GET(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  if ((type !== "cpd" && type !== "evidence") || !isUuid(id)) return NextResponse.json({ error: "Choose a document." }, { status: 400 });

  const { data: row } = await ctx.admin.from(TABLE[type]).select("document_path").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!row?.document_path) return NextResponse.json({ error: "That document is not on your record." }, { status: 404 });
  const signed = await signDocument(ctx.admin, row.document_path);
  if (!signed) return NextResponse.json({ error: "The document could not be opened just now. Try again shortly." }, { status: 503 });
  return NextResponse.redirect(signed, { status: 303 });
}
