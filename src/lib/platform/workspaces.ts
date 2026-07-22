// Workspace Management (POP-001 §3) loader. A "workspace" is a distinct
// application surface a user switches into. The catalogue is defined in CODE
// (@/lib/roles) across three planes — portal, org-role and platform — so routes
// and audiences never drift from the running app. A sparse DB override table
// (plat_workspaces) carries only MANAGEMENT state (enabled, renamed, re-iconed,
// themed, re-scoped), mirroring the plat_feature_flags/assignments pattern.
// Fail-soft: with no override table the page still renders code defaults, so it
// works before RUN-ME-053 is applied and becomes editable after.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ROLE_CONFIG, PLATFORM_ROLE_CONFIG, WORKSPACE_CATALOGUE, type AppRole } from "@/lib/roles";

export type WorkspaceKind = "portal" | "org_role" | "platform";
export const KIND_LABEL: Record<WorkspaceKind, string> = { portal: "Role Portals", org_role: "Organisation Workspaces", platform: "Platform (Landlord) Workspaces" };
const KIND_ACCENT: Record<WorkspaceKind, string> = { portal: "#7c3aed", org_role: "#0d9488", platform: "#2563eb" };

export type CatalogueEntry = { key: string; kind: WorkspaceKind; name: string; icon: string; route: string; audience: string[]; description: string; tier: number };

// Platform workspace-code → route (staff sections / control-plane).
const PLATFORM_ROUTE: Record<string, string> = {
  "POW-001": "/platform/control-plane", "PSA-001": "/platform/control-plane",
  "PCS-001": "/platform/staff/customer-success", "SUP-001": "/platform/staff/support",
  "PRD-001": "/platform/staff/product", "ENG-001": "/platform/staff/engineering",
  "AIS-001": "/platform/staff/ai-ops", "FIN-001": "/platform/staff/finance",
  "CNT-001": "/platform/staff", "QLT-001": "/platform/staff/quality", "SEC-001": "/platform/staff/security",
};

// Build the canonical catalogue from the three code configs.
export function workspaceCatalogue(): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];

  // Portal workspaces (base role portals).
  (Object.keys(ROLE_CONFIG) as AppRole[]).forEach((r, i) => {
    const c = ROLE_CONFIG[r];
    out.push({ key: `portal:${r}`, kind: "portal", name: c.label, icon: c.icon, route: c.portal, audience: [r], description: `Base role portal for ${c.label}.`, tier: i + 1 });
  });

  // Organisation (org-role) workspaces — switchable destinations.
  WORKSPACE_CATALOGUE.forEach((w, i) => {
    out.push({ key: `org:${w.href.replace(/^\//, "")}`, kind: "org_role", name: w.label, icon: w.icon, route: w.href, audience: w.appRoles.slice(), description: `Organisation workspace admitted to ${w.appRoles.join(", ")}.`, tier: i + 1 });
  });

  // Platform (landlord) workspaces — deduped by workspace code.
  const seen = new Map<string, { roles: string[] }>();
  (Object.keys(PLATFORM_ROLE_CONFIG) as (keyof typeof PLATFORM_ROLE_CONFIG)[]).forEach(role => {
    const c = PLATFORM_ROLE_CONFIG[role];
    const g = seen.get(c.workspace);
    if (g) g.roles.push(role as string);
    else seen.set(c.workspace, { roles: [role as string] });
  });
  let ti = 1;
  for (const [code, { roles }] of seen) {
    const c = PLATFORM_ROLE_CONFIG[roles[0] as keyof typeof PLATFORM_ROLE_CONFIG];
    out.push({ key: `platform:${code}`, kind: "platform", name: c.label, icon: c.icon, route: PLATFORM_ROUTE[code] ?? "/platform/staff", audience: roles, description: c.description, tier: ti++ });
  }
  return out;
}

export type Workspace = CatalogueEntry & { accent: string; enabled: boolean; customized: boolean; defaults: { name: string; icon: string; accent: string; audience: string[] } };

export async function loadWorkspaces(admin: any) {
  const catalogue = workspaceCatalogue();
  const ov = await admin.from("plat_workspaces").select("key, is_enabled, label, icon, description, accent, audience, config, sort");
  const needsMigration = !!ov.error;
  const overrides = new Map<string, any>(((ov.error ? [] : ov.data ?? []) as any[]).map(o => [o.key, o]));

  const workspaces: Workspace[] = catalogue.map(c => {
    const o = overrides.get(c.key);
    const defAccent = KIND_ACCENT[c.kind];
    return {
      ...c,
      name: o?.label ?? c.name, icon: o?.icon ?? c.icon,
      description: o?.description ?? c.description,
      audience: Array.isArray(o?.audience) ? o.audience : c.audience,
      accent: o?.accent ?? defAccent,
      enabled: o?.is_enabled ?? true,
      customized: !!o,
      defaults: { name: c.name, icon: c.icon, accent: defAccent, audience: c.audience },
    };
  }).sort((a, b) => a.tier - b.tier);

  const groups = (["portal", "org_role", "platform"] as WorkspaceKind[]).map(kind => ({
    kind, label: KIND_LABEL[kind], items: workspaces.filter(w => w.kind === kind),
  }));
  const summary = {
    total: workspaces.length,
    enabled: workspaces.filter(w => w.enabled).length,
    disabled: workspaces.filter(w => !w.enabled).length,
    customized: workspaces.filter(w => w.customized).length,
    planes: groups.map(g => ({ label: g.label, n: g.items.length })),
  };
  return { groups, summary, needsMigration, generatedAt: new Date().toISOString() };
}
