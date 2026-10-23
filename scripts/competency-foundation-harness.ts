/**
 * COMPETEN-SCHOLAR-01 S1 -- STATIC HARNESS for the Shared Competency Foundation.
 *
 *   npx tsx scripts/competency-foundation-harness.ts
 *
 * No credentials, no network. Each check has a planted violation that must turn it RED.
 *   L1  migration 384 is additive: four columns with their checks and foreign keys, nothing dropped or rewritten
 *   L2  the read API reads only shared (hospital_id null), active, published rows, and writes nothing
 *   L3  it fails closed: nothing allowed reads nothing, any failure is null
 *   L4  the Individual allowlists are empty by default and the HQ route checks each id against the library
 *   L5  Nursing is a profession, not the root: no layer or profession is hard-coded to nursing in the API
 *   L6  the seed is staging-only, creates DRAFT catalogues, and never writes an existing catalogue
 */
import { readFileSync, existsSync } from "node:fs";

const F = {
  mig: "supabase/migrations/384-competency-layers-and-outcomes.sql",
  api: "src/lib/competency/foundation.ts",
  wrap: "src/lib/individual/catalogue.ts",
  policy: "src/lib/individual/policy.ts",
  route: "src/app/api/hq/individual/config/route.ts",
  seed: "scripts/seed-staging-competency-foundation.ts",
} as const;
type K = keyof typeof F;
type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const RAW: Src = new Map(Object.values(F).map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const code = (src: Src, k: K) => k === "mig" ? (src.get(F[k]) ?? "").split("\n").filter(l => !l.trim().startsWith("--")).join("\n") : strip(src.get(F[k]) ?? "");

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
type R = { ok: boolean; detail: string };

const checkMigration = (src: Src): R => {
  const m = code(src, "mig");
  const cols = [/alter table frameworks add column if not exists competency_layer text;/, /alter table frameworks add column if not exists profession_term_id uuid references taxonomy_terms\(id\) on delete restrict;/,
    /alter table framework_competencies add column if not exists learning_outcomes jsonb not null default '\[\]'::jsonb;/, /alter table framework_competencies add column if not exists expected_level_id uuid references scoring_levels\(id\) on delete set null;/].every(r => r.test(m));
  const layers = /check \(competency_layer is null or competency_layer in \('foundational', 'profession', 'advanced', 'specialty', 'context'\)\)/.test(m);
  const consistency = /competency_layer is distinct from 'profession' or profession_term_id is not null/.test(m) && /competency_layer is distinct from 'foundational' or profession_term_id is null/.test(m);
  const destructive = /\bdrop (table|column)\b|\bupdate \w+ set\b|\bdelete from\b|\btruncate\b/i.test(m);
  return { ok: cols && layers && consistency && !destructive, detail: `columns ${cols}, layers ${layers}, profession rule ${consistency}, destructive ${destructive}` };
};
const checkSharedOnly = (src: Src): R => {
  const s = code(src, "api");
  const fw = /from\("frameworks"\)[\s\S]{0,200}?\.is\("hospital_id", null\)\.eq\("is_active", true\)\.eq\("pub_status", "published"\)/.test(s);
  const links = /from\("competency_dependencies"\)[^;]*\.is\("hospital_id", null\)/.test(s) && /from\("competency_equivalencies"\)[^;]*\.is\("hospital_id", null\)/.test(s);
  const writes = /\.(insert|update|upsert|delete)\(/.test(s);
  return { ok: fw && links && !writes, detail: `frameworks shared+active+published ${fw}, links Holdings-scope ${links}, writes ${writes}` };
};
const checkFailClosed = (src: Src): R => {
  const s = code(src, "api");
  const empty = /if \(!allowedFrameworkIds\.length\) return \[\];/.test(s);
  const caught = /try \{ return await readCatalogue\(admin, allowedFrameworkIds\); \} catch \{ return null; \}/.test(s);
  const nulls = /if \(\[cpus, levels, terms, dependencies, equivalencies\]\.some\(x => x === null\)\) return null;/.test(s);
  return { ok: empty && caught && nulls, detail: `empty allowlist reads nothing ${empty}, throw is null ${caught}, partial read is null ${nulls}` };
};
const checkAllowlist = (src: Src): R => {
  const p = code(src, "policy"), r = code(src, "route"), w = code(src, "wrap");
  const empty = /if \(settings == null \|\| !Array\.isArray\(settings\.ids\)\) return \[\];/.test(p);
  const keys = /key: "scholar_catalogues", kind: "catalogues"/.test(p) && /key: "professional_catalogues", kind: "catalogues"/.test(p);
  const library = /if \(v\.def\.kind === "catalogues"\) \{[\s\S]*?\.from\("frameworks"\)\.select\("id"\)\.in\("id", ids\)\.is\("hospital_id", null\)\.eq\("is_active", true\)\.eq\("pub_status", "published"\)/.test(r)
    && /if \(ids\.some\(id => !ok\.has\(id\)\)\) return refuse\(422/.test(r);
  const wrapper = /loadIndividualCatalogue\(admin, allowedCatalogueIds\(await loadIndividualPolicy\(admin\), scope\)\)/.test(w);
  return { ok: empty && keys && library && wrapper, detail: `empty default ${empty}, two keys ${keys}, library check ${library}, wrapper applies allowlist ${wrapper}` };
};
const checkNotNursingRoot = (src: Src): R => {
  const s = code(src, "api");
  const layers = /export const COMPETENCY_LAYERS = \["foundational", "profession", "advanced", "specialty", "context"\] as const;/.test(s);
  const hard = /nursing/i.test(s);
  return { ok: layers && !hard, detail: `five layers, foundational first ${layers}, nursing hard-coded ${hard}` };
};
const checkSeed = (src: Src): R => {
  const s = code(src, "seed");
  const guard = /const verdict = judgeTarget\(url\);\s*if \(!verdict\.ok \|\| !key\)/.test(s) && /process\.env\.STAGING_SUPABASE_URL/.test(s) && !/NEXT_PUBLIC_SUPABASE_URL/.test(s);
  const draft = (s.match(/pub_status: "(\w+)"/g) ?? []).every(m => m === 'pub_status: "draft"') && /pub_status: "draft"/.test(s);
  const noUpdate = !/\.update\(/.test(s) && !/\.upsert\(/.test(s);
  const deletesOwn = (s.match(/\.delete\(\)/g) ?? []).length === 2 && /\.in\("code", \["CF-FOUND", "NUR-RESP"\]\)/.test(s);
  return { ok: guard && draft && noUpdate && deletesOwn, detail: `staging guard ${guard}, draft only ${draft}, no update ${noUpdate}, deletes only its own ${deletesOwn}` };
};

const plant = (k: K, from: string | RegExp, to: string): Src => {
  const s = RAW.get(F[k]) ?? ""; const n = s.replace(from, to);
  if (n === s) throw new Error(`plant did not apply in ${F[k]}: ${String(from).slice(0, 70)}`);
  return new Map([...RAW, [F[k], n]]);
};
const red = (n: string, r: R) => ok(`P. ${n} goes RED`, !r.ok, "the check passed on a planted violation");

console.log("COMPETENCY FOUNDATION HARNESS (COMPETEN-SCHOLAR-01 S1)\n");
const missing = Object.values(F).filter(f => !RAW.get(f));
ok("0. every pinned file exists", missing.length === 0, missing.join(", "));
const run = (n: string, r: R) => ok(n, r.ok, r.detail);
run("L1. migration 384 is additive: four columns, five layers, the profession rule, nothing destroyed", checkMigration(RAW));
run("L2. the read API reads only shared, active, published rows and Holdings-scope links, and writes nothing", checkSharedOnly(RAW));
run("L3. it fails closed", checkFailClosed(RAW));
run("L4. the allowlists are empty by default and checked against the library", checkAllowlist(RAW));
run("L5. Nursing is a profession, not the root", checkNotNursingRoot(RAW));
run("L6. the seed is staging-only, draft-only, and writes no existing catalogue", checkSeed(RAW));
console.log("");
red("L1 on a dropped column", checkMigration(plant("mig", "notify pgrst, 'reload schema';", "alter table frameworks drop column library;\nnotify pgrst, 'reload schema';")));
red("L1 on a layer set without foundational", checkMigration(plant("mig", "('foundational', 'profession', 'advanced', 'specialty', 'context')", "('nursing', 'specialty', 'role')")));
red("L2 on a hospital framework read", checkSharedOnly(plant("api", `.in("id", [...allowedFrameworkIds]).is("hospital_id", null)`, `.in("id", [...allowedFrameworkIds])`)));
red("L2 on a draft framework read", checkSharedOnly(plant("api", `.eq("is_active", true).eq("pub_status", "published"));`, `.eq("is_active", true));`)));
red("L2 on a write", checkSharedOnly(plant("api", "const rows = async", `const w = (a: any) => a.from("frameworks").update({});\nconst rows = async`)));
red("L3 on an empty allowlist that reads everything", checkFailClosed(plant("api", "if (!allowedFrameworkIds.length) return [];", "")));
red("L4 on a default that offers everything", checkAllowlist(plant("policy", "if (settings == null || !Array.isArray(settings.ids)) return [];", "if (settings == null) return [\"*\"];")));
red("L4 on a route that skips the library check", checkAllowlist(plant("route", "if (ids.some(id => !ok.has(id))) return refuse(422", "if (false) return refuse(422")));
red("L5 on Nursing as the root", checkNotNursingRoot(plant("api", `["foundational", "profession", "advanced", "specialty", "context"]`, `["nursing", "specialty", "role"]`)));
red("L6 on a published seed", checkSeed(plant("seed", `scope: "master", pub_status: "draft"`, `scope: "master", pub_status: "published"`)));
red("L6 on a seed that edits Core Nursing", checkSeed(plant("seed", "const byCode = new Map<string, string>();", `const byCode = new Map<string, string>();\n  await admin.from("frameworks").update({ competency_layer: "profession" }).eq("id", core.id);`)));

console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
