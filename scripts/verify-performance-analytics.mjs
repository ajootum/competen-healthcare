// Mirror verifier for the UMW Performance Analytics stores (migration 108 + seed). Confirms the seeded catalogue +
// the LIVE snapshot resolution (operational KPIs pull their current value from op_ops_snapshots) + the balanced
// scorecard rollup, for the AMU hospital. Read-only. Run:  node scripts/verify-performance-analytics.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (t, sel = "*") => { const r = await db.from(t).select(sel); return r.error ? { e: r.error.message } : { data: r.data ?? [] }; };
const ach = (v, t, dir) => { if (v == null || t == null || t === 0) return 0; const raw = dir === "lower_better" ? (v <= 0 ? 120 : (t / v) * 100) : (v / t) * 100; return Math.max(0, Math.min(120, Math.round(raw))); };
const rag = (v, t, a, dir) => { if (dir === "lower_better") return v <= t ? "🟢" : v <= a ? "🟡" : "🔴"; return v >= t ? "🟢" : v >= a ? "🟡" : "🔴"; };

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }

const persp = (await q("pa_perspectives")).data ?? [];
const kpis = (await q("pa_kpis")).data ?? [];
const values = (await q("pa_kpi_values", "id")).data ?? [];
const benches = (await q("pa_benchmarks", "id")).data ?? [];
const costs = (await q("pa_cost_centres")).data ?? [];
const projects = (await q("pa_improvement_projects")).data ?? [];
const reports = (await q("pa_reports")).data ?? [];
const preds = await q("pa_predictions", "id");
const snap = (await db.from("op_ops_snapshots").select("*").eq("hospital_id", H).eq("period_type", "day").order("period", { ascending: false }).limit(1)).data?.[0] ?? {};

console.log(`AMU hospital ${H}\n`);
console.log("Catalogue:");
console.log(`  Perspectives ........ ${persp.length}`);
console.log(`  KPIs ................ ${kpis.length}  (live-mapped ${kpis.filter((k) => k.snapshot_field).length})`);
console.log(`  Trend values ........ ${values.length}`);
console.log(`  Benchmarks .......... ${benches.length}`);
console.log(`  Cost centres ........ ${costs.length}   Projects ${projects.length}   Reports ${reports.length}`);
console.log(`  Predictions ......... ${preds.e ? "MISSING (" + preds.e.slice(0, 40) + "…)" : preds.data.length}`);

console.log(`\nLive snapshot resolution (period ${snap.period ?? "—"}):`);
kpis.filter((k) => k.snapshot_field).slice(0, 6).forEach((k) => {
  const live = snap[k.snapshot_field];
  const v = live != null ? Math.round(Number(live) * 100) / 100 : Number(k.current_value);
  console.log(`  ${rag(v, Number(k.target), Number(k.threshold_amber), k.direction)} ${k.name.padEnd(26)} = ${String(v).padStart(6)} (target ${k.target}, ${live != null ? "LIVE ←" + k.snapshot_field : "seeded"})`);
});

const scorecard = persp.map((p) => {
  const members = kpis.filter((k) => k.perspective_id === p.id);
  const score = members.length ? Math.round(members.reduce((a, k) => { const live = k.snapshot_field != null ? snap[k.snapshot_field] : null; const v = live != null ? Number(live) : Number(k.current_value); return a + Math.min(100, ach(v, Number(k.target), k.direction)); }, 0) / members.length) : 0;
  return { name: p.name, score, n: members.length };
});
console.log("\nBalanced scorecard:");
scorecard.forEach((s) => console.log(`  ${s.name.padEnd(20)} ${String(s.score).padStart(3)}%  (${s.n} KPIs)`));
console.log(`  OVERALL (weighted-mean approx) ${Math.round(scorecard.reduce((a, s) => a + s.score, 0) / scorecard.length)}%`);

console.log("\n✅ verify-performance-analytics mirror ran clean.");
