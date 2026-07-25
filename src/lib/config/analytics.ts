// Configuration Analytics & Optimisation Centre (NCP-013) — continuous analytics over the configuration estate,
// computed entirely from existing stores (registry + audit + version snapshots + dependency graph + governance).
// No new store. Produces inventory, a weighted health score per object + overall, unused-asset detection,
// dependency hotspots, change churn, activity trend, approval cycle time and rule-based (explainable)
// optimisation recommendations. Read-only; consumed by the analytics page + executive view.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadDependencyGraph } from "@/lib/config/dependency-graph";

const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const AUTHORABLE_CONTENT = new Set(["METRIC", "FORM", "BUSINESS_RULE", "PAGE", "WORKFLOW", "DASHBOARD", "REPORT", "PERMISSION", "NAVIGATION_SECTION"]);
const CRITICAL = new Set(["clinical_safety_critical", "security_critical", "regulatory_critical", "financial_control_critical", "clinical_safety_relevant"]);
const SETTLED = new Set(["approved", "published", "active"]);
const round = (n: number) => Math.round(n);
const tally = (arr: any[], key: string) => { const m: Record<string, number> = {}; for (const o of arr) { const k = o[key] ?? "—"; m[k] = (m[k] ?? 0) + 1; } return m; };

export async function loadConfigAnalytics(admin: any) {
  const { data: objs, error } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, status, safety_classification, configurability_class, source, definition, created_at, updated_at").limit(5000);
  if (error && missing(error)) return { provisioned: false as const };
  const objects = (objs ?? []) as any[];

  const graph: any = await loadDependencyGraph(admin);
  const brokenFrom = new Set<string>(graph.provisioned ? graph.broken.map((b: any) => b.from) : []);
  const cycleNodes = new Set<string>(graph.provisioned ? graph.cycleKeys.flat() : []);
  const dependents: Record<string, string[]> = graph.provisioned ? graph.dependents : {};

  const emptyDef = (o: any) => AUTHORABLE_CONTENT.has(o.object_type) && (!o.definition || Object.keys(o.definition).length === 0);

  // Weighted health score per object (0–100) with explainable reasons.
  const scored = objects.map(o => {
    let s = 100; const reasons: string[] = [];
    if (brokenFrom.has(o.object_key)) { s -= 40; reasons.push("broken dependency"); }
    if (cycleNodes.has(o.object_key)) { s -= 30; reasons.push("in a dependency cycle"); }
    if (emptyDef(o)) { s -= 25; reasons.push("no definition"); }
    if (o.status === "draft") { s -= 10; reasons.push("still draft"); }
    if (CRITICAL.has(o.safety_classification) && !SETTLED.has(o.status)) { s -= 15; reasons.push("safety-critical, not approved"); }
    return { key: o.object_key, name: o.display_name, type: o.object_type, score: Math.max(0, s), reasons };
  });
  const overall = objects.length ? round(scored.reduce((a, b) => a + b.score, 0) / scored.length) : 100;
  const dist = { healthy: scored.filter(s => s.score >= 80).length, watch: scored.filter(s => s.score >= 50 && s.score < 80).length, atRisk: scored.filter(s => s.score < 50).length };
  const worst = [...scored].filter(s => s.score < 100).sort((a, b) => a.score - b.score).slice(0, 10);

  // Inventory / adoption.
  const authorable = objects.filter(o => AUTHORABLE_CONTENT.has(o.object_type));
  const defined = authorable.filter(o => !emptyDef(o)).length;
  const inventory = {
    total: objects.length,
    byType: Object.entries(tally(objects, "object_type")).sort((a, b) => b[1] - a[1]),
    byStatus: Object.entries(tally(objects, "status")).sort((a, b) => b[1] - a[1]),
    bySource: Object.entries(tally(objects, "source")).sort((a, b) => b[1] - a[1]),
    studioAuthored: objects.filter(o => o.source === "studio").length,
    definitionRate: authorable.length ? round((defined / authorable.length) * 100) : 100,
    authorable: authorable.length, defined,
  };

  // Unused assets — nothing depends on them and still draft (excludes container modules / nav entry points).
  const unused = objects
    .filter(o => !(dependents[o.object_key]?.length) && o.status === "draft" && !["MODULE", "NAVIGATION_SECTION"].includes(o.object_type))
    .map(o => ({ key: o.object_key, name: o.display_name, type: o.object_type })).slice(0, 12);

  // Change churn — most-snapshotted objects.
  let churn: { key: string; name: string; versions: number }[] = [];
  try {
    const { data: snaps } = await admin.from("configuration_version_snapshots").select("object_key").limit(20000);
    const c = tally(snaps ?? [], "object_key");
    const nameOf = (k: string) => objects.find(o => o.object_key === k)?.display_name ?? k;
    churn = Object.entries(c).map(([key, versions]) => ({ key, name: nameOf(key), versions: versions as number })).sort((a, b) => b.versions - a.versions).slice(0, 8);
  } catch { /* snapshots optional */ }

  // Activity trend — registry audit over the last 14 days (+ 7d vs prior-7d momentum).
  let activity: any = { total: 0, byAction: [], series: [], last7: 0, prev7: 0 };
  try {
    const { data: aud } = await admin.from("configuration_registry_audit").select("action, created_at").order("created_at", { ascending: false }).limit(5000);
    const rows = aud ?? [];
    const now = Date.now(); const day = 86400000;
    const series = Array.from({ length: 14 }, (_, i) => ({ d: 13 - i, n: 0 }));
    let last7 = 0, prev7 = 0;
    for (const r of rows) {
      const age = (now - new Date(r.created_at).getTime()) / day;
      if (age < 14) { const idx = 13 - Math.floor(age); if (series[idx]) series[idx].n++; }
      if (age < 7) last7++; else if (age < 14) prev7++;
    }
    activity = { total: rows.length, byAction: Object.entries(tally(rows, "action")).sort((a, b) => b[1] - a[1]), series: series.map(s => s.n), last7, prev7 };
  } catch { /* audit optional */ }

  // Approval cycle time — mean days from CR creation to settle, for settled CRs.
  let cycleTime: any = { provisioned: false };
  try {
    const { data: crs, error: cErr } = await admin.from("configuration_change_requests").select("status, created_at, updated_at").limit(2000);
    if (!cErr) {
      const settled = (crs ?? []).filter((c: any) => ["approved", "published", "verified", "closed"].includes(c.status));
      const days: number[] = settled.map((c: any) => (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 86400000).filter((d: number) => d >= 0);
      cycleTime = { provisioned: true, settled: settled.length, avgDays: days.length ? Math.round((days.reduce((a: number, b: number) => a + b, 0) / days.length) * 10) / 10 : 0, open: (crs ?? []).length - settled.length };
    }
  } catch { /* governance optional */ }

  // Rule-based optimisation recommendations (explainable — not an opaque model).
  const draftsNoDeps = unused.length;
  const emptyCount = authorable.length - defined;
  const criticalUnsettled = objects.filter(o => CRITICAL.has(o.safety_classification) && !SETTLED.has(o.status)).length;
  const recommendations: { severity: string; title: string; why: string; href: string }[] = [];
  if (graph.provisioned && graph.stats.broken > 0) recommendations.push({ severity: "high", title: `Fix ${graph.stats.broken} broken dependency reference(s)`, why: "Objects reference config that no longer exists — runtime resolution and packaging will fail.", href: "/super-admin/platform-ops/dependencies" });
  if (graph.provisioned && graph.stats.cycles > 0) recommendations.push({ severity: "high", title: `Break ${graph.stats.cycles} circular dependency chain(s)`, why: "Cycles block deterministic resolution and safe publishing.", href: "/super-admin/platform-ops/dependencies" });
  if (criticalUnsettled > 0) recommendations.push({ severity: "high", title: `Review ${criticalUnsettled} safety-critical object(s) not yet approved`, why: "Safety- or regulatory-critical objects should pass governance before use.", href: "/super-admin/platform-ops/governance" });
  if (emptyCount > 0) recommendations.push({ severity: "medium", title: `Complete ${emptyCount} authorable object(s) with no definition`, why: "They exist in the registry but their designer body is empty.", href: "/super-admin/platform-ops/studio" });
  if (draftsNoDeps > 0) recommendations.push({ severity: "medium", title: `Publish or retire ${draftsNoDeps} unused draft(s)`, why: "Nothing depends on them and they were never published.", href: "/super-admin/platform-ops/governance" });
  if (!recommendations.length) recommendations.push({ severity: "low", title: "No structural issues detected", why: "No broken refs, cycles, empty definitions or unreviewed critical objects.", href: "/super-admin/platform-ops/dependencies" });

  return {
    provisioned: true as const, inventory,
    health: { overall, dist, worst },
    unused, hotspots: graph.provisioned ? graph.topImpact : [], churn, activity, cycleTime, recommendations,
    graphStats: graph.provisioned ? graph.stats : null,
  };
}
