/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-105 — Competency Dependency Manager. Loads the competency↔competency sequencing graph
// (competency_dependencies, migration 128): prerequisite / co-requisite / recommended / inherited
// links. Resolves names, distribution and — importantly — detects prerequisite CYCLES (A requires B
// requires A), which would make progression impossible. Equivalency/recognition is a separate concern
// (competency_equivalencies, migration 123); its count is surfaced here only as a cross-reference.

const NONE = "00000000-0000-0000-0000-000000000000";

export const DEP_TYPES = ["prerequisite", "co_requisite", "recommended", "inherited"] as const;
export const DEP_LABEL: Record<string, string> = { prerequisite: "Prerequisite", co_requisite: "Co-requisite", recommended: "Recommended", inherited: "Inherited" };
export const DEP_COLOR: Record<string, string> = { prerequisite: "#3b82f6", co_requisite: "#f59e0b", recommended: "#14b8a6", inherited: "#8b5cf6" };

export type DepRow = { id: string; source: string; sourceCtx: string | null; target: string; targetCtx: string | null; type: string; notes: string | null; when: string | null };

// Cycle detection over the directed prerequisite graph (source requires target).
function findCycles(edges: { s: string; t: string }[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) { const a = adj.get(e.s) ?? []; a.push(e.t); adj.set(e.s, a); }
  const GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const dfs = (u: string) => {
    color.set(u, GRAY); stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const cv = color.get(v) ?? 0;
      if (cv === GRAY) { const i = stack.indexOf(v); if (i >= 0) cycles.push([...stack.slice(i), v]); }
      else if (cv !== BLACK) dfs(v);
    }
    color.set(u, BLACK); stack.pop();
  };
  for (const n of adj.keys()) if ((color.get(n) ?? 0) === 0) dfs(n);
  return cycles;
}

export async function loadDependencies(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("competency_dependencies").select("id, source_competency_id, target_competency_id, dependency_type, notes, created_at").order("created_at", { ascending: false }).limit(5000));
  if (res.error) return { provisioned: false as const };
  const deps = (res.data ?? []) as any[];

  // Cross-reference: equivalencies live in the recognition store (migration 123).
  let equivalencies = 0;
  try { const eq = await admin.from("competency_equivalencies").select("id", { count: "exact", head: true }); equivalencies = eq.count ?? 0; } catch { equivalencies = 0; }

  if (!deps.length) {
    return { provisioned: true as const, empty: true, kpis: { total: 0, prerequisite: 0, co_requisite: 0, recommended: 0, inherited: 0, sourced: 0, equivalencies, cycles: 0 }, distribution: [], rows: [] as DepRow[], cycles: [] as string[][] };
  }

  const ids = [...new Set(deps.flatMap(d => [d.source_competency_id, d.target_competency_id]).filter(Boolean))] as string[];
  const nameById = new Map<string, { name: string; ctx: string | null }>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin.from("framework_competencies").select("id, name, framework_domains(name, frameworks(name))").in("id", ids.slice(i, i + 500));
    for (const c of (data ?? []) as any[]) {
      const fw = c.framework_domains?.frameworks?.name ?? null;
      const dm = c.framework_domains?.name ?? null;
      nameById.set(c.id, { name: c.name, ctx: fw ?? dm });
    }
  }
  const nm = (id: string) => nameById.get(id)?.name ?? "Competency";
  const ctx = (id: string) => nameById.get(id)?.ctx ?? null;

  const rows: DepRow[] = deps.map(d => ({
    id: d.id,
    source: nm(d.source_competency_id), sourceCtx: ctx(d.source_competency_id),
    target: nm(d.target_competency_id), targetCtx: ctx(d.target_competency_id),
    type: d.dependency_type, notes: d.notes, when: d.created_at,
  }));

  const count = (t: string) => deps.filter(d => d.dependency_type === t).length;
  const distribution = DEP_TYPES.map(t => ({ type: t, label: DEP_LABEL[t], color: DEP_COLOR[t], n: count(t) })).filter(x => x.n > 0);

  // Cycles over prerequisite + inherited edges (both imply "must come before").
  const edges = deps.filter(d => d.dependency_type === "prerequisite" || d.dependency_type === "inherited").map(d => ({ s: d.source_competency_id, t: d.target_competency_id }));
  const cycleIds = findCycles(edges);
  const cycles = cycleIds.slice(0, 10).map(chain => chain.map(nm));

  const kpis = {
    total: deps.length,
    prerequisite: count("prerequisite"),
    co_requisite: count("co_requisite"),
    recommended: count("recommended"),
    inherited: count("inherited"),
    sourced: new Set(deps.map(d => d.source_competency_id)).size,
    equivalencies,
    cycles: cycles.length,
  };

  return { provisioned: true as const, empty: false, kpis, distribution, rows, cycles };
}
