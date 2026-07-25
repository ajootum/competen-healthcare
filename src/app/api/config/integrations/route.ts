import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadIntegrationMapper } from "@/lib/config/integration-mapper";

// NCP-010 §9 — GET /integrations. Returns the connector catalogue, the data sources referenced by registry
// objects and the data-source binding coverage (bound vs unbound configurable objects). Super-admin gated.
export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const d = await loadIntegrationMapper(c.admin);
  if (!d.provisioned) return NextResponse.json({ error: "Configuration registry not provisioned" }, { status: 409 });
  return NextResponse.json({ stats: d.stats, connectors: d.connectors, sources: d.sources, gap: d.gap });
}
