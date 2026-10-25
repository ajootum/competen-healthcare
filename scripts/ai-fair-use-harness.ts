/**
 * AI FAIR USE -- STATIC HARNESS (COMPETEN-AI-FAIR-USE-01 and IND-007 D1, migrations 410, 411 and 412).
 *
 *   npx tsx scripts/ai-fair-use-harness.ts
 *
 * No credentials, no network. Each check has a planted violation that must turn it RED. The financial red line's
 * checks are marked FI. Database checks read the LATEST definition of each function (411 replaces 410's).
 *   A1  (FI) concurrent overspend is impossible: ai_reserve takes the account row FOR UPDATE and checks the pool
 *       under that lock, and no application code writes a balance
 *   A2  (FI) a retry cannot charge twice: request_id is UNIQUE, ai_reserve returns an existing request, and the
 *       engine refuses a known id before the provider is called
 *   A3  (FI) a double settle is refused: ai_settle and ai_release act only on an open request, and the ledger
 *       guard refuses any change to a settled or released one
 *   A4  (FI) a client cannot send an allowance: no route passes request input into the allowance, and nothing
 *       but the engine calls the money functions
 *   A5  (FI) an unknown charge is never settled on the estimate: the engine settles only provider-reported usage,
 *       releases only when nothing was billed, and otherwise marks the request unreconciled (amendment 4)
 *   A6  fail closed and dark: metering off is generate() unchanged, an unreadable standing sends nothing, the
 *       unpublished default allows nothing and no ceiling refuses
 *   A7  clinical risk (owner D1): the subject decides, not the activity name (Teach Me on medication safety is
 *       high risk under the provisional rules), an unknown subject is high risk, no level runs below a risk tier's
 *       model floor, the engine passes the classified tier, and ai_reserve treats a null or unknown tier as high
 *       risk and needs an eligibility decision covering the tier
 *   A8  the admin door: gated first by hq.platform.ai.manage, POST only, no credential, no activation
 *   A9  history cannot move: every rate and eligibility table is append-only, and a request settles at the price,
 *       reference rate and CAU basis fixed when it was reserved
 *   A10 (FI) two records: provider expenditure and allowance consumption are written once at settlement, the buffer
 *       widens only the hold, and neither record changes afterwards (owner GO, D3)
 *   A11 no allowance figure in code: no literal 4000, 500 or 1000 in the engine, and none bound to an allowance field
 *       in the admin or student surfaces (owner D5)
 *   A12 activities are policy data: a code the published policy does not define is refused (amendment 1)
 *   A13 who pays follows the workflow (AI-CONSUMPTION-01 s4): a student's own work on the student, platform screening,
 *       de-duplication, promotion and shared variations on the platform -- promotion never re-charges the student
 *   A14 (FI) the ledger enforces ownership (421): a person's account only for that person, a budget only while
 *       active, an institution budget never without its institution and funding, an account a person's xor a budget's
 *   A15 the owner is decided on the server: student routes run no platform work, and no request input reaches it
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { activityAt, defaultPolicy, resolvePolicy, serviceLevel } from "../src/lib/ai/fair-use-policy";
import { classifyRisk, resolveRiskPolicy } from "../src/lib/ai/clinical-risk";
import { PROVISIONAL_ACTIVITIES, PROVISIONAL_RISK } from "./ai-provisional-policy";
import { ATTRIBUTION } from "../src/lib/ai/consumption";
import { withEligibility, type AiStanding } from "../src/lib/ai/allowance";

const F = {
  mig410: "supabase/migrations/410-ai-usage-ledger-and-allowances.sql",
  mig411: "supabase/migrations/411-ai-reconciliation-fx-basis-and-eligibility.sql",
  mig412: "supabase/migrations/412-ai-risk-tiers-and-rate-source.sql",
  mig420: "supabase/migrations/420-ai-allowance-balance-scale.sql",
  mig421: "supabase/migrations/421-ai-consumption-ownership.sql",
  consumption: "src/lib/ai/consumption.ts",
  engine: "src/lib/ai/allowance.ts",
  policy: "src/lib/ai/fair-use-policy.ts",
  admin: "src/lib/ai/fair-use-admin.ts",
  adminRoute: "src/app/api/hq/ai-governance/route.ts",
  adminPage: "src/app/super-admin/ai/fair-use/page.tsx",
  adminControls: "src/app/super-admin/ai/fair-use/_components/FairUseControls.tsx",
  studentPage: "src/app/individual/(app)/[experience]/ai-allowance/page.tsx",
  standingRoute: "src/app/api/individual/ai-allowance/route.ts",
  assistant: "src/app/api/individual/assistant/route.ts",
  proAssistant: "src/app/api/individual/professional/assistant/route.ts",
  mappings: "src/app/api/individual/professional/mappings/route.ts",
  personal: "src/lib/ai/personal-assistant.ts",
} as const;
type K = keyof typeof F;
type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const RAW: Src = new Map(Object.values(F).map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const sqlCode = (s: string) => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").toLowerCase();
/** 410 then 411, comment lines dropped: what the database holds after both. */
const mig = (src: Src) => [F.mig410, F.mig411, F.mig412, F.mig420, F.mig421].map(f => sqlCode(src.get(f) ?? "")).join("\n");
const code = (src: Src, k: K) => strip(src.get(F[k]) ?? "");
const HAS_MIG = !!RAW.get(F.mig410) && !!RAW.get(F.mig411) && !!RAW.get(F.mig412) && !!RAW.get(F.mig421);
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p.replace(/\\/g, "/")] : []; });
}
const ALL: Src = new Map(walk("src").map(f => [f, strip(readFileSync(f, "utf8").replace(/\r\n/g, "\n"))]));

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
type R = { ok: boolean; detail: string };
/** The latest definition of a function: the one the database runs. */
const fn = (m: string, name: string) => { const i = m.lastIndexOf(`create or replace function public.${name}(`); return i < 0 ? "" : m.slice(i, m.indexOf("$$;", i)); };

const checkLock = (src: Src, all: Src): R => {
  const r = fn(mig(src), "ai_reserve");
  const lock = /select \* into a from ai_allowance_account where id = p_account for update;/.test(r);
  const lockFirst = r.indexOf("for update") > -1 && r.indexOf("for update") < r.indexOf("if p_pool = 'included' then");
  const pools = /if a\.used_cau \+ a\.reserved_cau \+ v_max > a\.included_cau then/.test(r) && /if a\.reserve_used_cau \+ a\.reserve_reserved_cau \+ v_max > a\.reserve_cau then/.test(r);
  const appWrites = [...all].filter(([, s]) => /from\("ai_allowance_account"\)[\s\S]{0,120}?\.update\(|from\("ai_usage_ledger"\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\(/.test(s)).map(([f]) => f);
  return { ok: lock && lockFirst && pools && appWrites.length === 0, detail: `row lock ${lock}, lock before pool checks ${lockFirst}, pool checks ${pools}, app balance writes: ${appWrites.join(", ")}` };
};
const checkIdempotent = (src: Src): R => {
  const m = mig(src), e = code(src, "engine");
  const unique = /create unique index if not exists ux_ai_usage_ledger_request on ai_usage_ledger\(request_id\);/.test(m);
  const r = fn(m, "ai_reserve");
  const retry = (r.match(/select \* into existing from ai_usage_ledger l where l\.request_id = p_request_id;/g) ?? []).length === 2;
  const refusedBeforeCall = e.indexOf(`r.reason.startsWith("retry")) return { refused: "duplicate" }`) > -1
    && e.indexOf(`r.reason.startsWith("retry")) return { refused: "duplicate" }`) < e.indexOf("const out = await generate(");
  const namespaced = /`\$\{userId\}:\$\{clientId && REQ\.test\(clientId\) \? clientId : crypto\.randomUUID\(\)\}`/.test(e);
  return { ok: unique && retry && refusedBeforeCall && namespaced, detail: `unique ${unique}, retry found before and under the lock ${retry}, known id refused before the provider ${refusedBeforeCall}, namespaced ${namespaced}` };
};
const checkSettleOnce = (src: Src): R => {
  const m = mig(src);
  const s = fn(m, "ai_settle"), r = fn(m, "ai_release"), g = fn(m, "ai_usage_ledger_guard");
  const settle = /if l\.status not in \('reserved', 'unreconciled'\) then raise exception 'ai_settle: request % is already %'/.test(s);
  const release = /if l\.status not in \('reserved', 'unreconciled'\) then raise exception 'ai_release: request % is already %'/.test(r);
  const guard = /if old\.status not in \('reserved', 'unreconciled'\) or \(old\.status = 'unreconciled' and new\.status = 'reserved'\)/.test(g);
  return { ok: settle && release && guard, detail: `settle once ${settle}, release once ${release}, ledger guard ${guard}` };
};
const checkNoClientAllowance = (src: Src, all: Src): R => {
  // The assistant routes call the Personal AI (owner D3: Individual composes, Holdings meters). Each route passes
  // the session's identity, and from the request only a mode the engine checks against the product's profile.
  const block = (s: string, call: string) => { const i = s.indexOf(call); return i < 0 ? "" : s.slice(i, s.indexOf("});", i)); };
  const routes = [code(src, "assistant"), code(src, "proAssistant")].map(s => block(s, "runIndividualAssistant("));
  const mapping = block(code(src, "mappings"), "runMeteredAi(");
  const personal = block(code(src, "personal"), "runMeteredAi(");
  const metered = routes.every(b => /^runIndividualAssistant\(ctx\.admin, \{\s*userId: ctx\.userId,/.test(b)) && /^runMeteredAi\(ctx\.admin, \{ userId: ctx\.userId, product: /.test(mapping)
    && /^runMeteredAi\(admin, \{\s*userId: r\.userId, product: r\.product, activity: MODE_ACTIVITY\[mode\], requestId: r\.requestId,/.test(personal);
  const fromBody = [...routes, mapping].some(b => /body\??\.(?!mode\b)\w+|fields\./.test(b));
  const standing = code(src, "standingRoute");
  const readOnly = !/export async function (POST|PUT|PATCH|DELETE)/.test(standing) && /getAiStanding\(ctx\.admin, \{ userId: ctx\.userId, product: experience \}\)/.test(standing);
  const rpcOnly = [...all].filter(([f, s]) => /rpc\("ai_(reserve|settle|release|mark_unreconciled)/.test(s) && f !== F.engine).map(([f]) => f);
  return { ok: metered && !fromBody && readOnly && rpcOnly.length === 0, detail: `routes metered ${metered}, request input into the allowance ${fromBody}, standing read-only ${readOnly}, other callers of the money functions: ${rpcOnly.join(", ")}` };
};
const checkNoEstimate = (src: Src): R => {
  const e = code(src, "engine");
  // The one money path (meter), from the provider call to its return.
  const branch = e.slice(e.indexOf("const out = await generate("), e.indexOf("return { result: out };", e.indexOf("const out = await generate(")));
  const settleOnlyReported = /if \(out\.usage\) \{\s+const s = await settle\(admin, m\.requestId, out\.ok \? out\.model : model, out\.usage\.input, out\.usage\.output/.test(branch)
    && (branch.match(/settle\(/g) ?? []).length === 1;
  const releaseOnlyUnbilled = /\} else if \(!out\.ok && \(out\.error === "not_configured" \|\| out\.billing === "none"\)\) \{[\s\S]*?admin\.rpc\("ai_release"/.test(branch);
  const unknownWaits = /\} else \{[\s\S]*?admin\.rpc\("ai_mark_unreconciled"/.test(branch) && (branch.match(/admin\.rpc\("ai_release"/g) ?? []).length === 1;
  const stale = /perform ai_mark_unreconciled\(r\.request_id, 'expired'\);/.test(fn(mig(src), "ai_release_stale"));
  return { ok: settleOnlyReported && releaseOnlyUnbilled && unknownWaits && (stale || !HAS_MIG), detail: `settles only reported usage ${settleOnlyReported}, releases only when unbilled ${releaseOnlyUnbilled}, an unknown charge waits ${unknownWaits}, stale holds wait ${stale}` };
};
const checkFailClosed = (src: Src): R => {
  const e = code(src, "engine");
  // Both entry points -- a person's allowance and a budget -- are dark when the flag is off.
  const dark = (e.match(/if \(!\(await aiFairUseEnabled\(admin\)\)\) return generate\(args\.generate\);/g) ?? []).length === 2;
  const unreadable = e.indexOf(`if (!readable) return { ok: false, error: "unreadable"`) > -1 && e.indexOf(`if (!readable) return { ok: false, error: "unreadable"`) < e.indexOf("const out = await generate(");
  const d = defaultPolicy("scholar");
  const nothing = d.includedCau === 0 && d.reserveCau === 0 && d.maxUnreconciledCau === 0 && Object.keys(d.activities).length === 0
    && serviceLevel(d, { includedCau: 0, reserveCau: 0, usedCau: 0, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 }) === "continuity";
  const noCeiling = !HAS_MIG || /if p_unreconciled_cap_cau is null or v_open \+ v_max > p_unreconciled_cap_cau then/.test(fn(mig(src), "ai_reserve"));
  return { ok: dark && unreadable && nothing && noCeiling, detail: `off = generate unchanged ${dark}, unreadable sends nothing ${unreadable}, default allows nothing ${nothing}, no ceiling refuses ${noCeiling}` };
};
type Classify = typeof classifyRisk;
const checkRisk = (src: Src, classify: Classify, at: typeof activityAt): R => {
  const rules = resolveRiskPolicy(PROVISIONAL_RISK);
  const subj = (text: string) => ({ text, competencyRisks: [] as string[], frameworkCodes: [] as string[] });
  const teach = PROVISIONAL_ACTIVITIES.scholar.teach.riskFloor;
  const medication = classify(rules, subj("Teach me about medication safety"), teach).tier === "high_risk_clinical";
  const unknown = classify(rules, subj("Tell me about the weather"), teach).tier === "high_risk_clinical" && classify(rules, subj(""), teach).tier === "high_risk_clinical";
  const p = resolvePolicy("scholar", { includedCau: 100, risk: { minTier: { standard_educational: "cheap", clinical_educational: "reasoning", high_risk_clinical: "heavy" }, rules: [] },
    activities: { teach: { tier: "reasoning", minTier: "cheap", riskFloor: "standard_educational" } } }, "t");
  const b = { includedCau: 100, reserveCau: 0, usedCau: 75, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 };
  const opt = at(p, "optimised", "teach", b, "high_risk_clinical"), full = at(p, "full", "teach", { ...b, usedCau: 0 }, "high_risk_clinical");
  const floor = !opt.available && opt.refusal === "level_insufficient" && full.tier === "heavy";
  const e = code(src, "engine");
  const passed = /p_risk_tier: m\.risk\.tier, p_risk_rule: m\.risk\.rule,/.test(e) && /risk: risk!,/.test(e) && e.indexOf("classifyRisk(policy.risk") > -1 && e.indexOf("classifyRisk(policy.risk") < e.indexOf("const decision = activityAt(");
  const r = fn(mig(src), "ai_reserve");
  const db = !HAS_MIG || (/v_tier := case when p_risk_tier in \('standard_educational', 'clinical_educational', 'high_risk_clinical'\) then p_risk_tier else 'high_risk_clinical' end;/.test(r)
    && /if v_rank > 1 and not exists \(/.test(r) && /and e\.eligible and ai_risk_rank\(coalesce\(e\.max_risk_tier, 'clinical_educational'\)\) >= v_rank/.test(r)
    && /select case p_tier when 'standard_educational' then 1 when 'clinical_educational' then 2 else 3 end/.test(fn(mig(src), "ai_risk_rank")));
  return { ok: medication && unknown && floor && passed && db, detail: `medication by subject is high ${medication}, unknown is high ${unknown}, tier floor kept ${floor}, engine passes the classified tier ${passed}, database fails closed on tier and eligibility ${db}` };
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
  const m = mig(src);
  const guard = /if old\.effective_to is not null or new\.effective_to is null\s+or \(to_jsonb\(new\) - 'effective_to'\) is distinct from \(to_jsonb\(old\) - 'effective_to'\) then/.test(m);
  const all = ["ai_price", "ai_fx_rate", "ai_cau_rate", "ai_cau_basis", "ai_model_eligibility"].every(t => new RegExp(`create trigger ${t}_history_guard before update or delete on ${t}`).test(m));
  const s = fn(m, "ai_settle");
  const reserved = /select \* into pr from ai_price where id = l\.price_id;/.test(s) && /select per_usd into v_rate from ai_fx_rate where id = l\.fx_rate_id;/.test(s)
    && /select currency_per_cau into v_basis from ai_cau_basis where id = l\.cau_basis_id;/.test(s);
  return { ok: guard && all && reserved, detail: `rate guard ${guard}, on every rate and eligibility table ${all}, settled at the reserved price, rate and basis ${reserved}` };
};
const checkTwoRecords = (src: Src): R => {
  const m = mig(src), r = fn(m, "ai_reserve"), s = fn(m, "ai_settle"), g = fn(m, "ai_usage_ledger_guard");
  const bufferOnHold = /v_max := round\(v_usd \* fx\.per_usd \* \(1 \+ p_buffer_pct \/ 100\) \/ cb\.currency_per_cau, 6\);/.test(r);
  const consumptionNoBuffer = /v_cau := round\(v_cost \* v_rate \/ v_basis, 6\);/.test(s) && !/buffer/.test(s);
  const expenditure = /v_cost := round\(\(p_input_tokens::numeric \* pr\.input_per_mtok_usd \+ p_output_tokens::numeric \* pr\.output_per_mtok_usd\) \/ 1000000\s+\+ pr\.extra_per_request_usd \+ coalesce\(p_extra_usd, 0\), 6\);/.test(s);
  const frozen = /if old\.status not in \('reserved', 'unreconciled'\)/.test(g) && /or new\.fx_rate_id is distinct from old\.fx_rate_id or new\.cau_basis_id is distinct from old\.cau_basis_id/.test(g)
    && /or new\.reserve_buffer_pct is distinct from old\.reserve_buffer_pct or new\.policy_version is distinct from old\.policy_version/.test(g);
  return { ok: bufferOnHold && consumptionNoBuffer && expenditure && frozen, detail: `buffer on the hold ${bufferOnHold}, consumption without buffer ${consumptionNoBuffer}, expenditure from provider usage at the reserved price ${expenditure}, both frozen once settled ${frozen}` };
};
const LITERAL = /(?<![\w.$#-])(4_?000|500|1_?000)(?![\w.])/;
const BOUND = /(includedCau|reserveCau|windowCapCau|maxUnreconciledCau|included_cau|reserve_cau)\s*(:|=|\?\?|\|\|)\s*[^,;\n)]*?(?<![\w.$#-])(4_?000|500|1_?000)(?![\w.])/;
const checkNoFigures = (src: Src): R => {
  const engine = (["engine", "policy"] as K[]).filter(k => LITERAL.test(code(src, k))).map(k => F[k]);
  const bound = (["admin", "adminRoute", "adminPage", "adminControls", "studentPage", "standingRoute"] as K[]).filter(k => BOUND.test(code(src, k))).map(k => F[k]);
  return { ok: engine.length === 0 && bound.length === 0, detail: `literal in the engine: ${engine.join(", ")}; bound to an allowance field: ${bound.join(", ")}` };
};
const checkActivitiesAreData = (src: Src, resolve: typeof resolvePolicy, at: typeof activityAt): R => {
  const p = resolve("scholar", { includedCau: 100, activities: { explain: { tier: "cheap" } } }, "t");
  const b = { includedCau: 100, reserveCau: 0, usedCau: 0, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 };
  const refused = at(p, "full", "questions", b).refusal === "unknown_activity" && at(p, "full", "toString", b).refusal === "unknown_activity" && at(p, "full", "explain", b).available;
  const e = code(src, "engine");
  const before = e.indexOf(`decision.refusal === "unknown_activity" ? "unknown_activity"`) > -1 && e.indexOf(`decision.refusal === "unknown_activity" ? "unknown_activity"`) < e.indexOf(`admin.rpc("ai_reserve"`);
  const noCatalogue = !/ACTIVITY_CATALOGUE/.test(code(src, "policy") + code(src, "engine") + code(src, "studentPage"));
  return { ok: refused && before && noCatalogue, detail: `unknown refused ${refused}, before any reservation ${before}, no activity list in code ${noCatalogue}` };
};

// ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01: who pays ──
type Attribution = Record<string, string>;
const checkAttribution = (attr: Attribution): R => {
  const student = ["case.private_generate", "case.private_interact", "case.feedback", "case.live_with_stored"].every(w => attr[w] === "individual");
  const platform = ["case.candidate_screen", "case.dedupe", "case.promote", "case.shared_variation"].every(w => attr[w] === "platform");
  const replay = attr["case.replay_stored"] === "none";
  const institution = attr["case.institution_commission"] === "institution";
  return { ok: student && platform && replay && institution, detail: `student work on the student ${student}, promotion and screening on the platform ${platform}, replay needs no AI ${replay}, institution commissions on the institution ${institution}` };
};
const checkReserveOwnership = (src: Src): R => {
  const m = mig(src), r = fn(m, "ai_reserve");
  const person = /if p_actor is null or p_actor is distinct from a\.user_id or p_service is not null then\s+return query select null::uuid, false, 'owner_mismatch'/.test(r);
  const active = /if not found or b\.status <> 'active' then return query select null::uuid, false, 'budget_suspended'/.test(r);
  const funded = /and \(owner_type <> 'institution' or \(institution_ref is not null and funding_ref is not null and char_length\(btrim\(funding_ref\)\) >= 5\)\)/.test(m);
  const xor = /and \(owner_type <> 'individual' or \(user_id is not null and budget_id is null\)\)/.test(m) && /and \(owner_type = 'individual' or \(budget_id is not null and user_id is null\)\)/.test(m);
  return { ok: !HAS_MIG || (person && active && funded && xor), detail: `a person's account only for that person ${person}, a budget only while active ${active}, no unfunded institution ${funded}, an account is a person's xor a budget's ${xor}` };
};
const checkOwnerFromServer = (src: Src, all: Src): R => {
  // Student routes never run a platform or institution workflow, and nothing passes request input into the owner.
  const platformWorkflows = ["case.candidate_screen", "case.dedupe", "case.promote", "case.shared_variation", "case.educator_develop", "case.reviewer_assist", "case.institution_commission"];
  const student = [...all].filter(([f, s]) => /^src\/app\/(api\/)?individual\//.test(f) && platformWorkflows.some(w => s.includes(`"${w}"`))).map(([f]) => f);
  const fromBody = [...all].filter(([, s]) => { const i = s.indexOf("resolveOwner("); return i > -1 && /body\??\.|searchParams|formData/.test(s.slice(i, s.indexOf(")", s.indexOf("}", i)) + 1)); }).map(([f]) => f);
  const c = code(src, "consumption");
  const fromWorkflow = /const rule: OwnerRule = ATTRIBUTION\[workflow\];/.test(c);
  return { ok: student.length === 0 && fromBody.length === 0 && fromWorkflow, detail: `student routes running platform work: ${student.join(", ")}; request input into the owner: ${fromBody.join(", ")}; owner from the workflow ${fromWorkflow}` };
};

// A16: standing says what ai_reserve will do -- an activity above standard educational with no evaluated model is not
// offered (IND-004's defect: questions and evaluate "available", then refused not_eligible on every call).
function checkStandingEligibility(raw: Src, apply: typeof withEligibility): R {
  const engine = raw.get(F.engine) ?? "";
  const i = engine.indexOf("export async function getAiStanding"), body = i < 0 ? "" : engine.slice(i, engine.indexOf("\n}\n", i));
  const bad: string[] = [];
  if (!/withEligibility\(standingFrom\(policy, a\.account\)/.test(body) || !/loadEligibility\(admin, args\.product\)/.test(body)) bad.push("getAiStanding does not apply model eligibility on the metered path");
  const policy = resolvePolicy("scholar", { includedCau: 10, risk: PROVISIONAL_RISK, activities: { teach: PROVISIONAL_ACTIVITIES.scholar.teach, questions: PROVISIONAL_ACTIVITIES.scholar.questions } }, "h");
  const st: AiStanding = { readable: true, metered: true, level: "full", remaining: { band: "plenty", percent: 100 }, resetsAt: null, message: null,
    activities: { teach: { label: "t", available: true, via: "included", reason: null }, questions: { label: "q", available: true, via: "included", reason: null } } };
  const b = { includedCau: 10, reserveCau: 0, usedCau: 0, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 };
  const out = apply(st, policy, b, "anthropic", { cheap: "h", reasoning: "s", heavy: "o" }, []);
  if (out.activities.questions.available) bad.push("a clinical activity with no eligible model is still offered");
  if (!out.activities.teach.available) bad.push("a standard activity was closed");
  return { ok: bad.length === 0, detail: bad.join("; ") };
}

const plant = (k: K, from: string, to: string): Src => {
  const s = RAW.get(F[k]) ?? ""; const n = s.replace(from, to);
  if (n === s) throw new Error(`plant did not apply in ${F[k]}: ${from.slice(0, 70)}`);
  return new Map([...RAW, [F[k], n]]);
};
const red = (n: string, r: R) => ok(`P. ${n} goes RED`, !r.ok, "the check passed on a planted violation");
const run = (n: string, r: R) => ok(n, r.ok, r.detail);

console.log("AI FAIR USE HARNESS (COMPETEN-AI-FAIR-USE-01, IND-007 D1 and AI-CONSUMPTION-01, migrations 410 to 421)\n");
const missing = Object.entries(F).filter(([k, f]) => !k.startsWith("mig") && !RAW.get(f)).map(([, f]) => f);
ok("0. every pinned file exists", missing.length === 0, missing.join(", "));
if (HAS_MIG) {
  run("A1. (FI) concurrent overspend is impossible: row lock first, pool checked under it, no app balance writes", checkLock(RAW, ALL));
  run("A2. (FI) a retry cannot charge twice: unique request id, found under the lock, refused before the provider", checkIdempotent(RAW));
  run("A3. (FI) a double settle or release is refused", checkSettleOnce(RAW));
  run("A9. history cannot move: append-only rates and eligibility, settled at the reserved price, rate and basis", checkHistory(RAW));
  run("A10. (FI) two records: buffer on the hold only, provider expenditure and allowance consumption frozen once settled", checkTwoRecords(RAW));
} else console.log(`  PEND  A1-A3, A9, A10. ${F.mig410}, ${F.mig411} and ${F.mig412} are not all in this checkout`);
run("A4. (FI) a client cannot send an allowance: routes meter by session, standing is read-only, only the engine calls the money functions", checkNoClientAllowance(RAW, ALL));
run("A5. (FI) an unknown charge is never settled on the estimate: settle reported usage, release only when unbilled, otherwise wait", checkNoEstimate(RAW));
run("A6. fail closed and dark: off is generate() unchanged, unreadable sends nothing, the default allows nothing", checkFailClosed(RAW));
run("A7. clinical risk (D1): subject decides, unknown is high, no downgrade below the tier floor, tier enforced in ai_reserve", checkRisk(RAW, classifyRisk, activityAt));
run("A8. the admin door: gated first, POST only, no credential, no activation", checkAdminDoor(RAW));
run("A11. no allowance figure in code", checkNoFigures(RAW));
run("A12. activities are policy data: an undefined activity is refused before any reservation", checkActivitiesAreData(RAW, resolvePolicy, activityAt));
run("A13. who pays follows the workflow: student work on the student, promotion and screening on the platform", checkAttribution(ATTRIBUTION));
run("A14. (FI) the ledger enforces ownership: a person's account only for that person, a budget only while active, no unfunded institution", checkReserveOwnership(RAW));
run("A15. the owner is decided on the server: student routes run no platform work, no request input reaches the owner", checkOwnerFromServer(RAW, ALL));
run("A16. standing reflects model eligibility: no evaluated model, not offered", checkStandingEligibility(RAW, withEligibility));
console.log("");
if (HAS_MIG) {
  red("A1 (FI) concurrent overspend: the row lock removed", checkLock(plant("mig421", "  select * into a from ai_allowance_account where id = p_account for update;", "  select * into a from ai_allowance_account where id = p_account;"), ALL));
  red("A1 (FI) an app-side balance write", checkLock(RAW, new Map([...ALL, ["src/lib/ai/evil.ts", `admin.from("ai_allowance_account").update({ used_cau: 0 })`]])));
  red("A2 (FI) the unique request id dropped", checkIdempotent(plant("mig410", "create unique index if not exists ux_ai_usage_ledger_request on ai_usage_ledger(request_id);", "create index if not exists ix_ai_usage_ledger_request on ai_usage_ledger(request_id);")));
  red("A3 (FI) a double settle", checkSettleOnce(plant("mig411", "  if l.status not in ('reserved', 'unreconciled') then raise exception 'ai_settle: request % is already %', p_request_id, l.status; end if;\n", "")));
  red("A9 a price rewritten", checkHistory(plant("mig411", "  select * into pr from ai_price where id = l.price_id;", "  select * into pr from ai_price_at(l.provider, l.model, now());")));
  red("A9 settled at today's reference rate", checkHistory(plant("mig411", "    select per_usd into v_rate from ai_fx_rate where id = l.fx_rate_id;", "    select per_usd into v_rate from ai_fx_rate where currency = 'UGX' and effective_to is null;")));
  red("A10 (FI) the buffer charged to the allowance", checkTwoRecords(plant("mig411", "    v_cau := round(v_cost * v_rate / v_basis, 6);", "    v_cau := round(v_cost * v_rate * (1 + l.reserve_buffer_pct / 100) / v_basis, 6);")));
  red("A10 (FI) a settled record left rewritable", checkTwoRecords(plant("mig421", "  if old.status not in ('reserved', 'unreconciled') or (old.status = 'unreconciled' and new.status = 'reserved')", "  if (old.status = 'unreconciled' and new.status = 'reserved')")));
  red("A7 an unknown tier let through as standard in ai_reserve", checkRisk(plant("mig421", "then p_risk_tier else 'high_risk_clinical' end;", "then p_risk_tier else 'standard_educational' end;"), classifyRisk, activityAt));
  red("A7 the tier eligibility check removed from ai_reserve", checkRisk(plant("mig421", "  if v_rank > 1 and not exists (", "  if false and not exists ("), classifyRisk, activityAt));
  red("A1 (FI) the row lock removed from 411's superseded copy is NOT what runs", checkLock(plant("mig411", "  select * into a from ai_allowance_account where id = p_account for update;", "  select * into a from ai_allowance_account where id = p_account;"), ALL).ok
    ? { ok: false, detail: "" } as R : { ok: true, detail: "the check read a superseded definition" } as R);
  red("A5 (FI) a stale hold released as free", checkNoEstimate(plant("mig411", "    perform ai_mark_unreconciled(r.request_id, 'expired');", "    perform ai_release(r.request_id, 'expired');")));
}
red("A2 (FI) a known id sent to the provider again", checkIdempotent(plant("engine", `  if (typeof r?.reason === "string" && r.reason.startsWith("retry")) return { refused: "duplicate" };\n`, "")));
red("A4 (FI) a client-sent activity through the assistant route", checkNoClientAllowance(plant("assistant", "mode: typeof body?.mode === \"string\" ? body.mode as AssistantMode : null, question,", "mode: typeof body?.mode === \"string\" ? body.mode as AssistantMode : null, question, activity: body.activity,"), ALL));
red("A4 (FI) the engine metering a client-chosen activity", checkNoClientAllowance(plant("personal", "activity: MODE_ACTIVITY[mode], requestId: r.requestId,", "activity: (r as any).activity ?? MODE_ACTIVITY[mode], requestId: r.requestId,"), ALL));
red("A4 (FI) a route calling the money functions itself", checkNoClientAllowance(RAW, new Map([...ALL, ["src/app/api/individual/evil/route.ts", `await admin.rpc("ai_mark_unreconciled", {})`]])));
red("A5 (FI) settled on the estimate", checkNoEstimate(plant("engine", `    const { error } = await admin.rpc("ai_mark_unreconciled", { p_request_id: m.requestId, p_outcome: "timeout" });`,
  `    const { error } = { error: !(await settle(admin, m.requestId, model, maxInputTokens(m.generate.system, m.generate.user), maxOut, "timeout")) };`)));
red("A5 (FI) an unknown charge released as free", checkNoEstimate(plant("engine", `  } else if (!out.ok && (out.error === "not_configured" || out.billing === "none")) {`, `  } else if (!out.ok) {`)));
red("A6 metering on with no flag check", checkFailClosed(plant("engine", "  if (!(await aiFairUseEnabled(admin))) return generate(args.generate);\n  const { policy, readable }", "  const { policy, readable }")));
red("A7 Teach Me on medication safety classified as standard (by activity name)", checkRisk(RAW, (pol, sub, floor) => sub.text.toLowerCase().startsWith("teach me") ? { tier: "standard_educational", rule: "activity:teach", reason: "" } : classifyRisk(pol, sub, floor), activityAt));
red("A7 an unknown subject treated as standard", checkRisk(RAW, (pol, sub, floor) => { const d = classifyRisk(pol, sub, floor); return d.rule.startsWith("unknown:") ? { ...d, tier: "standard_educational" } : d; }, activityAt));
red("A7 a downgrade below the risk tier's model floor", checkRisk(RAW, classifyRisk, (p, l, c, b) => activityAt(p, l, c, b)));
red("A7 the engine reserving at standard whatever the subject", checkRisk(plant("engine", "p_risk_tier: m.risk.tier, p_risk_rule: m.risk.rule,", "p_risk_tier: \"standard_educational\", p_risk_rule: m.risk.rule,"), classifyRisk, activityAt));
red("A8 an admin door that activates metering", checkAdminDoor(plant("adminRoute", "    default:\n      return refuse(400, \"Unknown action\");", "    case \"activate\": await ctx.admin.from(\"practice_platform_flags\").upsert({ flag: \"ai_fair_use\", enabled: true }); return NextResponse.json({});\n    default:\n      return refuse(400, \"Unknown action\");")));
red("A11 an allowance hard-coded in the engine", checkNoFigures(plant("policy", "export const CAU_MAX = 1_000_000;", "export const CAU_MAX = 1_000_000;\nconst PILOT_INCLUDED = 4000;")));
red("A11 a reserve default bound in the admin surface", checkNoFigures(plant("adminControls", `{field("Essential reserve (CAU), hard cap", p.reserveCau, v => setP({ ...p, reserveCau: v ?? 0 }))}`, `{field("Essential reserve (CAU), hard cap", p.reserveCau, v => setP({ ...p, reserveCau: v ?? 500 }))}`)));
red("A11 a window cap in the engine", checkNoFigures(plant("engine", "export const AI_FAIR_USE_FLAG = \"ai_fair_use\";", "export const AI_FAIR_USE_FLAG = \"ai_fair_use\";\nconst WINDOW = 1000;")));
red("A16 standing that skips eligibility", checkStandingEligibility(plant("engine", "return withEligibility(standingFrom(policy, a.account),", "return ((x: any) => x)(standingFrom(policy, a.account),"), withEligibility));
red("A16 an eligibility check that offers everything", checkStandingEligibility(RAW, (st) => st));
red("A13 promotion charged to the student", checkAttribution({ ...ATTRIBUTION, "case.promote": "individual" }));
red("A13 a student's private case charged to the platform", checkAttribution({ ...ATTRIBUTION, "case.private_generate": "platform" }));
red("A15 a student route running platform screening", checkOwnerFromServer(RAW, new Map([...ALL, ["src/app/api/individual/scholar/evil/route.ts", `await resolveOwner(admin, "case.candidate_screen", "scholar", { userId: ctx.userId })`]])));
red("A15 a browser-sent owner", checkOwnerFromServer(RAW, new Map([...ALL, ["src/app/api/hq/evil/route.ts", `await resolveOwner(admin, body.workflow, "scholar", { userId: ctx.userId, institutionBudgetCode: body.budget })`]])));
if (HAS_MIG) {
  red("A14 (FI) another person's account chargeable", checkReserveOwnership(plant("mig421", "    if p_actor is null or p_actor is distinct from a.user_id or p_service is not null then", "    if false then")));
  red("A14 (FI) a suspended budget chargeable", checkReserveOwnership(plant("mig421", "    if not found or b.status <> 'active' then return query select null::uuid, false, 'budget_suspended', null::numeric; return; end if;", "")));
  red("A14 an institution budget without funding", checkReserveOwnership(plant("mig421", "     and (owner_type <> 'institution' or (institution_ref is not null and funding_ref is not null and char_length(btrim(funding_ref)) >= 5))\n", "")));
}
red("A12 an undefined activity served", checkActivitiesAreData(RAW, resolvePolicy, (p, l, c, b) => { const d = activityAt(p, l, c, b); return d.refusal === "unknown_activity" ? { available: true, via: "included", tier: "reasoning", refusal: null, reason: null } : d; }));

console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
