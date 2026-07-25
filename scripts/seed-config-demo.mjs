// ============================================================================
// CONFIG DEMO SEED — proves the no-code platform end to end against REAL data.
// ----------------------------------------------------------------------------
// The AMU cohort (scripts/seed-cohort.mjs) already produces real operational
// data (staff, patients, escalations, safety alerts, tasks, CAPA, competency
// decisions). This script authors GOVERNED registry objects — a set of METRIC
// objects whose formulas reference the runtime data functions, one DASHBOARD
// that binds them, and a NAVIGATION_SECTION that links to it — so the live
// metadata-driven surface (/config-view/<key>) renders authentic numbers,
// computed by the metric calculation runtime, for a user scoped to the AMU ward.
//
// It also PRINTS what each metric computes right now (mirroring the runtime's
// data functions + ragOf), which is the verification path given the auth wall.
//
// Idempotent (upsert on object_key). WRITES to the DB in .env.local.
// Run:  node scripts/seed-config-demo.mjs --confirm
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--confirm")) {
  console.error("This script WRITES config objects to the database in .env.local. Re-run with --confirm to proceed.");
  process.exit(1);
}
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  const envUrl = new URL("../.env.local", import.meta.url);
  let raw;
  try { raw = readFileSync(envUrl, "utf8"); }
  catch (e) { console.error(`Could not read .env.local at ${fileURLToPath(envUrl)} (${e.message})`); process.exit(1); }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Resolve the AMU hospital exactly as the runtime callerContext would for a ward user.
const { data: cohort } = await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo");
const H = cohort?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU cohort found — run scripts/seed-cohort.mjs --confirm first."); process.exit(1); }
console.log(`AMU hospital: ${H}\n`);

// Real, hospital-scoped counts — the same data functions the metric runtime exposes.
const count = async (t) => { const { count: c, error } = await db.from(t).select("id", { count: "exact", head: true }).eq("hospital_id", H); return error ? null : (c ?? 0); };
const DF = {
  staff_count: await count("profiles"),
  open_escalations: await count("op_escalations"),
  patients: await count("op_patients"),
  safety_alerts: await count("op_safety_alerts"),
  open_tasks: await count("op_tasks"),
  capa_actions: await count("capa_actions"),
  competency_decisions: await count("competency_decisions"),
};
console.log("Live data functions (AMU-scoped):", Object.entries(DF).map(([k, v]) => `${k}=${v}`).join("  "), "\n");

// Mirror the runtime evaluator for the (simple) demo formulas + ragOf.
const ragOf = (v, g, a, dir) => dir === "lower_better" ? (v <= g ? "green" : v <= a ? "amber" : "red") : (v >= g ? "green" : v >= a ? "amber" : "red");
function evalDemo(formula) {
  const bare = formula.match(/^(\w+)$/);
  if (bare) return DF[bare[1]] ?? null;
  const pct = formula.match(/^pct\((\w+),\s*(\w+)\)$/);
  if (pct) { const a = DF[pct[1]], b = DF[pct[2]]; return b ? Math.round((a / b) * 10000) / 100 : null; }
  return null;
}

const METRICS = [
  { key: "workspace.amu.staffing_level", name: "AMU Registered Staff", formula: "staff_count", unit: "", target: 30, green: 25, amber: 20, direction: "higher_better", viz: "kpi_card" },
  { key: "workspace.amu.escalation_rate", name: "AMU Escalation Rate", formula: "pct(open_escalations, patients)", unit: "%", target: 10, green: 15, amber: 25, direction: "lower_better", viz: "gauge" },
  { key: "workspace.amu.open_safety_alerts", name: "Open Safety Alerts", formula: "safety_alerts", unit: "", target: 0, green: 3, amber: 6, direction: "lower_better", viz: "kpi_card" },
  { key: "workspace.amu.open_tasks", name: "Open Ward Tasks", formula: "open_tasks", unit: "", target: 10, green: 10, amber: 20, direction: "lower_better", viz: "trend" },
  { key: "workspace.amu.capa_backlog", name: "CAPA Backlog", formula: "capa_actions", unit: "", target: 3, green: 3, amber: 6, direction: "lower_better", viz: "kpi_card" },
  { key: "workspace.amu.competency_decisions", name: "Competency Decisions", formula: "competency_decisions", unit: "", target: 50, green: 50, amber: 30, direction: "higher_better", viz: "kpi_card" },
];

const base = { status: "active", source: "demo", default_enabled: true, configurability_class: "optional", safety_classification: "operational", schema_version: "1.0.0" };
let wrote = 0;
console.log("── Metrics authored (with live computed value) ──");
for (const m of METRICS) {
  const definition = { formula: m.formula, aggregation: "ratio", unit: m.unit, target: m.target, thresholds: { green: m.green, amber: m.amber }, direction: m.direction, refresh: "daily" };
  const { error } = await db.from("configuration_registry_objects").upsert({ object_key: m.key, object_type: "METRIC", display_name: m.name, description: `AMU operational KPI — ${m.name}.`, definition, ...base }, { onConflict: "object_key" });
  if (error) { console.error(`  ✗ ${m.key}: ${error.message}`); continue; }
  wrote++;
  const v = evalDemo(m.formula);
  const rag = v == null ? "—" : ragOf(v, m.green, m.amber, m.direction);
  console.log(`  ${m.name.padEnd(26)} ${m.formula.padEnd(34)} = ${String(v).padStart(6)}${m.unit}  [${rag}]`);
}

// Dashboard binding the metrics + a navigation section linking to it.
const dash = {
  object_key: "workspace.amu.ops_overview", object_type: "DASHBOARD", display_name: "AMU Operational Overview",
  description: "Live operational KPIs for the Acute Medical Unit, composed from governed metrics.",
  definition: { tiles: METRICS.map((m, i) => ({ key: `tile_${i + 1}`, viz: m.viz, title: m.name, metric: m.key, span: 4 })), refresh: { mode: "realtime" }, exports: ["pdf"] },
  dependencies: METRICS.map((m) => ({ type: "METRIC_REF", objectKey: m.key })), ...base,
};
const nav = {
  object_key: "workspace.amu.nav", object_type: "NAVIGATION_SECTION", display_name: "AMU Navigation",
  definition: { navType: "sidebar", items: [{ key: "nav_overview", label: "Operational Overview", icon: "📊", target: "workspace.amu.ops_overview", route: "", roles: "", children: [] }] },
  dependencies: [{ type: "NAV_TARGET", objectKey: "workspace.amu.ops_overview" }], ...base,
};
for (const o of [dash, nav]) {
  const { error } = await db.from("configuration_registry_objects").upsert(o, { onConflict: "object_key" });
  if (error) console.error(`  ✗ ${o.object_key}: ${error.message}`); else { wrote++; console.log(`  ✓ ${o.object_type.padEnd(20)} ${o.object_key}`); }
}

console.log(`\nWrote ${wrote} governed config object(s).`);
console.log("Live surfaces (sign in as an AMU user, or super-admin for estate-wide):");
console.log("  /config-view/workspace.amu.ops_overview   (dashboard — live KPI values)");
console.log("  /config-view/workspace.amu.nav            (navigation → dashboard)");
console.log("Done.");
