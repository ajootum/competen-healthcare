// Dependency Graph Service (NCP-000 §4 core component · §8 GET /config/dependencies · §10 "Dependency
// Analysis" pipeline stage). Builds the configuration dependency graph from the WCE-002 registry:
// containment edges (parent_object_key) + explicit dependency edges (dependencies jsonb). Provides
// impact analysis (transitive dependents = blast radius of a change), circular-dependency detection
// (a publish blocker) and broken-reference detection. Pure graph logic + a loader over the registry —
// no new store; consumed by the Dependency Explorer page and the /api/config/dependencies endpoint.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRegistry } from "@/lib/config/registry";

export type Adj = Map<string, Set<string>>;
const add = (m: Adj, k: string, v: string) => { let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(v); };

// Transitive closure — every node reachable from `start` along `adj` (excludes `start`).
export function transitiveClosure(adj: Adj | Record<string, string[]>, start: string): Set<string> {
  const get = (k: string): Iterable<string> => (adj instanceof Map ? (adj.get(k) ?? []) : (adj[k] ?? []));
  const out = new Set<string>(); const stack = [start];
  while (stack.length) { const n = stack.pop()!; for (const nb of get(n)) { if (nb !== start && !out.has(nb)) { out.add(nb); stack.push(nb); } } }
  return out;
}

// DFS circular-dependency detection — returns up to `limit` cycle paths (each a key array).
export function detectCycles(adj: Adj, limit = 12): string[][] {
  const GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const nodes = new Set<string>([...adj.keys()]);
  adj.forEach(s => s.forEach(v => nodes.add(v)));
  const visit = (u: string) => {
    if (cycles.length >= limit) return;
    color.set(u, GRAY); stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (cycles.length >= limit) break;
      const c = color.get(v);
      if (c === GRAY) { const i = stack.indexOf(v); if (i >= 0) cycles.push([...stack.slice(i), v]); }
      else if (c !== BLACK) visit(v);
    }
    stack.pop(); color.set(u, BLACK);
  };
  for (const n of nodes) if (!color.get(n)) visit(n);
  return cycles;
}

export async function loadDependencyGraph(admin: any) {
  const reg: any = await loadRegistry(admin);
  if (!reg.provisioned) return { provisioned: false as const };
  const objects = reg.objects as any[];
  const keys = new Set(objects.map(o => o.object_key));

  // "depends on" (A → B: A needs B) from parent containment + explicit dependencies, and its reverse.
  const dependsOn: Adj = new Map();
  const dependents: Adj = new Map();
  const broken: { from: string; to: string; kind: string }[] = [];
  for (const o of objects) {
    const refs: { to: string; kind: string }[] = [];
    if (o.parent_object_key) refs.push({ to: o.parent_object_key, kind: "parent" });
    for (const d of (Array.isArray(o.dependencies) ? o.dependencies : [])) {
      const dk = typeof d === "string" ? d : d?.objectKey ?? d?.object_key;
      if (typeof dk === "string") refs.push({ to: dk, kind: "dependency" });
    }
    for (const { to, kind } of refs) {
      if (to === o.object_key) continue;
      if (keys.has(to)) { add(dependsOn, o.object_key, to); add(dependents, to, o.object_key); }
      else broken.push({ from: o.object_key, to, kind });
    }
  }

  let edges = 0; dependsOn.forEach(s => edges += s.size);
  const cycles = detectCycles(dependsOn);

  // Blast radius per node — transitive dependents (who is affected if this object changes).
  const label = (k: string) => reg.objects.find((o: any) => o.object_key === k)?.display_name ?? k;
  const topImpact = objects
    .map(o => ({ key: o.object_key, label: o.display_name ?? o.object_key, type: o.object_type, safety: o.safety_classification, impact: transitiveClosure(dependents, o.object_key).size }))
    .filter(o => o.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 8);

  // Orphaned / isolated objects — depend on nothing and nothing depends on them (candidates to wire or retire).
  const orphans = objects
    .filter(o => !dependsOn.has(o.object_key) && !dependents.has(o.object_key) && !["PLATFORM", "PRODUCT_SUITE", "WORKSPACE"].includes(o.object_type))
    .map(o => ({ key: o.object_key, label: o.display_name ?? o.object_key, type: o.object_type, status: o.status }));

  // Serialise for the client explorer.
  const nodes = objects.map(o => ({ key: o.object_key, label: o.display_name ?? o.object_key, type: o.object_type, status: o.status, safety: o.safety_classification, cls: o.configurability_class }));
  const dependsObj: Record<string, string[]> = {}; dependsOn.forEach((s, k) => { dependsObj[k] = [...s]; });
  const dependentsObj: Record<string, string[]> = {}; dependents.forEach((s, k) => { dependentsObj[k] = [...s]; });

  const stats = {
    nodes: objects.length, edges, cycles: cycles.length, broken: broken.length,
    roots: objects.filter(o => !dependsOn.has(o.object_key)).length,     // depend on nothing (top of the tree)
    leaves: objects.filter(o => !dependents.has(o.object_key)).length,   // nothing depends on them (safe to change)
    maxImpact: topImpact[0]?.impact ?? 0,
    orphans: orphans.length,
  };

  return {
    provisioned: true as const, stats, cycles: cycles.map(c => c.map(label)), cycleKeys: cycles,
    broken: broken.slice(0, 20), topImpact, orphans: orphans.slice(0, 30), nodes, dependsOn: dependsObj, dependents: dependentsObj,
  };
}

// Publish gate (NCP-000 §10 "Dependency Analysis") — a change may not be published if the configuration
// graph leaves a circular dependency or a broken reference. Scoped to the change's affected objects when
// declared, else evaluated globally (a CR with no declared scope is treated conservatively). Fail-open when
// the registry is not provisioned — governance should not be blocked by an absent graph.
export async function dependencyGate(admin: any, affectedKeys: string[]): Promise<{ ok: boolean; cycles: string[][]; broken: { from: string; to: string; kind: string }[]; reason?: string }> {
  const g = await loadDependencyGraph(admin);
  if (!g.provisioned) return { ok: true, cycles: [], broken: [] };
  const affected = new Set((affectedKeys ?? []).filter(Boolean));
  const touchesCycle = (c: string[]) => affected.size === 0 || c.some(k => affected.has(k));
  const touchesBroken = (b: { from: string; to: string }) => affected.size === 0 || affected.has(b.from) || affected.has(b.to);
  const cycles = g.cycleKeys.filter(touchesCycle);
  const broken = g.broken.filter(touchesBroken);
  const ok = cycles.length === 0 && broken.length === 0;
  const reason = ok ? undefined : [cycles.length ? `${cycles.length} circular dependency chain(s)` : null, broken.length ? `${broken.length} broken reference(s)` : null].filter(Boolean).join(" + ");
  return { ok, cycles, broken, reason };
}
