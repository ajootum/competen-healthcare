// Workspace Configuration Engine (WCE-001) — runtime resolver. Merges the sparse
// DB overrides onto the code catalogue along the inheritance hierarchy
// Platform → Tenant → Hospital → Unit → Role → User (least → most specific; the
// most specific applicable scope wins per attribute). Runtime reads PUBLISHED
// settings; the Designer edits DRAFT. Fail-soft: no override table → every module
// resolves to its catalogue default (enabled).
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ScopeCtx = { tenantId?: string | null; hospitalId?: string | null; unitId?: string | null; roles?: string[]; userId?: string | null };
export type OverrideRow = { scope_type: string; scope_ref: string | null; config_path: string; draft: any; published: any };
export type Settings = { enabled: boolean; label?: string; order?: number };

export const SCOPE_ORDER: Record<string, number> = { platform: 0, tenant: 1, hospital: 2, unit: 3, role: 4, user: 5 };

function applies(row: OverrideRow, ctx: ScopeCtx): boolean {
  switch (row.scope_type) {
    case "platform": return true;
    case "tenant": return !!ctx.tenantId && row.scope_ref === ctx.tenantId;
    case "hospital": return !!ctx.hospitalId && row.scope_ref === ctx.hospitalId;
    case "unit": return !!ctx.unitId && row.scope_ref === ctx.unitId;
    case "role": return !!row.scope_ref && (ctx.roles ?? []).includes(row.scope_ref);
    case "user": return !!ctx.userId && row.scope_ref === ctx.userId;
    default: return false;
  }
}

// Load all overrides (small table — filtered in memory). Fail-soft pre-migration.
export async function loadConfigOverrides(admin: any): Promise<{ provisioned: boolean; rows: OverrideRow[] }> {
  const res = await admin.from("workspace_config_overrides").select("scope_type, scope_ref, config_path, draft, published");
  if (res.error) return { provisioned: false, rows: [] };
  return { provisioned: true, rows: (res.data ?? []) as OverrideRow[] };
}

// Effective settings for a config path, resolved along the hierarchy.
export function resolveSettings(rows: OverrideRow[], ctx: ScopeCtx, path: string, use: "published" | "draft" = "published"): Settings {
  const applicable = rows
    .filter(r => r.config_path === path && applies(r, ctx) && r[use] != null)
    .sort((a, b) => SCOPE_ORDER[a.scope_type] - SCOPE_ORDER[b.scope_type]); // least → most specific
  let eff: any = {};
  for (const r of applicable) eff = { ...eff, ...(r[use] || {}) };          // most specific applied last
  return { enabled: eff.enabled !== false, label: eff.label, order: eff.order };
}

// Runtime module/section gate — default ENABLED unless a published override disables it.
export function isEnabled(rows: OverrideRow[], ctx: ScopeCtx, path: string): boolean {
  return resolveSettings(rows, ctx, path, "published").enabled;
}

export function effectiveLabel(rows: OverrideRow[], ctx: ScopeCtx, path: string, fallback: string): string {
  return resolveSettings(rows, ctx, path, "published").label ?? fallback;
}

// The exact override row for one specific scope+path (for the Designer's edit view).
export function overrideAt(rows: OverrideRow[], scopeType: string, scopeRef: string | null, path: string): OverrideRow | undefined {
  return rows.find(r => r.scope_type === scopeType && (r.scope_ref ?? null) === (scopeRef ?? null) && r.config_path === path);
}
