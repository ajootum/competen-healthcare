// DEMO STORYLINE SEED — makes every screen light up for a localhost demo.
// Cast (existing profiles):
//   Gabriel Ajootum (nurse)      — the star: completed cycle, 2 competent + 1 gap,
//                                  pathway, authorization, credential, recognition
//   Grace Wanjiru (nurse)        — reassessment-due + expired decisions (workforce risk)
//   Elisha (admin/educator/assessor) + Super Admin — the two assessors
// Idempotent: skips if the storyline cycle already exists.
// Run: node scripts/seed-storyline.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

if (!process.argv.includes("--confirm")) {
  console.error("This script WRITES to the database in .env.local. Re-run with --confirm to proceed.");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const die = (msg) => { console.error("ABORT:", msg); process.exit(1); };
const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// ── Cast lookup ─────────────────────────────────────────────
const { data: people } = await db.from("profiles").select("id, full_name, role, hospital_id");
const byName = (n) => (people ?? []).find(p => p.full_name?.toLowerCase().includes(n.toLowerCase()));
const gabriel = byName("Gabriel") ?? die("Gabriel profile not found");
const grace   = byName("Grace")   ?? die("Grace profile not found");
const elisha  = byName("Elisha")  ?? die("Elisha profile not found");
const superA  = byName("Super Admin") ?? die("Super Admin profile not found");
const hospitalId = elisha.hospital_id ?? die("Elisha has no hospital");

// ── Idempotency guard ───────────────────────────────────────
const MARKER = "DEMO-STORYLINE";
const { data: existing } = await db.from("competency_cycles").select("id").eq("notes", MARKER).limit(1);
if (existing?.length) { console.log("Storyline already seeded — nothing to do."); process.exit(0); }

// ── Demo framework structure ────────────────────────────────
const { data: fw } = await db.from("frameworks").select("id").eq("name", "Demo: Oxygen Therapy (CKCM)").single();
if (!fw) die("Demo framework missing — run seed-demo.mjs first");
const { data: comps } = await db.from("framework_competencies")
  .select("id, code, name, domain_id, cpu_id").in("code", ["COMP-OXY-001", "COMP-OXY-002", "COMP-OXY-003"]);
const comp = (c) => (comps ?? []).find(x => x.code === c) ?? die(`${c} missing`);
const c1 = comp("COMP-OXY-001"), c2 = comp("COMP-OXY-002"), c3 = comp("COMP-OXY-003");
const domainId = c1.domain_id;
const { data: levels } = await db.from("scoring_levels").select("score, label, is_passing")
  .eq("scale_id", "00000000-0000-0000-0000-000000000001");
const level = (s) => (levels ?? []).find(l => l.score === s) ?? { label: null, is_passing: s >= 3 };

async function insert(table, row) {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (error) die(`${table}: ${error.message}`);
  return data.id;
}

console.log("Seeding demo storyline…");

// ── Departments + assignments ───────────────────────────────
async function ensureDept(name, specialty) {
  const { data: d } = await db.from("departments").select("id").eq("hospital_id", hospitalId).eq("name", name).maybeSingle();
  if (d) return d.id;
  return insert("departments", { hospital_id: hospitalId, name, specialty, is_active: true });
}
const medWard = await ensureDept("Medical Ward", "General Medicine");
const critCare = await ensureDept("Critical Care", "ICU");
await db.from("profiles").update({ hospital_id: hospitalId, department_id: medWard }).eq("id", gabriel.id);
await db.from("profiles").update({ hospital_id: hospitalId, department_id: critCare }).eq("id", grace.id);

// ── Gabriel: completed annual cycle, dual-assessor majority ─
const cycleStart = daysFromNow(-30);
const cycleId = await insert("competency_cycles", {
  nurse_id: gabriel.id, hospital_id: hospitalId, cycle_type: "annual", status: "completed",
  start_date: cycleStart, end_date: daysFromNow(0), notes: MARKER,
  created_by: elisha.id, min_assessors: 2, consensus_rule: "majority",
});
await db.from("cycle_frameworks").insert({ cycle_id: cycleId, framework_id: fw.id, status: "complete", framework_score: 3.7 });

// Dual assessments per competency (Elisha + Super Admin)
const PLAN = [
  { c: c1, scores: [5, 5], final: 5, validated: true  },   // Proficient → Competent
  { c: c2, scores: [4, 4], final: 4, validated: true  },   // Competent+ → Competent
  { c: c3, scores: [2, 2], final: 2, validated: false },   // Gap → Requires Remediation
];
const methods = ["direct_observation", "simulation"];
const assessors = [elisha.id, superA.id];
for (const p of PLAN) {
  for (let i = 0; i < 2; i++) {
    await insert("assessments", {
      cycle_id: cycleId, competency_id: p.c.id, assessor_id: assessors[i], method: methods[i],
      score: p.scores[i], status: "complete", assessed_at: new Date().toISOString(),
      notes: i === 0 && p.final === 2 ? "Documentation incomplete during observation; needs supervised practice." : null,
    });
  }
  const lv = level(p.final);
  await db.from("competency_scores").upsert({
    cycle_id: cycleId, competency_id: p.c.id, nurse_id: gabriel.id, domain_id: domainId, framework_id: fw.id,
    score: p.final, label: lv.label, is_passing: lv.is_passing, assessor_count: 2,
    assessed_at: new Date().toISOString(), educator_validated: p.validated,
  }, { onConflict: "cycle_id,competency_id" });
}
const avg = (5 + 4 + 2) / 3;
const dLv = level(Math.round(avg));
await db.from("domain_scores").upsert({
  cycle_id: cycleId, domain_id: domainId, nurse_id: gabriel.id, framework_id: fw.id,
  score: avg, label: dLv.label, is_passing: dLv.is_passing, competency_count: 3, assessed_at: new Date().toISOString(),
}, { onConflict: "cycle_id,domain_id" });
await db.from("framework_scores").upsert({
  cycle_id: cycleId, framework_id: fw.id, score: avg, label: dLv.label, is_passing: dLv.is_passing,
  domain_count: 1, assessed_at: new Date().toISOString(),
}, { onConflict: "cycle_id,framework_id" });

// Formal decisions (mirrors decisions.ts outcome logic)
const decide = (c, outcome, maturity, validated, expiryDays) => ({
  cycle_id: cycleId, nurse_id: gabriel.id, cpu_id: c.cpu_id, competency_id: c.id, framework_id: fw.id,
  outcome, maturity, decided_by: elisha.id, decided_by_name: elisha.full_name,
  effective_date: daysFromNow(0), expiry_date: expiryDays ? daysFromNow(expiryDays) : null,
  critical_failure: false,
  validated_by: validated ? elisha.id : null,
  validated_at: validated ? new Date().toISOString() : null,
  validation_outcome: validated ? "validated" : null,
});
const { data: decs, error: decErr } = await db.from("competency_decisions").insert([
  decide(c1, "competent", "proficient", true, 365),
  decide(c2, "competent", "competent", true, 365),
  decide(c3, "requires_remediation", "advanced_beginner", false, null),
]).select("id, competency_id");
if (decErr) die(`competency_decisions: ${decErr.message}`);

// Learning pathway from the c3 gap (mirrors pathways.ts)
const { data: res } = await db.from("learning_resources").select("id, title, resource_type")
  .eq("title", "Oxygen Therapy Essentials (demo course)").single();
await db.from("learning_pathways").delete().eq("nurse_id", gabriel.id);
const pathwayId = await insert("learning_pathways", { nurse_id: gabriel.id, status: "active" });
await insert("pathway_items", {
  pathway_id: pathwayId, competency_id: c3.id, competency_name: c3.name,
  reason: "Requires Remediation", resource_id: res?.id ?? null,
  resource_title: res?.title ?? null, resource_type: res?.resource_type ?? null, sort_order: 0,
});

// Authorization 🔑 based on the competent decision
const authId = await insert("clinical_authorizations", {
  nurse_id: gabriel.id, hospital_id: hospitalId,
  authorization_type: "clinical_privilege", authorization_level: "independent", status: "active",
  scope: "Independent administration and titration of supplemental oxygen (nasal cannula, face mask, non-rebreather)",
  effective_date: daysFromNow(0), expiry_date: daysFromNow(365),
  based_on_decision: (decs ?? []).find(d => d.competency_id === c1.id)?.id ?? null,
  granted_by: elisha.id, granted_by_name: elisha.full_name,
});
await insert("authorization_activities", {
  authorization_id: authId, cpu_id: c1.cpu_id, competency_id: c1.id, label: "Safe Oxygen Administration (CPU-OXYSAFE-001)",
});

// Credential 🎖️ + Recognition 🏆
await insert("professional_credentials", {
  nurse_id: gabriel.id, hospital_id: hospitalId, credential_type: "professional_license",
  title: "Registered Nurse", issuing_body: "Uganda Nurses and Midwives Council",
  issue_date: daysFromNow(-730), expiry_date: daysFromNow(365), status: "active",
  verified: true, verified_by: elisha.id, verified_at: new Date().toISOString(),
});
await insert("professional_recognitions", {
  nurse_id: gabriel.id, hospital_id: hospitalId, recognition_type: "patient_safety_champion",
  title: "Patient Safety Champion — Q2 2026",
  description: "Recognized for exemplary escalation practice and oxygen-safety leadership on Medical Ward.",
  awarded_by: elisha.id, awarded_by_name: elisha.full_name, awarded_at: daysFromNow(-14),
});

// ── Grace: reassessment-due + expired (lights up workforce risk + forecast) ──
const graceCycle = await insert("competency_cycles", {
  nurse_id: grace.id, hospital_id: hospitalId, cycle_type: "annual", status: "completed",
  start_date: daysFromNow(-330), end_date: daysFromNow(-320), notes: MARKER,
  created_by: elisha.id, min_assessors: 1, consensus_rule: "any",
});
await db.from("cycle_frameworks").insert({ cycle_id: graceCycle, framework_id: fw.id, status: "complete", framework_score: 4 });
const gDecide = (c, expiryDays) => ({
  cycle_id: graceCycle, nurse_id: grace.id, cpu_id: c.cpu_id, competency_id: c.id, framework_id: fw.id,
  outcome: "competent", maturity: "competent", decided_by: elisha.id, decided_by_name: elisha.full_name,
  effective_date: daysFromNow(-320), expiry_date: daysFromNow(expiryDays), critical_failure: false,
  validated_by: elisha.id, validated_at: new Date().toISOString(), validation_outcome: "validated",
});
{
  const { error } = await db.from("competency_decisions").insert([
    gDecide(c1, 45),   // due soon → 31-60d forecast bucket
    gDecide(c2, -20),  // expired → risk panel
  ]);
  if (error) die(`grace decisions: ${error.message}`);
}

// ── Audit trail (feeds the accreditation "audit active" check) ──
await db.from("audit_log").insert([
  { actor_id: elisha.id, actor_name: elisha.full_name, action: "complete_cycle", entity_type: "competency_cycle", entity_id: cycleId, new_value: { nurse: gabriel.full_name, framework: "Demo: Oxygen Therapy (CKCM)" } },
  { actor_id: elisha.id, actor_name: elisha.full_name, action: "generate_decisions", entity_type: "competency_cycle", entity_id: cycleId, new_value: { decisions: 3 } },
  { actor_id: elisha.id, actor_name: elisha.full_name, action: "grant_authorization", entity_type: "clinical_authorization", entity_id: authId, new_value: { nurse: gabriel.full_name, type: "clinical_privilege" } },
]);

console.log(`Storyline seeded:
  Gabriel — cycle complete (2 assessors), decisions: 2 competent + 1 remediation,
            pathway (1 item), authorization, verified credential, recognition
  Grace   — 1 due in 45d, 1 expired (workforce risk + forecast)
  Departments: Medical Ward, Critical Care · 3 audit entries`);
