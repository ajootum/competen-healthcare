// ============================================================================
// COHORT COMPETENCY TOP-UP — adds the competency spine to the AMU ward cohort.
// ----------------------------------------------------------------------------
// The main cohort seed (seed-cohort.mjs) skips competency decisions when no
// framework with ≥2 competencies exists yet. Once a framework is present (e.g.
// after seed-demo.mjs), run THIS to give every AMU nurse a completed annual
// competency cycle + decisions — lighting up the CMO/UMW readiness and
// reassessment-forecast lenses (competency_decisions scope through
// nurse_id → profile.hospital_id, already set by the main seed).
//
// Idempotent: skips if AMU-COHORT competency cycles already exist.
// Run:  node scripts/seed-cohort-competency.mjs --confirm
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--confirm")) {
  console.error("This script WRITES to the database in .env.local. Re-run with --confirm to proceed.");
  process.exit(1);
}

const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  const envUrl = new URL("../.env.local", import.meta.url);
  let raw;
  try { raw = readFileSync(envUrl, "utf8"); }
  catch (e) {
    console.error(`Could not read .env.local at:\n  ${fileURLToPath(envUrl)}\n  (${e.message})`);
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const die = (msg) => { console.error("ABORT:", msg); process.exit(1); };
const iso = (d) => d.toISOString().slice(0, 10);
const dateFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const ts = (daysOffset, hour = 15) => { const d = new Date(); d.setDate(d.getDate() + daysOffset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const at = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
async function insert(table, row) {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (error) die(`${table}: ${error.message}`);
  return data.id;
}
async function insertMany(table, rows) {
  if (!rows.length) return;
  const { error } = await db.from(table).insert(rows);
  if (error) die(`${table}: ${error.message}`);
}

// ── idempotency guard ────────────────────────────────────────────────────────
{
  const { data: existing } = await db.from("competency_cycles").select("id").eq("notes", "AMU-COHORT").limit(1);
  if (existing?.length) { console.log("AMU competency data already seeded — nothing to do."); process.exit(0); }
}

// ── resolve cohort, framework, assessor ──────────────────────────────────────
const { data: cohort } = await db.from("profiles")
  .select("id, full_name, hospital_id").ilike("email", "%@amu.competen.demo").eq("role", "nurse").order("full_name");
if (!cohort?.length) die("No AMU cohort nurses found — run scripts/seed-cohort.mjs first.");
const hospitalId = cohort[0].hospital_id ?? die("Cohort nurse has no hospital_id — re-run seed-cohort.mjs.");

// framework_competencies links to its framework via framework_domains
// (domain_id → framework_id), NOT a direct framework_id column. Resolve that
// join, then prefer a foundational clinical framework for the AMU ward.
let framework = null, comps = [];
{
  const { data: domains } = await db.from("framework_domains").select("id, framework_id");
  const domToFw = new Map((domains ?? []).map((d) => [d.id, d.framework_id]));
  const { data: allComps } = await db.from("framework_competencies").select("id, code, name, domain_id, cpu_id");
  const byFw = new Map();
  for (const c of allComps ?? []) {
    const fw = domToFw.get(c.domain_id);
    if (fw) { if (!byFw.has(fw)) byFw.set(fw, []); byFw.get(fw).push(c); }
  }
  const { data: fws } = await db.from("frameworks").select("id, name");
  const eligible = (fws ?? []).filter((f) => (byFw.get(f.id)?.length ?? 0) >= 2);
  const prefer = ["core nursing", "acute care", "intensive", "emergency", "medical"];
  for (const p of prefer) { framework = eligible.find((f) => (f.name ?? "").toLowerCase().includes(p)); if (framework) break; }
  framework ??= eligible[0] ?? null;
  if (framework) comps = byFw.get(framework.id).slice(0, 3);
}
if (!framework) die("No framework with ≥2 competencies found — run scripts/seed-demo.mjs first.");

const { data: assessors } = await db.from("profiles")
  .select("id, full_name, role").in("role", ["super_admin", "assessor", "hospital_admin"]).limit(5);
const assessor = (assessors ?? []).find((a) => /elisha|super/i.test(a.full_name ?? "")) ?? (assessors ?? [])[0] ?? die("No assessor/admin profile to sign decisions.");
const assessorId = assessor.id;
const assessorName = assessor.full_name;

// ── seed cycles + decisions (mirrors the block in seed-cohort.mjs) ───────────
// Mostly competent, with a realistic tail of due-soon / gap / expired.
const PLANS = [
  { outcome: "competent", maturity: "proficient", exp: 365, validated: true },
  { outcome: "competent", maturity: "competent", exp: 365, validated: true },
  { outcome: "competent", maturity: "competent", exp: 45, validated: true },     // due-soon → forecast
  { outcome: "requires_remediation", maturity: "advanced_beginner", exp: null, validated: false }, // gap → pathway/risk
  { outcome: "competent", maturity: "expert", exp: -20, validated: true },        // expired → risk
  { outcome: "provisionally_competent", maturity: "advanced_beginner", exp: 180, validated: true },
];
let cycleCount = 0, decCount = 0;
for (let i = 0; i < cohort.length; i++) {
  const s = cohort[i];
  const cycleId = await insert("competency_cycles", {
    nurse_id: s.id, hospital_id: hospitalId, cycle_type: "annual", status: "completed",
    start_date: dateFromNow(-at([40, 90, 200, 320], i)), end_date: dateFromNow(-at([10, 30, 60], i)),
    notes: "AMU-COHORT", created_by: assessorId, min_assessors: 1, consensus_rule: "any",
  });
  cycleCount++;
  const decRows = comps.map((c, ci) => {
    const p = at(PLANS, i + ci * 2);
    decCount++;
    return {
      cycle_id: cycleId, nurse_id: s.id, hospital_id: hospitalId, cpu_id: c.cpu_id ?? null, competency_id: c.id, framework_id: framework.id,
      outcome: p.outcome, maturity: p.maturity, decided_by: assessorId, decided_by_name: assessorName,
      effective_date: dateFromNow(-at([10, 30, 60], i)),
      expiry_date: p.exp == null ? null : dateFromNow(p.exp),
      critical_failure: false,
      validated_by: p.validated ? assessorId : null,
      validated_at: p.validated ? ts(-at([12, 40], i)) : null,
      validation_outcome: p.validated ? "validated" : null,
    };
  });
  await insertMany("competency_decisions", decRows);
}

console.log(`AMU competency spine seeded: ${cycleCount} cycles + ${decCount} decisions against "${framework.name}" (assessor: ${assessorName}).`);
console.log("CMO/UMW readiness + reassessment-forecast lenses now reflect the cohort.");
