/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CFCA-STUDIO-P1 -- STAGING ACCEPTANCE for migration 660 (programme overlays, components, stages).
 *
 *   npx tsx scripts/staging-cfca-studio-p1.ts           run: build two draft programme frameworks, prove the rules, clean up
 *   npx tsx scripts/staging-cfca-studio-p1.ts --keep    the same, but leave the two draft catalogues for a browser walk
 *   npx tsx scripts/staging-cfca-studio-p1.ts --remove  delete only what this script created
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project. Everything it writes
 * is a DRAFT shared catalogue named "STAGING P1 ..." over existing NUR-FOUND competencies (references, never
 * copies), plus a throwaway DACUM draft mapping version. It never publishes a framework, never touches an
 * Individual allowlist, and never writes "approved".
 *
 * What it proves, against the live staging database:
 *   F1-F3  programme-specific filtering: two programme frameworks over the SAME shared competencies resolve, through
 *          the HQ preview (the learner's own projection), to exactly their own set, requirements and targets
 *   G1     a safety-critical component that is not mandatory is refused (660 CHECK)
 *   G2     a catalogue in review freezes its overlay and its component requirements (394 and 660 triggers)
 *   G3     the author of a stage-mapping draft cannot publish it, an incomplete draft cannot be published, and a
 *          published version's bands cannot be edited (660 triggers)
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { loadProgrammePreview } from "../src/lib/individual/programme-framework";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const NAMES = ["STAGING P1 Enrolled Nursing", "STAGING P1 BSc Nursing"];
const FAKE_AUTHOR = "00000000-0000-4000-8000-0000000000a1";

let failed = 0;
const ok = (id: string, pass: boolean, detail: string) => { if (!pass) failed++; console.log(`  ${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

async function remove() {
  const { data } = await admin.from("frameworks").select("id, pub_status").in("name", NAMES).is("hospital_id", null);
  for (const f of data ?? []) {
    if (f.pub_status !== "draft") await admin.from("frameworks").update({ pub_status: "draft" }).eq("id", f.id);
    await admin.from("frameworks").delete().eq("id", f.id);
  }
  await admin.from("competency_stage_mapping").delete().eq("status", "draft").eq("created_by", FAKE_AUTHOR);
  console.log(`removed ${data?.length ?? 0} STAGING P1 catalogue(s) and any throwaway draft mapping`);
}

async function main() {
  if (process.argv.includes("--remove")) return remove();
  await remove();
  const nf = (await admin.from("frameworks").select("id").eq("code", "NUR-FOUND").is("hospital_id", null).single()).data;
  if (!nf) throw new Error("NUR-FOUND is missing: apply 660 first");
  const master = (await admin.from("competency_catalogue_entry").select("competency_id").eq("catalogue_id", nf.id).order("sort_order").limit(3)).data ?? [];
  if (master.length < 3) throw new Error("NUR-FOUND names fewer than 3 competencies");
  const [a, b, c] = master.map((m: any) => m.competency_id);
  const dacum = (await admin.from("scoring_scales").select("id, scoring_levels(id, score)").eq("name", "DACUM 0-6").single()).data;
  const lv = new Map<number, string>(dacum.scoring_levels.map((l: any) => [l.score, l.id]));
  const nursing = (await admin.from("taxonomy_terms").select("id, taxonomies!inner(kind)").eq("value", "Nursing").eq("taxonomies.kind", "profession").limit(1).single()).data;

  const make = async (name: string) => (await admin.from("frameworks").insert({ name, code: null, library: "core", is_active: true, pub_status: "draft", hospital_id: null,
    competency_layer: "profession", profession_term_id: nursing.id, description: "Staging acceptance for CFCA-STUDIO-P1. Not clinically reviewed." }).select("id").single()).data.id as string;
  const enr = await make(NAMES[0]), bsc = await make(NAMES[1]);
  const entry = async (cat: string, comp: string, requirement: string, level: number | null, i: number) =>
    (await admin.from("competency_catalogue_entry").insert({ catalogue_id: cat, competency_id: comp, content_status: "unreviewed", sort_order: i, requirement,
      expected_level_id: level === null ? null : lv.get(level) }).select("id").single()).data.id as string;
  await entry(enr, a, "required", 3, 1); await entry(enr, b, "recommended", null, 2);
  const bscA = await entry(bsc, a, "required", 4, 1); await entry(bsc, b, "required", 4, 2); await entry(bsc, c, "optional", 5, 3);
  const comp = await admin.from("competency_catalogue_entry_component").insert([
    { entry_id: bscA, component_code: "clinical_skills", pass_level_id: lv.get(4), is_mandatory: true, is_safety_critical: true, sort_order: 0 },
    { entry_id: bscA, component_code: "knowledge", pass_level_id: lv.get(3), is_mandatory: true, is_safety_critical: false, sort_order: 1 },
    { entry_id: bscA, component_code: "knowledge_application", pass_level_id: null, is_mandatory: false, is_safety_critical: false, weight: 20, sort_order: 2 },
  ]);
  if (comp.error) throw new Error(comp.error.message);

  console.log("\nProgramme-specific filtering (HQ preview = the learner's projection):");
  const pe: any = await loadProgrammePreview(admin, { catalogueId: enr });
  const pb: any = await loadProgrammePreview(admin, { catalogueId: bsc });
  if (pe.error || pb.error) throw new Error(pe.error ?? pb.error);
  const show = (p: any) => p.rows.map((r: any) => `${r.title} | ${r.requirement} | target ${r.expectedLevel ? r.expectedLevel.score : "-"} (${r.targetFrom}) | stage ${r.targetStage ?? "-"} | components ${r.components.map((x: any) => `${x.code}${x.safetyCritical ? "*" : ""}`).join("+") || "none"}`);
  console.log(`  ${NAMES[0]}:\n    ${show(pe).join("\n    ")}`);
  console.log(`  ${NAMES[1]}:\n    ${show(pb).join("\n    ")}`);
  ok("F1", pe.rows.length === 2 && pe.rows.map((r: any) => r.id).join() === [a, b].join(), `Enrolled resolves to exactly its 2 named competencies (${pe.rows.length})`);
  ok("F2", pb.rows.length === 3 && pb.rows[0].expectedLevel?.score === 4 && pb.rows[2].requirement === "optional" && pb.rows[0].targetStage === "competent",
    "BSc resolves to its 3, the shared competency at target 4 (stage competent) where Enrolled sets 3, and its optional one");
  ok("F3", pe.rows[0].targetStage === "advanced_beginner" && pe.rows[1].targetFrom === "competency" && pb.rows[0].components.length === 3,
    "Enrolled's target 3 is Advanced Beginner on the DACUM mapping; a blank target falls back to the competency; BSc's components resolve");

  console.log("\nDatabase guards:");
  const g1 = await admin.from("competency_catalogue_entry_component").insert({ entry_id: bscA, component_code: "knowledge_application", is_mandatory: false, is_safety_critical: true });
  ok("G1", !!g1.error, `safety-critical but not mandatory is refused (${g1.error?.code ?? "accepted!"})`);
  await admin.from("frameworks").update({ pub_status: "in_review" }).eq("id", bsc);
  const g2a = await admin.from("competency_catalogue_entry").update({ requirement: "optional" }).eq("id", bscA);
  const g2b = await admin.from("competency_catalogue_entry_component").update({ pass_level_id: lv.get(1) }).eq("entry_id", bscA).eq("component_code", "knowledge");
  ok("G2", /frozen/.test(g2a.error?.message ?? "") && /frozen/.test(g2b.error?.message ?? ""), "a catalogue in review freezes the overlay and the component requirements");
  await admin.from("frameworks").update({ pub_status: "draft" }).eq("id", bsc);

  const v1 = (await admin.from("competency_stage_mapping").select("id").eq("scale_id", dacum.id).eq("status", "published").single()).data;
  const g3a = await admin.from("competency_stage_mapping_band").update({ stage_code: "expert" }).eq("mapping_id", v1.id).eq("level_id", lv.get(0));
  const next = (await admin.from("competency_stage_mapping").select("version").eq("scale_id", dacum.id).order("version", { ascending: false }).limit(1).single()).data.version + 1;
  const draft = (await admin.from("competency_stage_mapping").insert({ scale_id: dacum.id, version: next, status: "draft", created_by: FAKE_AUTHOR, note: "staging throwaway" }).select("id").single()).data;
  const g3b = await admin.from("competency_stage_mapping").update({ status: "published", published_by: FAKE_AUTHOR }).eq("id", draft.id);
  await admin.from("competency_stage_mapping_band").insert({ mapping_id: draft.id, level_id: lv.get(0), stage_code: "unstaged" });
  const g3c = await admin.from("competency_stage_mapping").update({ status: "published", published_by: "00000000-0000-4000-8000-0000000000b2" }).eq("id", draft.id);
  const stillV1 = (await admin.from("competency_stage_mapping").select("status").eq("id", v1.id).single()).data.status;
  ok("G3", /frozen/.test(g3a.error?.message ?? "") && /cannot publish/.test(g3b.error?.message ?? "") && /have no stage/.test(g3c.error?.message ?? "") && stillV1 === "published",
    "published bands are frozen, the author cannot publish, an incomplete draft cannot be published, and v1 stays published");

  if (process.argv.includes("--keep")) {
    await admin.from("competency_stage_mapping").delete().eq("id", draft.id);
    console.log("\n--keep: the two STAGING P1 draft catalogues are left for a browser walk. Remove with --remove.");
  } else await remove();
  console.log(failed ? `\nRED -- ${failed} failed` : "\nALL GREEN");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
