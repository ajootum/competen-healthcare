// Configuration Runtime & Resolution Engine (NCP-015) — resolves a configuration object's EFFECTIVE settings for
// a given runtime context by merging the inheritance layers (platform default → tenant → hospital → unit → role
// → user) with deterministic precedence, and COMPOSES a resolved object (page / dashboard / navigation) into the
// executable runtime model a user in that context would actually see — enabled-filtered, references resolved,
// with a per-node trace. Builds on the WCE-001 override store. A distributed cache (§7) is next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadConfigOverrides, applies, SCOPE_ORDER, type ScopeCtx, type OverrideRow } from "@/lib/config/workspace-config";
import { computeMetric, type MetricValue } from "@/lib/config/metric-runtime";

export type TraceLayer = { level: string; scopeRef: string | null; contributed: Record<string, any>; note?: string };
type RegObj = { object_key: string; object_type: string; display_name: string; status?: string; default_enabled?: boolean; allowed_config_levels?: any; safety_classification?: string; override_policy?: string };

// Pure resolution core — merge the applicable override layers onto an object's registry default, with provenance.
function resolveFromRows(obj: RegObj, rows: OverrideRow[], ctx: ScopeCtx) {
  const path = obj.object_key.replace(/^workspace\./, "");
  const applicable = rows
    .filter(r => r.config_path === path && applies(r, ctx) && r.published != null)
    .sort((a, b) => (SCOPE_ORDER[a.scope_type] ?? 99) - (SCOPE_ORDER[b.scope_type] ?? 99));
  const base = { enabled: obj.default_enabled !== false };
  let eff: any = { ...base };
  const trace: TraceLayer[] = [{ level: "platform_default", scopeRef: null, contributed: { ...base }, note: "registry default" }];
  for (const r of applicable) { const val = r.published || {}; eff = { ...eff, ...val }; trace.push({ level: r.scope_type, scopeRef: r.scope_ref, contributed: val }); }
  const cacheKey = `cfg:${obj.object_key}|t:${ctx.tenantId ?? "-"}|h:${ctx.hospitalId ?? "-"}|u:${ctx.unitId ?? "-"}|r:${(ctx.roles ?? []).join(",") || "-"}`;
  return { effective: { enabled: eff.enabled !== false, label: eff.label ?? obj.display_name, order: eff.order ?? null }, raw: eff, trace, layers: applicable.length, cacheKey };
}

export async function resolveRuntime(admin: any, objectKey: string, ctx: ScopeCtx) {
  const { data: obj, error } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, status, default_enabled, allowed_config_levels, safety_classification, override_policy")
    .eq("object_key", objectKey).maybeSingle();
  if (error && /does not exist|schema cache/i.test(error.message ?? "")) return { provisioned: false as const };
  if (!obj) return { provisioned: true as const, found: false as const };
  const { rows } = await loadConfigOverrides(admin);
  const r = resolveFromRows(obj, rows, ctx);
  return {
    provisioned: true as const, found: true as const,
    object: { key: obj.object_key, type: obj.object_type, name: obj.display_name, status: obj.status, safety: obj.safety_classification, overridePolicy: obj.override_policy },
    path: obj.object_key.replace(/^workspace\./, ""), allowedLevels: obj.allowed_config_levels ?? [], ...r,
  };
}

// Compose a resolved object into the executable model a user in this context would see. PAGE → enabled-filtered
// layout; DASHBOARD → tiles with their bound metric resolved; NAVIGATION_SECTION → the menu tree filtered by role
// visibility and target availability. Every referenced object is resolved through the same layered engine.
export async function composeRuntime(admin: any, objectKey: string, ctx: ScopeCtx, opts: { withValues?: boolean } = {}) {
  const { data: obj, error } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, default_enabled, definition").eq("object_key", objectKey).maybeSingle();
  if (error && /does not exist|schema cache/i.test(error.message ?? "")) return { provisioned: false as const };
  if (!obj) return { provisioned: true as const, found: false as const };
  const def = obj.definition ?? {};
  const type = obj.object_type;

  // Collect referenced object keys from the definition, load them + all overrides once, resolve in memory.
  const refKeys = new Set<string>();
  if (type === "PAGE") for (const row of (def.rows ?? [])) for (const col of (row?.columns ?? [])) if (typeof col?.widget === "string") refKeys.add(col.widget);
  if (type === "DASHBOARD") for (const t of (def.tiles ?? [])) if (typeof t?.metric === "string" && t.metric) refKeys.add(t.metric);
  if (type === "NAVIGATION_SECTION") for (const it of (def.items ?? [])) { if (typeof it?.target === "string" && it.target) refKeys.add(it.target); for (const ch of (it?.children ?? [])) if (typeof ch?.target === "string" && ch.target) refKeys.add(ch.target); }

  const { rows } = await loadConfigOverrides(admin);
  const { data: refRows } = refKeys.size ? await admin.from("configuration_registry_objects").select("object_key, object_type, display_name, default_enabled, definition").in("object_key", [...refKeys]) : { data: [] };
  const refMap = new Map<string, any>(((refRows ?? []) as any[]).map(o => [o.object_key, o]));
  const resolveRef = (key: string) => { const ro = refMap.get(key); if (!ro) return { key, name: key, enabled: true, external: true }; const r = resolveFromRows(ro, rows, ctx); return { key, name: r.effective.label, enabled: r.effective.enabled, external: false, kind: ro.object_type, definition: ro.definition ?? {} }; };

  let model: any = null; let included = 0, excluded = 0;
  const roleOk = (roles?: string) => { const list = String(roles ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean); return list.length === 0 || list.some(r => (ctx.roles ?? []).map(x => x.toLowerCase()).includes(r)); };

  if (type === "PAGE") {
    const grid = Number(def.grid) || 12;
    const outRows = (def.rows ?? []).map((row: any) => ({
      columns: (row?.columns ?? []).map((col: any) => {
        if (typeof col?.widget === "string" && refMap.has(col.widget)) { const w = resolveRef(col.widget); if (w.enabled) included++; else excluded++; return { span: col.span, widget: w, shown: w.enabled }; }
        included++; return { span: col?.span, widget: col?.widget ? { key: col.widget, name: col.widget, enabled: true, external: true } : null, shown: true };
      }),
    }));
    model = { kind: "page", grid, rows: outRows };
  } else if (type === "DASHBOARD") {
    const memo = new Map<string, MetricValue>();
    const tiles: any[] = [];
    for (const t of (def.tiles ?? [])) {
      const metric: any = t.metric ? resolveRef(t.metric) : null;
      if (metric && opts.withValues && !metric.external && metric.enabled) {
        if (!memo.has(t.metric)) memo.set(t.metric, await computeMetric(admin, t.metric, ctx));
        const mv = memo.get(t.metric)!; metric.value = mv.value; metric.rag = mv.rag ?? null; metric.unresolved = mv.unresolved ?? [];
      }
      const shown = !metric || metric.enabled;
      if (shown) included++; else excluded++;
      tiles.push({ key: t.key, viz: t.viz, title: t.title, span: t.span, metric, shown });
    }
    model = { kind: "dashboard", tiles };
  } else if (type === "NAVIGATION_SECTION") {
    const mapItem = (it: any): any => {
      const target = it.target ? resolveRef(it.target) : null;
      const rOk = roleOk(it.roles); const tOk = !target || target.enabled;
      const visible = rOk && tOk;
      if (visible) included++; else excluded++;
      const reason = !rOk ? "role" : !tOk ? "target disabled" : null;
      return { key: it.key, label: it.label, icon: it.icon, target, visible, reason, children: (it.children ?? []).map(mapItem) };
    };
    model = { kind: "navigation", navType: def.navType ?? "sidebar", items: (def.items ?? []).map(mapItem) };
  } else {
    return { provisioned: true as const, found: true as const, composable: false as const, object: { key: obj.object_key, type, name: obj.display_name } };
  }

  return {
    provisioned: true as const, found: true as const, composable: true as const,
    object: { key: obj.object_key, type, name: obj.display_name },
    model, stats: { included, excluded, references: refKeys.size },
  };
}
