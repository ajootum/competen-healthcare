// Platform Configuration Registry (WCE-002) — the authoritative catalogue of every configurable platform
// object. `loadRegistry` reads the registry for the admin dashboard / explorer / search; `syncRegistryFromCatalog`
// SEEDS the registry from the real in-code WORKSPACE_CATALOG (WCE-001) so the registry reflects the actual
// platform structure rather than fabricated objects. MVP object model; deeper property / version /
// relationship tables (spec §32) are next-phase. Every write is audited. Fail-soft (pre-migration → empty).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { WORKSPACE_CATALOG } from "@/lib/config/workspace-catalog";
import { WIDGET_CATALOG, widgetObjectKey } from "@/lib/config/widget-catalog";

const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export const OBJECT_TYPE_LABEL: Record<string, string> = {
  PLATFORM: "Platform", PRODUCT_SUITE: "Product Suite", WORKSPACE: "Workspace", NAVIGATION_SECTION: "Navigation Section",
  MODULE: "Module", PAGE: "Page", VIEW: "View", TAB: "Tab", PANEL: "Panel", WIDGET: "Widget", METRIC: "Metric",
  FORM: "Form", FIELD: "Field", TABLE: "Table", COLUMN: "Column", FILTER: "Filter", ACTION: "Action", WORKFLOW: "Workflow",
  DATA_SOURCE: "Data Source", INTEGRATION: "Integration", AI_CAPABILITY: "AI Capability", TERMINOLOGY_SET: "Terminology Set",
  PERMISSION: "Permission", FEATURE_FLAG: "Feature Flag", POLICY_CONTROL: "Policy Control", REPORT: "Report", DASHBOARD: "Dashboard", TEMPLATE: "Template", ALERT: "Alert", NOTIFICATION: "Notification", BUSINESS_RULE: "Business Rule", APPROVAL_RULE: "Approval Rule",
};
export const CLASS_LABEL: Record<string, string> = { mandatory_locked: "Mandatory · Locked", mandatory_configurable: "Mandatory · Configurable", optional: "Optional", conditional: "Conditional", user_personalisable: "User-personalisable", deprecated: "Deprecated", retired: "Retired" };
export const SAFETY_LABEL: Record<string, string> = { non_clinical: "Non-clinical", administrative: "Administrative", operational: "Operational", clinical_support: "Clinical support", clinical_safety_relevant: "Clinical-safety relevant", clinical_safety_critical: "Clinical-safety critical", security_critical: "Security critical", regulatory_critical: "Regulatory critical", financial_control_critical: "Financial-control critical" };

// ── Read: dashboard stats + hierarchy + list ──────────────────────────────────────────────────────
export async function loadRegistry(admin: any) {
  const res = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, description, parent_object_key, schema_version, status, configurability_class, safety_classification, override_policy, default_enabled, mandatory, configuration_owner, owner_team, route, data_source_key, allowed_config_levels, dependencies, tags, display_order, source, updated_at")
    .order("object_type").order("display_order").limit(20000);
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const objects = (res.error ? [] : res.data ?? []) as any[];

  const keys = new Set(objects.map(o => o.object_key));
  const active = objects.filter(o => ["active", "published"].includes(o.status));
  const byType = new Map<string, number>();
  objects.forEach(o => byType.set(o.object_type, (byType.get(o.object_type) ?? 0) + 1));

  // Governance-quality flags (§19.1).
  const missingOwners = objects.filter(o => !o.configuration_owner).length;
  const configurableTypes = ["MODULE", "WIDGET", "PAGE", "DASHBOARD", "REPORT"];
  const missingDataSource = objects.filter(o => configurableTypes.includes(o.object_type) && !o.data_source_key).length;
  const unresolvedDeps = objects.filter(o => Array.isArray(o.dependencies) && o.dependencies.some((d: any) => d?.objectKey && !keys.has(d.objectKey))).length;
  const orphaned = objects.filter(o => o.parent_object_key && !keys.has(o.parent_object_key)).length;

  const stats = {
    total: objects.length,
    active: active.length,
    draft: objects.filter(o => ["draft", "technical_review", "product_review", "safety_review", "approved"].includes(o.status)).length,
    deprecated: objects.filter(o => o.status === "deprecated").length,
    retired: objects.filter(o => o.status === "retired").length,
    workspaces: objects.filter(o => o.object_type === "WORKSPACE").length,
    sections: objects.filter(o => o.object_type === "NAVIGATION_SECTION").length,
    modules: objects.filter(o => o.object_type === "MODULE").length,
    missingOwners, missingDataSource, unresolvedDeps, orphaned,
    byType: [...byType.entries()].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n),
  };

  let auditRecent: any[] = [];
  try {
    const { data } = await admin.from("configuration_registry_audit").select("object_key, action, actor_name, created_at").order("created_at", { ascending: false }).limit(10);
    auditRecent = data ?? [];
  } catch { /* fail-soft */ }

  return { provisioned: true as const, objects, stats, auditRecent };
}

// ── Sync: register the real WORKSPACE_CATALOG (workspaces → sections → modules) ────────────────────
export async function syncRegistryFromCatalog(admin: any, actorId: string | null, actorName: string | null) {
  const now = new Date().toISOString();
  const rows: any[] = [];
  const push = (o: any) => rows.push({ ...o, source: "catalogue", schema_version: "1.0.0", status: "active", updated_at: now, updated_by: actorId });

  // Root platform + product suite (anchors the hierarchy).
  push({ object_key: "platform.competen", object_type: "PLATFORM", display_name: "Competen Healthcare Platform", description: "The entire Competen platform.", parent_object_key: null, configurability_class: "mandatory_locked", safety_classification: "operational", override_policy: "none", default_enabled: true, mandatory: true, configuration_owner: "PLATFORM", owner_team: "Platform", allowed_config_levels: ["PLATFORM"], dependencies: [], tags: ["root"], display_order: 0, route: null, data_source_key: null });
  push({ object_key: "product.competen.clinical_workforce", object_type: "PRODUCT_SUITE", display_name: "Clinical Workforce Suite", description: "Operational clinical-workforce workspaces.", parent_object_key: "platform.competen", configurability_class: "mandatory_locked", safety_classification: "operational", override_policy: "none", default_enabled: true, mandatory: true, configuration_owner: "PLATFORM", owner_team: "Platform", allowed_config_levels: ["PLATFORM"], dependencies: [], tags: ["suite"], display_order: 0, route: null, data_source_key: null });

  // Safety-classification heuristic for known section/module keys.
  const safetyFor = (path: string) => (/quality|patient|safety|incident|risk|clinical|competency/i.test(path) ? "clinical_safety_relevant" : /admin|config|settings|tool/i.test(path) ? "administrative" : "operational");

  WORKSPACE_CATALOG.forEach((ws, wi) => {
    push({
      object_key: `workspace.${ws.key}`, object_type: "WORKSPACE", display_name: ws.label, description: `${ws.label} — role-based operational environment.`,
      parent_object_key: "product.competen.clinical_workforce", configurability_class: "mandatory_configurable", safety_classification: "operational",
      override_policy: "restricted", default_enabled: true, mandatory: true, configuration_owner: "TENANT", owner_team: "Platform",
      route: ws.route, data_source_key: null, allowed_config_levels: ["PLATFORM", "ENTERPRISE", "TENANT"], dependencies: [], tags: [ws.wired ? "wired" : "catalogued"], display_order: wi,
    });
    ws.sections.forEach((s, si) => {
      const locked = s.canDisable === false;
      push({
        object_key: `workspace.${s.path}`, object_type: "NAVIGATION_SECTION", display_name: s.label, description: `${ws.label} › ${s.label}.`,
        parent_object_key: `workspace.${ws.key}`, configurability_class: locked ? "mandatory_configurable" : "optional", safety_classification: safetyFor(s.path),
        override_policy: locked ? "narrow_only" : "full", default_enabled: true, mandatory: locked, configuration_owner: "TENANT", owner_team: "Platform",
        route: null, data_source_key: null, allowed_config_levels: ["PLATFORM", "ENTERPRISE", "TENANT", "UNIT"], dependencies: [{ type: "WORKSPACE", objectKey: `workspace.${ws.key}` }], tags: [], display_order: si,
      });
      s.modules.forEach((mod, mi) => {
        const mlocked = mod.canDisable === false;
        push({
          object_key: `workspace.${mod.path}`, object_type: "MODULE", display_name: mod.label, description: mod.note ?? `${s.label} › ${mod.label}.`,
          parent_object_key: `workspace.${s.path}`, configurability_class: mlocked ? "mandatory_configurable" : "optional", safety_classification: safetyFor(mod.path),
          override_policy: mlocked ? "narrow_only" : "full", default_enabled: true, mandatory: mlocked, configuration_owner: "TENANT", owner_team: "Platform",
          route: mod.route ?? null, data_source_key: null, allowed_config_levels: ["PLATFORM", "ENTERPRISE", "TENANT", "UNIT", "USER"], dependencies: [{ type: "SECTION", objectKey: `workspace.${s.path}` }], tags: [], display_order: mi,
        });
      });
    });
  });

  // Shared widget library (WCE-005) — register the catalogued widget primitives as WIDGET objects, so widgets
  // carry a configuration contract in the registry (parented under a shared library grouping).
  push({ object_key: "shared.widget_library", object_type: "NAVIGATION_SECTION", display_name: "Shared Widget Library", description: "Reusable widget primitives catalogued in WCE-005.", parent_object_key: "platform.competen", configurability_class: "mandatory_configurable", safety_classification: "operational", override_policy: "restricted", default_enabled: true, mandatory: false, configuration_owner: "PLATFORM", owner_team: "Platform", allowed_config_levels: ["PLATFORM"], dependencies: [], tags: ["widgets"], display_order: 1, route: null, data_source_key: null });
  WIDGET_CATALOG.forEach((w, wi) => push({
    object_key: widgetObjectKey(w.key), object_type: "WIDGET", display_name: w.name, description: w.description,
    parent_object_key: "shared.widget_library", configurability_class: w.mandatory ? "mandatory_configurable" : "optional",
    safety_classification: w.safety, override_policy: "restricted", default_enabled: true, mandatory: !!w.mandatory,
    configuration_owner: "TENANT", owner_team: "Platform", route: null, data_source_key: w.dataSource,
    allowed_config_levels: ["PLATFORM", "ENTERPRISE", "TENANT", "UNIT", "USER"], dependencies: [], tags: [w.category], display_order: wi,
  }));

  // Upsert — preserve created_at/created_by on existing, set them on insert.
  const { data: existing } = await admin.from("configuration_registry_objects").select("object_key").limit(20000);
  const have = new Set((existing ?? []).map((r: any) => r.object_key));
  const inserts = rows.filter(r => !have.has(r.object_key)).map(r => ({ ...r, created_at: now, created_by: actorId }));
  const updates = rows.filter(r => have.has(r.object_key));

  if (inserts.length) await admin.from("configuration_registry_objects").insert(inserts);
  for (const u of updates) await admin.from("configuration_registry_objects").update(u).eq("object_key", u.object_key);

  await admin.from("configuration_registry_audit").insert({
    action: "synced", actor_id: actorId, actor_name: actorName, change_reason: "Synced from in-code WORKSPACE_CATALOG",
    new_value: { registered: rows.length, inserted: inserts.length, updated: updates.length },
  });
  return { registered: rows.length, inserted: inserts.length, updated: updates.length };
}
