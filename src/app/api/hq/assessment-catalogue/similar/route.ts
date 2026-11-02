import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { findSimilar } from "@/lib/assessment/catalogue/similar";
import { plainError } from "@/lib/assessment/catalogue/db";

export const dynamic = "force-dynamic";

// GET /api/hq/assessment-catalogue/similar?title=&family=  (hq.assessment.catalogue.manage)
// The duplicate warning shown before an identity is registered. It never blocks: two instruments may share a title when
// their family or method differs. Returns at most five candidates, same family first.
export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.assessment.catalogue.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const url = new URL(req.url);
  const title = (url.searchParams.get("title") ?? "").slice(0, 200);
  const family = (url.searchParams.get("family") ?? "").toUpperCase();
  try {
    return NextResponse.json({ similar: await findSimilar(ctx.admin, title, /^[A-Z]{1,6}$/.test(family) ? family : null) });
  } catch (e) {
    return NextResponse.json({ error: plainError(e) }, { status: 500 });
  }
}
