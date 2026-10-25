/**
 * CKRI -- STATIC HARNESS (COMPETEN-KNOWLEDGE-RESEARCH-01, migrations 440-443).
 *
 *   npx tsx scripts/ckri-harness.ts
 *
 * No credentials, no network. Every check runs twice: on the real sources (must PASS) and on a copy with ONE planted
 * violation (must go RED). A check whose plant does not turn it red is reported as a failure of the check itself.
 * The behaviour of the triggers is proven separately against a disposable database (scripts/ckri-db/test-44x.sql).
 *
 *   K1-1  440: aggregate-only access is the only representable value, the cohort floor is 5, the purpose permission
 *         set has no content-contribution or personal-AI value, a research-study purpose always needs ethics
 *   K1-2  440: independence and authority -- an author cannot activate their purpose, a proposer cannot decide their
 *         project, and both go through ckri_holds_capability
 *   K1-3  440: both trails are written only by their record trigger, append-only, with the cascade path
 *   K1-4  Scholar never reads CKRI participation to decide anything: no Individual file imports lib/knowledge or names
 *         a ckri_ table, except the one research-choices route
 *   K1-5  the research-choices route: one CKRI permission per request, and a withdrawal is never gated
 *   K1-6  the HQ governance route: its capability fixed server-side, then the gate, before any action
 *   K1-7  CKRI library code names no individual_scholar_ table except the person's own AI consent
 *   K1-8  the HQ catalogue lists both capabilities, and governance resolves to govern, not propose
 *   K2-*  added with migration 441
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Src = Map<string, string>;
const F = {
  m440: "supabase/migrations/440-ckri-research-governance.sql",
  gov: "src/lib/knowledge/governance.ts",
  rgov: "src/lib/knowledge/research-governance.ts",
  contracts: "src/lib/knowledge/data-contracts.ts",
  choices: "src/app/api/individual/scholar/research/route.ts",
  hqGov: "src/app/api/hq/knowledge/governance/route.ts",
  spaces: "src/lib/hq/spaces.ts",
} as const;
type K = keyof typeof F;

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) { const p = join(dir, e).replace(/\\/g, "/"); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(p)) out.push(p); }
  return out;
};
const INDIVIDUAL = [...walk("src/lib/individual"), ...walk("src/app/api/individual"), ...walk("src/app/(individual)"), ...walk("src/app/individual"), ...walk("src/app/scholar")];
const KNOWLEDGE_LIB = walk("src/lib/knowledge").filter(f => !f.endsWith(".test.ts"));

const RAW: Src = new Map([...Object.values(F), ...INDIVIDUAL, ...KNOWLEDGE_LIB].map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const sqlCode = (s: string) => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").toLowerCase();
const tsCode = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const get = (src: Src, k: K) => (k.startsWith("m") ? sqlCode : tsCode)(src.get(F[k]) ?? "");

type R = { ok: boolean; detail: string };
const r = (ok: boolean, detail = ""): R => ({ ok, detail });

const CHECKS: { id: string; check: (s: Src) => R; plant: (s: Src) => Src }[] = [];
const plantIn = (file: string, from: string | RegExp, to: string) => (s: Src): Src => {
  const n = new Map(s); const v = n.get(file) ?? ""; const w = v.replace(from, to);
  if (w === v) throw new Error(`plant did not apply in ${file}: ${String(from)}`);
  n.set(file, w); return n;
};

CHECKS.push({ id: "K1-1 aggregate only, floor 5, permissions closed, study needs ethics", check: s => {
  const m = get(s, "m440");
  const a = /and data_access = 'aggregate_only'/.test(m);
  const floor = /min_cohort between 5 and 1000/.test(m);
  const perms = /permission in \('collective_analytics', 'research_study'\)/g;
  const permCount = (m.match(perms) ?? []).length;
  const noBad = !/'content_contribution'|'personal_ai_learning'|'row_level'/.test(m);
  const ethics = /\(permission <> 'research_study' or requires_ethics\)/.test(m);
  return r(a && floor && permCount === 2 && noBad && ethics, `aggregate=${a} floor=${floor} permissionChecks=${permCount} noBadValues=${noBad} ethics=${ethics}`);
}, plant: plantIn(F.m440, "and data_access = 'aggregate_only'", "and data_access in ('aggregate_only', 'row_level')") });

CHECKS.push({ id: "K1-2 independence and authority in the triggers", check: s => {
  const m = get(s, "m440");
  const purpose = /if new\.activated_by = new\.created_by then\s+raise exception/.test(m) && /ckri_holds_capability\(new\.activated_by, 'hq\.quality\.research\.govern'\)/.test(m);
  const project = /if new\.decided_by = new\.proposed_by then\s+raise exception/.test(m) && /ckri_holds_capability\(new\.decided_by, 'hq\.quality\.research\.govern'\)/.test(m);
  const propose = /ckri_holds_capability\(new\.proposed_by, 'hq\.quality\.research\.propose'\)/.test(m);
  return r(purpose && project && propose, `purpose=${purpose} project=${project} propose=${propose}`);
}, plant: plantIn(F.m440, "if new.decided_by = new.proposed_by then", "if false then") });

CHECKS.push({ id: "K1-3 trails trigger-written, append-only, cascade path", check: s => {
  const m = get(s, "m440");
  const insertOnlyFromTrigger = /if tg_op = 'insert' then\s+if pg_trigger_depth\(\) > 1 then return new; end if;\s+raise exception/.test(m);
  const cascade = /if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then return old; end if;\s+raise exception '% is append-only'/.test(m);
  const both = /ckri_participation_event_guard before insert or update or delete/.test(m) && /ckri_research_project_event_guard before insert or update or delete/.test(m);
  return r(insertOnlyFromTrigger && cascade && both, `insert=${insertOnlyFromTrigger} cascade=${cascade} bothTables=${both}`);
}, plant: plantIn(F.m440, "if pg_trigger_depth() > 1 then return new; end if;", "return new;") });

CHECKS.push({ id: "K1-4 Scholar never reads CKRI to decide anything", check: s => {
  const offenders = INDIVIDUAL.filter(f => f !== F.choices && /@\/lib\/knowledge|from\(\s*["'`]ckri_/.test(tsCode(s.get(f) ?? "")));
  return r(offenders.length === 0 && INDIVIDUAL.length > 50, `${INDIVIDUAL.length} Individual files scanned, offenders: ${offenders.join(", ") || "none"}`);
}, plant: s => { const n = new Map(s); const f = INDIVIDUAL.find(x => x.endsWith("scholar/http.ts"))!; n.set(f, `import { ckriEnabled } from "@/lib/knowledge/governance";\n${n.get(f)}`); return n; } });

CHECKS.push({ id: "K1-5 one permission per request, withdrawal never gated", check: s => {
  const c = get(s, "choices");
  const onlyTwo = /permission !== "collective_analytics" && permission !== "research_study"/.test(c) && !/personal_ai_learning|content_contribution|individual_scholar_consent|case_candidacy/.test(c);
  const gateInsideGrant = /if \(body\.grant\) \{\s+if \(!\(await ckriEnabled\(ctx\.admin\)\)\)/.test(c) && (c.match(/ckriEnabled\(ctx\.admin\)/g) ?? []).length === 2;
  const noticeInsideGrant = /if \(body\.grant\) \{[\s\S]*?participationNotice\(\)[\s\S]*?\n  \}/.test(c);
  return r(onlyTwo && gateInsideGrant && noticeInsideGrant, `onlyTwo=${onlyTwo} gateOnGrantOnly=${gateInsideGrant} noticeOnGrantOnly=${noticeInsideGrant}`);
}, plant: plantIn(F.choices, "  let noticeVersion: string | null = null;\n", "  if (!(await ckriEnabled(ctx.admin))) return NextResponse.json({ error: CKRI_OFF }, { status: 409 });\n  let noticeVersion: string | null = null;\n") });

CHECKS.push({ id: "K1-6 HQ governance route: capability fixed, then gate, before any action", check: s => {
  const c = get(s, "hqGov");
  const i = (re: RegExp) => c.search(re);
  const order = [i(/const capability = /), i(/await hqApiGate\(\[capability\]\)/), i(/await ckriEnabled\(ctx\.admin\)/), i(/switch \(action\)/)];
  const ok = order.every(x => x >= 0) && order.every((x, k) => k === 0 || x > order[k - 1]);
  const noBrowserActor = !/body\.(decidedBy|actor|changedBy|proposedBy|dataAccess)/.test(c);
  return r(ok && noBrowserActor, `order=${order.join(",")} noBrowserActor=${noBrowserActor}`);
}, plant: plantIn(F.hqGov, "  if (!(await ckriEnabled(ctx.admin))) return refuse(409, CKRI_OFF);\n", "") });

CHECKS.push({ id: "K1-7 CKRI library names no raw Scholar table but the person's own consent", check: s => {
  const hits: string[] = [];
  for (const f of KNOWLEDGE_LIB) for (const m of tsCode(s.get(f) ?? "").matchAll(/from\(\s*["'`](individual_scholar_[a-z_]+)/g)) if (!(f === F.gov && m[1] === "individual_scholar_consent")) hits.push(`${f}:${m[1]}`);
  return r(hits.length === 0 && KNOWLEDGE_LIB.length >= 3, `${KNOWLEDGE_LIB.length} files, hits: ${hits.join(", ") || "none"}`);
}, plant: plantIn(F.rgov, "export async function governanceOverview(admin: any) {", "export async function governanceOverview(admin: any) {\n  await admin.from(\"individual_scholar_attempt\").select(\"correct\");") });

CHECKS.push({ id: "K1-8 HQ catalogue and route intent", check: s => {
  const c = s.get(F.spaces) ?? "";
  const caps = /code: "hq\.quality\.research\.govern"/.test(c) && /code: "hq\.quality\.research\.propose"/.test(c);
  const gi = c.indexOf('"/super-admin/research/governance"'), ri = c.indexOf('prefix: "/super-admin/research",');
  const route = gi > 0 && /"\/super-admin\/research\/governance",\s+capability: "hq\.quality\.research\.govern"/.test(c) && (ri < 0 || gi < ri);
  return r(caps && route, `caps=${caps} governanceRoute=${route}`);
}, plant: plantIn(F.spaces, /"\/super-admin\/research\/governance",(\s+)capability: "hq\.quality\.research\.govern"/, "\"/super-admin/research/governance\",$1capability: \"hq.quality.research.propose\"") });

let pass = 0; const fails: string[] = [];
for (const c of CHECKS) {
  const real = c.check(RAW);
  let planted: R;
  try { planted = c.check(c.plant(RAW)); } catch (e) { planted = { ok: true, detail: `plant error: ${(e as Error).message}` }; }
  const good = real.ok && !planted.ok;
  if (good) pass++; else fails.push(c.id);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${c.id}\n        real: ${real.ok ? "green" : "RED"} (${real.detail})\n        planted: ${planted.ok ? "STILL GREEN" : "red"} (${planted.detail})`);
}
console.log(`\nCKRI harness: ${pass}/${CHECKS.length} checks pass on the real sources AND go red when their violation is planted.`);
if (fails.length) { console.log(`FAILED: ${fails.join("; ")}`); process.exit(1); }
