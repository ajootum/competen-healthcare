/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-SCHOLAR-01 S1 ACCEPTANCE -- the Shared Competency Foundation on STAGING (migration 384).
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only competency-foundation-acceptance-harness
 *
 *   D  the schema refuses the wrong states (a profession catalogue with no profession, a foundational one
 *      with a profession, an unknown layer, outcomes that are not a list) -- nothing is written
 *   N  by default neither Scholar nor Professional is offered any catalogue
 *   S  the staging seed: Competen Foundational and Nursing: Respiratory Care, their layers, profession,
 *      extension of Core Nursing, outcomes, expected level, CPUs and Holdings-scope links
 *   R  the read API against the seed, allowlisted for Scholar only for the run: what S2 maps against
 *   Z  the allowlists are restored exactly
 *
 * Refuses production via assertSafeTarget. PEND (exit 0) until 384 is applied; S/R PEND until seeded.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { loadCatalogueFor } from "../src/lib/individual/catalogue";
import { loadSharedFrameworks } from "../src/lib/individual/professional/frameworks";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "competency-foundation-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const ALLOW = (k: string) => ({ scope_type: "platform", scope_ref: "individual", config_path: `individual.policy.${k}_catalogues` });

async function main() {
  console.log(`COMPETENCY FOUNDATION ACCEPTANCE (S1) -- target ${ref}\n`);
  const probe = await admin.from("frameworks").select("competency_layer").limit(1);
  if (probe.error) { console.log(`  PEND  migration 384 is not applied here (${probe.error.message}). Nothing created.`); return; }

  // ── D. the schema refuses the wrong states ──
  const nursing = (await admin.from("taxonomy_terms").select("id, taxonomies!inner(kind)").eq("taxonomies.kind", "profession").eq("value", "Nursing").maybeSingle()).data;
  const bad = [
    { name: "harness-s1 profession without profession", competency_layer: "profession", profession_term_id: null },
    { name: "harness-s1 foundational with profession", competency_layer: "foundational", profession_term_id: nursing?.id ?? null },
    { name: "harness-s1 unknown layer", competency_layer: "nursing-root", profession_term_id: null },
  ];
  const refused: boolean[] = [];
  for (const b of bad) {
    const r = await admin.from("frameworks").insert({ ...b, library: "core", hospital_id: null, is_active: false, pub_status: "draft" }).select("id");
    if (r.data?.length) await admin.from("frameworks").delete().in("id", r.data.map((x: any) => x.id));
    refused.push(!!r.error);
  }
  ok("D1. ⚠ the schema refuses a profession catalogue with no profession, a foundational one with a profession, and an unknown layer", refused.every(Boolean) && !!nursing, refused.join(","));
  const anyComp = (await admin.from("framework_competencies").select("id").limit(1).maybeSingle()).data;
  const notList = anyComp ? await admin.from("framework_competencies").update({ learning_outcomes: { not: "a list" } }).eq("id", anyComp.id).select("id") : { error: null };
  if (anyComp && !notList.error) await admin.from("framework_competencies").update({ learning_outcomes: [] }).eq("id", anyComp.id);
  ok("D2. ⚠ the schema refuses learning outcomes that are not a list", !!anyComp && !!notList.error);

  const before: Record<string, any> = {};
  for (const k of ["scholar", "professional"]) before[k] = (await admin.from("workspace_config_overrides").select("*").match(ALLOW(k)).maybeSingle()).data;
  try {
    // ── N. nothing by default ──
    if (!before.scholar && !before.professional) {
      const [s, p, pf] = [await loadCatalogueFor(admin, "scholar"), await loadCatalogueFor(admin, "professional"), await loadSharedFrameworks(admin)];
      ok("N1. ⚠ with no allowlist, Scholar and Professional are offered no catalogue -- although published shared frameworks exist", s !== null && s.length === 0 && p !== null && p.length === 0 && pf !== null && pf.length === 0,
        `scholar ${s?.length}, professional ${p?.length}, picker ${pf?.length}`);
    } else pend("N1. the empty default", "an allowlist is already set here; the default is pinned statically (competency-foundation-harness L4)");

    // ── S. the seed ──
    const seed = (await admin.from("frameworks").select("id, code, name, competency_layer, profession_term_id, parent_framework_id, pub_status").is("hospital_id", null).in("code", ["CF-FOUND", "NUR-RESP"])).data ?? [];
    const cf = seed.find((f: any) => f.code === "CF-FOUND"), nr = seed.find((f: any) => f.code === "NUR-RESP");
    if (!cf || !nr) { pend("S/R. the seed and the read API over it", "not seeded here (scripts/seed-staging-competency-foundation.ts)"); return; }
    // By the parent id, not by name: a CFCA mirror (scripts/seed-staging-cfca.ts) puts production's Core Nursing beside staging's.
    const core = (await admin.from("frameworks").select("id").is("hospital_id", null).eq("id", nr.parent_framework_id ?? "").eq("name", "Core Nursing").maybeSingle()).data;
    ok("S1. Competen Foundational is foundational with no profession; Nursing: Respiratory Care is a Nursing profession catalogue extending Core Nursing",
      cf.competency_layer === "foundational" && !cf.profession_term_id && nr.competency_layer === "profession" && nr.profession_term_id === nursing?.id && nr.parent_framework_id === core?.id, JSON.stringify({ cf, nr }));

    // ── R. the read API, with the seed allowlisted for Scholar for this run ──
    await admin.from("workspace_config_overrides").delete().match(ALLOW("scholar"));
    await admin.from("workspace_config_overrides").insert({ ...ALLOW("scholar"), draft: { ids: [cf.id, nr.id] }, published: { ids: [cf.id, nr.id] } });
    const cat = await loadCatalogueFor(admin, "scholar");
    const prof = await loadCatalogueFor(admin, "professional");
    if (cf.pub_status === "published" && nr.pub_status === "published") {
      const byCode = new Map((cat ?? []).map(c => [c.code, c]));
      const oxy = byCode.get("COMP-OXY-001"), resp = byCode.get("COMP-RESP-001"), reason = byCode.get("CF-CR-001");
      ok("R1. Scholar is offered both seed catalogues: 8 foundational and 5 nursing respiratory competencies", (cat ?? []).filter(c => c.catalogue.id === cf.id).length === 8 && (cat ?? []).filter(c => c.catalogue.id === nr.id).length === 5, `${cat?.length}`);
      ok("R2. each carries its layer, profession, outcomes and expected level (Benner 3, Competent)", !!reason && reason.layer === "foundational" && reason.profession === null && reason.outcomes.length > 0 && reason.expectedLevel?.score === 3 && !!oxy && oxy.layer === "profession" && oxy.profession?.label === "Nursing");
      ok("R3. the recovered Oxygen Therapy CPU and the new Respiratory Assessment CPU are attached", oxy?.cpu?.code === "CPU-OXYSAFE-001" && resp?.cpu?.code === "CPU-RESPASS-001");
      ok("R4. Holdings-scope links: oxygen requires respiratory assessment, respiratory assessment extends foundational reasoning", !!oxy && !!resp && !!reason && oxy.links.prerequisites.includes(resp.competencyId) && resp.links.extends.includes(reason.competencyId), JSON.stringify({ oxy: oxy?.links, resp: resp?.links }));
      ok("R5. ⚠ Professional is still offered nothing: the Scholar allowlist does not leak across", prof !== null && prof.length === 0, `${prof?.length}`);
    } else {
      ok("R1. ⚠ while the seed is DRAFT, allowlisting it offers nothing (published is still required)", cat !== null && cat.length === 0, `${cat?.length}`);
      pend("R2-R5. the read API over the published seed", "the seed catalogues are not published here yet (the governed workflow)");
    }
  } finally {
    for (const k of ["scholar", "professional"]) {
      await admin.from("workspace_config_overrides").delete().match(ALLOW(k));
      if (before[k]) await admin.from("workspace_config_overrides").insert(before[k]);
    }
    const now: Record<string, any> = {};
    for (const k of ["scholar", "professional"]) now[k] = (await admin.from("workspace_config_overrides").select("*").match(ALLOW(k)).maybeSingle()).data;
    ok("Z1. both allowlists are restored exactly", JSON.stringify(now) === JSON.stringify(before));
  }
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, e => { console.error(e); process.exit(1); });
