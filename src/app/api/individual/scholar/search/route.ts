import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isMyPlanOn, loadIndividualPolicy } from "@/lib/individual/policy";
import { globalSearch, parseGlobalQuery } from "@/lib/individual/scholar/global-search";
import { scholarModulesFor } from "@/lib/individual/scholar/module-access";
import { librarySchema, studyPlanSchema } from "@/lib/individual/scholar/store";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/search?q= -- COMPETEN UNIVERSAL SEARCH STANDARD: Global Search across Scholar, for the signed-in
// learner's own records and only the modules they may see (the registry's rule, decided here, before anything is read).
// No AI, nothing kept: what is typed here is not recorded by this route. Off until HQ publishes scholar_global_search.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarGlobalSearch !== "on") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const q = parseGlobalQuery(new URL(req.url).searchParams.get("q"));
  if (!q) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });
  const [provisioned, saved, modules] = await Promise.all([
    studyPlanSchema(ctx.admin, ctx.userId), librarySchema(ctx.admin, ctx.userId), scholarModulesFor(ctx.admin, ctx.userId, policy),
  ]);
  const groups = await globalSearch(ctx, { planOn: isMyPlanOn(policy, provisioned), savedOn: policy.scholarLearningLibrary === "on" && saved, modules }, q);
  return NextResponse.json({ q, groups }, { headers: { "Cache-Control": "no-store" } });
}
