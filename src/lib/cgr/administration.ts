/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-015 — Competency Governance Platform Administration & Configuration.
// "How is the governance platform configured, maintained and operated safely over time?" The no-code governance
// configuration layer over real stores (deep platform admin stays owned by the control plane — cross-linked):
//   • cmo_config (mig 115) — governance configuration keys by category (scoring / workflow / approval / rules /
//     notification / ai / general), each local or INHERITED (§4.3 safe defaults / §6 hierarchy) + active status.
//   • cmo_ai_recommendations (mig 115) — advisory AI governance recommendations (§12) with category, confidence,
//     impact and status (open / accepted / dismissed).
// From them: the configuration inventory by category, the inherit-vs-override hierarchy, tenants configured, and
// the open AI recommendations. Configuration lifecycle (§8) is rendered as labelled reference. No migration.

type Admin = any;
const catLabel = (c: string) => (c === "ai" ? "AI" : (c || "general").replace(/^\w/, (x) => x.toUpperCase()));
const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function loadGovernanceAdmin(admin: Admin) {
  const [cfgRes, recRes] = await Promise.all([
    admin.from("cmo_config").select("config_key, name, category, source, status, hospital_id").limit(5000),
    admin.from("cmo_ai_recommendations").select("title, category, confidence, impact, status").limit(2000),
  ]);

  const cfg = (cfgRes.error ? [] : cfgRes.data ?? []) as any[];
  const rec = (recRes.error ? [] : recRes.data ?? []) as any[];

  const byCat = new Map<string, number>();
  const bySource: Record<string, number> = { inherited: 0, local: 0 };
  const byStatus: Record<string, number> = { active: 0, inactive: 0 };
  const tenants = new Set<string>();
  for (const c of cfg) {
    byCat.set(c.category || "general", (byCat.get(c.category || "general") ?? 0) + 1);
    if (c.source in bySource) bySource[c.source]++;
    if (c.status in byStatus) byStatus[c.status]++;
    if (c.hospital_id) tenants.add(c.hospital_id);
  }
  const categories = [...byCat.entries()].map(([category, count]) => ({ category, label: catLabel(category), count })).sort((a, b) => b.count - a.count);

  const recOpen = rec.filter((r) => r.status === "open");
  const byImpact: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const r of recOpen) if (r.impact in byImpact) byImpact[r.impact]++;
  const recList = recOpen
    .slice()
    .sort((a, b) => (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) || (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 10)
    .map((r) => ({ title: r.title, category: r.category, impact: r.impact, confidence: r.confidence != null ? Math.round(r.confidence * (r.confidence <= 1 ? 100 : 1)) : null }));

  return {
    provisioned: cfg.length > 0 || rec.length > 0,
    kpis: {
      configs: cfg.length,
      active: byStatus.active,
      local: bySource.local,
      inherited: bySource.inherited,
      tenants: tenants.size,
      recsOpen: recOpen.length,
      accepted: rec.filter((r) => r.status === "accepted").length,
    },
    categories,
    bySource,
    recommendations: { open: recOpen.length, byImpact, list: recList },
  };
}
