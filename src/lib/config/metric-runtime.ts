// Metric Calculation Runtime (NCP-005 runtime) — computes a LIVE numeric value for a metric by binding its
// formula tokens to a curated registry of real, hospital-scoped platform data functions (and to other metrics,
// recursively), then evaluating the arithmetic with a safe recursive-descent evaluator (never eval()). A metric
// whose formula references only known data functions / metrics computes a real value + RAG; one that references
// unknown tokens returns null with the unresolved list (honest — no fabricated numbers). Values are scoped to the
// caller's hospital via ctx; with no hospital they aggregate across the estate.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ragOf } from "@/lib/config/simulate";
import type { ScopeCtx } from "@/lib/config/workspace-config";

const FUNCS = new Set(["sum", "avg", "count", "ratio", "min", "max", "round", "abs", "pct", "if", "coalesce"]);

// A real scoped count. Filters by hospital_id when present + when the column exists; fails soft to null.
async function count(admin: any, table: string, ctx: ScopeCtx): Promise<number | null> {
  try {
    let q = admin.from(table).select("*", { count: "exact", head: true });
    if (ctx.hospitalId) q = q.eq("hospital_id", ctx.hospitalId);
    const { count: n, error } = await q;
    return error ? null : (n ?? 0);
  } catch { return null; }
}

// Curated data-function registry — each resolves to a real number for the context. Authors reference these bare
// identifiers in metric formulas (e.g. "open_escalations / patients * 100").
export const DATA_FUNCTIONS: Record<string, { label: string; fn: (admin: any, ctx: ScopeCtx) => Promise<number | null> }> = {
  staff_count: { label: "Registered staff", fn: (a, c) => count(a, "profiles", c) },
  competency_decisions: { label: "Competency decisions", fn: (a, c) => count(a, "competency_decisions", c) },
  assessments: { label: "Assessments", fn: (a, c) => count(a, "assessments", c) },
  open_escalations: { label: "Escalations", fn: (a, c) => count(a, "op_escalations", c) },
  patients: { label: "Patients", fn: (a, c) => count(a, "op_patients", c) },
  active_shifts: { label: "Shifts", fn: (a, c) => count(a, "op_shifts", c) },
  safety_alerts: { label: "Safety alerts", fn: (a, c) => count(a, "op_safety_alerts", c) },
  open_tasks: { label: "Tasks", fn: (a, c) => count(a, "op_tasks", c) },
  capa_actions: { label: "CAPA actions", fn: (a, c) => count(a, "capa_actions", c) },
  evidence_items: { label: "Evidence items", fn: (a, c) => count(a, "evidence", c) },
};
export const listDataFunctions = () => Object.entries(DATA_FUNCTIONS).map(([name, d]) => ({ name, label: d.label }));

// Safe arithmetic evaluator — recursive descent over numbers, pre-resolved identifiers and a small function set.
function applyFunc(name: string, args: number[]): number {
  switch (name) {
    case "round": return Math.round(args[0]);
    case "abs": return Math.abs(args[0]);
    case "min": return Math.min(...args);
    case "max": return Math.max(...args);
    case "avg": return args.length ? args.reduce((a, b) => a + b, 0) / args.length : 0;
    case "sum": return args.reduce((a, b) => a + b, 0);
    case "pct": return args[1] ? (args[0] / args[1]) * 100 : 0;
    case "ratio": return args[1] ? args[0] / args[1] : 0;
    case "coalesce": return args.find(x => !Number.isNaN(x)) ?? 0;
    case "count": return args[0];
    default: throw new Error(`unknown function ${name}`);
  }
}
export function evalExpr(src: string, vars: Record<string, number>): number {
  const s = src; let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function factor(): number {
    ws();
    if (s[i] === "-") { i++; return -factor(); }
    if (s[i] === "(") { i++; const v = expr(); ws(); if (s[i] !== ")") throw new Error("expected )"); i++; return v; }
    if (/[0-9.]/.test(s[i])) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; const n = parseFloat(s.slice(i, j)); i = j; return n; }
    if (/[a-zA-Z_]/.test(s[i])) {
      let j = i; while (j < s.length && /[a-zA-Z0-9_.]/.test(s[j])) j++;
      const name = s.slice(i, j); i = j; ws();
      if (s[i] === "(") { i++; const args: number[] = []; ws(); if (s[i] !== ")") { args.push(expr()); ws(); while (s[i] === ",") { i++; args.push(expr()); ws(); } } if (s[i] !== ")") throw new Error("expected )"); i++; return applyFunc(name.toLowerCase(), args); }
      if (name in vars) return vars[name];
      throw new Error(`unresolved ${name}`);
    }
    throw new Error(`unexpected '${s[i] ?? "end"}'`);
  }
  function term(): number { let v = factor(); ws(); while (s[i] === "*" || s[i] === "/" || s[i] === "%") { const op = s[i++]; const r = factor(); v = op === "*" ? v * r : op === "/" ? (r ? v / r : 0) : (r ? v % r : 0); ws(); } return v; }
  function expr(): number { let v = term(); ws(); while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; ws(); } return v; }
  const out = expr(); ws();
  if (i < s.length) throw new Error(`trailing '${s.slice(i)}'`);
  return out;
}

function ragForMetric(def: any, value: number): string | null {
  const g = Number(def?.thresholds?.green), a = Number(def?.thresholds?.amber);
  if (!Number.isFinite(g) || !Number.isFinite(a)) return null;
  return ragOf(value, g, a, def?.direction ?? "lower_better");
}

export type MetricValue = { value: number | null; rag?: string | null; resolved?: Record<string, number>; unresolved?: string[]; error?: string };

// Compute a metric's live value: resolve each formula token (data function | metric ref | number), evaluate.
export async function computeMetric(admin: any, metricKey: string, ctx: ScopeCtx, seen = new Set<string>()): Promise<MetricValue> {
  if (seen.has(metricKey)) return { value: null, error: "circular reference" };
  seen.add(metricKey);
  const { data: m } = await admin.from("configuration_registry_objects").select("object_type, definition").eq("object_key", metricKey).maybeSingle();
  if (!m || m.object_type !== "METRIC") return { value: null, error: "not a metric" };
  const def = m.definition ?? {};
  const formula = String(def.formula ?? "").trim();
  if (!formula) return { value: null, error: "no formula" };

  const ids = [...new Set([...formula.matchAll(/[a-zA-Z_][a-zA-Z0-9_.]*/g)].map(x => x[0]))].filter(t => !FUNCS.has(t.toLowerCase()));
  const vars: Record<string, number> = {}; const unresolved: string[] = [];
  for (const id of ids) {
    if (DATA_FUNCTIONS[id]) { const v = await DATA_FUNCTIONS[id].fn(admin, ctx); if (v == null) unresolved.push(id); else vars[id] = v; }
    else { const sub = await computeMetric(admin, id, ctx, seen); if (sub.value != null) vars[id] = sub.value; else unresolved.push(id); }
  }
  if (unresolved.length) return { value: null, unresolved, resolved: vars };
  try { const raw = evalExpr(formula, vars); const value = Math.round(raw * 100) / 100; return { value, rag: ragForMetric(def, value), resolved: vars }; }
  catch (e) { return { value: null, error: e instanceof Error ? e.message : "evaluation failed", resolved: vars }; }
}
