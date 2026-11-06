import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { platformSearch, MAX_RAW_QUERY } from "@/lib/platform/search";

// Platform Search Service API (PFS-000 Search / PCS-000 Search Index). GET ?q=<term>
// runs one unified cross-entity search over the Postgres store and returns results
// grouped by type, each with a deep link. Fail-soft.
//
// HQ-PLATFORM-SEARCH-REGATE: the verb is admitted by the UNION of the capabilities that govern each source's own
// page; platformSearch then reads ONLY the sources the caller holds (ctx.capabilities), and the owner reads all.
//   Tenants / Workspaces  hq.platform.operations.view  (platform-ops/tenants, platform-ops/workspaces)
//   Organisations         hq.platform.tenants.view     (organisations, hospitals)
//   Users                 hq.platform.users.view       (users)
//   Frameworks            hq.learning.competencies.view (competencies)
//   Activity              hq.platform.audit.view       (audit)
//   Competencies          owner only (no page found that governs framework_competencies names)
// Rate limiting: the repo has no shared rate-limit helper, so none is applied here (see the evidence README).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await hqApiGate([
    "hq.platform.operations.view",
    "hq.platform.tenants.view",
    "hq.platform.users.view",
    "hq.learning.competencies.view",
    "hq.platform.audit.view",
  ]);
  if (isHqRefusal(ctx)) return ctx;

  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length > MAX_RAW_QUERY)
    return NextResponse.json({ error: "Search term is too long" }, { status: 400 });
  const result = await platformSearch(ctx.admin, q, { isOwner: ctx.isOwner, capabilities: ctx.capabilities });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
