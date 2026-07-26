// PW-014 WS2 + Ch.11 WS8 — resolve the effective Personal Dashboard manifest with GOVERNED user personalization.
// Reuses the WCE override store (workspace_config_overrides) along SCOPE_ORDER platform→tenant→hospital→unit→role
// →user. Two layers are resolved SEPARATELY and combined with policy precedence (Ch.11 §11.4.2 — "policy before
// preference"): the ADMIN policy (non-user scopes) sets each widget's state (required/locked/optional), enabled
// and order (PW-AC-06 — configure without code); the USER preference (user scope) may hide/reorder ONLY where the
// state allows. A `required` widget is always shown; a `locked` widget can't be hidden by the user; an admin-
// disabled widget is hidden. Fail-soft: no overrides → code-default manifest, everything shown.
import { loadConfigOverrides, applies, SCOPE_ORDER, type ScopeCtx, type OverrideRow } from "@/lib/config/workspace-config";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type WidgetZone = "main" | "rail" | "full";
export type WidgetState = "required" | "locked" | "optional";
export type ManifestEntry = { key: string; label: string; zone: WidgetZone; order: number; span: 1 | 2; state?: WidgetState };
export type DashboardControl = { key: string; label: string; zone: WidgetZone; order: number; state: WidgetState; visible: boolean; canToggle: boolean };

export const DASHBOARD_CONFIG_PREFIX = "personal.dashboard";

// Merge the `published` jsonb across applicable rows within a scope subset, least→most specific.
function mergeAt(rows: OverrideRow[], ctx: ScopeCtx, path: string, inScope: (scopeType: string) => boolean): any {
  const applicable = rows
    .filter(r => r.config_path === path && inScope(r.scope_type) && applies(r, ctx) && r.published != null)
    .sort((a, b) => (SCOPE_ORDER[a.scope_type] ?? 99) - (SCOPE_ORDER[b.scope_type] ?? 99));
  let eff: any = {};
  for (const r of applicable) eff = { ...eff, ...(r.published || {}) };
  return eff;
}

type Resolved = { entry: ManifestEntry; state: WidgetState; visible: boolean; adminDisabled: boolean };

function resolveAll(rows: OverrideRow[], ctx: ScopeCtx, defaults: ManifestEntry[]): Resolved[] {
  return defaults.map(e => {
    const path = `${DASHBOARD_CONFIG_PREFIX}.${e.key}`;
    const admin = mergeAt(rows, ctx, path, st => st !== "user");   // platform → role (organizational policy)
    const user = mergeAt(rows, ctx, path, st => st === "user");    // user preference
    const state: WidgetState = admin.state === "required" ? "required" : admin.state === "locked" ? "locked" : "optional";
    const adminDisabled = admin.enabled === false;
    const userHidden = user.enabled === false;
    // Policy precedence:
    let visible: boolean;
    if (state === "required") visible = true;          // mandatory — never hidden, whatever the user prefers
    else if (adminDisabled) visible = false;           // org turned it off
    else if (state === "locked") visible = true;       // fixed on — user may not hide
    else visible = !userHidden;                        // optional — user preference within policy
    const order = user.order ?? admin.order ?? e.order;
    return { entry: { ...e, order, state, label: admin.label ?? e.label }, state, visible, adminDisabled };
  });
}

// The visible, ordered manifest the dashboard renders.
export async function resolveDashboardManifest(admin: any, ctx: ScopeCtx, defaults: ManifestEntry[]): Promise<ManifestEntry[]> {
  const { rows } = await loadConfigOverrides(admin); // fail-soft → []
  return resolveAll(rows, ctx, defaults)
    .filter(r => r.visible)
    .map(r => r.entry)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

// Every widget with its policy state + current visibility — for the Customize panel. `canToggle` is true only for
// optional widgets the org hasn't disabled (required/locked are surfaced but locked in the UI too).
export async function resolveDashboardControls(admin: any, ctx: ScopeCtx, defaults: ManifestEntry[]): Promise<DashboardControl[]> {
  const { rows } = await loadConfigOverrides(admin);
  const zoneRank: Record<WidgetZone, number> = { main: 0, rail: 1, full: 2 };
  return resolveAll(rows, ctx, defaults)
    .map(r => ({
      key: r.entry.key, label: r.entry.label, zone: r.entry.zone, order: r.entry.order, state: r.state, visible: r.visible,
      canToggle: r.state === "optional" && !r.adminDisabled,
    }))
    .sort((a, b) => zoneRank[a.zone] - zoneRank[b.zone] || a.order - b.order || a.key.localeCompare(b.key));
}

export const inZone = (manifest: ManifestEntry[], zone: WidgetZone) => manifest.filter(e => e.zone === zone);
