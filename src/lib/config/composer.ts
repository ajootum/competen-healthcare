// Tenant Experience Composer (WCE-003) — the governed configuration overview that INTEGRATES the registry
// (WCE-002, what may be configured) with the runtime overrides (WCE-001, what is configured). It composes,
// it does not fork: no new store. Per §3/§35 the composer only exposes what WCE-002 declares configurable, and
// per §5 it shows the inheritance (inherited value, source scope, locked, may-override, local override). Real:
// the Composer Dashboard (§8 config-health score + summary + required actions + recent activity) and the
// registry-driven Workspace Catalogue with per-object configurability class, override policy, safety class and
// effective state for the selected scope. The actual toggle/rename/reorder editing runs through the existing
// WCE-001 Designer (linked); the deep builders (navigation DnD, page/dashboard/widget builders, forms,
// workflows, permission matrix, branding, templates, change requests, phased publishing) are honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRegistry } from "@/lib/config/registry";
import { loadConfigOverrides, resolveSettings, overrideAt, SCOPE_ORDER, type ScopeCtx, type OverrideRow } from "@/lib/config/workspace-config";

const stripWs = (key: string) => key.replace(/^workspace\./, "");
// The scope level a WCE-003 scope maps to for registry override-eligibility (allowed_config_levels).
const SCOPE_LEVEL: Record<string, string> = { platform: "PLATFORM", enterprise: "ENTERPRISE", tenant: "TENANT", hospital: "TENANT", unit: "UNIT", role: "ROLE", user: "USER" };

function ctxFor(scopeType: string, scopeRef: string | null): ScopeCtx {
  switch (scopeType) {
    case "hospital": return { hospitalId: scopeRef };
    case "tenant": return { tenantId: scopeRef };
    case "unit": return { unitId: scopeRef };
    case "role": return { roles: scopeRef ? [scopeRef] : [] };
    case "user": return { userId: scopeRef };
    default: return {};
  }
}

// The scope that determines the effective published value for a path (else "platform default").
function effectiveSource(rows: OverrideRow[], ctx: ScopeCtx, path: string): string {
  const applies = (r: OverrideRow) => {
    switch (r.scope_type) {
      case "platform": return true;
      case "tenant": return !!ctx.tenantId && r.scope_ref === ctx.tenantId;
      case "hospital": return !!ctx.hospitalId && r.scope_ref === ctx.hospitalId;
      case "unit": return !!ctx.unitId && r.scope_ref === ctx.unitId;
      case "role": return !!r.scope_ref && (ctx.roles ?? []).includes(r.scope_ref);
      case "user": return !!ctx.userId && r.scope_ref === ctx.userId;
      default: return false;
    }
  };
  const applicable = rows.filter(r => r.config_path === path && applies(r) && r.published != null && r.published.enabled !== undefined)
    .sort((a, b) => SCOPE_ORDER[a.scope_type] - SCOPE_ORDER[b.scope_type]);
  return applicable.length ? applicable[applicable.length - 1].scope_type : "platform-default";
}

export async function loadComposer(admin: any, scopeType: string, scopeRef: string | null) {
  const [reg, ov] = await Promise.all([loadRegistry(admin), loadConfigOverrides(admin)]);
  if (!reg.provisioned) return { registryProvisioned: false as const, configProvisioned: ov.provisioned };
  const rows = ov.rows;
  const ctx = ctxFor(scopeType, scopeRef);
  const level = SCOPE_LEVEL[scopeType] ?? "PLATFORM";

  const objects = reg.objects;
  const workspaces = objects.filter(o => o.object_type === "WORKSPACE").sort((a, b) => a.display_order - b.display_order);
  const sections = objects.filter(o => o.object_type === "NAVIGATION_SECTION");
  const modules = objects.filter(o => o.object_type === "MODULE");

  // Per-object effective state + inheritance (for configurable section/module objects).
  const decorate = (o: any) => {
    const path = stripWs(o.object_key);
    const eff = resolveSettings(rows, ctx, path);
    const localPub = overrideAt(rows, scopeType, scopeRef, path)?.published;
    const localDraft = overrideAt(rows, scopeType, scopeRef, path)?.draft;
    const mayOverride = Array.isArray(o.allowed_config_levels) && o.allowed_config_levels.includes(level) && o.configurability_class !== "mandatory_locked";
    return {
      key: o.object_key, path, name: o.display_name, type: o.object_type,
      configClass: o.configurability_class, overridePolicy: o.override_policy, safety: o.safety_classification,
      enabled: eff.enabled, label: eff.label ?? o.display_name, source: effectiveSource(rows, ctx, path),
      locked: o.configurability_class === "mandatory_locked" || (o.mandatory && ["none", "narrow_only"].includes(o.override_policy)),
      mayOverride, hasLocalOverride: localPub != null, hasDraft: localDraft != null && JSON.stringify(localDraft) !== JSON.stringify(localPub ?? null),
      deprecated: ["deprecated", "retired"].includes(o.status),
    };
  };

  // Tree: workspace → sections → modules.
  const tree = workspaces.map(ws => {
    const wsKey = ws.object_key;
    const secs = sections.filter(s => s.parent_object_key === wsKey).sort((a, b) => a.display_order - b.display_order).map(s => {
      const mods = modules.filter(m => m.parent_object_key === s.object_key).sort((a, b) => a.display_order - b.display_order).map(decorate);
      return { ...decorate(s), modules: mods };
    });
    return { key: wsKey, name: ws.display_name, route: ws.route, wired: (ws.tags ?? []).includes("wired"), sections: secs };
  });

  // Flat configurable list (sections + modules) for summary maths.
  const flat = tree.flatMap(w => w.sections.flatMap(s => [s, ...s.modules]));
  const configurable = flat.filter(o => !o.locked);
  const disabled = flat.filter(o => !o.enabled);
  const localOverrides = flat.filter(o => o.hasLocalOverride).length;
  const draftChanges = rows.filter(r => r.scope_type === scopeType && (r.scope_ref ?? null) === (scopeRef ?? null) && r.draft != null && JSON.stringify(r.draft) !== JSON.stringify(r.published ?? null)).length;
  const deprecatedInUse = flat.filter(o => o.deprecated && o.enabled).length;

  // Config health score (§8.2) — from registry integrity + config hygiene.
  const s = reg.stats;
  const factors: number[] = [];
  factors.push(Math.max(0, 100 - (s.orphaned + s.unresolvedDeps) * 8));                 // dependency/hierarchy integrity
  factors.push(s.total ? Math.round(((s.total - s.missingOwners) / s.total) * 100) : 100); // ownership completeness
  factors.push(Math.max(0, 100 - deprecatedInUse * 10));                                  // deprecated usage
  const healthScore = Math.round(factors.reduce((a, b) => a + b, 0) / factors.length);
  const healthBand = healthScore >= 90 ? "Healthy" : healthScore >= 75 ? "Attention" : "At Risk";

  const summary = {
    workspaces: workspaces.length, sections: sections.length, modules: modules.length,
    enabledModules: modules.filter(m => decorate(m).enabled).length,
    disabledOptional: disabled.filter(o => o.type === "MODULE" && !o.locked).length,
    configurable: configurable.length, localOverrides, draftChanges, deprecatedInUse,
    validationErrors: s.orphaned + s.unresolvedDeps,
  };

  // Required actions (§8.4).
  const actions: { label: string; detail: string; tone: string; href: string }[] = [];
  if (s.unresolvedDeps) actions.push({ label: `${s.unresolvedDeps} unresolved dependency(ies)`, detail: "Registry objects depend on unregistered objects", tone: "rose", href: "/super-admin/platform-ops/registry" });
  if (s.orphaned) actions.push({ label: `${s.orphaned} orphaned object(s)`, detail: "Parent object not registered — re-sync the registry", tone: "amber", href: "/super-admin/platform-ops/registry" });
  if (deprecatedInUse) actions.push({ label: `${deprecatedInUse} deprecated object(s) in use`, detail: "Enabled but marked deprecated — plan migration", tone: "amber", href: "/super-admin/platform-ops/registry" });
  if (draftChanges) actions.push({ label: `${draftChanges} unpublished draft change(s)`, detail: "Publish or discard in the Workspace Designer", tone: "sky", href: "/super-admin/platform-ops/configuration" });
  if (s.missingDataSource) actions.push({ label: `${s.missingDataSource} object(s) without a data source`, detail: "DATA_SOURCE binding is a registry next-phase item", tone: "gray", href: "/super-admin/platform-ops/registry" });

  // Recent activity (WCE-001 config audit).
  let activity: any[] = [];
  try {
    const { data } = await admin.from("workspace_config_audit").select("action, scope_type, config_path, actor_name, created_at").order("created_at", { ascending: false }).limit(8);
    activity = data ?? [];
  } catch { /* fail-soft */ }

  return {
    registryProvisioned: true as const, configProvisioned: ov.provisioned,
    scope: { type: scopeType, ref: scopeRef, level },
    health: { score: healthScore, band: healthBand },
    summary, tree, actions, activity,
  };
}
