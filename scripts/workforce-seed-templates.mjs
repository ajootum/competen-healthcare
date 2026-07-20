// Seed the CDN-001 §5 example Position Templates as GLOBAL, reusable blueprints
// (hospital_id null → visible to every hospital admin), wired to the shared
// master competency frameworks. Idempotent: re-running updates in place.
// Run: node scripts/workforce-seed-templates.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const fwByName = async (name) => (await admin.from("frameworks").select("id").eq("name", name).is("hospital_id", null).maybeSingle()).data?.id ?? null;
const cpuByName = async (name) => (await admin.from("clinical_practice_units").select("id").ilike("name", `%${name}%`).limit(1).maybeSingle()).data?.id ?? null;
const resByName = async (name) => (await admin.from("learning_resources").select("id").ilike("title", `%${name}%`).limit(1).maybeSingle()).data?.id ?? null;

async function seedOne(spec) {
  // 1. Library entry (global, idempotent by name + null hospital)
  let { data: lib } = await admin.from("position_library").select("id").eq("name", spec.name).is("hospital_id", null).maybeSingle();
  if (!lib) {
    const r = await admin.from("position_library").insert({
      name: spec.name, category: spec.category, level: spec.level, specialty: spec.specialty ?? null,
      hospital_id: null, organisation_id: null, status: "active",
    }).select("id").single();
    if (r.error) { console.log(`  ✗ ${spec.name}: ${r.error.message}`); return; }
    lib = r.data;
  }

  // 2. Template v1, published (active). Idempotent: reuse existing v1, else create.
  let { data: tpl } = await admin.from("position_templates").select("id").eq("position_library_id", lib.id).eq("version", 1).maybeSingle();
  const payload = {
    workspaces: spec.workspaces, framework_ids: spec.framework_ids.filter(Boolean),
    resource_ids: spec.resource_ids.filter(Boolean), cpu_ids: spec.cpu_ids.filter(Boolean),
    cycle_type: spec.cycle_type, assessment_programme: spec.assessment_programme,
    ai_context: spec.ai_context, status: "active",
  };
  if (tpl) {
    await admin.from("position_templates").update(payload).eq("id", tpl.id);
  } else {
    const r = await admin.from("position_templates").insert({ position_library_id: lib.id, version: 1, ...payload }).select("id").single();
    if (r.error) { console.log(`  ✗ ${spec.name} template: ${r.error.message}`); return; }
    tpl = r.data;
  }
  console.log(`  ✓ ${spec.name} — workspaces [${spec.workspaces.join(", ")}] · ${payload.framework_ids.length} framework(s) · ${payload.cpu_ids.length} CPU(s) · ${payload.resource_ids.length} resource(s) · published`);
}

(async () => {
  console.log("Resolving master frameworks / CPUs / resources ...");
  const core = await fwByName("Core Nursing");
  const icu = await fwByName("Intensive and Progressive Care");
  const educatorFw = await fwByName("Nurse Educator");
  const chargeFw = await fwByName("Charge Nurse");
  const oxygenCpu = await cpuByName("Oxygen");
  const gaitCpu = await cpuByName("Gait");
  const oxygenRes = await resByName("Oxygen Therapy");

  console.log("\nSeeding example Position Templates (global):");
  await seedOne({
    name: "ICU Staff Nurse", category: "clinical", level: "staff", specialty: "Intensive Care",
    workspaces: ["nurse"], framework_ids: [core, icu], cpu_ids: [oxygenCpu, gaitCpu], resource_ids: [oxygenRes],
    cycle_type: "orientation", assessment_programme: "orientation",
    ai_context: "Clinical guidance, competency coaching and learning recommendations for critical care nursing.",
  });
  await seedOne({
    name: "Clinical Educator", category: "education", level: "senior", specialty: null,
    workspaces: ["educator", "nurse"], framework_ids: [core, educatorFw], cpu_ids: [], resource_ids: [oxygenRes],
    cycle_type: "orientation", assessment_programme: "orientation",
    ai_context: "Curriculum development, content generation, assessment design and learning analytics.",
  });
  await seedOne({
    name: "Clinical Assessor", category: "assessment", level: "senior", specialty: null,
    workspaces: ["assessor", "nurse"], framework_ids: [core, chargeFw], cpu_ids: [oxygenCpu], resource_ids: [],
    cycle_type: "orientation", assessment_programme: "orientation",
    ai_context: "Assessment planning, evidence review and OSCE scoring support.",
  });

  const { count } = await admin.from("position_templates").select("id", { count: "exact", head: true }).eq("status", "active");
  console.log(`\nDone. ${count} active template(s) now available in /admin/positions.`);
})();
