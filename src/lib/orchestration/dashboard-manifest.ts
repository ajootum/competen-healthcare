// PW-014 WS2 / P3 / §6, §11, §13 — resolve the effective Personal Dashboard manifest for a user. Reuses the WCE
// override engine (loadConfigOverrides + resolveSettings along SCOPE_ORDER platform→tenant→hospital→unit→role→user)
// so a tenant admin can DISABLE or REORDER dashboard widgets via config with NO code deploy (PW-AC-06). Each widget
// is a config object at path `personal.dashboard.<key>`; absence of an override = the code default (default-enabled).
// Fail-soft: if the overrides table is absent, the code-default manifest stands unchanged.
import { loadConfigOverrides, resolveSettings, type ScopeCtx } from "@/lib/config/workspace-config";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type WidgetZone = "main" | "rail" | "full";
export type ManifestEntry = { key: string; label: string; zone: WidgetZone; order: number; span: 1 | 2 };

export const DASHBOARD_CONFIG_PREFIX = "personal.dashboard";

export async function resolveDashboardManifest(admin: any, ctx: ScopeCtx, defaults: ManifestEntry[]): Promise<ManifestEntry[]> {
  const { rows } = await loadConfigOverrides(admin); // fail-soft → []
  return defaults
    .map(e => {
      const s = resolveSettings(rows, ctx, `${DASHBOARD_CONFIG_PREFIX}.${e.key}`, "published");
      return { entry: { ...e, order: s.order ?? e.order, label: s.label ?? e.label }, enabled: s.enabled };
    })
    .filter(x => x.enabled)               // config-disabled widgets drop out (PW-AC-06)
    .map(x => x.entry)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

export const inZone = (manifest: ManifestEntry[], zone: WidgetZone) => manifest.filter(e => e.zone === zone);
