/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CFCA-STUDIO-P1 -- STAGING REHEARSAL of the NUR-CCF draft import (needs migrations 660 and 670 on staging).
 *
 *   npx tsx scripts/staging-nur-ccf-import.ts <package.json>            import through the real importDraftPackage, then validate
 *   npx tsx scripts/staging-nur-ccf-import.ts <package.json> --verify   validate only (NUR-CCF already imported)
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project. The import is the same
 * governed path HQ uses (a DRAFT shared framework, every competency not clinically reviewed). The actor is the
 * staging platform owner's profile, so the authorship trail and the parent links name a real person.
 *
 * Validates, against the live staging database:
 *   V1  all 30 areas are competencies of one DRAFT framework, with their codes and domains
 *   V2  every source criterion is a skill row, in order, with its component and source reference -- exactly the package
 *   V3  every parent link is an "inherited" Holdings-scope dependency to the named shared competency
 *   V4  no existing content changed: the Core Nursing (and other parents') content hashes, and every pre-existing
 *       competency's hash, are what they were before the import
 *   V5  the authoring view returns the criteria by component
 *   V6  nothing is offered or approved: the framework is not published, not in any Individual allowlist, and every
 *       competency reads "not clinically reviewed"
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
let failed = 0;
const ok = (id: string, pass: boolean, detail: string) => { if (!pass) failed++; console.log(`  ${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

async function hashes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("framework_competencies").select("id").order("id").range(from, from + 999);
    if (!data?.length) break;
    const h = await admin.rpc("competency_content_hashes", { p_ids: data.map((r: any) => r.id) });
    for (const r of h.data ?? []) out.set(r.competency_id, r.content_hash);
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const verifyOnly = process.argv.includes("--verify");
  const before = await hashes();
  // STAGING ONLY: staging holds two shared "Core Nursing" frameworks (production holds one). A parent framework
  // name that is not unique here is settled to its OLDEST framework, the one production also has.
  const names = [...new Set(pkg.domains.flatMap((d: any) => d.competencies.flatMap((c: any) => c.parents.map((p: any) => p.framework))))];
  const settled = new Map<string, string>();
  for (const n of names) {
    const { data } = await admin.from("frameworks").select("id").eq("name", n).is("hospital_id", null).order("created_at").limit(2);
    if ((data ?? []).length > 1) { settled.set(n as string, data[0].id); console.log(`staging: "${n}" is not unique here, settled to its oldest framework`); }
  }
  // STAGING ONLY: staging's specialty frameworks do not mirror production's competency names. A parent that does
  // not exist here is left out of the staging run and listed. Production's parents are proven separately, read
  // only (PRECHECK-670 in the release package).
  const exists = async (p: any) => {
    let q = admin.from("framework_competencies").select("id, framework_domains!inner(framework_id, frameworks!inner(name, hospital_id))")
      .eq("name", p.competency).eq("framework_domains.frameworks.name", p.framework).is("framework_domains.frameworks.hospital_id", null);
    if (settled.has(p.framework)) q = q.eq("framework_domains.framework_id", settled.get(p.framework));
    return ((await q.limit(2)).data ?? []).length === 1;
  };
  const dropped: string[] = [];
  for (const d of pkg.domains) for (const c of d.competencies) {
    const keep = [];
    for (const p of c.parents) if (await exists(p)) keep.push(settled.has(p.framework) ? { ...p, frameworkId: settled.get(p.framework) } : p); else dropped.push(`${c.code} -> ${p.framework} / ${p.competency}`);
    c.parents = keep;
  }
  if (dropped.length) console.log(`staging: ${dropped.length} parent(s) not on staging, left out of this run:\n  ${dropped.join("\n  ")}`);
  const staged = pkg;
  if (!verifyOnly) {
    const { importDraftPackage } = await import("../src/lib/competency/authoring");
    const owner = (await admin.from("profiles").select("id, full_name").eq("role", "super_admin").order("created_at").limit(1).single()).data;
    const r = await importDraftPackage(admin, { userId: owner.id, name: owner.full_name ?? "Staging owner" }, staged);
    console.log(`import: ${JSON.stringify(r)}`);
    if (!r.ok) process.exit(1);
  }
  const fw = (await admin.from("frameworks").select("id, pub_status, competency_layer, profession_term_id, is_active").eq("code", "NUR-CCF").is("hospital_id", null).single()).data;
  const doms = (await admin.from("framework_domains").select("id, name").eq("framework_id", fw.id)).data ?? [];
  const comps = (await admin.from("framework_competencies").select("id, code, name, domain_id").in("domain_id", doms.map((d: any) => d.id))).data ?? [];
  const byCode = new Map<string, any>(comps.map((c: any) => [c.code, c]));
  const want = pkg.domains.flatMap((d: any) => d.competencies.map((c: any) => ({ ...c, domain: d.name })));
  ok("V1", fw.pub_status === "draft" && comps.length === 30 && want.every((w: any) => byCode.get(w.code)?.name === w.name && doms.find((d: any) => d.id === byCode.get(w.code)?.domain_id)?.name === w.domain),
    `one draft framework, ${comps.length} competencies with their codes and domains (${doms.length} domains)`);

  const skills = (await admin.from("competency_skills").select("competency_id, name, sort_order, component_code, source_ref").in("competency_id", comps.map((c: any) => c.id)).order("sort_order").limit(5000)).data ?? [];
  let mismatch = 0;
  for (const w of want) {
    const got = skills.filter((s: any) => s.competency_id === byCode.get(w.code)?.id).sort((a: any, b: any) => a.sort_order - b.sort_order);
    if (got.length !== w.criteria.length || w.criteria.some((k: any, i: number) => got[i]?.name !== k.text.trim() || got[i]?.component_code !== k.component || got[i]?.source_ref !== k.sourceRef)) mismatch++;
  }
  const n = (c: string) => skills.filter((s: any) => s.component_code === c).length;
  ok("V2", mismatch === 0 && skills.length === want.reduce((s: number, w: any) => s + w.criteria.length, 0),
    `${skills.length} criteria (Clinical Skills ${n("clinical_skills")}, Knowledge ${n("knowledge")}, Knowledge Application ${n("knowledge_application")}), each exactly as in the package; ${mismatch} competencies differ`);

  const deps = (await admin.from("competency_dependencies").select("source_competency_id, target_competency_id, dependency_type, hospital_id").in("source_competency_id", comps.map((c: any) => c.id))).data ?? [];
  const parentNames = new Map<string, string>();
  const targets: string[] = [...new Set<string>(deps.map((d: any) => d.target_competency_id))];
  for (const t of (await admin.from("framework_competencies").select("id, name, framework_domains!inner(frameworks!inner(name, hospital_id))").in("id", targets)).data ?? [])
    parentNames.set(t.id, `${t.framework_domains.frameworks.name}|${t.name}`);
  const wantLinks = want.flatMap((w: any) => w.parents.map((p: any) => `${w.code}->${p.framework}|${p.competency}`)).sort();
  const gotLinks = deps.filter((d: any) => d.dependency_type === "inherited" && d.hospital_id === null)
    .map((d: any) => `${comps.find((c: any) => c.id === d.source_competency_id)?.code}->${parentNames.get(d.target_competency_id)}`).sort();
  ok("V3", JSON.stringify(gotLinks) === JSON.stringify(wantLinks), `${gotLinks.length} inherited Holdings-scope links to ${targets.length} existing parents, exactly as named`);

  const after = await hashes();
  const changed = [...before].filter(([id, h]) => after.get(id) !== h).length;
  const parentsUnchanged = targets.every(t => !before.size || before.get(t) === after.get(t));
  ok("V4", (verifyOnly || changed === 0) && parentsUnchanged, `${verifyOnly ? "verify only: " : ""}${changed} of ${before.size} pre-existing competency hashes changed; parents' hashes unchanged ${parentsUnchanged}`);

  const { loadAuthoringView } = await import("../src/lib/competency/authoring-view");
  const view = await loadAuthoringView(admin);
  const vf = view?.frameworks.find(f => f.code === "NUR-CCF");
  const vc = vf?.domains.flatMap(d => d.competencies) ?? [];
  ok("V5", vc.length === 30 && vc.reduce((s, c) => s + c.criteria.length, 0) === skills.length && vc.every(c => c.criteria.every(k => !!k.component)) && Object.keys(view?.components ?? {}).length >= 3,
    `the authoring view shows ${vc.reduce((s, c) => s + c.criteria.length, 0)} criteria on ${vc.length} competencies, every one with its component`);

  const { loadIndividualCatalogue } = await import("../src/lib/competency/foundation");
  const offered = await loadIndividualCatalogue(admin, [fw.id]);
  const states = new Set(vc.map(c => c.clinical?.state ?? "unreadable"));
  ok("V6", fw.pub_status === "draft" && Array.isArray(offered) && offered.length === 0 && states.size === 1 && states.has("unreviewed"),
    `not published, offers ${offered?.length ?? "?"} competencies even if allowlisted, clinical state ${[...states].join(",")}`);
  console.log(failed ? `\nRED -- ${failed} failed` : "\nALL GREEN");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
