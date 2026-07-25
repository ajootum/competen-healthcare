import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Configuration Studio — no-code authoring of a governed configuration object. POST creates a DRAFT object in
// the WCE-002 registry (source:"studio"); the client then raises a WCE-004 change request for it, so it flows
// through governance + the dependency gate before going active. Super-admin gated. Mirrors the proven
// syncRegistryFromCatalog insert shape.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = ["MODULE", "WIDGET", "PAGE", "DASHBOARD", "REPORT", "METRIC", "FORM", "WORKFLOW", "BUSINESS_RULE", "NAVIGATION_SECTION", "PERMISSION", "DATA_SOURCE"];
const CLASSES = ["mandatory_configurable", "optional", "conditional", "user_personalisable"];
const SAFETY = ["non_clinical", "administrative", "operational", "clinical_support", "clinical_safety_relevant", "clinical_safety_critical", "security_critical", "regulatory_critical", "financial_control_critical"];
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

// Lightweight metric-formula validation (NCP-005 §8): balanced parentheses, allowed tokens, self-reference.
const FUNCS = new Set(["sum", "avg", "count", "ratio", "min", "max", "round", "abs", "pct", "if", "coalesce"]);
function validateFormula(formula: string, selfKey: string): { ok: boolean; error?: string; refs: string[] } {
  const f = formula.trim();
  if (!f) return { ok: true, refs: [] };
  let depth = 0;
  for (const ch of f) { if (ch === "(") depth++; else if (ch === ")") { if (--depth < 0) return { ok: false, error: "Unbalanced parentheses", refs: [] }; } }
  if (depth !== 0) return { ok: false, error: "Unbalanced parentheses", refs: [] };
  if (!/^[\w\s.+\-*/(),%<>=?:]+$/.test(f)) return { ok: false, error: "Formula contains unsupported characters", refs: [] };
  const refs = [...new Set([...f.matchAll(/[a-zA-Z_][a-zA-Z0-9_.]*/g)].map(m => m[0]).filter(t => !FUNCS.has(t.toLowerCase())))];
  if (refs.includes(selfKey)) return { ok: false, error: "Formula references itself — a circular dependency", refs };
  return { ok: true, refs };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Configuration authoring is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));

  const object_type = String(b.object_type ?? "");
  const object_key = String(b.object_key ?? "").trim().toLowerCase();
  const display_name = String(b.display_name ?? "").trim();
  if (!TYPES.includes(object_type)) return badRequest("Invalid object type");
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(object_key)) return badRequest("object_key must be lowercase, dot-separated (e.g. workspace.ward.my_metric)");
  if (!display_name) return badRequest("Display name required");
  const parent = String(b.parent_object_key ?? "").trim() || null;
  const configurability_class = CLASSES.includes(b.configurability_class) ? b.configurability_class : "optional";
  const safety_classification = SAFETY.includes(b.safety_classification) ? b.safety_classification : "operational";

  const { data: existing, error: exErr } = await admin.from("configuration_registry_objects").select("object_key").eq("object_key", object_key).maybeSingle();
  if (exErr && /does not exist|schema cache/i.test(exErr.message ?? "")) return NextResponse.json({ error: "Registry not provisioned — run migration 092" }, { status: 409 });
  if (existing) return badRequest(`Object key "${object_key}" already exists`);
  if (parent) {
    const { data: p } = await admin.from("configuration_registry_objects").select("object_key").eq("object_key", parent).maybeSingle();
    if (!p) return badRequest(`Parent "${parent}" is not in the registry`);
  }

  const now = new Date().toISOString();
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
  const row = {
    object_key, object_type, display_name, description: String(b.description ?? "").trim() || null,
    parent_object_key: parent, configurability_class, safety_classification, override_policy: "restricted",
    default_enabled: true, mandatory: false, configuration_owner: "TENANT", owner_team: "Platform",
    route: null, data_source_key: String(b.data_source_key ?? "").trim() || null,
    allowed_config_levels: ["PLATFORM", "ENTERPRISE", "TENANT", "UNIT", "USER"],
    dependencies: parent ? [{ type: "PARENT", objectKey: parent }] : [],
    tags: ["studio"], display_order: 0, source: "studio", schema_version: "1.0.0", status: "draft",
    created_at: now, created_by: userId, updated_at: now, updated_by: userId,
  };
  const { data, error } = await admin.from("configuration_registry_objects").insert(row).select("object_key, object_type, display_name, status").single();
  if (error) return badRequest(error.message);
  await admin.from("configuration_registry_audit").insert({ object_key, action: "authored", actor_id: userId, actor_name: me?.full_name ?? null, new_value: { object_type, source: "studio" } });
  return NextResponse.json({ ok: true, object: data });
}

// PATCH — save the type-specific definition body onto an object. For a METRIC this is the formula +
// aggregation + target + thresholds + direction; the formula is validated and its metric references are
// wired into the object's dependencies so the dependency graph + publish gate account for them.
export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Configuration authoring is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const object_key = String(b.object_key ?? "").trim().toLowerCase();
  if (!object_key) return badRequest("object_key required");

  const { data: obj, error: e0 } = await admin.from("configuration_registry_objects").select("object_key, object_type, dependencies").eq("object_key", object_key).maybeSingle();
  if (e0 && missing(e0)) return NextResponse.json({ error: "Registry not provisioned — run migration 092" }, { status: 409 });
  if (!obj) return badRequest("Object not found");

  const def: any = { ...(b.definition ?? {}) };
  let deps: any[] = Array.isArray(obj.dependencies) ? obj.dependencies : [];
  if (obj.object_type === "METRIC") {
    const v = validateFormula(String(def.formula ?? ""), object_key);
    if (!v.ok) return badRequest(v.error!);
    def.refs = v.refs;
    const registryRefs = v.refs.length ? (((await admin.from("configuration_registry_objects").select("object_key").in("object_key", v.refs)).data) ?? []).map((r: any) => r.object_key) : [];
    deps = [...deps.filter((d: any) => d?.type !== "METRIC_REF"), ...registryRefs.map((k: string) => ({ type: "METRIC_REF", objectKey: k }))];
  }
  if (obj.object_type === "FORM") {
    const fields = Array.isArray(def.fields) ? def.fields : [];
    const seen = new Set<string>();
    for (const fl of fields) {
      if (!fl?.key || !/^[a-z][a-z0-9_]*$/.test(fl.key)) return badRequest(`Invalid field key "${fl?.key ?? ""}" — lowercase letters/numbers/underscore`);
      if (seen.has(fl.key)) return badRequest(`Duplicate field key "${fl.key}"`);
      seen.add(fl.key);
      if (!String(fl.label ?? "").trim()) return badRequest(`Field "${fl.key}" needs a label`);
    }
    def.fieldCount = fields.length;
  }
  if (obj.object_type === "BUSINESS_RULE") {
    const conds = Array.isArray(def.conditions) ? def.conditions : [];
    const acts = Array.isArray(def.actions) ? def.actions : [];
    if (!acts.length) return badRequest("A decision table needs at least one action (output) column");
    const seen = new Set<string>();
    for (const col of [...conds, ...acts]) {
      if (!col?.key || !/^[a-z][a-z0-9_]*$/.test(col.key)) return badRequest(`Invalid column key "${col?.key ?? ""}" — lowercase letters/numbers/underscore`);
      if (seen.has(col.key)) return badRequest(`Duplicate column key "${col.key}"`);
      seen.add(col.key);
    }
    def.rowCount = Array.isArray(def.rows) ? def.rows.length : 0;
  }
  if (obj.object_type === "PAGE") {
    const grid = Number(def.grid) || 12;
    const rows = Array.isArray(def.rows) ? def.rows : [];
    const widgetRefs = new Set<string>();
    for (let ri = 0; ri < rows.length; ri++) {
      const cols = Array.isArray(rows[ri]?.columns) ? rows[ri].columns : [];
      let sum = 0;
      for (const col of cols) {
        const span = Number(col?.span);
        if (!Number.isInteger(span) || span < 1 || span > grid) return badRequest(`Row ${ri + 1}: column span must be 1–${grid}`);
        sum += span;
        if (typeof col?.widget === "string" && col.widget.startsWith("widget.")) widgetRefs.add(col.widget);
      }
      if (sum > grid) return badRequest(`Row ${ri + 1}: column spans total ${sum}, exceeding the ${grid}-column grid`);
    }
    def.rowCount = rows.length;
    // Wire referenced widgets into dependencies (real registry keys), so the graph + gate account for them.
    const realRefs = widgetRefs.size ? (((await admin.from("configuration_registry_objects").select("object_key").in("object_key", [...widgetRefs])).data) ?? []).map((r: any) => r.object_key) : [];
    deps = [...deps.filter((d: any) => d?.type !== "WIDGET_REF"), ...realRefs.map((k: string) => ({ type: "WIDGET_REF", objectKey: k }))];
  }
  if (obj.object_type === "WORKFLOW") {
    const NODE_TYPES = ["start", "task", "decision", "approval", "timer", "notification", "integration", "ai_action", "end"];
    const nodes = Array.isArray(def.nodes) ? def.nodes : [];
    const trans = Array.isArray(def.transitions) ? def.transitions : [];
    const keys = new Set<string>();
    for (const n of nodes) {
      if (!n?.key || !/^[a-z][a-z0-9_]*$/.test(n.key)) return badRequest(`Invalid node key "${n?.key ?? ""}" — lowercase letters/numbers/underscore`);
      if (keys.has(n.key)) return badRequest(`Duplicate node key "${n.key}"`);
      keys.add(n.key);
      if (!NODE_TYPES.includes(n.type)) return badRequest(`Node "${n.key}": invalid type`);
      if (!String(n.label ?? "").trim()) return badRequest(`Node "${n.key}" needs a label`);
    }
    for (const tr of trans) {
      if (!keys.has(tr?.from) || !keys.has(tr?.to)) return badRequest(`Transition references an unknown node (${tr?.from ?? "?"} → ${tr?.to ?? "?"})`);
    }
    def.nodeCount = nodes.length;
  }

  const { error } = await admin.from("configuration_registry_objects").update({ definition: def, dependencies: deps, updated_at: new Date().toISOString(), updated_by: userId }).eq("object_key", object_key);
  if (error) return missing(error) ? NextResponse.json({ error: "Run migration 094 to enable object definitions" }, { status: 409 }) : badRequest(error.message);
  await admin.from("configuration_registry_audit").insert({ object_key, action: "define", actor_id: userId, new_value: def });
  return NextResponse.json({ ok: true, definition: def });
}
