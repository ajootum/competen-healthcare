import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { parseProfessionalQuery, professionalGlobalSearch } from "@/lib/individual/professional/global-search";
import { PROFESSIONAL_SEARCH_MODULES, type ProfessionalSearchKey } from "@/lib/individual/search/registry-professional";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/individual/professional/search?q= -- COMPETEN UNIVERSAL SEARCH STANDARD: Global Search across Professional, for the signed-in
// professional's own records and only the modules Professional lists (decided here, before anything is read). It reads no Scholar record.
// No AI, nothing kept: what is typed here is not recorded by this route. Off until HQ publishes professional_global_search.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.professionalGlobalSearch !== "on") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const q = parseProfessionalQuery(new URL(req.url).searchParams.get("q"));
  if (!q) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });
  const listed = new Set(EXPERIENCES.professional.modules.map(m => m.segment));
  const modules = new Set<ProfessionalSearchKey>(PROFESSIONAL_SEARCH_MODULES.filter(m => listed.has(m.segment)).map(m => m.key));
  const groups = await professionalGlobalSearch(ctx, { modules }, q);
  return NextResponse.json({ q, groups }, { headers: { "Cache-Control": "no-store" } });
}
