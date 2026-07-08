// Seeds the demo CKCM structure (mirror of supabase/seed-demo-ckcm.sql) via the
// service-role client, then derives knowledge-graph edges for the new objects.
// Idempotent: skips if the demo framework already exists.
// Run: node scripts/seed-demo.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FW_NAME = "Demo: Oxygen Therapy (CKCM)";

async function insert(table, row) {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}
async function insertMany(table, rows) {
  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
}

// Resumable: reuses any pieces that already exist, creates the rest.
async function getOrCreate(table, match, row) {
  let q = db.from(table).select("id");
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data: found } = await q.maybeSingle();
  if (found) return { id: found.id, created: false };
  return { id: await insert(table, row), created: true };
}

console.log("Seeding demo CKCM structure (resumable)…");

const { id: fw } = await getOrCreate("frameworks", { name: FW_NAME }, {
  name: FW_NAME, library: "core",
  description: "Demonstration framework showing the full CKCM hierarchy: Domain → Practice → CPU → Competency → Skill.",
  is_active: true, sort_order: 99, pub_status: "published",
});
const { id: dom } = await getOrCreate("framework_domains", { framework_id: fw, name: "Breathing" },
  { framework_id: fw, name: "Breathing", sort_order: 1 });
const { id: pra } = await getOrCreate("practices", { domain_id: dom, code: "PRA-OXY-001" }, {
  domain_id: dom, name: "Oxygen Therapy", code: "PRA-OXY-001", sort_order: 1,
  description: "Safe assessment, delivery and monitoring of supplemental oxygen.",
});
const { id: cpu } = await getOrCreate("clinical_practice_units", { practice_id: pra, code: "CPU-OXYSAFE-001" }, {
  practice_id: pra, name: "Safe Oxygen Administration", code: "CPU-OXYSAFE-001",
  description: "Assess oxygen requirement, select and apply delivery devices, titrate flow, monitor saturation, escalate deterioration and document therapy.",
  risk_category: "high", complexity: 2, reassessment_months: 12, pub_status: "published", sort_order: 1,
});

const { id: bp, created: bpNew } = await getOrCreate("assessment_blueprints", { cpu_id: cpu }, {
  cpu_id: cpu, min_score: 4, min_assessors: 2, consensus_rule: "majority", reassessment_months: 12,
});
if (bpNew) await insertMany("blueprint_methods", [
  { blueprint_id: bp, method: "knowledge",          weight: 20, is_required: true, min_evidence: 1 },
  { blueprint_id: bp, method: "skills_checklist",   weight: 25, is_required: true, min_evidence: 1 },
  { blueprint_id: bp, method: "simulation",         weight: 25, is_required: true, min_evidence: 1 },
  { blueprint_id: bp, method: "direct_observation", weight: 30, is_required: true, min_evidence: 2 },
]);
if (bpNew) await insertMany("evidence_matrix", [
  { cpu_id: cpu, evidence_type: "direct_observation", min_quantity: 2, weight: 40, validity_months: 12, is_critical: true,  min_assessors: 2 },
  { cpu_id: cpu, evidence_type: "simulation",         min_quantity: 1, weight: 25, validity_months: 12, is_critical: false, min_assessors: 1 },
  { cpu_id: cpu, evidence_type: "skills_checklist",   min_quantity: 1, weight: 20, validity_months: 12, is_critical: false, min_assessors: 1 },
  { cpu_id: cpu, evidence_type: "knowledge",          min_quantity: 1, weight: 15, validity_months: 24, is_critical: false, min_assessors: 1 },
]);
if (bpNew) await insertMany("critical_failure_rules", [
  { cpu_id: cpu, description: "Failure to verify patient identity before commencing oxygen therapy" },
  { cpu_id: cpu, description: "Failure to escalate SpO2 below prescribed target range" },
  { cpu_id: cpu, description: "Administering oxygen against a documented prescription limit (e.g. CO2-retainer target)" },
]);

const comps = [];
const COMP_DEFS = [
  ["Assess oxygen requirement", "Recognise indications for supplemental oxygen using respiratory assessment and SpO2 targets.", "COMP-OXY-001", "high",
    ["Perform respiratory assessment", "Interpret SpO2 against prescribed target"]],
  ["Administer oxygen via delivery devices", "Select, apply and titrate nasal cannula, simple face mask and non-rebreather devices safely.", "COMP-OXY-002", "high",
    ["Apply nasal cannula", "Apply face mask", "Adjust oxygen flow rate"]],
  ["Monitor, escalate and document oxygen therapy", "Monitor response, recognise deterioration, escalate appropriately and document therapy accurately.", "COMP-OXY-003", "standard",
    ["Monitor oxygen saturation trends", "Escalate deterioration", "Document oxygen therapy"]],
];
let sort = 1;
for (const [name, description, code, risk, skills] of COMP_DEFS) {
  const { id: cid, created } = await getOrCreate("framework_competencies", { domain_id: dom, code }, {
    domain_id: dom, name, description, sort_order: sort++, practice_id: pra, cpu_id: cpu, code, risk_category: risk,
  });
  comps.push(cid);
  if (created) await insertMany("competency_skills", skills.map((s, i) => ({ competency_id: cid, name: s, sort_order: i + 1 })));
}

const { id: res, created: resNew } = await getOrCreate("learning_resources",
  { title: "Oxygen Therapy Essentials (demo course)" }, {
  title: "Oxygen Therapy Essentials (demo course)", resource_type: "course", is_active: true,
  description: "Covers indications, delivery devices, titration, monitoring and escalation for supplemental oxygen.",
});
if (resNew) await insertMany("resource_competencies", comps.map(c => ({ resource_id: res, competency_id: c })));

// ── Knowledge-graph edges for the seeded objects ─────────────
const edges = [
  { source_type: "framework", source_id: fw, target_type: "domain", target_id: dom, relationship: "contains" },
  { source_type: "domain", source_id: dom, target_type: "practice", target_id: pra, relationship: "contains" },
  { source_type: "practice", source_id: pra, target_type: "cpu", target_id: cpu, relationship: "contains" },
  { source_type: "cpu", source_id: cpu, target_type: "assessment_blueprint", target_id: bp, relationship: "assesses" },
  ...comps.map(c => ({ source_type: "cpu", source_id: cpu, target_type: "competency", target_id: c, relationship: "contains" })),
  ...comps.map(c => ({ source_type: "resource", source_id: res, target_type: "competency", target_id: c, relationship: "supports" })),
];
const { error: edgeErr } = await db.from("knowledge_edges").upsert(edges, {
  onConflict: "source_type,source_id,target_type,target_id,relationship", ignoreDuplicates: true,
});
if (edgeErr) console.warn("knowledge_edges:", edgeErr.message);

console.log(`Seeded: framework=${fw}\n  domain=${dom}\n  practice=${pra}\n  cpu=${cpu}\n  competencies=${comps.length}, skills=8, resource linked, ${edges.length} graph edges`);

// ── EQOS demo (migration 019) — skipped gracefully if not applied ──
try {
  const { data: qd } = await db.from("quality_domains").select("id, code");
  if (!qd) throw new Error("quality tables not found — run migration 019 first");
  const domId = c => qd.find(d => d.code === c)?.id ?? null;
  const { data: fws } = await db.from("quality_frameworks").select("id, code");
  const fwId = c => fws?.find(f => f.code === c)?.id ?? null;

  const { id: qoHH, created: hhNew } = await getOrCreate("quality_objects", { title: "Hand Hygiene" }, {
    code: "QO-HH-001", title: "Hand Hygiene", status: "active", domain_id: domId("QD-IPC"),
    description: "Compliance with WHO 5 Moments for hand hygiene across all clinical areas.",
  });
  if (hhNew) {
    await insertMany("quality_standards", [
      { quality_object_id: qoHH, framework_id: fwId("JCI"), reference_code: "IPSG.5", title: "Reduce the risk of health care-associated infections" },
      { quality_object_id: qoHH, framework_id: fwId("SAFECARE"), reference_code: "IPC-01" },
      { quality_object_id: qoHH, framework_id: fwId("INTERNAL"), reference_code: "POL-IPC-12" },
    ].filter(s => s.framework_id));
    const { data: ind } = await db.from("quality_indicators").insert({
      quality_object_id: qoHH, code: "QI-HH-001", name: "Hand hygiene compliance",
      unit: "percent", direction: "higher_is_better", target_value: 85, escalation_value: 70,
    }).select("id").single();
    if (ind) await insertMany("indicator_measurements", [
      { indicator_id: ind.id, period: "2026-05-31", value: 74, numerator: 148, denominator: 200 },
      { indicator_id: ind.id, period: "2026-06-30", value: 81, numerator: 178, denominator: 220 },
    ]);
  }

  const { id: qoMR, created: mrNew } = await getOrCreate("quality_objects", { title: "Medication Reconciliation" }, {
    code: "QO-MR-001", title: "Medication Reconciliation", status: "active", domain_id: domId("QD-MS"),
    description: "Accurate medication reconciliation at admission, transfer and discharge.",
  });
  if (mrNew) {
    await insertMany("quality_standards", [
      { quality_object_id: qoMR, framework_id: fwId("JCI"), reference_code: "MMU.4" },
      { quality_object_id: qoMR, framework_id: fwId("MOH"), reference_code: "MOH-MS-07" },
    ].filter(s => s.framework_id));
    await db.from("improvement_objects").insert({
      code: "IO-MR-001", title: "Improve admission medication reconciliation completion",
      quality_object_id: qoMR, methodology: "pdsa", status: "active",
      problem_statement: "Reconciliation completed for only 62% of admissions within 24h.",
      aim_statement: "Reach 90% completion within 24h of admission in 6 months.",
      start_date: "2026-06-01", target_date: "2026-12-01",
    });
  }
  console.log("EQOS demo seeded: 2 quality objects, standards mappings, 1 indicator (2 measurements), 1 improvement.");
} catch (e) {
  console.log(`EQOS demo skipped: ${e.message}`);
}
