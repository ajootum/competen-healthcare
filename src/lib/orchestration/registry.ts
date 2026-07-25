// PW-014 P0 / §12 — the single Workspace Registry read model. Reconciles the three fragmented sources into one:
//   • roles.ts WORKSPACE_CATALOGUE — org-role entitlement gating (label/icon/href/orgRoles/appRoles), no stable key
//   • ROLE_CONFIG portals          — the base AppRole portals (assessor/educator/admin/super-admin), missing above
//   • plat_workspaces (053)        — operator overrides keyed by `key` (`portal:assessor`, `platform:*`)
// This module is the canonical, stably-keyed list every launcher / entitlement / landing surface should read.
// It does NOT replace config/workspace-catalog.ts (that is the deep config tree for the WCE Designer) — it
// cross-references it by `configKey` so composition (WS2) can attach later.
import { WORKSPACE_CATALOGUE, ROLE_CONFIG, type AppRole, type OrgRole } from "@/lib/roles";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type WorkspaceKind = "personal" | "portal" | "workspace";
export type RegisteredWorkspace = {
  key: string;              // stable id, aligned to plat_workspaces convention: 'personal' | 'portal:<role>' | 'workspace:<slug>'
  label: string;
  icon: string;
  href: string;             // entry / deep-link base route
  kind: WorkspaceKind;
  appRoles: AppRole[];      // AppRoles admitted ([] on 'personal' = any authenticated user)
  orgRoles: OrgRole[];      // org roles that unlock (workspace kind)
  configKey: string | null; // cross-ref into config/workspace-catalog.ts (WCE) for composition, where one exists
  enabled: boolean;         // operator toggle (plat_workspaces.is_enabled); default true
};

// The base AppRole portals — the nurse "portal" IS the Personal Workspace, so it is not repeated here.
const PORTAL_ROLES: AppRole[] = ["assessor", "educator", "hospital_admin", "super_admin"];
const slug = (href: string) => href.replace(/^\//, "").replace(/\//g, "-"); // '/unit-manager' → 'unit-manager'

// Canonical, code-defined registry (routes/labels never drift from the running app).
export const WORKSPACE_REGISTRY: RegisteredWorkspace[] = [
  { key: "personal", label: "Personal Workspace", icon: "🧑‍⚕️", href: "/dashboard", kind: "personal", appRoles: [], orgRoles: [], configKey: null, enabled: true },
  ...PORTAL_ROLES.map((r): RegisteredWorkspace => ({
    key: `portal:${r}`, label: ROLE_CONFIG[r].label, icon: ROLE_CONFIG[r].icon, href: ROLE_CONFIG[r].portal,
    kind: "portal", appRoles: [r], orgRoles: [], configKey: null, enabled: true,
  })),
  ...WORKSPACE_CATALOGUE.map((w): RegisteredWorkspace => ({
    key: `workspace:${slug(w.href)}`, label: w.label, icon: w.icon, href: w.href,
    kind: "workspace", appRoles: w.appRoles, orgRoles: w.orgRoles, configKey: slug(w.href), enabled: true,
  })),
];

export function workspaceByKey(key: string): RegisteredWorkspace | null {
  return WORKSPACE_REGISTRY.find(w => w.key === key) ?? null;
}
export function workspaceByHref(href: string): RegisteredWorkspace | null {
  return WORKSPACE_REGISTRY.find(w => w.href === href || (href.startsWith(w.href + "/") && w.href !== "/dashboard")) ?? null;
}

// Apply operator overrides from plat_workspaces (is_enabled / label / icon), best-effort + fail-soft: if the
// table is absent or errors, the canonical code registry stands unchanged.
export async function loadWorkspaceRegistry(admin: any): Promise<RegisteredWorkspace[]> {
  try {
    const { data, error } = await admin.from("plat_workspaces").select("key, is_enabled, label, icon");
    if (error || !data?.length) return WORKSPACE_REGISTRY;
    const ov = new Map<string, any>(data.map((r: any) => [r.key, r]));
    return WORKSPACE_REGISTRY.map(w => {
      const o = ov.get(w.key);
      return o ? { ...w, label: o.label ?? w.label, icon: o.icon ?? w.icon, enabled: o.is_enabled !== false } : w;
    });
  } catch { return WORKSPACE_REGISTRY; }
}
