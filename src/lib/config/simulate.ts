// Configuration simulation evaluators (NCP-012 / NCP-015) — pure, server-side replicas of the semantics each
// designer simulates in the browser, so the Testing Centre and the runtime resolve identically to what the
// author previewed. Kept deliberately in lockstep with MetricEditor.ragOf, RuleEditor.cellMatches and
// PermissionDesigner.ruleHolds.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- Metric RAG (mirrors MetricEditor.ragOf; direction values are "lower_better" | "higher_better") ----
export function ragOf(v: number, green: number, amber: number, dir: string): string {
  if (dir === "lower_better") return v <= green ? "green" : v <= amber ? "amber" : "red";
  return v >= green ? "green" : v >= amber ? "amber" : "red";
}
export function evalMetric(def: any, value: number): { rag: string | null } {
  const g = Number(def?.thresholds?.green), a = Number(def?.thresholds?.amber);
  if (!Number.isFinite(value) || !Number.isFinite(g) || !Number.isFinite(a)) return { rag: null };
  return { rag: ragOf(value, g, a, def?.direction ?? "lower_better") };
}

// ---- Rule decision table (mirrors RuleEditor.cellMatches + first-match hit policy) ----
export function cellMatches(cell: string, value: string): boolean {
  const c = String(cell ?? "").trim();
  if (!c || c === "*" || c.toLowerCase() === "any") return true;
  const m = c.match(/^(>=|<=|>|<|!=|=)\s*(.+)$/);
  if (m) {
    const op = m[1], rhs = m[2].trim(), num = parseFloat(value), rn = parseFloat(rhs);
    if (!isNaN(num) && !isNaN(rn) && ["<", ">", "<=", ">="].includes(op)) return op === ">=" ? num >= rn : op === "<=" ? num <= rn : op === ">" ? num > rn : num < rn;
    if (op === "=") return !isNaN(num) && !isNaN(rn) ? num === rn : value.trim().toLowerCase() === rhs.toLowerCase();
    if (op === "!=") return !isNaN(num) && !isNaN(rn) ? num !== rn : value.trim().toLowerCase() !== rhs.toLowerCase();
  }
  return value.trim().toLowerCase() === c.toLowerCase();
}
export function evalRule(def: any, inputs: Record<string, any>): { matched: boolean; rowIndex: number; outputs: Record<string, string> } {
  const conds = Array.isArray(def?.conditions) ? def.conditions : [];
  const acts = Array.isArray(def?.actions) ? def.actions : [];
  const rows = Array.isArray(def?.rows) ? def.rows : [];
  const idx = rows.findIndex((r: any) => conds.every((c: any) => cellMatches(r?.conditions?.[c.key] ?? "", String(inputs?.[c.key] ?? ""))));
  if (idx < 0) return { matched: false, rowIndex: -1, outputs: {} };
  const outputs: Record<string, string> = {};
  for (const a of acts) outputs[a.key] = rows[idx]?.actions?.[a.key] ?? "";
  return { matched: true, rowIndex: idx, outputs };
}

// ---- Permission policy (mirrors PermissionDesigner.ruleHolds + deny-override) ----
const asList = (v: string) => String(v ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
export function ruleHolds(rule: any, ctx: Record<string, string>): boolean {
  const cv = String(ctx?.[rule.attribute] ?? "").trim().toLowerCase();
  const val = String(rule?.value ?? "").trim().toLowerCase();
  switch (rule.operator) {
    case "is": return cv !== "" && cv === val;
    case "is_not": return cv !== val;
    case "in": return cv !== "" && asList(rule.value).includes(cv);
    case "not_in": return !asList(rule.value).includes(cv);
    case "exists": return cv !== "";
    default: return false;
  }
}
export function evalPermission(def: any, ctx: Record<string, string>): { applies: boolean; failing: string[]; effective: any[] } {
  const rules = Array.isArray(def?.rules) ? def.rules : [];
  const grants = Array.isArray(def?.grants) ? def.grants : [];
  const failing = rules.filter((r: any) => !ruleHolds(r, ctx)).map((r: any) => r.attribute);
  const applies = rules.length === 0 || failing.length === 0;
  const m = new Map<string, any>();
  for (const g of grants) { const id = `${g.resource}|${g.resourceKey || "*"}|${g.action}`; const ex = m.get(id); if (!ex || (ex.effect === "allow" && g.effect === "deny")) m.set(id, g); }
  return { applies, failing, effective: [...m.values()] };
}
