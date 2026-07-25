import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadDependencyGraph, transitiveClosure } from "@/lib/config/dependency-graph";

// NCP-017 Configuration Dependency Manager (also NCP-000 §8). GET returns the dependency graph (stats, circular
// dependencies, broken references, orphans, highest-blast-radius); with ?object=<key> that object's upstream +
// downstream impact. POST adds the spec's analyze (impact + safe-delete for a change) and validate (all
// dependency violations) endpoints. Super-admin gated.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const g: any = await loadDependencyGraph((c as any).admin);
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
  return NextResponse.json({ stats: g.stats, cycles: g.cycles, broken: g.broken, orphans: g.orphans, topImpact: g.topImpact });
}

// POST — analyze (change/delete impact for one object) | validate (all dependency violations, deployment guard).
export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const g: any = await loadDependencyGraph((c as any).admin);
  if (!g.provisioned) return NextResponse.json({ error: "Configuration registry not provisioned" }, { status: 409 });
  const b = await req.json().catch(() => ({}));

  if (b.action === "validate") {
    return NextResponse.json({
      ok: g.stats.cycles === 0 && g.stats.broken === 0,
      cycles: g.cycles, broken: g.broken, orphans: g.orphans,
      summary: { cycles: g.stats.cycles, broken: g.stats.broken, orphans: g.stats.orphans },
    });
  }
  if (b.action === "analyze") {
    const key = String(b.object ?? "");
    if (!g.dependsOn[key] && !g.dependents[key] && !g.nodes.find((n: any) => n.key === key)) return badRequest("Object not found in the graph");
    const impact = [...transitiveClosure(g.dependents, key)];
    const label = (k: string) => g.nodes.find((n: any) => n.key === k)?.label ?? k;
    return NextResponse.json({
      object: key,
      dependsOn: g.dependsOn[key] ?? [],
      impactDirect: g.dependents[key] ?? [],
      impactTransitive: impact,
      blastRadius: impact.length,
      safeToDelete: (g.dependents[key] ?? []).length === 0,
      breaks: impact.map(label),
    });
  }
  return badRequest("Unknown action — use analyze | validate");
}
