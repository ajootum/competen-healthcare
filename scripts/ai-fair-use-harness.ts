/**
 * AI FAIR USE -- STATIC HARNESS (COMPETEN-AI-FAIR-USE-01, migration 410).
 *
 *   npx tsx scripts/ai-fair-use-harness.ts
 *
 * No credentials, no network. Each check has a planted violation that must turn it RED. The four the financial
 * red line names are marked FI:
 *   A1  (FI) concurrent overspend is impossible: ai_reserve takes the account row FOR UPDATE and checks the pool
 *       under that lock, and no application code writes a balance
 *   A2  (FI) a retry cannot charge twice: request_id is UNIQUE, ai_reserve returns an existing request, and the
 *       engine refuses a known id before the provider is called
 *   A3  (FI) a double settle is refused: ai_settle and ai_release act only on a reserved request
 *   A4  (FI) a client cannot send an allowance: no route passes request input into the allowance, and nothing
 *       but the 410 functions writes the ledger or a balance
 *   A5  (FI) a failure before provider billing costs nothing: with no reported usage the engine releases, and it
 *       settles only what the provider reported
 *   A6  fail closed and dark: metering off is generate() unchanged, an unreadable standing sends nothing, and the
 *       unpublished default policy allows nothing
 *   A7  clinical safety: a clinically sensitive activity is never configured or served below its tier
 *   A8  the admin door: gated first by hq.platform.ai.manage, POST only, no credential, no activation
 *   A9  history cannot move: rates are append-only (only effective_to may be set, once) and a request is settled
 *       at the price row fixed when it was reserved
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { activityAt, defaultPolicy, resolvePolicy, serviceLevel } from "../src/lib/ai/fair-use-policy";

const F = {
  mig: "supabase/migrations/410-ai-usage-ledger-and-allowances.sql",
  engine: "src/lib/ai/allowance.ts",
  admin: "src/lib/ai/fair-use-admin.ts",
  adminRoute: "src/app/api/hq/ai-governance/route.ts",
  adminPage: "src/app/super-admin/ai/fair-use/page.tsx",
  standingRoute: "src/app/api/individual/ai-allowance/route.ts",
  assistant: "src/app/api/individual/assistant/route.ts",
  proAssistant: "src/app/api/individual/professional/assistant/route.ts",
  mappings: "src/app/api/individual/professional/mappings/route.ts",
} as const;
type K = keyof typeof F;
type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const RAW: Src = new Map(Object.values(F).map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const code = (src: Src, k: K) => k === "mig" ? (src.get(F[k]) ?? "").split("\n").filter(l => !l.trim().startsWith("--")).join("\n").toLowerCase() : strip(src.get(F[k]) ?? "");
const HAS_MIG = !!RAW.get(F.mig);
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p.replace(/\\/g, "/")] : []; });
}
const ALL: Src = new Map(walk("src").map(f => [f, strip(readFileSync(f, "utf8").replace(/\r\n/g, "\n"))]));

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
type R = { ok: boolean; detail: string };
const fn = (m: string, name: string) => m.slice(m.indexOf(`create or replace function public.${name}(`), m.indexOf("$$;", m.indexOf(`create or replace function public.${name}(`)));

const checkLock = (src: Src, all: Src): R => {
  const r = fn(code(src, "mig"), "ai_reserve");
  const lock = /select \* into a from ai_allowance_account where id = p_account for update;/.test(r);
  const lockFirst = r.indexOf("for update") > -1 && r.indexOf("for update") < r.indexOf("if p_pool = 'included' then");
  const pools = /if a\.used_cau \+ a\.reserved_cau \+ v_max > a\.included_cau then/.test(r) && /if a\.reserve_used_cau \+ a\.reserve_reserved_cau \+ v_max > a\.reserve_cau then/.test(r);
  const appWrites = [...all].filter(([, s]) => /from\("ai_allowance_account"\)[\s\S]{0,120}?\.update\(|from\("ai_usage_ledger"\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\(/.test(s)).map(([f]) => f);
  return { ok: lock && lockFirst && pools && appWrites.length === 0, detail: `row lock ${lock}, lock before pool checks ${lockFirst}, pool checks ${pools}, app balance writes: ${appWrites.join(", ")}` };
};
const checkIdempotent = (src: Src): R => {
  const m = code(src, "mig"), e = code(src, "engine");
  const unique = /create unique index if not exists ux_ai_usage_ledger_request on ai_usage_ledger\(request_id\);/.test(m);
  const r = fn(m, "ai_reserve");
  const retry = (r.match(/select \* into existing from ai_usage_ledger l where l\.request_id = p_request_id;/g) ?? []).length === 2;
  const refusedBeforeCall = e.indexOf(`r.reason.startsWith("retry")) return { ok: false, error: "duplicate_request"`) > -1
    && e.indexOf(`r.reason.startsWith("retry")) return { ok: false, error: "duplicate_request"`) < e.indexOf("const out = await generate(");
  const namespaced = /`\$\{userId\}:\$\{clientId && REQ\.test\(clientId\) \? clientId : crypto\.randomUUID\(\)\}`/.test(e);
  return { ok: unique && retry && refusedBeforeCall && namespaced, detail: `unique ${unique}, retry found before and under the lock ${retry}, known id refused before the provider ${refusedBeforeCall}, namespaced ${namespaced}` };
};
const checkSettleOnce = (src: Src): R => {
  const m = code(src, "mig");
  const s = fn(m, "ai_settle"), r = fn(m, "ai_release");
  const settle = /if l\.status <> 'reserved' then raise exception 'ai_settle: request % is already %'/.test(s);
  const release = /if l\.status <> 'reserved' then raise exception 'ai_release: request % is already %'/.test(r);
  const guard = /if old\.status <> 'reserved' then\s+raise exception 'ai_usage_ledger: request % is already %'/.test(m);
  return { ok: settle && release && guard, detail: `settle once ${settle}, release once ${release}, ledger guard ${guard}` };
};
const checkNoClientAllowance = (src: Src, all: Src): R => {
  const calls = (["assistant", "proAssistant", "mappings"] as K[]).map(k => code(src, k));
  const metered = calls.every(s => /runMeteredAi\(ctx\.admin, \{\s*userId: ctx\.userId, product: /.test(s));
  const fromBody = calls.some(s => { const i = s.indexOf("runMeteredAi("); return /body\.|fields\./.test(s.slice(i, s.indexOf("});", i))); });
  const standing = code(src, "standingRoute");
  const readOnly = !/export async function (POST|PUT|PATCH|DELETE)/.test(standing) && /getAiStanding\(ctx\.admin, \{ userId: ctx\.userId, product: experience \}\)/.test(standing);
  const rpcOnly = [...all].filter(([f, s]) => /rpc\("ai_(reserve|settle|release)/.test(s) && f !== F.engine).map(([f]) => f);
  return { ok: metered && !fromBody && readOnly && rpcOnly.length === 0, detail: `routes metered ${metered}, request input into the allowance ${fromBody}, standing read-only ${readOnly}, other callers of the money functions: ${rpcOnly.join(", ")}` };
};
const checkNoChargeBeforeBilling = (src: Src): R => {
  const e = code(src, "engine");
  const branch = e.slice(e.indexOf("const billed = out.usage;"), e.indexOf("return out;"));
  const settleOnlyBilled = /if \(billed\) \{\s+const s = await settle\(admin, args\.requestId, out\.ok \? out\.model : model, billed\.input, billed\.output/.test(branch);
  const releaseOtherwise = /\} else \{[\s\S]*?admin\.rpc\("ai_release"/.test(branch);
  return { ok: settleOnlyBilled && releaseOtherwise, detail: `settles only reported usage ${settleOnlyBilled}, releases otherwise ${releaseOtherwise}` };
};
const checkFailClosed = (src: Src): R => {
  const e = code(src, "engine");
  const dark = /if \(!\(await aiFairUseEnabled\(admin\)\)\) return generate\(args\.generate\);/.test(e);
  const unreadable = e.indexOf(`if (!readable) return { ok: false, error: "unreadable"`) > -1 && e.indexOf(`if (!readable) return { ok: false, error: "unreadable"`) < e.indexOf("const out = await generate(");
  const d = defaultPolicy("scholar");
  const nothing = d.includedCau === 0 && d.reserveCau === 0 && serviceLevel(d, { includedCau: 0, reserveCau: 0, usedCau: 0, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 }) === "continuity";
  return { ok: dark && unreadable && nothing, detail: `off = generate unchanged ${dark}, unreadable sends nothing ${unreadable}, default allows nothing ${nothing}` };
};
const checkClinical = (resolve: typeof resolvePolicy, at: typeof activityAt): R => {
  const p = resolve("scholar", { includedCau: 100, activities: { questions: { tier: "cheap", minTier: "cheap" }, case_steps: { tier: "cheap" } } }, "t");
  const b = { includedCau: 100, reserveCau: 0, usedCau: 75, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 };
  const configured = p.activities.questions.tier === "reasoning" && p.activities.case_steps.tier === "reasoning";
  const served = at(p, "optimised", "questions", b).tier === "reasoning" && at(p, "essential", "case_steps", b).available === false;
  return { ok: configured && served, detail: `configured at tier ${configured}, served at tier ${served}` };
};
const checkAdminDoor = (src: Src): R => {
  const r = code(src, "adminRoute"), p = code(src, "adminPage"), a = code(src, "admin");
  const body = r.slice(r.indexOf("export async function POST"));
  const gate = body.indexOf(`await hqApiGate(["hq.platform.ai.manage"])`), first = body.indexOf("await ");
  const pageGate = /await requireHqCapability\("hq\.platform\.ai\.manage"\)/.test(p);
  const noCreds = !/(ANTHROPIC|OPENAI|GEMINI)_API_KEY|providerKey\(/.test(r + p + a);
  const noActivation = !/practice_platform_flags|AI_FAIR_USE_FLAG\b.*upsert/.test(r + p + a);
  return { ok: gate > -1 && gate === first && !/export async function (GET|PUT|PATCH|DELETE)/.test(r) && pageGate && noCreds && noActivation, detail: `gate first ${gate === first}, page gate ${pageGate}, no credentials ${noCreds}, no activation ${noActivation}` };
};
const checkHistory = (src: Src): R => {
  const m = code(src, "mig");
  const guard = /if old\.effective_to is not null or new\.effective_to is null\s+or \(to_jsonb\(new\) - 'effective_to'\) is distinct from \(to_jsonb\(old\) - 'effective_to'\) then/.test(m);
  const all3 = ["ai_price", "ai_fx_rate", "ai_cau_rate"].every(t => new RegExp(`create trigger ${t}_history_guard before update or delete on ${t}`).test(m));
  const s = fn(m, "ai_settle");
  const reservedPrice = /select \* into pr from ai_price where id = l\.price_id;/.test(s) && /select \* into cr from ai_cau_rate where id = l\.cau_rate_id;/.test(s);
  return { ok: guard && all3 && reservedPrice, detail: `rate guard ${guard}, on all three ${all3}, settled at the reserved price ${reservedPrice}` };
};

const plant = (k: K, from: string, to: string): Src => {
  const s = RAW.get(F[k]) ?? ""; const n = s.replace(from, to);
  if (n === s) throw new Error(`plant did not apply in ${F[k]}: ${from.slice(0, 70)}`);
  return new Map([...RAW, [F[k], n]]);
};
const red = (n: string, r: R) => ok(`P. ${n} goes RED`, !r.ok, "the check passed on a planted violation");
const run = (n: string, r: R) => ok(n, r.ok, r.detail);

console.log("AI FAIR USE HARNESS (COMPETEN-AI-FAIR-USE-01, migration 410)\n");
const missing = Object.entries(F).filter(([k, f]) => k !== "mig" && !RAW.get(f)).map(([, f]) => f);
ok("0. every pinned file exists", missing.length === 0, missing.join(", "));
if (HAS_MIG) {
  run("A1. (FI) concurrent overspend is impossible: row lock first, pool checked under it, no app balance writes", checkLock(RAW, ALL));
  run("A2. (FI) a retry cannot charge twice: unique request id, found under the lock, refused before the provider", checkIdempotent(RAW));
  run("A3. (FI) a double settle or release is refused", checkSettleOnce(RAW));
  run("A9. history cannot move: append-only rates, settled at the reserved price", checkHistory(RAW));
} else console.log(`  PEND  A1-A3, A9. ${F.mig} is not in this checkout`);
run("A4. (FI) a client cannot send an allowance: routes meter by session, standing is read-only, only the engine calls the money functions", checkNoClientAllowance(RAW, ALL));
run("A5. (FI) a failure before provider billing costs nothing: settle only reported usage, release otherwise", checkNoChargeBeforeBilling(RAW));
run("A6. fail closed and dark: off is generate() unchanged, unreadable sends nothing, the default allows nothing", checkFailClosed(RAW));
run("A7. clinical safety: a sensitive activity is never configured or served below its tier", checkClinical(resolvePolicy, activityAt));
run("A8. the admin door: gated first, POST only, no credential, no activation", checkAdminDoor(RAW));
console.log("");
if (HAS_MIG) {
  red("A1 (FI) concurrent overspend: the row lock removed", checkLock(plant("mig", "select * into a from ai_allowance_account where id = p_account for update;", "select * into a from ai_allowance_account where id = p_account;"), ALL));
  red("A1 (FI) an app-side balance write", checkLock(RAW, new Map([...ALL, ["src/lib/ai/evil.ts", `admin.from("ai_allowance_account").update({ used_cau: 0 })`]])));
  red("A2 (FI) the unique request id dropped", checkIdempotent(plant("mig", "create unique index if not exists ux_ai_usage_ledger_request on ai_usage_ledger(request_id);", "create index if not exists ix_ai_usage_ledger_request on ai_usage_ledger(request_id);")));
  red("A3 (FI) a double settle", checkSettleOnce(plant("mig", "  if l.status <> 'reserved' then raise exception 'ai_settle: request % is already %', p_request_id, l.status; end if;\n", "")));
  red("A9 a price rewritten", checkHistory(plant("mig", "  select * into pr from ai_price where id = l.price_id;", "  select * into pr from ai_price_at(l.provider, l.model, now());")));
}
red("A2 (FI) a known id sent to the provider again", checkIdempotent(plant("engine", `  if (typeof r?.reason === "string" && r.reason.startsWith("retry")) return { ok: false, error: "duplicate_request", standing };\n`, "")));
red("A4 (FI) a client-sent allowance", checkNoClientAllowance(plant("assistant", "userId: ctx.userId, product: experience, activity: \"assistant\",", "userId: ctx.userId, product: experience, activity: body.activity ?? \"assistant\",") , ALL));
red("A4 (FI) a route calling the money functions itself", checkNoClientAllowance(RAW, new Map([...ALL, ["src/app/api/individual/evil/route.ts", `await admin.rpc("ai_settle", {})`]])));
red("A5 (FI) a failure before billing charged", checkNoChargeBeforeBilling(plant("engine", "  if (billed) {", "  if (true) {")));
red("A6 metering on with no flag check", checkFailClosed(plant("engine", "  if (!(await aiFairUseEnabled(admin))) return generate(args.generate);\n  const { policy, readable }", "  const { policy, readable }")));
red("A7 a sensitive activity downgraded", checkClinical((p, s, v) => { const x = resolvePolicy(p, s, v); x.activities.questions = { ...x.activities.questions, tier: "cheap", minTier: "cheap" }; return x; }, activityAt));
red("A8 an admin door that activates metering", checkAdminDoor(plant("adminRoute", "    default:\n      return refuse(400, \"Unknown action\");", "    case \"activate\": await ctx.admin.from(\"practice_platform_flags\").upsert({ flag: \"ai_fair_use\", enabled: true }); return NextResponse.json({});\n    default:\n      return refuse(400, \"Unknown action\");")));

console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
