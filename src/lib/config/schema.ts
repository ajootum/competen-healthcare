// Configuration Schema & Object Model (NCP-016) — the canonical metadata contract for every configurable
// platform object. This is the single source of truth the spec calls for: it formalises, per object type, the
// registry envelope (identity/governance fields) and the definition shape that each type-specific designer
// (NCP-001..011) writes. New/AI-generated/migrated artifacts validate against these schemas so the platform
// stays consistent. The deeper schema-version migration + compatibility matrix (§9) are next-phase; the
// enums here ARE the contract the live PATCH validators enforce inline.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type FieldSpec = {
  key: string; label: string;
  type: "string" | "number" | "boolean" | "enum" | "array" | "formula" | "object";
  required?: boolean; enum?: string[]; of?: string; keyed?: boolean; note?: string;
};
export type ObjectSchema = { type: string; title: string; icon: string; envelope: FieldSpec[]; definition: FieldSpec[]; note?: string };

// Enum vocabularies (kept identical to the designers + the objects PATCH route).
export const ENUMS = {
  configurability_class: ["mandatory_configurable", "optional", "conditional", "user_personalisable"],
  safety_classification: ["non_clinical", "administrative", "operational", "clinical_support", "clinical_safety_relevant", "clinical_safety_critical", "security_critical", "regulatory_critical", "financial_control_critical"],
  config_level: ["PLATFORM", "ENTERPRISE", "TENANT", "UNIT", "USER"],
  metric_direction: ["lower_better", "higher_better"],
  field_type: ["text", "textarea", "number", "date", "datetime", "dropdown", "multiselect", "radio", "checkbox", "toggle", "signature", "file", "rating", "email", "phone", "patient_lookup", "staff_lookup", "currency", "url"],
  node_type: ["start", "task", "decision", "approval", "timer", "notification", "integration", "ai_action", "end"],
  viz: ["kpi_card", "table", "pivot", "line", "bar", "pie", "heatmap", "treemap", "scatter", "map", "gauge", "timeline", "calendar", "trend", "custom"],
  section_type: ["cover", "summary", "kpi_band", "table", "chart", "narrative", "page_break"],
  resource: ["workspace", "module", "dashboard", "widget", "form", "field", "record", "report", "workflow", "ai_assistant", "administration", "configuration"],
  action: ["view", "create", "edit", "delete", "execute", "approve", "configure", "admin"],
  effect: ["allow", "deny"],
  attribute: ["role", "profession", "department", "facility", "enterprise", "unit", "location", "shift", "competency_status", "certification", "patient_context", "feature_flag", "tenant_config", "workflow_state", "device_type", "custom"],
  operator: ["is", "is_not", "in", "not_in", "exists"],
  nav_type: ["sidebar", "top", "tabbed", "tree", "mega", "wizard"],
} as const;

// The 12 authorable object types (Configuration Studio) — the envelope is shared, the definition is per-type.
const ENVELOPE: FieldSpec[] = [
  { key: "object_key", label: "Object key", type: "string", required: true, note: "lowercase, dot-separated" },
  { key: "object_type", label: "Object type", type: "enum", required: true },
  { key: "display_name", label: "Display name", type: "string", required: true },
  { key: "description", label: "Description", type: "string" },
  { key: "parent_object_key", label: "Parent", type: "string", note: "soft reference to another object_key" },
  { key: "configurability_class", label: "Configurability", type: "enum", enum: [...ENUMS.configurability_class] },
  { key: "safety_classification", label: "Safety class", type: "enum", enum: [...ENUMS.safety_classification] },
  { key: "allowed_config_levels", label: "Config levels", type: "array", of: "enum", note: "PLATFORM…USER" },
  { key: "dependencies", label: "Dependencies", type: "array", of: "object", note: "{type,objectKey}" },
];

export const OBJECT_SCHEMAS: ObjectSchema[] = [
  { type: "METRIC", title: "Metric / Indicator", icon: "📈", envelope: ENVELOPE, definition: [
    { key: "formula", label: "Formula", type: "formula", required: true, note: "balanced parens; refs resolve to other metrics" },
    { key: "aggregation", label: "Aggregation", type: "string" },
    { key: "unit", label: "Unit", type: "string" },
    { key: "target", label: "Target", type: "number" },
    { key: "thresholds", label: "RAG thresholds", type: "object", note: "{green,amber}" },
    { key: "direction", label: "Direction", type: "enum", enum: [...ENUMS.metric_direction] },
    { key: "refresh", label: "Refresh", type: "string" },
  ], note: "NCP-005 · formula refs become METRIC_REF dependencies" },
  { type: "FORM", title: "Form / Data Capture", icon: "📝", envelope: ENVELOPE, definition: [
    { key: "fields", label: "Fields", type: "array", of: "object", keyed: true, note: "{key,label,type,required,options[]}" },
  ], note: "NCP-003 · unique lowercase field keys; 19 field types" },
  { type: "BUSINESS_RULE", title: "Business Rule", icon: "⚖️", envelope: ENVELOPE, definition: [
    { key: "conditions", label: "Condition columns", type: "array", of: "object", keyed: true },
    { key: "actions", label: "Action columns", type: "array", of: "object", keyed: true, required: true },
    { key: "rows", label: "Rows", type: "array", of: "object" },
  ], note: "NCP-007 · decision table; ≥1 action column; unique column keys" },
  { type: "PAGE", title: "Page / Layout", icon: "🧱", envelope: ENVELOPE, definition: [
    { key: "grid", label: "Grid columns", type: "number", note: "default 12" },
    { key: "rows", label: "Rows", type: "array", of: "object", note: "{columns:[{span,widget}]}" },
  ], note: "NCP-001 · per-row span sum ≤ grid; widget refs become WIDGET_REF deps" },
  { type: "WORKFLOW", title: "Workflow / Automation", icon: "🔀", envelope: ENVELOPE, definition: [
    { key: "nodes", label: "Nodes", type: "array", of: "object", keyed: true, required: true, note: "{key,type,label,config}" },
    { key: "transitions", label: "Transitions", type: "array", of: "object", note: "{from,to,condition?}" },
  ], note: "NCP-004 · node types start…end; transitions reference existing nodes" },
  { type: "DASHBOARD", title: "Dashboard", icon: "📊", envelope: ENVELOPE, definition: [
    { key: "tiles", label: "Tiles", type: "array", of: "object", keyed: true, note: "{key,viz,title,metric,span}" },
    { key: "filters", label: "Global filters", type: "array", of: "object" },
    { key: "refresh", label: "Refresh policy", type: "object" },
    { key: "exports", label: "Export formats", type: "array", of: "string" },
  ], note: "NCP-006 · 15 viz types; span 1–12; bound metrics become METRIC_REF deps" },
  { type: "REPORT", title: "Report", icon: "📄", envelope: ENVELOPE, definition: [
    { key: "sections", label: "Sections", type: "array", of: "object", keyed: true, note: "{key,type,title,metric}" },
    { key: "params", label: "Parameters", type: "array", of: "object" },
    { key: "page", label: "Page settings", type: "object" },
    { key: "distribution", label: "Distribution", type: "object" },
  ], note: "NCP-006 · ordered sections; bound metrics become METRIC_REF deps" },
  { type: "PERMISSION", title: "Permission Set", icon: "🔐", envelope: ENVELOPE, definition: [
    { key: "grants", label: "Grants", type: "array", of: "object", keyed: true, note: "{key,resource,resourceKey,action,effect}" },
    { key: "rules", label: "Visibility rules", type: "array", of: "object", keyed: true, note: "{key,attribute,operator,value}" },
    { key: "inherits", label: "Inherits", type: "array", of: "string", note: "permission set keys" },
    { key: "effective", label: "Effective window", type: "object" },
  ], note: "NCP-008 · RBAC grants + ABAC rules; inherits become PERMISSION_REF deps; deny overrides allow" },
  { type: "NAVIGATION_SECTION", title: "Navigation Section", icon: "🧭", envelope: ENVELOPE, definition: [
    { key: "navType", label: "Navigation type", type: "enum", enum: [...ENUMS.nav_type] },
    { key: "items", label: "Menu items", type: "array", of: "object", keyed: true, note: "{key,label,icon,target,route,roles,children[]}" },
    { key: "landing", label: "Landing", type: "string" },
    { key: "quickActions", label: "Quick actions", type: "array", of: "object" },
  ], note: "NCP-009 · one level of nesting; linked objects become NAV_TARGET deps" },
  { type: "WIDGET", title: "Widget", icon: "🧩", envelope: ENVELOPE, definition: [
    { key: "kind", label: "Widget kind", type: "string" },
    { key: "data_source_key", label: "Data source", type: "string" },
    { key: "options", label: "Options", type: "object" },
  ], note: "NCP-002 · authored via WCE-005 catalogue (partial)" },
  { type: "MODULE", title: "Module", icon: "📦", envelope: ENVELOPE, definition: [
    { key: "route", label: "Route", type: "string" },
    { key: "icon", label: "Icon", type: "string" },
  ], note: "Container object · children reference it via parent_object_key" },
  { type: "DATA_SOURCE", title: "Data Source", icon: "🔌", envelope: ENVELOPE, definition: [
    { key: "connector", label: "Connector", type: "string" },
    { key: "endpoint", label: "Endpoint", type: "string" },
    { key: "options", label: "Options", type: "object" },
  ], note: "NCP-010 · bound by objects via data_source_key" },
];

export const schemaFor = (type: string) => OBJECT_SCHEMAS.find(s => s.type === type) ?? null;

export type SchemaIssue = { path: string; severity: "error" | "warning"; message: string };

// Contract validation — required fields present, enum membership, basic typing, and keyed-array key uniqueness.
// The authoritative per-type semantics still live in the objects PATCH route; this is the portable contract check
// used by testing (NCP-012), migration pre-flight (NCP-020) and AI-generated artifacts (NCP-014).
export function validateDefinition(type: string, definition: any): SchemaIssue[] {
  const schema = schemaFor(type);
  if (!schema) return [{ path: "object_type", severity: "error", message: `Unknown object type "${type}"` }];
  const def = definition ?? {};
  const issues: SchemaIssue[] = [];
  const typeOk = (v: any, spec: FieldSpec): boolean => {
    switch (spec.type) {
      case "number": return typeof v === "number" && !Number.isNaN(v);
      case "boolean": return typeof v === "boolean";
      case "array": return Array.isArray(v);
      case "object": return v && typeof v === "object" && !Array.isArray(v);
      case "enum": return typeof v === "string" && (!spec.enum || spec.enum.includes(v));
      default: return typeof v === "string";
    }
  };
  for (const spec of schema.definition) {
    const v = def[spec.key];
    const present = v !== undefined && v !== null && v !== "";
    if (spec.required && !present && !(spec.type === "array" && Array.isArray(v))) {
      issues.push({ path: spec.key, severity: "error", message: `"${spec.label}" is required` });
      continue;
    }
    if (!present) continue;
    if (!typeOk(v, spec)) { issues.push({ path: spec.key, severity: "error", message: `"${spec.label}" should be ${spec.type}${spec.type === "enum" ? ` (${spec.enum?.join("/")})` : ""}` }); continue; }
    if (spec.keyed && Array.isArray(v)) {
      const seen = new Set<string>();
      v.forEach((el: any, i: number) => {
        const k = el?.key;
        if (!k || !/^[a-z][a-z0-9_]*$/.test(String(k))) issues.push({ path: `${spec.key}[${i}].key`, severity: "error", message: `Invalid key "${k ?? ""}" — lowercase letters/numbers/underscore` });
        else if (seen.has(k)) issues.push({ path: `${spec.key}[${i}].key`, severity: "error", message: `Duplicate key "${k}"` });
        else seen.add(k);
      });
    }
  }
  // Warn about unknown definition keys (forward-compat: warning, not error).
  const known = new Set([...schema.definition.map(f => f.key), "refs", "fieldCount", "rowCount", "nodeCount", "tileCount", "sectionCount", "grantCount", "itemCount"]);
  for (const k of Object.keys(def)) if (!known.has(k)) issues.push({ path: k, severity: "warning", message: `Unrecognised definition key "${k}"` });
  return issues;
}
