/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0 CONTROLLED CATALOGUES -- ACCEPTANCE on STAGING (migration 394, the S1 read API, the CFCA mirror).
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only controlled-catalogue-acceptance-harness
 *
 *   M  the CFCA mirror is on staging: the committed export's practices, CPUs and competencies, by id
 *   G  the 394 guard: a hospital framework cannot be a catalogue, a hospital competency cannot be named,
 *      the status is one of three, and once the catalogue leaves draft nothing can be added, changed or
 *      removed -- yet deleting the framework still removes its entries (the cascade path)
 *   R  the read API (loadIndividualCatalogue) over a fixture catalogue: it offers exactly what it names, each
 *      with its home framework, practice and CPU from the real spine, and the content status as written --
 *      unreviewed by default, approved only where an entry says so -- and never the home framework itself
 *   S  the seeded SCH-RESPCARD: a draft naming only records production holds, every one unreviewed, and not
 *      in any Individual allowlist
 *
 * Fixtures: one shared framework "harness-cc fixture" (published by the run itself) and one hospital
 * framework row, both removed at the end. No allowlist is read for writing or changed. Refuses production
 * via assertSafeTarget. PEND (exit 0) until 394 is applied.
 */
import { readFileSync, existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { loadIndividualCatalogue } from "../src/lib/competency/foundation";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "controlled-catalogue-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const FIXTURE = "harness-cc fixture";
const EXPORT = "supabase/reference/cfca-export.json";

async function cleanup() {
  await admin.from("frameworks").delete().eq("name", FIXTURE);
}

async function main() {
  console.log(`CONTROLLED CATALOGUE ACCEPTANCE (394) -- target ${ref}\n`);
  const probe = await admin.from("competency_catalogue_entry").select("id").limit(0);
  if (probe.error) { pend("M-S", `migration 394 is not applied here (${probe.error.message}). Nothing created.`); return; }
  if (!existsSync(EXPORT)) { pend("M-S", `${EXPORT} is not in this checkout`); return; }
  const exp = JSON.parse(readFileSync(EXPORT, "utf8"));
  await cleanup();

  // ── M. the mirror ──
  const ids = (k: string) => exp[k].map((r: any) => r.id);
  const [pr, cp, co] = await Promise.all([
    admin.from("practices").select("id", { count: "exact", head: false }).in("id", ids("practices")),
    admin.from("clinical_practice_units").select("id").in("id", ids("cpus")),
    admin.from("framework_competencies").select("id").in("id", ids("competencies")),
  ]);
  const mirrored = (pr.data ?? []).length === exp.practices.length && (cp.data ?? []).length === exp.cpus.length && (co.data ?? []).length === exp.competencies.length;
  ok("M1. the CFCA mirror is on staging by the production ids (practices, CPUs, competencies)", mirrored,
    `${pr.data?.length}/${exp.practices.length}, ${cp.data?.length}/${exp.cpus.length}, ${co.data?.length}/${exp.competencies.length}`);
  if (!mirrored) { pend("G-S", "run scripts/seed-staging-cfca.ts first"); return; }

  // Real spine rows to reference: one competency linked to a CPU, and one Core Nursing competency with none.
  const viaCpu = exp.competencies.find((c: any) => c.cpu_id && exp.cpus.some((u: any) => u.id === c.cpu_id));
  const plain = exp.competencies.find((c: any) => !c.cpu_id && !c.practice_id);
  const cpu = exp.cpus.find((u: any) => u.id === viaCpu?.cpu_id);
  const practice = exp.practices.find((p: any) => p.id === cpu?.practice_id);
  const homeOf = (c: any) => exp.frameworks.find((f: any) => f.id === exp.domains.find((d: any) => d.id === c.domain_id)?.framework_id);

  try {
    // ── G. the guard ──
    const fx = (await admin.from("frameworks").insert({ name: FIXTURE, library: "core", is_active: true, pub_status: "draft", hospital_id: null }).select("id").single()).data;
    const hosp = (await admin.from("hospitals").select("id").limit(1).maybeSingle()).data;
    const hospFw = hosp ? (await admin.from("frameworks").insert({ name: FIXTURE, library: "core", is_active: false, pub_status: "draft", hospital_id: hosp.id }).select("id").single()).data : null;
    const asCatalogue = hospFw ? await admin.from("competency_catalogue_entry").insert({ catalogue_id: hospFw.id, competency_id: plain.id }) : null;
    if (hospFw) ok("G1. ⚠ a hospital framework cannot be a catalogue", !!asCatalogue?.error, asCatalogue?.error?.message ?? "insert succeeded");
    else pend("G1", "staging has no hospital row to own a framework");
    const hospDom = hospFw ? (await admin.from("framework_domains").insert({ framework_id: hospFw.id, name: FIXTURE }).select("id").single()).data : null;
    const hospComp = hospDom ? (await admin.from("framework_competencies").insert({ domain_id: hospDom.id, name: FIXTURE }).select("id").single()).data : null;
    const named = hospComp ? await admin.from("competency_catalogue_entry").insert({ catalogue_id: fx.id, competency_id: hospComp.id }) : null;
    if (hospComp) ok("G2. ⚠ a competency of a hospital framework cannot be named", !!named?.error, named?.error?.message ?? "insert succeeded");
    else pend("G2", "no hospital competency fixture");
    const badStatus = await admin.from("competency_catalogue_entry").insert({ catalogue_id: fx.id, competency_id: plain.id, content_status: "verified" });
    ok("G3. ⚠ the status is one of approved, draft or unreviewed", !!badStatus.error);

    const e1 = await admin.from("competency_catalogue_entry").insert({ catalogue_id: fx.id, competency_id: plain.id, sort_order: 1 }).select("id, content_status").single();
    const e2 = await admin.from("competency_catalogue_entry").insert({ catalogue_id: fx.id, competency_id: viaCpu.id, sort_order: 2, content_status: "approved", status_note: "harness-cc: reviewed by the harness" }).select("id").single();
    ok("G4. in draft, entries are added; the default status is unreviewed", !e1.error && !e2.error && e1.data?.content_status === "unreviewed", e1.error?.message ?? e2.error?.message ?? "");

    await admin.from("frameworks").update({ pub_status: "published" }).eq("id", fx.id);
    const addLate = await admin.from("competency_catalogue_entry").insert({ catalogue_id: fx.id, competency_id: exp.competencies.find((c: any) => c.id !== plain.id && c.id !== viaCpu.id).id });
    const changeLate = await admin.from("competency_catalogue_entry").update({ content_status: "approved" }).eq("id", e1.data.id);
    const removeLate = await admin.from("competency_catalogue_entry").delete().eq("id", e1.data.id);
    ok("G5. ⚠ once the catalogue is published its entries are frozen: no add, change or remove", !!addLate.error && !!changeLate.error && !!removeLate.error,
      [addLate.error?.message, changeLate.error?.message, removeLate.error?.message].map(m => m ?? "allowed").join(" | "));

    // ── R. the read API ──
    const cat = await loadIndividualCatalogue(admin, [fx.id]);
    const a = cat?.find(c => c.competencyId === plain.id), b = cat?.find(c => c.competencyId === viaCpu.id);
    ok("R1. the catalogue offers exactly what it names, in its order", cat?.map(c => c.competencyId).join() === [plain.id, viaCpu.id].join(), `${cat?.length}`);
    ok("R2. each referenced competency keeps its home framework, and the CPU-linked one its CPU and practice from the real spine",
      a?.home.frameworkId === homeOf(plain)?.id && b?.home.frameworkId === homeOf(viaCpu)?.id && b?.cpu?.id === cpu?.id && b?.practice?.id === practice?.id && a?.catalogue.id === fx.id,
      JSON.stringify({ a: a?.home, b: { home: b?.home, cpu: b?.cpu?.code, practice: b?.practice?.code } }));
    ok("R3. content status as written: unreviewed by default, approved only where the entry says so, with its note",
      a?.contentStatus === "unreviewed" && a?.statusNote === null && b?.contentStatus === "approved" && b?.statusNote === "harness-cc: reviewed by the harness");
    const homeOnly = await loadIndividualCatalogue(admin, [fx.id]);
    ok("R4. ⚠ the home frameworks are not offered by being referenced: nothing else of them appears", (homeOnly ?? []).length === 2);

    // ── G6. the cascade path ──
    const del = await admin.from("frameworks").delete().eq("id", fx.id);
    const left = await admin.from("competency_catalogue_entry").select("id").eq("catalogue_id", fx.id);
    ok("G6. deleting a published catalogue still removes its entries (cascade through the guard)", !del.error && (left.data ?? []).length === 0, del.error?.message ?? "");
  } finally {
    await cleanup();
  }

  // ── S. the seeded SCH-RESPCARD ──
  const sch = (await admin.from("frameworks").select("id, pub_status").is("hospital_id", null).eq("code", "SCH-RESPCARD").maybeSingle()).data;
  if (!sch) pend("S1-S2", "SCH-RESPCARD is not seeded here (scripts/seed-staging-controlled-catalogue.ts)");
  else {
    const entries = (await admin.from("competency_catalogue_entry").select("competency_id, content_status, status_note").eq("catalogue_id", sch.id)).data ?? [];
    const exported = new Set(ids("competencies"));
    ok("S1. SCH-RESPCARD names only records production holds, every one not clinically reviewed and labelled a staging seed",
      entries.length > 0 && entries.every((e: any) => exported.has(e.competency_id) && e.content_status === "unreviewed" && /Staging seed: not clinically reviewed/.test(e.status_note ?? "")),
      `${entries.length} entries, ${JSON.stringify([...new Set(entries.map((e: any) => e.content_status))])}`);
    const allow = (await admin.from("workspace_config_overrides").select("config_path, published").eq("scope_ref", "individual").like("config_path", "%_catalogues")).data ?? [];
    ok("S2. ⚠ it is not in any Individual allowlist: nothing reaches a person until HQ chooses it after publication",
      !allow.some((r: any) => JSON.stringify(r.published ?? {}).includes(sch.id)), `status ${sch.pub_status}`);
  }
  const fixtureLeft = (await admin.from("frameworks").select("id").eq("name", FIXTURE)).data ?? [];
  ok("Z1. no fixture left behind", fixtureLeft.length === 0);
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
