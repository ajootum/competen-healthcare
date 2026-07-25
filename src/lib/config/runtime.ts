// Configuration Runtime & Resolution Engine (NCP-015) — resolves a configuration object's EFFECTIVE settings for
// a given runtime context by merging the inheritance layers (platform default → tenant → hospital → unit → role
// → user) with deterministic precedence (most specific wins), and returns a full resolution TRACE so any runtime
// value is explainable ("which layer set this?"). Builds on the WCE-001 override store (resolveSettings) and adds
// provenance + a cache key. The runtime service composition (layout/widget/form assembly) + a real distributed
// cache (§6/§7) are next-phase; this engine resolves enable/label/order along the hierarchy today.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadConfigOverrides, applies, SCOPE_ORDER, type ScopeCtx } from "@/lib/config/workspace-config";

export type TraceLayer = { level: string; scopeRef: string | null; contributed: Record<string, any>; note?: string };

export async function resolveRuntime(admin: any, objectKey: string, ctx: ScopeCtx) {
  const { data: obj, error } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, status, default_enabled, allowed_config_levels, safety_classification, override_policy")
    .eq("object_key", objectKey).maybeSingle();
  if (error && /does not exist|schema cache/i.test(error.message ?? "")) return { provisioned: false as const };
  if (!obj) return { provisioned: true as const, found: false as const };

  const path = objectKey.replace(/^workspace\./, "");
  const { rows } = await loadConfigOverrides(admin);
  const applicable = rows
    .filter(r => r.config_path === path && applies(r, ctx) && r.published != null)
    .sort((a, b) => (SCOPE_ORDER[a.scope_type] ?? 99) - (SCOPE_ORDER[b.scope_type] ?? 99)); // least → most specific

  const base = { enabled: obj.default_enabled !== false };
  let eff: any = { ...base };
  const trace: TraceLayer[] = [{ level: "platform_default", scopeRef: null, contributed: { ...base }, note: "registry default" }];
  for (const r of applicable) { const val = r.published || {}; eff = { ...eff, ...val }; trace.push({ level: r.scope_type, scopeRef: r.scope_ref, contributed: val }); }

  const cacheKey = `cfg:${objectKey}|t:${ctx.tenantId ?? "-"}|h:${ctx.hospitalId ?? "-"}|u:${ctx.unitId ?? "-"}|r:${(ctx.roles ?? []).join(",") || "-"}`;
  return {
    provisioned: true as const, found: true as const,
    object: { key: obj.object_key, type: obj.object_type, name: obj.display_name, status: obj.status, safety: obj.safety_classification, overridePolicy: obj.override_policy },
    path, allowedLevels: obj.allowed_config_levels ?? [],
    effective: { enabled: eff.enabled !== false, label: eff.label ?? obj.display_name, order: eff.order ?? null },
    raw: eff, trace, layers: applicable.length, cacheKey,
  };
}
