import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { lookupReferenceTargets, REFERENCE_TARGETS } from "@/lib/assessment/reference-targets";
import { loadReferenceKinds } from "@/lib/assessment/catalogue/relations";
import { plainError } from "@/lib/assessment/catalogue/db";

export const dynamic = "force-dynamic";

// GET /api/hq/assessment-catalogue/reference-targets  (hq.assessment.catalogue.manage)
//   no query     { targets, kinds }  what a reference can point at, and the reference kinds in the registry
//   ?key=&q=     up to 20 matches in that target's authoritative table. A reference stores the id and a label, never the row.
export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.assessment.catalogue.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  try {
    if (!key) return NextResponse.json({ targets: REFERENCE_TARGETS, kinds: await loadReferenceKinds(ctx.admin) });
    return NextResponse.json({ matches: await lookupReferenceTargets(ctx.admin, key, url.searchParams.get("q") ?? "") });
  } catch (e) {
    return NextResponse.json({ error: plainError(e) }, { status: 400 });
  }
}
