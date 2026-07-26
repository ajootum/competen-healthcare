// HEX-012 Executive Configuration & Administration — no-code admin over the real config substrate.
// Composes fetchAdmin (adm_config_items/_changes/_automations/_forms + reused role/user counts) and the
// platform configuration_registry_objects catalogue (092). Reuses the No-Code Platform per HEX-000 §14.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchAdmin } from "@/lib/admin/admin-suite";

const CFG_TONE = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];
// Group the registry's fine-grained object types into executive-friendly buckets.
const BUCKET: Record<string, string> = {
  WORKSPACE: "Workspaces", PRODUCT_SUITE: "Workspaces", PLATFORM: "Workspaces",
  NAVIGATION_SECTION: "Modules & pages", MODULE: "Modules & pages", PAGE: "Modules & pages", VIEW: "Modules & pages", TAB: "Modules & pages", PANEL: "Modules & pages",
  DASHBOARD: "Dashboards & KPIs", WIDGET: "Dashboards & KPIs", METRIC: "Dashboards & KPIs", REPORT: "Dashboards & KPIs",
  FORM: "Forms & fields", FIELD: "Forms & fields", TABLE: "Forms & fields", COLUMN: "Forms & fields",
  WORKFLOW: "Workflows & rules", APPROVAL_RULE: "Workflows & rules", BUSINESS_RULE: "Workflows & rules", ACTION: "Workflows & rules",
  POLICY_CONTROL: "Policies & controls", PERMISSION: "Policies & controls", FEATURE_FLAG: "Policies & controls",
};

export async function loadExecAdministration(admin: any, hid: string | null, isSuper: boolean) {
  const a = await fetchAdmin(admin, hid, isSuper);
  if (!a.provisioned) return { provisioned: false as const };

  // Platform configurable-object catalogue.
  let registryTotal = 0; const bucketMap = new Map<string, number>(); const typeMap = new Map<string, number>();
  const workspaceRows: any[] = [];
  try {
    const { data } = await admin.from("configuration_registry_objects").select("object_type, display_name, status, configurability_class").limit(20000);
    const rows = (data ?? []) as any[];
    registryTotal = rows.length;
    rows.forEach(r => {
      const b = BUCKET[r.object_type] ?? "Other";
      bucketMap.set(b, (bucketMap.get(b) ?? 0) + 1);
      typeMap.set(r.object_type, (typeMap.get(r.object_type) ?? 0) + 1);
      if (["WORKSPACE", "PRODUCT_SUITE"].includes(r.object_type)) workspaceRows.push(r);
    });
  } catch { /* optional */ }

  const config = a.config as any[], changes = a.changes as any[], automations = a.automations as any[], documents = a.documents as any[];
  const activeConfig = config.filter(c => c.status === "active").length;
  const publishedChanges = changes.filter(c => ["approved", "published"].includes(c.status)).length;
  const pendingApprovals = changes.filter(c => ["draft", "in_review", "pending_approval"].includes(c.status)).length;
  const activeAutomations = automations.filter(x => x.status === "active").length;
  const policies = documents.filter(d => d.doc_type === "policy").length || documents.length;

  // Config health — composite of config-active, change-governance and automation-health rates.
  const parts: number[] = [];
  if (config.length) parts.push((activeConfig / config.length) * 100);
  if (changes.length) parts.push((publishedChanges / changes.length) * 100);
  if (automations.length) parts.push((activeAutomations / automations.length) * 100);
  const configHealth = parts.length ? Math.round(parts.reduce((s, x) => s + x, 0) / parts.length) : null;

  const overviewDonut = [...bucketMap.entries()].sort((a2, b2) => b2[1] - a2[1]).map(([label, value], i) => ({ label, value, tone: CFG_TONE[i % CFG_TONE.length] }));
  const roleDist = Object.entries(a.reused.roleDist ?? {}).sort((x: any, y: any) => y[1] - x[1]).map(([label, value], i) => ({ label: String(label).replace(/_/g, " "), value: value as number, tone: CFG_TONE[i % CFG_TONE.length] }));

  // System health — honest data-backed proxies (not fabricated infra metrics).
  const health = [
    { label: "Configuration coverage", pct: config.length ? Math.round((activeConfig / config.length) * 100) : 0 },
    { label: "Change governance", pct: changes.length ? Math.round((publishedChanges / changes.length) * 100) : 0 },
    { label: "Automation health", pct: automations.length ? Math.round((activeAutomations / automations.length) * 100) : 0 },
    { label: "Forms published", pct: (a.forms as any[]).length ? Math.round(((a.forms as any[]).filter((f: any) => f.status === "published" || f.status === "active").length / (a.forms as any[]).length) * 100) : 0 },
  ];

  const RISK_TONE: Record<string, string> = { high: "rose", medium: "amber", low: "emerald" };
  const ST_TONE: Record<string, string> = { draft: "slate", in_review: "amber", pending_approval: "violet", approved: "blue", published: "emerald", rolled_back: "rose", cancelled: "slate" };

  return {
    provisioned: true as const,
    kpis: {
      configHealth, activeWorkspaces: workspaceRows.length, activeUsers: a.reused.totalUsers,
      policies, workflows: typeMap.get("WORKFLOW") ?? 0, dashboards: (typeMap.get("DASHBOARD") ?? 0) + (typeMap.get("WIDGET") ?? 0),
      pendingApprovals, registryTotal,
    },
    overviewDonut, roleDist, health,
    recentChanges: changes.slice(0, 6).map(c => ({ code: c.change_code, title: c.title, type: c.change_type, risk: c.risk, status: c.status, riskTone: RISK_TONE[c.risk] ?? "slate", statusTone: ST_TONE[c.status] ?? "slate" })),
    pending: changes.filter(c => ["draft", "in_review", "pending_approval"].includes(c.status)).slice(0, 6).map(c => ({ title: c.title, type: c.change_type, risk: c.risk, riskTone: RISK_TONE[c.risk] ?? "slate" })),
    workspaces: workspaceRows.slice(0, 8).map(w => ({ name: w.display_name, status: w.status })),
    configItems: config.length, automations: activeAutomations,
  };
}
