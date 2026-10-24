/**
 * COMPETEN-CONFIG-002 -- STATIC HARNESS for the Competen Individual policy. No credentials, no network.
 *
 *   npx tsx scripts/individual-config-harness.ts
 *
 * What it pins, each with a planted violation that must turn it RED (a check that cannot fail proves nothing):
 *   G  the door: the route is hqApiGate(["hq.individual.config.manage"]) before anything else, the page is
 *      requireHqCapability of the same code, the HQ catalogue and route map declare it, and migration 376
 *      seeds the capability and its grant together, data only, to the one position.
 *   W  one engine: the WCE tables are written only by src/lib/config/workspace-config-write.ts, the super
 *      door pins platform scope to 'platform', the Individual door to 'individual', and its rollback names
 *      its scope.
 *   R  every consumer reads its setting from the policy, and none still compares against the old constant.
 *   L  the reader reads PUBLISHED values only, and clamps every one.
 *   A  nothing on this surface names individual_app.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

const FILES = {
  route: "src/app/api/hq/individual/config/route.ts",
  page: "src/app/super-admin/individual/configuration/page.tsx",
  controls: "src/app/super-admin/individual/configuration/_components/PolicyControls.tsx",
  superRoute: "src/app/api/platform/workspace-config/route.ts",
  lib: "src/lib/config/workspace-config-write.ts",
  policy: "src/lib/individual/policy.ts",
  spaces: "src/lib/hq/spaces.ts",
  nav: "src/app/super-admin/_components/nav-tables.ts",
  mig: "supabase/migrations/376-individual-config-manage-capability.sql",
  reminders: "src/lib/individual/professional/reminders.ts",
  shareRoute: "src/app/api/individual/professional/share/route.ts",
  sharePage: "src/app/individual/(app)/[experience]/(professional)/share/page.tsx",
  scholarHttp: "src/lib/individual/scholar/http.ts",
  assistant: "src/app/api/individual/assistant/route.ts",
  proAssistant: "src/app/api/individual/professional/assistant/route.ts",
  questions: "src/app/api/individual/scholar/questions/route.ts",
  generation: "src/lib/individual/scholar/generation.ts",
  uploads: "src/app/api/individual/scholar/uploads/route.ts",
  passportRoute: "src/app/api/individual/scholar/passport/route.ts",
  progress: "src/app/individual/(app)/[experience]/(scholar)/study/progress/page.tsx",
  evidence: "src/app/individual/(app)/[experience]/(professional)/evidence/page.tsx",
  home: "src/app/individual/_components/professional/HomeReminders.tsx",
  registration: "src/app/individual/(app)/[experience]/(professional)/registration/page.tsx",
  // P0 controlled catalogues (migration 394): the second door under /api/hq/individual, same capability.
  catRoute: "src/app/api/hq/individual/catalogues/route.ts",
  catPage: "src/app/super-admin/individual/catalogues/page.tsx",
} as const;
type K = keyof typeof FILES;

const RAW: Src = new Map(Object.values(FILES).map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
// spaces.ts and nav-tables.ts are data whose strings carry "/*" (route globs), which a comment strip would
// read as a block comment, so they are matched raw, line by line, and the migration is matched raw too.
const RAW_KEYS: readonly K[] = ["mig", "spaces", "nav"];
const code = (src: Src, k: K) => RAW_KEYS.includes(k) ? (src.get(FILES[k]) ?? "") : strip(src.get(FILES[k]) ?? "");

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
type R = { ok: boolean; detail: string };

// ── G. the door ──
const checkRouteGate = (src: Src): R => {
  const s = code(src, "route");
  const body = s.slice(s.indexOf("export async function POST"));
  const first = body.indexOf("await "), gate = body.indexOf(`await hqApiGate(["hq.individual.config.manage"])`);
  return { ok: gate > -1 && gate === first && /if \(isHqRefusal\(ctx\)\) return ctx;/.test(body) && !/export async function (GET|PUT|PATCH|DELETE)/.test(s), detail: `gate at ${gate}, first await at ${first}` };
};
const checkPageGate = (src: Src): R => {
  const s = code(src, "page");
  const body = s.slice(s.indexOf("export default async function"));
  const first = body.indexOf("await "), gate = body.indexOf(`await requireHqCapability("hq.individual.config.manage")`);
  return { ok: gate > -1 && gate === first, detail: `gate at ${gate}, first await at ${first}` };
};
const checkCatalogue = (src: Src): R => {
  const s = code(src, "spaces");
  const cat = /\{ code: "hq\.individual\.config\.manage",\s+space: "platform"\s+\}/.test(s);
  // The policy page's own path, never the bare /super-admin/individual: that is the pilot-grant page
  // (IND-ACCESS-001), and a prefix there would hand its route to this capability.
  const route = /\{ prefix: "\/super-admin\/individual\/configuration",\s*capability: "hq\.individual\.config\.manage" \}/.test(s)
    && !/\{ prefix: "\/super-admin\/individual",\s*capability: "hq\.individual\.config\.manage"/.test(s);
  const nav = code(src, "nav").includes(`href: "/super-admin/individual/configuration"`);
  return { ok: cat && route && nav, detail: `catalogue ${cat}, route map ${route}, nav ${nav}` };
};
const checkMigration = (src: Src): R => {
  const m = code(src, "mig").split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  const capIns = /insert into hq_capability \(code, space, label, description\) values\s+\('hq\.individual\.config\.manage', 'platform'/.test(m);
  const grant = /from \(values \('individual_product_administrator'\)\) as p\(code\)\s+cross join \(values \('hq\.individual\.config\.manage'\)\) as c\(code\)/.test(m);
  const ddl = /\b(create|alter|drop|truncate|update|delete)\b/i.test(m);
  const otherPos = (m.match(/'[a-z_]+_(administrator|director|owner|officer)'/g) ?? []).filter(x => x !== "'individual_product_administrator'");
  return { ok: capIns && grant && !ddl && otherPos.length === 0 && /notify pgrst, 'reload schema';\s*$/.test(m), detail: `cap ${capIns}, grant ${grant}, ddl ${ddl}, other positions ${otherPos.join(",")}` };
};

// ── W. one engine ──
const WCE_WRITE = /\.from\("workspace_config_(overrides|versions|audit)"\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/;
const checkOneWriter = (src: Src): R => {
  const bad = (["route", "page", "controls", "superRoute", "policy"] as K[]).filter(k => WCE_WRITE.test(code(src, k)));
  const lib = WCE_WRITE.test(code(src, "lib"));
  return { ok: bad.length === 0 && lib, detail: `inline WCE writes in: ${bad.map(k => FILES[k]).join(", ")}` };
};
const checkPartitions = (src: Src): R => {
  const sup = /const scopeRefOf = \(scopeType: string, scopeRef: any\) => \(scopeType === "platform" \? PLATFORM : \(scopeRef \?\? null\)\);/.test(code(src, "superRoute"))
    && /const PLATFORM = "platform";/.test(code(src, "superRoute"));
  const ind = /export const POLICY_SCOPE = \{ scopeType: "platform", scopeRef: "individual" \} as const;/.test(code(src, "policy"));
  const r = code(src, "route");
  const roll = /rollbackVersion\(ctx\.admin, actor, body\.versionId, \{ scope: SCOPE, prune: true \}\)/.test(r);
  const only = !/scopeRef: (body|"platform")/.test(r) && /const SCOPE = \{ scopeType: POLICY_SCOPE\.scopeType, scopeRef: POLICY_SCOPE\.scopeRef \};/.test(r);
  return { ok: sup && ind && roll && only, detail: `super pinned ${sup}, individual partition ${ind}, scoped rollback ${roll}, fixed scope ${only}` };
};
const checkPolicyPathsOnly = (src: Src): R => {
  const r = code(src, "route");
  const count = (re: RegExp) => (r.match(re) ?? []).length;
  return { ok: count(/\bsetOverride\(/g) === 1 && count(/\bresetOverride\(/g) === 1
      && r.includes("setOverride(ctx.admin, actor, SCOPE, policyPath(v.def.key), v.settings)")
      && r.includes("resetOverride(ctx.admin, actor, SCOPE, policyPath(def.key))")
      && /const v = validateDraft\(body\.key, body\.value\);\s*if \(!v\.ok\) return refuse\(422/.test(r),
    detail: "the route may write only catalogue paths, after validateDraft refuses out-of-range" };
};

// ── R. consumers ──
const CONSUMERS: [K, string, RegExp | null][] = [
  ["reminders", "const horizonDays = (await loadIndividualPolicy(admin)).reminderHorizonDays;", /REMINDER_HORIZON_DAYS/],
  ["evidence", "loadIndividualPolicy(ctx.admin)", /REMINDER_HORIZON_DAYS/],
  ["home", "}, today, policy.reminderHorizonDays);", null],
  ["registration", "policy.reminderHorizonDays", /REMINDER_HORIZON_DAYS/],
  ["shareRoute", "parseShare(fields, (await loadIndividualPolicy(ctx.admin)).shareLinkMaxDays)", null],
  ["sharePage", "max={maxDays}", /max=\{365\}/],
  ["scholarHttp", "individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId))", /const quota = await checkAiQuota/],
  ["assistant", "individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId))", /const quota = await checkAiQuota/],
  ["proAssistant", "individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId))", /const quota = await checkAiQuota/],
  // AI-FAIR-USE-01: the generator also takes the metered runner -- the limit is still the policy value.
  ["questions", "runQuestions(ctx.userId, kind, passage, (await loadIndividualPolicy(ctx.admin)).scholarQuestionsPerRequest, ai.run)", null],
  ["generation", "checkQuestions(r.text, passage, limit)", /arr\.slice\(0, QUESTIONS_PER_REQUEST\)/],
  ["uploads", "if (count >= maxMaterials)", /MAX_MATERIALS_PER_PERSON/],
  ["passportRoute", "passportAchievementKinds.includes(body.achievement)", null],
  ["progress", "offered.has(a.achievement)", null],
];
const checkConsumers = (src: Src): R => {
  const bad = CONSUMERS.filter(([k, need, banned]) => { const s = code(src, k); return !s.includes(need) || (banned ? banned.test(s) : false); }).map(([k]) => FILES[k]);
  return { ok: bad.length === 0, detail: bad.join(", ") };
};

// ── L. the reader ──
const checkReader = (src: Src): R => {
  const s = code(src, "policy");
  const load = s.slice(s.indexOf("export async function loadIndividualPolicy"));
  return {
    ok: /\.select\("config_path, published"\)/.test(load) && !/draft/.test(load.slice(0, load.indexOf("}"))) && /return error \? DEFAULT_POLICY : resolvePolicy\(data \?\? \[\]\);/.test(load)
      && /const int = \(key: IntPolicyKey\) => clampInt\(/.test(s) && /clampSet\(policyDef\("passport_achievement_kinds"\)/.test(s)
      && /return Math\.min\(p\.max, Math\.max\(p\.min, Math\.floor\(n\)\)\);/.test(s),
    detail: "loadIndividualPolicy must read published only, fail soft, and clamp every value",
  };
};

// ── G6. the controlled-catalogue door (migration 394) ──
// The same capability, gate first, POST only; the page gated first; route map and nav declare it; and it
// never publishes -- publication stays the governed framework lifecycle.
const checkCatalogueDoor = (src: Src): R => {
  const r = code(src, "catRoute"), p = code(src, "catPage"), sp = code(src, "spaces"), nav = code(src, "nav");
  const body = r.slice(r.indexOf("export async function POST"));
  const gate = body.indexOf(`await hqApiGate(["hq.individual.config.manage"])`), first = body.indexOf("await ");
  const pageBody = p.slice(p.indexOf("export default async function"));
  const pGate = pageBody.indexOf(`await requireHqCapability("hq.individual.config.manage")`), pFirst = pageBody.indexOf("await ");
  const routeOk = gate > -1 && gate === first && /if \(isHqRefusal\(ctx\)\) return ctx;/.test(body) && !/export async function (GET|PUT|PATCH|DELETE)/.test(r);
  const noPublish = !/transitionFramework|pub_status:\s*"|\.update\(\{\s*pub_status/.test(r + p);
  const mapped = /\{ prefix: "\/super-admin\/individual\/catalogues",\s*capability: "hq\.individual\.config\.manage" \}/.test(sp) && nav.includes(`href: "/super-admin/individual/catalogues"`);
  return { ok: routeOk && pGate > -1 && pGate === pFirst && noPublish && mapped, detail: `route ${routeOk}, page gate ${pGate}/${pFirst}, no publish ${noPublish}, mapped ${mapped}` };
};

// ── G5. no third HQ Individual door ──
// individual-foundation-harness pins the grants/ and invitations/ routes, G1 pins config/. A route anywhere else under
// /api/hq/individual would be pinned by neither, so it must not exist without one of them learning of it.
const listRoutes = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? listRoutes(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name).replace(/\\/g, "/")] : []);
const checkKnownDoors = (routes: string[]): R => {
  // invitations/ (COMPETEN-IND-ACCESS-001, migration 378) is pinned by individual-foundation-harness 5b, 5c
  // and 10c beside grants/: the same pilot-grant capability, the same release gate.
  // plans/ (P1 Commercial, migration 400) is pinned by individual-foundation-harness 13b: its own capability,
  // hq.individual.commercial.manage (no position holds it), then individual_app AND individual_commerce.
  // catalogues/ (migration 394) is pinned by G6 here.
  const extra = routes.filter(f => !/^src\/app\/api\/hq\/individual\/(grants|invitations)\//.test(f)
    && f !== "src/app/api/hq/individual/plans/route.ts"
    // programmes/ (JOIN-01) is pinned by individual-foundation-harness 14g: this same right, every save audited.
    && f !== "src/app/api/hq/individual/programmes/route.ts" && f !== FILES.route && f !== FILES.catRoute);
  return { ok: routes.includes(FILES.route) && extra.length === 0, detail: `unpinned: ${extra.join(", ")}` };
};

// ── A. no activation ──
const checkNoActivation = (src: Src): R => {
  const bad = (["route", "page", "controls", "policy"] as K[]).filter(k => /individual_app|INDIVIDUAL_APP_FLAG|practice_platform_flags/.test(code(src, k)));
  return { ok: bad.length === 0, detail: bad.map(k => FILES[k]).join(", ") };
};

const plant = (k: K, from: string | RegExp, to: string): Src => {
  const s = RAW.get(FILES[k]) ?? "";
  const next = typeof from === "string" ? s.replace(from, to) : s.replace(from, to);
  if (next === s) throw new Error(`plant did not apply in ${FILES[k]}: ${String(from)}`);
  return new Map([...RAW, [FILES[k], next]]);
};
const red = (name: string, r: R) => ok(`P. ${name} goes RED`, !r.ok, "the check passed on a planted violation");

function main() {
  console.log("INDIVIDUAL CONFIG HARNESS (COMPETEN-CONFIG-002)\n");
  const missing = Object.values(FILES).filter(f => !RAW.get(f));
  ok("0. every file this harness pins exists", missing.length === 0, missing.join(", "));
  ok("0b. ⚠ the comment strip kept real code", code(RAW, "route").includes("await hqApiGate(") && !code(RAW, "route").includes("GATED BY"));

  const run = (n: string, r: R) => ok(n, r.ok, r.detail);
  run("G1. the route is hqApiGate(hq.individual.config.manage) before anything else, POST only", checkRouteGate(RAW));
  run("G2. the page is requireHqCapability(hq.individual.config.manage) before anything else", checkPageGate(RAW));
  run("G3. the HQ catalogue, the route map and the nav declare it", checkCatalogue(RAW));
  run("G4. 376 seeds the capability and its grant together, to the one position, data only", checkMigration(RAW));
  run("W1. the WCE tables are written only by the shared lifecycle", checkOneWriter(RAW));
  run("W2. the super door pins 'platform', the Individual door 'individual', and its rollback names its scope", checkPartitions(RAW));
  run("W3. the Individual door writes only catalogue paths, after validateDraft refuses out-of-range (422)", checkPolicyPathsOnly(RAW));
  run("R1. every consumer reads its setting from the policy and none compares the old constant", checkConsumers(RAW));
  run("L1. the reader reads published values only, fails soft and clamps every one", checkReader(RAW));
  run("G5. every route under /api/hq/individual is a pinned grants route, this config route or the catalogue route", checkKnownDoors(listRoutes("src/app/api/hq/individual")));
  run("G6. the controlled-catalogue door: same capability first, POST only, page gated first, mapped, never publishes", checkCatalogueDoor(RAW));
  run("A1. ⚠ nothing on this surface names individual_app", checkNoActivation(RAW));

  console.log("");
  red("G1 on a route with no gate", checkRouteGate(plant("route", `const ctx = await hqApiGate(["hq.individual.config.manage"]);`, `const ctx = await hqApiGate(["hq.platform.home.view"]);`)));
  red("G1 on a read before the gate", checkRouteGate(plant("route", `const ctx = await hqApiGate(`, `await Promise.resolve(); const ctx = await hqApiGate(`)));
  red("G1 on an added GET", checkRouteGate(plant("route", "export async function POST", "export async function GET() { return null; }\nexport async function POST")));
  red("G2 on a page gated by a view right", checkPageGate(plant("page", `requireHqCapability("hq.individual.config.manage")`, `requireHqCapability("hq.platform.home.view")`)));
  red("G3 on a missing route-map entry", checkCatalogue(plant("spaces", `  { prefix: "/super-admin/individual/configuration", capability: "hq.individual.config.manage" },\n`, "")));
  red("G3 on the capability claiming the bare /super-admin/individual", checkCatalogue(plant("spaces", `{ prefix: "/super-admin/individual/configuration", capability:`, `{ prefix: "/super-admin/individual", capability: "hq.individual.config.manage" },\n  { prefix: "/super-admin/individual/configuration", capability:`)));
  red("G4 on a capability with no grant", checkMigration(plant("mig", "cross join (values ('hq.individual.config.manage')) as c(code)", "cross join (values ('hq.platform.home.view')) as c(code)")));
  red("G4 on a grant to a second position", checkMigration(plant("mig", "(values ('individual_product_administrator')) as p(code)", "(values ('individual_product_administrator'), ('practice_product_director')) as p(code)")));
  red("G4 on DDL in the data-only file", checkMigration(plant("mig", "notify pgrst, 'reload schema';", "alter table hq_capability add column x int;\nnotify pgrst, 'reload schema';")));
  red("W1 on an inline write in the Individual route", checkOneWriter(plant("route", "switch (body?.action) {", `await ctx.admin.from("workspace_config_overrides").upsert({});\n  switch (body?.action) {`)));
  red("W1 on the super route writing inline again", checkOneWriter(plant("superRoute", "if (action === \"set\") {", `if (action === "set") {\n    await admin.from("workspace_config_audit").insert({});`)));
  red("W2 on the Individual policy sharing the workspace partition", checkPartitions(plant("policy", `scopeRef: "individual" } as const`, `scopeRef: "platform" } as const`)));
  red("W2 on an unscoped rollback", checkPartitions(plant("route", "{ scope: SCOPE, prune: true }", "{ prune: true }")));
  red("W2 on a caller-chosen scope", checkPartitions(plant("route", "const SCOPE = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };", "const SCOPE = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };\nconst S2 = { scopeType: \"platform\", scopeRef: body.scope_ref };")));
  red("W3 on a raw config path", checkPolicyPathsOnly(plant("route", "setOverride(ctx.admin, actor, SCOPE, policyPath(v.def.key), v.settings)", "setOverride(ctx.admin, actor, SCOPE, String(body.path), v.settings)")));
  red("R1 on the reminder scan using the constant", checkConsumers(plant("reminders", "const horizonDays = (await loadIndividualPolicy(admin)).reminderHorizonDays;", "const horizonDays = REMINDER_HORIZON_DAYS;")));
  red("R1 on the upload cap reverting to the constant", checkConsumers(plant("uploads", "if (count >= maxMaterials)", "if (count >= MAX_MATERIALS_PER_PERSON)")));
  red("R1 on an AI route with only the estate quota", checkConsumers(plant("proAssistant", "const quota = individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId));", "const quota = await checkAiQuota(ctx.admin, ctx.userId);")));
  red("R1 on the Passport route ignoring switched-off kinds", checkConsumers(plant("passportRoute", "passportAchievementKinds.includes(body.achievement)", "length >= 0")));
  red("L1 on a reader that reads drafts", checkReader(plant("policy", `.select("config_path, published")`, `.select("config_path, draft")`)));
  red("L1 on a reader that does not clamp", checkReader(plant("policy", "return Math.min(p.max, Math.max(p.min, Math.floor(n)));", "return Math.floor(n);")));
  red("G5 on a third, unpinned door", checkKnownDoors([...listRoutes("src/app/api/hq/individual"), "src/app/api/hq/individual/export/route.ts"]));
  red("G6 on a read before the gate", checkCatalogueDoor(plant("catRoute", `  const ctx = await hqApiGate(["hq.individual.config.manage"]);`, `  await ctx0();\n  const ctx = await hqApiGate(["hq.individual.config.manage"]);`)));
  red("G6 on a view right", checkCatalogueDoor(plant("catPage", `requireHqCapability("hq.individual.config.manage")`, `requireHqCapability("hq.learning.competencies.view")`)));
  red("G6 on a publish from this door", checkCatalogueDoor(plant("catRoute", `  if (!result.ok) return refuse(409, result.error);`, `  if (!result.ok) return refuse(409, result.error);\n  await transitionFramework(ctx.admin, fw.id, "publish", actor);`)));
  red("G6 on a missing route-map entry", checkCatalogueDoor(plant("spaces", `  { prefix: "/super-admin/individual/catalogues", capability: "hq.individual.config.manage" },\n`, "")));
  red("A1 on the route touching the release gate", checkNoActivation(plant("route", "switch (body?.action) {", `await ctx.admin.from("practice_platform_flags").select("enabled");\n  switch (body?.action) {`)));

  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}
main();
