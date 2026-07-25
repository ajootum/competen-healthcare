import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadDependencyGraph, transitiveClosure } from "@/lib/config/dependency-graph";

// NCP-000 §8 — GET /config/dependencies. Returns the configuration dependency graph (stats, circular
// dependencies, broken references, highest-blast-radius objects). With ?object=<key> it returns that
// object's upstream dependencies + downstream impact (direct and transitive). Super-admin gated.
export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const g = await loadDependencyGraph(c.admin);
  if (!g.provisioned) return NextResponse.json({ error: "Configuration registry not provisioned" }, { status: 409 });

  const key = new URL(req.url).searchParams.get("object");
  if (key) {
    return NextResponse.json({
      object: key,
      dependsOn: g.dependsOn[key] ?? [],
      dependents: g.dependents[key] ?? [],
      transitiveDependsOn: [...transitiveClosure(g.dependsOn, key)],
      impact: [...transitiveClosure(g.dependents, key)],
    });
  }
  return NextResponse.json({ stats: g.stats, cycles: g.cycles, broken: g.broken, topImpact: g.topImpact });
}
