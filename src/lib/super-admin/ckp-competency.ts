// Competency & Framework Centre (CKP-001.2) loader — the competency architecture
// dashboard. Aggregates frameworks (by library), domains, practices and
// competencies, and derives per-framework competency counts + CPU-mapping
// coverage, a domain hierarchy, and crosswalk/mapping totals. Version columns
// are read best-effort (isolated query) so a schema variance can't blank the
// page. Live counts; fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);

export async function loadCompetencyCentre(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });

  const [frRes, verRes, domRes, compRes, pracCount, edgeCount, cycleRes] = await Promise.all([
    admin.from("frameworks").select("id, name, code, library, is_active, review_date").order("name").limit(1000),
    admin.from("frameworks").select("id, version_major, version_minor"), // best-effort version
    admin.from("framework_domains").select("id, framework_id, name").limit(5000),
    admin.from("framework_competencies").select("domain_id, cpu_id").limit(30000),
    head("practices"),
    head("knowledge_edges"),
    admin.from("competency_cycles").select("*", { count: "exact", head: true }).eq("status", "active"),
  ]);

  const frameworks = (frRes.error ? [] : frRes.data ?? []) as any[];
  const domains = (domRes.error ? [] : domRes.data ?? []) as any[];
  const comps = (compRes.error ? [] : compRes.data ?? []) as any[];
  const verMap = new Map<string, any>((verRes.error ? [] : verRes.data ?? []).map((v: any) => [v.id, v]));

  // domain → framework, and per-domain / per-framework competency + mapping tallies.
  const domFramework = new Map<string, string>(domains.map(d => [d.id, d.framework_id]));
  const domName = new Map<string, string>(domains.map(d => [d.id, d.name]));
  const domCount = new Map<string, number>();
  const frCount = new Map<string, number>();
  const frMapped = new Map<string, number>();
  let totalMapped = 0;
  for (const c of comps) {
    domCount.set(c.domain_id, (domCount.get(c.domain_id) ?? 0) + 1);
    const fid = domFramework.get(c.domain_id);
    if (fid) { frCount.set(fid, (frCount.get(fid) ?? 0) + 1); if (c.cpu_id) { frMapped.set(fid, (frMapped.get(fid) ?? 0) + 1); totalMapped++; } }
  }

  const ver = (id: string) => { const v = verMap.get(id); return v ? `v${v.version_major ?? 1}.${v.version_minor ?? 0}` : null; };
  const frameworkOverview = frameworks
    .map(f => { const n = frCount.get(f.id) ?? 0; const m = frMapped.get(f.id) ?? 0; return { id: f.id, name: f.name, library: f.library, version: ver(f.id), competencies: n, coverage: n ? Math.round((m / n) * 100) : 0 }; })
    .sort((a, b) => b.competencies - a.competencies).slice(0, 8);

  const domainHierarchy = domains
    .map(d => ({ id: d.id, name: d.name, framework: frameworks.find(f => f.id === d.framework_id)?.name ?? null, competencies: domCount.get(d.id) ?? 0 }))
    .sort((a, b) => b.competencies - a.competencies).slice(0, 10);

  const byLibrary = { core: frameworks.filter(f => f.library === "core").length, specialty: frameworks.filter(f => f.library === "specialty").length, role: frameworks.filter(f => f.library === "role").length };
  const totalComp = comps.length;

  return {
    kpis: {
      competencies: totalComp,
      frameworks: frameworks.length,
      frameworksActive: frameworks.filter(f => f.is_active).length,
      domains: domains.length,
      practices: num(pracCount) ?? 0,
      core: byLibrary.core, specialty: byLibrary.specialty, role: byLibrary.role,
      coverage: totalComp ? Math.round((totalMapped / totalComp) * 100) : null,
    },
    frameworkOverview,
    domainHierarchy,
    byLibrary,
    mapping: { mappings: totalMapped, crosswalks: num(edgeCount) ?? 0, unmapped: totalComp - totalMapped, activeCycles: num(cycleRes) ?? 0 },
    generatedAt: new Date().toISOString(),
  };
}
