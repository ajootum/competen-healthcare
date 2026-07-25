// ============================================================================
// COHORT GOVERNANCE TOP-UP — seeds the governance quality layer (audits + CAPA)
// for the AMU ward, so the Unit Manager / Hospital-Exec quality KPIs (which read
// audits + capa_actions — the governance layer, distinct from the operational
// op_incidents/op_quality_actions) reflect the cohort instead of showing 0.
//
// Idempotent: skips if AMU-COHORT audits already exist.
// Run:  node scripts/seed-cohort-governance.mjs --confirm
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
  catch (e) { console.error(`Could not read .env.local at ${fileURLToPath(envUrl)} (${e.message})`); process.exit(1); }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const die = (m) => { console.error("ABORT:", m); process.exit(1); };
const iso = (d) => d.toISOString().slice(0, 10);
const dateFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const ts = (daysOffset, hour = 11) => { const d = new Date(); d.setDate(d.getDate() + daysOffset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const at = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
async function insertMany(table, rows) {
  const { data, error } = await db.from(table).insert(rows).select("id");
  if (error) die(`${table}: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

// ── idempotency guard ────────────────────────────────────────────────────────
{
  const { data: existing } = await db.from("audits").select("id").eq("note", "AMU-COHORT").limit(1);
  if (existing?.length) { console.log("AMU governance layer already seeded — nothing to do."); process.exit(0); }
}

// ── resolve hospital, cohort nurses, actor ───────────────────────────────────
const { data: cohort } = await db.from("profiles")
  .select("id, full_name, hospital_id, role").ilike("email", "%@amu.competen.demo");
if (!cohort?.length) die("No AMU cohort found — run scripts/seed-cohort.mjs first.");
const H = cohort.find((p) => p.hospital_id)?.hospital_id ?? die("Cohort has no hospital_id.");
const nurses = cohort.filter((p) => p.role === "nurse");
const actor = cohort.find((p) => p.role === "hospital_admin") ?? nurses[0];
const actorId = actor.id, actorName = actor.full_name;

// ── audits (governance quality) ──────────────────────────────────────────────
const AUD = [
  { audit_type: "concurrent",    title: "NEWS2 documentation concurrent audit", status: "completed",   pct: 88, met: 45, nm: 6 },
  { audit_type: "retrospective", title: "Medication administration chart audit", status: "completed",   pct: 76, met: 37, nm: 11 },
  { audit_type: "clinical",      title: "Hand hygiene compliance round",         status: "completed",   pct: 94, met: 47, nm: 3 },
  { audit_type: "concurrent",    title: "Pain assessment concurrent review",     status: "completed",   pct: 82, met: 42, nm: 9 },
  { audit_type: "retrospective", title: "Falls-risk documentation audit",        status: "completed",   pct: 69, met: 33, nm: 15 },
  { audit_type: "concurrent",    title: "Pressure-injury prevention audit",      status: "in_progress", pct: null, met: 0, nm: 0 },
];
const auditRows = AUD.map((a, i) => ({
  hospital_id: H, audit_type: a.audit_type, title: a.title, area: "Acute Medical Unit (AMU)",
  nurse_id: nurses.length ? nurses[i % nurses.length].id : null,
  status: a.status, compliance_pct: a.pct,
  items_met: a.met, items_not_met: a.nm, items_na: a.pct == null ? 0 : 2,
  note: "AMU-COHORT", conducted_by: actorId, conducted_by_name: actorName,
  conducted_at: ts(-at([5, 12, 20, 30, 45, 3], i)),
}));
const auditIds = await insertMany("audits", auditRows);

// ── capa_actions (governance corrective actions, linked to audits) ───────────
const CAPA = [
  { title: "Improve medication chart completion", priority: "high",   status: "in_progress", ai: 1 },
  { title: "Falls documentation re-training",     priority: "high",   status: "open",        ai: 4 },
  { title: "Pain reassessment prompt cards",      priority: "medium", status: "completed",   ai: 3 },
  { title: "Hand-hygiene refresh — closed out",   priority: "low",    status: "verified",    ai: 2 },
  { title: "NEWS2 escalation SOP review",         priority: "medium", status: "open",        ai: 0 },
];
const capaRows = CAPA.map((c, i) => ({
  hospital_id: H, audit_id: auditIds[c.ai] ?? null, title: c.title,
  description: `Corrective action arising from the ${AUD[c.ai].title.toLowerCase()}.`,
  priority: c.priority, status: c.status, due_date: dateFromNow(at([14, 21, -5, 30, 10], i)),
  owner_id: actorId, owner_name: actorName,
  closed_at: ["completed", "verified", "closed"].includes(c.status) ? ts(-at([2, 6], i)) : null,
}));
await insertMany("capa_actions", capaRows);

console.log(`AMU governance layer seeded: ${auditRows.length} audits (5 completed, avg ~82% compliance) + ${capaRows.length} CAPA actions (3 open/in-progress, 2 high-priority).`);
console.log("Unit Manager + Hospital-Exec quality KPIs now reflect the cohort.");
