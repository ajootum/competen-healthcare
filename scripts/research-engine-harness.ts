/**
 * RESEARCH & EVIDENCE ENGINE -- STATIC HARNESS (COMPETEN-RESEARCH-01 ADDENDUM V2, migration 630). No credentials, no network.
 *   npx tsx scripts/research-engine-harness.ts
 *
 *   E1  nothing is Active by default; only Phase 1 has adapters; Phase 2 and 3 are structures only
 *   E2  the provider adapters are imported only by the engine (service.ts) and the Studio's connectivity check (admin.ts)
 *   E3  every adapter call in the engine sits behind the one gate (notInvocable) and the budget, after the workflow check
 *   E4  PLANTED AT RUNTIME: a status forged into the configuration, a Phase 2 source forced Active, and the seeded
 *       registry all send NO request
 *   E5  the Studio route is gated by hq.platform.research.manage, and approval, activation, retirement, spend approval,
 *       publish and rollback are owner-only
 *   E6  migration 630 grants the right to NO position, holds no person or query text, and keeps RLS on
 *   E7  research cost is recorded apart from AI cost (plat_research_requests, never plat_ai_requests, in the engine)
 *   E8  retention runs in the existing job runner, prunes only the engine's cache and zero-cost usage rows, and never
 *       touches spend rows, audit or AI records
 *   E9  research usage is attributed to the Scholar AI action it served (the runner is built first, its id passed on)
 *   P   each control goes red when its violation is planted
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS, SEED_REGISTRY, resolveRegistry } from "../src/lib/holdings/research/registry";
import { DEFAULT_POLICY, resolveWorkflows } from "../src/lib/holdings/research/engine-config";
import { runResearch } from "../src/lib/holdings/research/service";
import type { FetchLike } from "../src/lib/holdings/research/providers";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function walk(d: string): string[] { return readdirSync(d).flatMap(f => { const p = join(d, f).replace(/\\/g, "/"); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p) ? [p] : []; }); }

const LIB = "src/lib/holdings/research";
const SVC = `${LIB}/service.ts`, ADMIN = `${LIB}/admin.ts`, REG = `${LIB}/registry.ts`, ROUTE = "src/app/api/hq/research-sources/route.ts", MIG = "supabase/migrations/630-research-evidence-engine.sql";
type Src = Map<string, string>;
const REAL: Src = new Map(walk("src").map(f => [f, strip(read(f))]));
let MIG630 = ""; try { MIG630 = read(MIG); } catch { /* not in this checkout */ }

const seedsSafe = (reg: typeof SEED_REGISTRY, adapters: readonly string[]) =>
  Object.values(reg).every(r => r.status === "designed" || r.status === "configured")
  && Object.values(reg).filter(r => r.phase > 1).every(r => !adapters.includes(r.id))
  && [...adapters].sort().join() === Object.values(reg).filter(r => r.phase === 1).map(r => r.id).sort().join();

const adaptersConfined = (src: Src) => [...src].filter(([, s]) => /\b(searchPubmed|searchOpenAlex|verifyDoi)\b/.test(s) && /from "\.\/providers"|from "@\/lib\/holdings\/research\/providers"/.test(s))
  .map(([f]) => f).filter(f => f !== SVC && f !== ADMIN && f !== `${LIB}/providers.ts`);

const gated = (src: Src) => {
  const s = src.get(SVC) ?? "";
  const run = s.slice(s.indexOf("export async function runResearch"));
  const iWf = run.indexOf("workflowOperational("), iCall = run.indexOf("async function call<T>"), iGate = run.indexOf("const blocked = notInvocable(r,"), iBudget = run.indexOf("deps.usage.allow(r)"), iRun = run.indexOf("out = await run(");
  const direct = run.replace(/const ADAPTER[\s\S]*?\n  \};/, "").replace(/async function call<T>[\s\S]*?\n  \}\n/, "");
  return iWf > 0 && iCall > iWf && iGate > iCall && iBudget > iGate && iRun > iBudget
    && /pubmed: \(p, r\) => searchPubmed\(p,/.test(run) && /openalex: \(p, r\) => searchOpenAlex\(p,/.test(run)
    && /call\(r, "search", p => ADAPTER\[r\.id\]\(p, r\)\)/.test(run) && /call\(v, "doi_verification", p => verifyDoi\(p, i\)/.test(run)
    && !/\b(searchPubmed|searchOpenAlex)\(/.test(direct.replace(/call\(v, "doi_verification", p => verifyDoi\(p, i\)/, ""));
};

const ownerOnly = (src: Src) => {
  const route = src.get(ROUTE) ?? "", admin = src.get(ADMIN) ?? "", reg = src.get(REG) ?? "";
  return /const ctx = await hqApiGate\(\["hq\.platform\.research\.manage"\]\);/.test(route) && /if \(isHqRefusal\(ctx\)\) return ctx;/.test(route) && /isOwner: ctx\.isOwner/.test(route)
    && /export async function publishResearch\([^{]*\{\n  if \(!actor\.isOwner\) return fail\(403/.test(admin)
    && /export async function rollbackResearch\([^{]*\{\n  if \(!actor\.isOwner\) return fail\(403/.test(admin)
    && /if \(kind === "paidApproval" && !actor\.isOwner\) return fail\(403/.test(admin)
    && /if \(\["approved", "active", "retired"\]\.includes\(to\) && !actor\.isOwner\) need\.push\("a platform owner"\);/.test(reg)
    && /const needs = transitionNeeds\(r, to, actor\);/.test(admin)
    // The gate requires the server's checks and the owner's acts, not a status.
    && /if \(!r\.checks\.approval\?\.ok \|\| !r\.checks\.activation\?\.ok\) return "not_approved";/.test(reg) && /if \(!hasAdapter\(r\.id\)\) return "no_adapter";/.test(reg);
};

const migSafe = (m: string) => m.length > 0 && /insert into hq_capability \(code, space, label, description\) values\s+\('hq\.platform\.research\.manage'/.test(m)
  && !/hq_position_capability \(/i.test(m.replace(/--.*$/gm, "")) && /alter table plat_research_requests enable row level security/.test(m)
  && !/create policy/i.test(m) && !/^\s+(user_id|actor_id|person_id|query|query_text|question)\s+(uuid|text)/im.test(m);

const costApart = (src: Src) => {
  const load = src.get(`${LIB}/load.ts`) ?? "", svc = src.get(SVC) ?? "";
  return /admin\.from\("plat_research_requests"\)\.insert\(/.test(load) && ![load, svc].some(s => /plat_ai_requests/.test(s));
};

const RET = `${LIB}/retention.ts`, JOBS = "src/lib/platform/jobs.ts", ACT = "src/app/api/individual/scholar/learn/act/route.ts", LR = "src/lib/individual/scholar/learn-research.ts";
const retentionSafe = (src: Src) => {
  const r = src.get(RET) ?? "", j = src.get(JOBS) ?? "";
  const deletes = [...r.matchAll(/admin\.from\("([a-z_]+)"\)\.delete\(/g)].map(m => m[1]);
  const count = (s: string, x: string) => s.split(x).length - 1;
  return j.includes("research_retention: async (admin) => {\n    const r = await pruneResearchRecords(admin);") && /key: "research_retention",[^}]*runnable: true/.test(j)
    && deletes.length === 3 && deletes.every(t => t === "individual_scholar_research_cache" || t === "plat_research_requests")
    && count(r, '.like("provider", "holdings:%")') === 2 && r.includes('admin.from("plat_research_requests").delete({ count: "exact" }).eq("cost_usd", 0)')
    && r.includes("if (!engine.readable) return { ran: false");
};
const attributed = (src: Src) => {
  const a = src.get(ACT) ?? "", l = src.get(LR) ?? "";
  const iRunner = a.indexOf("const ai = scholarAiRunner("), iSearch = a.indexOf("await learnResearch(ctx,");
  return iRunner > 0 && iSearch > iRunner && a.includes("topics, title: stepTitle }, ai.actionId,")
    && l.includes('researchUsage(ctx.admin, { actionId, product: "scholar"') && l.includes("{ action_id: actionId, query_chars:");
};

async function forgedSendsNothing(): Promise<boolean> {
  const log: string[] = [];
  const f: FetchLike = async u => { log.push(u); return { ok: true, status: 200, text: async () => "{}" }; };
  const wf = resolveWorkflows({ basic: { status: "active" } }).basic;
  const plan = (doc: unknown) => ({ product: "scholar" as const, activity: "learn" as const, registry: resolveRegistry(doc), policy: DEFAULT_POLICY, workflow: wf });
  const all = { at: "2026-10-28T00:00:00Z", by: "x", ok: true, detail: "x" };
  await runResearch("oxygen therapy", plan(null), { fetch: f });
  await runResearch("oxygen therapy", plan({ pubmed: { status: "active" }, openalex: { status: "active" } }), { fetch: f });
  await runResearch("oxygen therapy", plan({ europe_pmc: { status: "active", products: ["scholar"], activities: ["learn"], checks: { connectivity: all, approval: all, activation: all } } }), { fetch: f });
  return log.length === 0;
}

(async () => {
  console.log("RESEARCH & EVIDENCE ENGINE HARNESS");
  ok("E1. nothing is Active by default; only Phase 1 has adapters; Phase 2 and 3 are structures only", seedsSafe(SEED_REGISTRY, ADAPTERS));
  ok("E2. the adapters are imported only by the engine and the Studio connectivity check", adaptersConfined(REAL).length === 0, adaptersConfined(REAL).join(", "));
  ok("E3. every adapter call sits behind the workflow check, the one gate and the budget", gated(REAL));
  ok("E4. PLANTED AT RUNTIME: a forged status, a Phase 2 source forced Active and the seeded registry send no request", await forgedSendsNothing());
  ok("E5. the Studio route is gated by hq.platform.research.manage; approval, activation, retirement, spend approval, publish and rollback are owner-only", ownerOnly(REAL));
  if (MIG630) ok("E6. 630 grants the right to no position, keeps RLS on with no policy, and holds no person or query text", migSafe(MIG630));
  else console.log(`  NOTE  ${MIG} is not in this checkout -- E6 NOT RUN`);
  ok("E7. research cost is recorded in plat_research_requests, apart from AI cost", costApart(REAL));

  ok("E8. retention runs in the existing job runner, prunes only the engine cache and zero-cost usage, keeps spend, audit and AI records", retentionSafe(REAL));
  ok("E9. research usage is attributed to the Scholar AI action it served", attributed(REAL));

  const plant = (file: string, from: string, to: string): Src => { const c = new Map(REAL); const b = c.get(file) ?? ""; if (!b.includes(from)) throw new Error(`plant did not apply in ${file}: ${from.slice(0, 50)}`); c.set(file, b.replace(from, to)); return c; };
  ok("P1. ⚠ E3 goes red when the gate is removed from the engine's call path",
    !gated(plant(SVC, "const blocked = notInvocable(r,", "const blocked = null && notInvocable(r,")) && !gated(plant(SVC, "deps.usage.allow(r)", "true")));
  ok("P2. ⚠ E2 goes red when another module calls an adapter directly",
    adaptersConfined(new Map([...REAL, ["src/lib/individual/scholar/rogue.ts", 'import { searchPubmed } from "@/lib/holdings/research/providers"; searchPubmed(x, "q", 5, true);']])).length === 1);
  ok("P3. ⚠ E1 goes red when a Phase 2 source is given an adapter or a seed is Active",
    !seedsSafe(SEED_REGISTRY, [...ADAPTERS, "elicit"]) && !seedsSafe({ ...SEED_REGISTRY, pubmed: { ...SEED_REGISTRY.pubmed, status: "active" } }, ADAPTERS));
  ok("P4. ⚠ E5 goes red when publish stops checking the owner, or the gate trusts a status",
    !ownerOnly(plant(ADMIN, "export async function publishResearch(admin: any, actor: Actor, note: string | null): Promise<Out> {\n  if (!actor.isOwner) return fail(403", "export async function publishResearch(admin: any, actor: Actor, note: string | null): Promise<Out> {\n  if (false) return fail(403"))
    && !ownerOnly(plant(REG, 'if (!r.checks.approval?.ok || !r.checks.activation?.ok) return "not_approved";', "")));
  if (MIG630) ok("P5. ⚠ E6 goes red when 630 grants the right to a position", !migSafe(`${MIG630}\ninsert into hq_position_capability (position_code, capability_code, source) values ('platform_director', 'hq.platform.research.manage', 'position_default');`));
  ok("P6. ⚠ E7 goes red when the engine records research cost as AI usage", !costApart(plant(`${LIB}/load.ts`, 'admin.from("plat_research_requests").insert(', 'admin.from("plat_ai_requests").insert(')));

  ok("P7. ⚠ E8 goes red when retention would delete a spend row, the exam cache or an audit record",
    !retentionSafe(plant(RET, '.delete({ count: "exact" }).eq("cost_usd", 0)', '.delete({ count: "exact" })'))
    && !retentionSafe(plant(RET, 'from("individual_scholar_research_cache").delete({ count: "exact" }).like("provider", "holdings:%").lt("expires_at"', 'from("individual_scholar_research_cache").delete({ count: "exact" }).lt("expires_at"'))
    && !retentionSafe(plant(RET, "  return { ran: true,", '  await admin.from("audit_log").delete().lt("created_at", cutoff);\n  return { ran: true,')));
  ok("P8. ⚠ E9 goes red when research no longer carries the action id",
    !attributed(plant(ACT, "topics, title: stepTitle }, ai.actionId,", "topics, title: stepTitle }, null,")));

  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed\n  FAILED: ${fails.join("\n  FAILED: ")}` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
})();
