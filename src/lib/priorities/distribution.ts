// PPE-002 Priority Distribution & Inheritance Engine loader. The runtime view of the cascade: priorities grouped by
// scope level, inheritance-mode + urgency breakdowns, and — the centrepiece — the *effective* resolved priority set
// for a representative context (the hospital/department that carries scoped priorities), produced by the engine's
// resolveEffectivePriorities (ranked by effective weight, with lineage and 'block' suppression surfaced). Read model.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchFramework, resolveEffectivePriorities, appliesToScope, effectiveWeight, scopeName, SCOPE_ORDER, SCOPE_LABEL } from "./engine";

export async function loadDistribution(admin: any) {
  const f = await fetchFramework(admin);
  if (!f.provisioned) return { provisioned: false as const };
  const { priorities, themes, approvals, nameByRef } = f;

  const published = priorities.filter(p => p.status === "published");
  const themeName = (id: string) => themes.find(t => t.id === id)?.name ?? null;
  const themeColor = (id: string) => themes.find(t => t.id === id)?.color ?? "#94a3b8";

  // Representative resolution context — the hospital/department that actually carry scoped priorities.
  const hospitalId = published.find(p => p.scope_type === "hospital")?.scope_ref ?? null;
  const departmentId = published.find(p => p.scope_type === "department")?.scope_ref ?? null;
  const ctx = { hospitalId, departmentId };
  const ctxLabel = hospitalId ? scopeName("hospital", hospitalId, nameByRef) : "Platform context";

  const effective = resolveEffectivePriorities(published, ctx, nameByRef).map(p => ({
    ...p, themeName: themeName(p.theme_id), themeColor: themeColor(p.theme_id),
  }));

  // Candidates that applied but were suppressed by a local 'block' (for transparency).
  const applied = published.filter(p => appliesToScope(p, ctx));
  const effectiveIds = new Set(effective.map(p => p.id));
  const suppressed = applied.filter(p => !effectiveIds.has(p.id)).map(p => ({ ...p, themeName: themeName(p.theme_id), sourceScope: scopeName(p.scope_type, p.scope_ref, nameByRef) }));

  // Cascade columns — published priorities by scope level (broad → specific).
  const levels = ["platform", "enterprise", "hospital", "department", "team", "user"];
  const byScope = levels.map(lvl => ({
    level: lvl, label: SCOPE_LABEL[lvl],
    items: published.filter(p => p.scope_type === lvl).map(p => ({ id: p.id, title: p.title, urgency: p.urgency, mandatory: p.mandatory, inheritance_mode: p.inheritance_mode, weight: effectiveWeight(p), themeColor: themeColor(p.theme_id) })),
  })).filter(c => c.items.length > 0);

  // Breakdowns.
  const byInheritance = ["cascade", "reference", "local", "block"].map(m => ({ mode: m, n: published.filter(p => p.inheritance_mode === m).length })).filter(x => x.n > 0);
  const byUrgency = ["critical", "high", "medium", "low"].map(u => ({ urgency: u, n: published.filter(p => p.urgency === u).length })).filter(x => x.n > 0);

  const kpis = {
    total: priorities.length, published: published.length,
    mandatory: published.filter(p => p.mandatory).length,
    levels: byScope.length,
    effective: effective.length,
    suppressed: suppressed.length,
    avgWeight: effective.length ? Math.round(effective.reduce((a, p) => a + p.weight, 0) / effective.length) : 0,
    pending: approvals.filter(a => a.state === "pending" && a.entity_type === "priority").length,
    drafts: priorities.filter(p => p.status === "draft").length,
  };

  return { provisioned: true as const, hasData: priorities.length > 0, kpis, byScope, byInheritance, byUrgency, effective, suppressed, ctxLabel, maxDepth: Math.max(0, ...byScope.map(c => SCOPE_ORDER[c.level] ?? 0)) };
}
