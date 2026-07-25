// ============================================================================
// COHORT VERIFICATION (read-only) — reports what each manager lens should show
// for the seeded AMU ward, scoped exactly as the loaders scope. No writes.
// Run:  node scripts/verify-cohort.mjs
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const today = new Date();
const daysUntil = (d) => d ? Math.round((new Date(d) - today) / 86400000) : null;
const tally = (rows, key) => rows.reduce((a, r) => { const k = r[key] ?? "∅"; a[k] = (a[k] ?? 0) + 1; return a; }, {});
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join("  ") || "—";
const count = async (t, col, val) => {
  const q = db.from(t).select("id", { count: "exact", head: true });
  const { count: c, error } = await (col ? q.eq(col, val) : q);
  return error ? `ERR(${error.message})` : c;
};

// Resolve the AMU cohort + hospital exactly as a hospital-scoped lens would.
const { data: cohort } = await db.from("profiles")
  .select("id, hospital_id, role").ilike("email", "%@amu.competen.demo");
if (!cohort?.length) { console.error("No AMU cohort found — run scripts/seed-cohort.mjs first."); process.exit(1); }
const H = cohort.find((p) => p.hospital_id)?.hospital_id;
const nurseIds = cohort.filter((p) => p.role === "nurse").map((p) => p.id);
console.log(`AMU hospital: ${H}`);
console.log(`Cohort: ${cohort.length} profiles (${nurseIds.length} nurses + ${cohort.length - nurseIds.length} manager)\n`);

// ── Unit Manager · Workforce ────────────────────────────────────────────────
console.log("── Unit Manager · Workforce ─────────────");
console.log(`  nurses on AMU: ${await count("profiles", "hospital_id", H)} profiles hospital-scoped (incl. manager)`);

// ── CPD (scopes through nurse_id → profile.hospital_id) ─────────────────────
{
  const { data } = await db.from("cpd_logs").select("cpd_points, verified").in("user_id", nurseIds);
  const verified = (data ?? []).filter((r) => r.verified).length;
  console.log(`  CPD logs: ${(data ?? []).length}  (verified=${verified})`);
}

// ── Learning · Mandatory compliance ─────────────────────────────────────────
console.log("\n── Unit Manager · Mandatory Learning ────");
{
  const { data } = await db.from("learning_enrolments").select("status, due_date").eq("hospital_id", H);
  const t = tally(data ?? [], "status");
  const total = (data ?? []).length;
  const completed = t.completed ?? 0;
  console.log(`  enrolments: ${total}  [${fmt(t)}]`);
  console.log(`  compliance: ${total ? Math.round((completed / total) * 100) : 0}% complete`);
}

// ── Competency readiness (scopes through nurse_id) ──────────────────────────
console.log("\n── CMO / UMW · Competency readiness ─────");
{
  const { data } = await db.from("competency_decisions").select("outcome, expiry_date").in("nurse_id", nurseIds);
  const t = tally(data ?? [], "outcome");
  const expired = (data ?? []).filter((r) => r.expiry_date && daysUntil(r.expiry_date) < 0).length;
  const soon = (data ?? []).filter((r) => r.expiry_date && daysUntil(r.expiry_date) >= 0 && daysUntil(r.expiry_date) <= 60).length;
  console.log(`  decisions: ${(data ?? []).length}  [${fmt(t)}]`);
  console.log(`  expiry:    expired=${expired}  due≤60d=${soon}`);
  console.log(`  cycles:    ${await count("competency_cycles", "hospital_id", H)}`);
}

// ── Credentials · CMO expiry watch ──────────────────────────────────────────
console.log("\n── CMO · Credentials ────────────────────");
{
  const { data } = await db.from("professional_credentials").select("status, expiry_date").eq("hospital_id", H);
  const t = tally(data ?? [], "status");
  const soon = (data ?? []).filter((r) => r.expiry_date && daysUntil(r.expiry_date) >= 0 && daysUntil(r.expiry_date) <= 60).length;
  console.log(`  credentials: ${(data ?? []).length}  [${fmt(t)}]  due≤60d=${soon}`);
}

// ── Quality & Safety ────────────────────────────────────────────────────────
console.log("\n── Unit Manager · Quality & Safety ──────");
{
  const { data: inc } = await db.from("op_incidents").select("status, severity, near_miss").eq("hospital_id", H);
  const nm = (inc ?? []).filter((r) => r.near_miss).length;
  console.log(`  incidents: ${(inc ?? []).length}  [${fmt(tally(inc ?? [], "status"))}]  near_miss=${nm}`);
  const { data: capa } = await db.from("op_quality_actions").select("status, action_type").eq("hospital_id", H);
  console.log(`  quality actions: ${(capa ?? []).length}  [${fmt(tally(capa ?? [], "status"))}]`);
}

// ── Operations ──────────────────────────────────────────────────────────────
console.log("\n── Unit Manager · Operations ────────────");
for (const t of ["op_patients", "op_shifts", "op_observations", "op_tasks", "op_escalations", "op_safety_alerts"]) {
  console.log(`  ${t.padEnd(18)} ${await count(t, "hospital_id", H)}`);
}
console.log("\nDone — these are the numbers each lens should render for the AMU ward.");
