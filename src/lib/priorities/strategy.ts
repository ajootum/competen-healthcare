// PPE-001 Organizational Objectives & Strategy Manager loader. The authoritative strategy view over the PPE stores:
// strategic themes with rolled-up objective progress, the objectives/OKR register (enriched with theme, owner, scope
// label and key results), the cascade/alignment tree (platform objectives → their lower-scope children via
// parent_id), a KPI/key-result rollup and a governance snapshot (pending approvals + recent audit). Read model.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchFramework, scopeName, SCOPE_ORDER } from "./engine";

export async function loadStrategyManager(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { themes, objectives, keyResults, priorities, campaigns, approvals, audit, nameByRef, ownerById } = f;

  const krByObj = new Map<string, any[]>();
  keyResults.forEach(k => { const a = krByObj.get(k.objective_id) ?? []; a.push(k); krByObj.set(k.objective_id, a); });

  // Enrich objectives.
  const objById = new Map(objectives.map(o => [o.id, o]));
  const enriched = objectives.map(o => ({
    ...o,
    themeName: themes.find(t => t.id === o.theme_id)?.name ?? null,
    themeColor: themes.find(t => t.id === o.theme_id)?.color ?? "#94a3b8",
    ownerName: o.owner_id ? (ownerById.get(o.owner_id) ?? "—") : "—",
    scopeLabel: scopeName(o.scope_type, o.scope_ref, nameByRef),
    parentTitle: o.parent_id ? (objById.get(o.parent_id)?.title ?? null) : null,
    krs: krByObj.get(o.id) ?? [],
  }));

  // Theme cards with rolled-up progress.
  const themeCards = themes.map(t => {
    const objs = objectives.filter(o => o.theme_id === t.id);
    const published = objs.filter(o => o.status === "published");
    const avg = published.length ? Math.round(published.reduce((a, o) => a + Number(o.progress_pct || 0), 0) / published.length) : 0;
    return { id: t.id, name: t.name, description: t.description, color: t.color, icon: t.icon, objectives: objs.length, published: published.length, priorities: priorities.filter(p => p.theme_id === t.id).length, campaigns: campaigns.filter(c => c.theme_id === t.id).length, progress: avg };
  });

  // Cascade/alignment tree: platform (root) objectives → lower-scope children.
  const roots = enriched.filter(o => !o.parent_id && (SCOPE_ORDER[o.scope_type] ?? 0) <= 1).sort((a, b) => (SCOPE_ORDER[a.scope_type] ?? 0) - (SCOPE_ORDER[b.scope_type] ?? 0));
  const cascade = roots.map(r => ({ ...r, children: enriched.filter(o => o.parent_id === r.id) }));
  const orphans = enriched.filter(o => !o.parent_id && (SCOPE_ORDER[o.scope_type] ?? 0) > 1);

  // KPIs.
  const publishedObjs = objectives.filter(o => o.status === "published");
  const kpis = {
    themes: themes.length,
    objectives: objectives.length,
    published: publishedObjs.length,
    draft: objectives.filter(o => o.status === "draft").length,
    pending: objectives.filter(o => o.status === "pending").length,
    avgProgress: publishedObjs.length ? Math.round(publishedObjs.reduce((a, o) => a + Number(o.progress_pct || 0), 0) / publishedObjs.length) : 0,
    priorities: priorities.filter(p => p.status === "published").length,
    campaigns: campaigns.filter(c => c.status === "active").length,
    keyResults: keyResults.length,
    pendingApprovals: approvals.filter(a => a.state === "pending").length,
  };

  // Key-result rollup.
  const krStatus = { on_track: 0, at_risk: 0, off_track: 0, achieved: 0 } as Record<string, number>;
  keyResults.forEach(k => { krStatus[k.status] = (krStatus[k.status] ?? 0) + 1; });

  // Governance snapshot.
  const pendingApprovals = approvals.filter(a => a.state === "pending" || a.state === "changes_requested").slice(0, 6);
  const recentAudit = audit.slice(0, 8).map(a => ({ ...a, scopeLabel: scopeName(a.scope_type ?? "platform", a.scope_ref, nameByRef) }));

  return {
    provisioned: true as const, hasData: objectives.length > 0,
    kpis, themeCards, objectives: enriched, cascade, orphans, krStatus, pendingApprovals, recentAudit,
    frameworkMix: { okr: objectives.filter(o => o.framework === "okr").length, bsc: objectives.filter(o => o.framework === "bsc").length, custom: objectives.filter(o => o.framework === "custom").length },
  };
}
