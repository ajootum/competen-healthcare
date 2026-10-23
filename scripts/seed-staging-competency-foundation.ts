/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-SCHOLAR-01 S1 -- STAGING SEED for the Shared Competency Foundation (needs migration 384).
 *
 *   npx tsx scripts/seed-staging-competency-foundation.ts            create (idempotent, by catalogue code)
 *   npx tsx scripts/seed-staging-competency-foundation.ts --verify   read only: what exists
 *   npx tsx scripts/seed-staging-competency-foundation.ts --remove   delete exactly what it created
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project. It writes
 * shared (hospital_id null) DRAFT catalogues -- nothing is published, nothing is offered to anyone: the
 * Individual allowlists stay empty until HQ chooses, and publication goes through the governed workflow.
 *
 *   CF-FOUND   Competen Foundational (layer foundational, no profession): clinical reasoning, patient
 *              safety, communication, infection prevention basics -- cross-professional.
 *   NUR-RESP   Nursing: Respiratory Care (layer profession, profession Nursing), EXTENDING Core Nursing
 *              (parent_framework_id) without touching it. Two clinical practice units:
 *                CPU-OXYSAFE-001  Safe Oxygen Administration -- recovered from supabase/seed-demo-ckcm.sql,
 *                                 with its assessment blueprint, evidence matrix and critical failures.
 *                CPU-RESPASS-001  Systematic Respiratory Assessment -- no earlier CPU existed; built here.
 *   Links, Holdings-scope (hospital_id null), so nothing is duplicated:
 *     dependencies   nursing respiratory competencies require their foundational ones (prerequisite) and
 *                    extend them (inherited)
 *     equivalencies  NUR-RESP competencies ARE the matching Core Nursing Airway / Breathing competencies
 *                    (equivalence_type 'equivalent'), so a person evidencing one evidences the other
 *
 * Core Nursing is READ (to find its id and competencies) and never written.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--verify") ? "verify" : "create";

const OUT = (o: string[]) => o.filter(Boolean);
type Comp = { code: string; name: string; description: string; outcomes: string[]; cpu?: string; risk?: string };
const FOUNDATIONAL: { name: string; comps: Comp[] }[] = [
  { name: "Clinical reasoning", comps: [
    { code: "CF-CR-001", name: "Gathers and interprets clinical information systematically", description: "Uses a structured approach to collect, prioritise and interpret information about a person's condition.", outcomes: OUT(["Applies a structured assessment approach (for example A to E)", "Distinguishes normal from abnormal findings and explains their significance", "Prioritises problems by clinical urgency"]) },
    { code: "CF-CR-002", name: "Recognises and responds to deterioration", description: "Identifies early warning signs and acts within scope and escalation policy.", outcomes: OUT(["Explains early warning signs and their thresholds", "Escalates using a structured handover (for example SBAR)", "Re-evaluates after intervention"]) },
  ]},
  { name: "Patient safety", comps: [
    { code: "CF-PS-001", name: "Verifies identity and consent before care", description: "Confirms the right person, procedure and consent before any intervention.", outcomes: OUT(["Uses two identifiers before every intervention", "Explains when and how consent is obtained and documented"]) },
    { code: "CF-PS-002", name: "Recognises, reports and learns from incidents", description: "Applies a just-culture approach to error and near miss.", outcomes: OUT(["Reports an incident through the local system", "Describes how learning is shared after an incident"]) },
  ]},
  { name: "Communication", comps: [
    { code: "CF-CM-001", name: "Communicates clearly with people and families", description: "Adapts information to the person's needs, language and health literacy.", outcomes: OUT(["Checks understanding (for example teach-back)", "Uses an interpreter when needed"]) },
    { code: "CF-CM-002", name: "Hands over care safely", description: "Gives and receives structured handover between people and teams.", outcomes: OUT(["Uses a structured handover format", "Confirms actions and responsibilities at handover"]) },
  ]},
  { name: "Infection prevention basics", comps: [
    { code: "CF-IP-001", name: "Performs hand hygiene at the right moments", description: "Applies the five moments of hand hygiene.", outcomes: OUT(["Names and applies the five moments", "Performs hand hygiene to the recommended technique"]) },
    { code: "CF-IP-002", name: "Uses personal protective equipment correctly", description: "Selects, dons and doffs PPE for the precautions required.", outcomes: OUT(["Selects PPE for standard and transmission-based precautions", "Dons and doffs in the correct sequence"]) },
  ]},
];
const NURSING: { name: string; practice: { code: string; name: string; description: string }; cpu: { code: string; name: string; description: string; risk: string; complexity: number }; comps: Comp[] }[] = [
  { name: "Respiratory Assessment",
    practice: { code: "PRA-RESPASS-001", name: "Respiratory Assessment", description: "Systematic assessment of breathing, oxygenation and airway." },
    cpu: { code: "CPU-RESPASS-001", name: "Systematic Respiratory Assessment", description: "Inspect, measure and interpret respiratory rate, effort, saturation and breath sounds; recognise and escalate deterioration.", risk: "high", complexity: 2 },
    comps: [
      { code: "COMP-RESP-001", name: "Performs a systematic respiratory assessment", description: "Assesses rate, rhythm, effort, saturation and breath sounds, and documents findings.", outcomes: OUT(["Measures respiratory rate over a full minute", "Interprets SpO2 against the prescribed target range", "Documents findings in the agreed format"]), risk: "high" },
      { code: "COMP-RESP-002", name: "Recognises and escalates respiratory deterioration", description: "Identifies worsening respiratory status and escalates promptly.", outcomes: OUT(["Recognises signs of respiratory distress", "Escalates using a structured handover", "Initiates first-line interventions within scope"]), risk: "high" },
    ] },
  { name: "Oxygen Therapy",
    practice: { code: "PRA-OXY-001", name: "Oxygen Therapy", description: "Safe assessment, delivery and monitoring of supplemental oxygen." },
    cpu: { code: "CPU-OXYSAFE-001", name: "Safe Oxygen Administration", description: "Assess oxygen requirement, select and apply delivery devices, titrate flow, monitor saturation, escalate deterioration and document therapy.", risk: "high", complexity: 2 },
    comps: [
      { code: "COMP-OXY-001", name: "Assess oxygen requirement", description: "Recognise indications for supplemental oxygen using respiratory assessment and SpO2 targets.", outcomes: OUT(["States the prescribed SpO2 target range", "Identifies who is at risk of hypercapnia"]), risk: "high" },
      { code: "COMP-OXY-002", name: "Administer oxygen via delivery devices", description: "Select, apply and titrate nasal cannula, simple face mask and non-rebreather devices safely.", outcomes: OUT(["Selects the device for the prescribed flow", "Titrates to the target range"]), risk: "high" },
      { code: "COMP-OXY-003", name: "Monitor, escalate and document oxygen therapy", description: "Monitor response, recognise deterioration, escalate appropriately and document therapy accurately.", outcomes: OUT(["Monitors at the prescribed frequency", "Escalates when SpO2 falls below target"]), risk: "standard" },
    ] },
];
// Holdings-scope links, by code. [source, target, kind]: source depends on target.
const DEPENDENCIES: [string, string, "prerequisite" | "inherited"][] = [
  ["COMP-RESP-001", "CF-CR-001", "inherited"],
  ["COMP-RESP-002", "CF-CR-002", "inherited"],
  ["COMP-OXY-001", "COMP-RESP-001", "prerequisite"],
  ["COMP-OXY-002", "CF-PS-001", "prerequisite"],
  ["COMP-OXY-003", "CF-CM-002", "prerequisite"],
];
// [NUR-RESP code, Core Nursing competency name]: the same competency, recognised both ways.
const EQUIVALENT_TO_CORE: [string, string][] = [
  ["COMP-RESP-001", "Monitors Respiratory Status"],
  ["COMP-RESP-002", "Recognizes Respiratory Deterioration"],
];
const SEED_NOTE = "COMPETEN-SCHOLAR-01 S1 staging seed";

async function one(q: any) { const { data, error } = await q; if (error) throw new Error(error.message); return data; }

async function remove() {
  const fws = await one(admin.from("frameworks").select("id, code").is("hospital_id", null).in("code", ["CF-FOUND", "NUR-RESP"]));
  for (const f of fws) {
    const doms = await one(admin.from("framework_domains").select("id").eq("framework_id", f.id));
    const domIds = doms.map((d: any) => d.id);
    if (domIds.length) {
      const pr = await one(admin.from("practices").select("id").in("domain_id", domIds));
      if (pr.length) await one(admin.from("clinical_practice_units").delete().in("practice_id", pr.map((p: any) => p.id)));
    }
    await one(admin.from("frameworks").delete().eq("id", f.id));
    console.log(`removed ${f.code}`);
  }
}

async function verify() {
  const fws = await one(admin.from("frameworks").select("id, code, name, competency_layer, profession_term_id, parent_framework_id, pub_status").is("hospital_id", null).in("code", ["CF-FOUND", "NUR-RESP"]));
  const out: any = { catalogues: fws };
  for (const f of fws) {
    const doms = await one(admin.from("framework_domains").select("id").eq("framework_id", f.id));
    const comps = doms.length ? await one(admin.from("framework_competencies").select("id, code, learning_outcomes, expected_level_id, cpu_id").in("domain_id", doms.map((d: any) => d.id))) : [];
    out[f.code] = { domains: doms.length, competencies: comps.length, withOutcomes: comps.filter((c: any) => (c.learning_outcomes ?? []).length).length, withLevel: comps.filter((c: any) => c.expected_level_id).length, withCpu: comps.filter((c: any) => c.cpu_id).length };
  }
  const ids = (await one(admin.from("framework_competencies").select("id, code").in("code", [...FOUNDATIONAL.flatMap(d => d.comps.map(c => c.code)), ...NURSING.flatMap(d => d.comps.map(c => c.code))]))).map((c: any) => c.id);
  out.dependencies = ids.length ? (await one(admin.from("competency_dependencies").select("id").is("hospital_id", null).in("source_competency_id", ids))).length : 0;
  out.equivalencies = ids.length ? (await one(admin.from("competency_equivalencies").select("id").is("hospital_id", null).in("source_competency_id", ids))).length : 0;
  console.log(JSON.stringify(out, null, 1));
}

async function create() {
  const existing = await one(admin.from("frameworks").select("code").is("hospital_id", null).in("code", ["CF-FOUND", "NUR-RESP"]));
  if (existing.length) { console.log(`already seeded (${existing.map((e: any) => e.code).join(", ")}) -- nothing created. Use --remove first to reseed.`); return; }
  const core = await one(admin.from("frameworks").select("id").is("hospital_id", null).eq("name", "Core Nursing").maybeSingle());
  if (!core) throw new Error("Core Nursing (shared) not found -- refusing to seed an extension of nothing");
  const nursingTax = await one(admin.from("taxonomies").select("id").eq("kind", "profession").maybeSingle());
  const nursing = nursingTax ? await one(admin.from("taxonomy_terms").select("id").eq("taxonomy_id", nursingTax.id).eq("value", "Nursing").maybeSingle()) : null;
  if (!nursing) throw new Error("taxonomy term profession/Nursing not found");
  const level = await one(admin.from("scoring_levels").select("id, scoring_scales!inner(is_default)").eq("score", 3).eq("scoring_scales.is_default", true).maybeSingle());
  const levelId = level?.id ?? null;
  const byCode = new Map<string, string>();

  const fwRow = (code: string, name: string, layer: string, profession: string | null, parent: string | null, description: string) =>
    one(admin.from("frameworks").insert({ code, name, library: "core", description, hospital_id: null, is_active: true, scope: "master", pub_status: "draft",
      version_major: 1, version_minor: 0, version_revision: 0, competency_layer: layer, profession_term_id: profession, parent_framework_id: parent }).select("id").single());

  const cf = await fwRow("CF-FOUND", "Competen Foundational", "foundational", null, null, `Cross-professional foundational competencies. ${SEED_NOTE}.`);
  for (const [i, d] of FOUNDATIONAL.entries()) {
    const dom = await one(admin.from("framework_domains").insert({ framework_id: cf.id, name: d.name, sort_order: i + 1 }).select("id").single());
    for (const [j, c] of d.comps.entries()) {
      const row = await one(admin.from("framework_competencies").insert({ domain_id: dom.id, name: c.name, description: c.description, code: c.code, sort_order: j + 1, risk_category: "standard", learning_outcomes: c.outcomes, expected_level_id: levelId }).select("id").single());
      byCode.set(c.code, row.id);
    }
  }
  const nr = await fwRow("NUR-RESP", "Nursing: Respiratory Care", "profession", nursing.id, core.id, `Nursing respiratory competencies, extending Core Nursing. Oxygen Therapy recovered from the CKCM demo. ${SEED_NOTE}.`);
  for (const [i, d] of NURSING.entries()) {
    const dom = await one(admin.from("framework_domains").insert({ framework_id: nr.id, name: d.name, sort_order: i + 1 }).select("id").single());
    const pra = await one(admin.from("practices").insert({ domain_id: dom.id, name: d.practice.name, description: d.practice.description, code: d.practice.code, sort_order: 1 }).select("id").single());
    const cpu = await one(admin.from("clinical_practice_units").insert({ practice_id: pra.id, name: d.cpu.name, description: d.cpu.description, code: d.cpu.code, risk_category: d.cpu.risk, complexity: d.cpu.complexity, reassessment_months: 12, pub_status: "draft", sort_order: 1 }).select("id").single());
    if (d.cpu.code === "CPU-OXYSAFE-001") {
      const bp = await one(admin.from("assessment_blueprints").insert({ cpu_id: cpu.id, min_score: 4, min_assessors: 2, consensus_rule: "majority", reassessment_months: 12 }).select("id").single());
      await one(admin.from("blueprint_methods").insert([
        { blueprint_id: bp.id, method: "knowledge", weight: 20, is_required: true, min_evidence: 1 },
        { blueprint_id: bp.id, method: "skills_checklist", weight: 25, is_required: true, min_evidence: 1 },
        { blueprint_id: bp.id, method: "simulation", weight: 25, is_required: true, min_evidence: 1 },
        { blueprint_id: bp.id, method: "direct_observation", weight: 30, is_required: true, min_evidence: 2 },
      ]));
      await one(admin.from("evidence_matrix").insert([
        { cpu_id: cpu.id, evidence_type: "direct_observation", min_quantity: 2, weight: 40, validity_months: 12, is_critical: true, min_assessors: 2 },
        { cpu_id: cpu.id, evidence_type: "simulation", min_quantity: 1, weight: 25, validity_months: 12, is_critical: false, min_assessors: 1 },
        { cpu_id: cpu.id, evidence_type: "skills_checklist", min_quantity: 1, weight: 20, validity_months: 12, is_critical: false, min_assessors: 1 },
        { cpu_id: cpu.id, evidence_type: "knowledge", min_quantity: 1, weight: 15, validity_months: 24, is_critical: false, min_assessors: 1 },
      ]));
      await one(admin.from("critical_failure_rules").insert([
        { cpu_id: cpu.id, description: "Failure to verify patient identity before commencing oxygen therapy" },
        { cpu_id: cpu.id, description: "Failure to escalate SpO2 below prescribed target range" },
        { cpu_id: cpu.id, description: "Administering oxygen against a documented prescription limit (e.g. CO2-retainer target)" },
      ]));
    }
    for (const [j, c] of d.comps.entries()) {
      const row = await one(admin.from("framework_competencies").insert({ domain_id: dom.id, name: c.name, description: c.description, code: c.code, sort_order: j + 1, practice_id: pra.id, cpu_id: cpu.id, risk_category: c.risk ?? "standard", learning_outcomes: c.outcomes, expected_level_id: levelId }).select("id").single());
      byCode.set(c.code, row.id);
    }
  }
  await one(admin.from("competency_dependencies").insert(DEPENDENCIES.map(([s, t, k]) => ({ hospital_id: null, source_competency_id: byCode.get(s), target_competency_id: byCode.get(t), dependency_type: k, notes: SEED_NOTE }))));
  const coreComps = await one(admin.from("framework_competencies").select("id, name, framework_domains!inner(framework_id)").eq("framework_domains.framework_id", core.id));
  const coreByName = new Map(coreComps.map((c: any) => [c.name, c.id]));
  const eq = EQUIVALENT_TO_CORE.filter(([, n]) => coreByName.has(n)).map(([code, n]) => ({ hospital_id: null, source_competency_id: byCode.get(code), target_competency_id: coreByName.get(n), equivalence_type: "equivalent", rationale: `Same competency in Core Nursing and Nursing: Respiratory Care. ${SEED_NOTE}.` }));
  if (eq.length) await one(admin.from("competency_equivalencies").insert(eq));
  console.log(`seeded CF-FOUND (${FOUNDATIONAL.reduce((n, d) => n + d.comps.length, 0)} competencies) and NUR-RESP (${NURSING.reduce((n, d) => n + d.comps.length, 0)} competencies, 2 CPUs), ${DEPENDENCIES.length} dependencies, ${eq.length} equivalencies to Core Nursing. Both DRAFT; no allowlist changed.`);
}

(async () => {
  console.log(`staging seed (${mode}) -- target ${(verdict as any).ref}`);
  if (mode === "remove") await remove(); else if (mode === "verify") await verify(); else await create();
})().catch(e => { console.error(`FAILED: ${e.message}`); process.exit(1); });
