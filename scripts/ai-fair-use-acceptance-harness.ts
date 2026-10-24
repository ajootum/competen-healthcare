/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI FAIR USE -- ACCEPTANCE on STAGING (COMPETEN-AI-FAIR-USE-01 s13 and IND-007 D1, migrations 410, 411 and 412).
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only ai-fair-use-acceptance-harness
 *
 * Against the real database functions, through PostgREST, with fixtures it makes and removes:
 *   S   Scholar and Professional use the same engine with independent policies (s13.1, s13.2)
 *   C   concurrent reservations cannot overspend: 20 at once against room for 5 (s13.4)
 *   I   a retried request id holds once and is never charged twice
 *   F   a failure before billing releases at no cost, a double settle is refused (s13.5)
 *   H   a price change does not re-price a reservation already made (s13.6)
 *   L   service levels follow the balance, and Continuity keeps only reserve-eligible essentials (s13.7, s13.9, s13.11)
 *   R   the essential reserve stops at its hard cap (s13.8)
 *   P   a new allowance period opens at zero (s13.12)
 *   X   an unknown charge keeps its hold, is reconciled into its original account, or released on proof (411)
 *   Y   outstanding unreconciled holds stop at the per-person ceiling (411)
 *   B   the buffer widens the hold only; provider expenditure and allowance consumption are immutable (411, D3)
 *   E   a clinical tier needs an eligibility decision covering it, null or unknown is high risk, the tier and rule
 *       are recorded and frozen, and eligibility is history (411, 412, D1)
 *   A   unknown activities and level-insufficient tiers are refused, never downgraded (amendments 1, 2)
 *   U   a signed-in person cannot read, write or call any of it (s13.13)
 *   G   the policy in force was published through the audited engine (s13.14)
 *
 * It never calls an AI provider and never switches the ai_fair_use flag: the engine's decisions are exercised
 * through its own pure functions and the database functions it calls. PEND (exit 0) until 411 and the
 * provisional seed (scripts/seed-staging-ai-fair-use.ts) are present.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { loadProductPolicy } from "../src/lib/ai/allowance";
import { activityAt, allowancePeriod, serviceLevel, type Balance } from "../src/lib/ai/fair-use-policy";
import { FAIR_USE_SCOPE } from "../src/lib/ai/fair-use-policy";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anon) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "ai-fair-use-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const EMAIL = "harness-aifu-person@competen.test";
const PASSWORD = `aifu-${Math.random().toString(36).slice(2)}-Aa1!`;
const MODEL = "claude-sonnet-4-6";

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup() {
  const u = await findUser(EMAIL);
  if (!u) return;
  await admin.from("ai_allowance_account").delete().eq("user_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
let BUFFER = 0;
const reserve = (req: string, acc: string, activity: string, pool: string, inT: number, outT: number, extra: Record<string, unknown> = {}) =>
  admin.rpc("ai_reserve", { p_request_id: req, p_account: acc, p_activity: activity, p_pool: pool, p_provider: "anthropic", p_model: MODEL,
    p_max_input_tokens: inT, p_max_output_tokens: outT, p_policy_version: "harness", p_currency: "UGX", p_buffer_pct: BUFFER,
    p_risk_tier: "standard_educational", p_risk_rule: "harness", p_unreconciled_cap_cau: 1e6, ...extra });
const ledger = async (req: string) => (await admin.from("ai_usage_ledger").select("*").eq("request_id", req).single()).data;
const row = (r: any) => (Array.isArray(r.data) ? r.data[0] : r.data);
const account = async (id: string) => (await admin.from("ai_allowance_account").select("*").eq("id", id).single()).data;
const toBal = (a: any): Balance => ({ includedCau: +a.included_cau, reserveCau: +a.reserve_cau, usedCau: +a.used_cau, reservedCau: +a.reserved_cau, reserveUsedCau: +a.reserve_used_cau, reserveReservedCau: +a.reserve_reserved_cau });

async function main() {
  console.log(`AI FAIR USE ACCEPTANCE (410, 411, 412) -- target ${ref}\n`);
  const probe = await admin.from("ai_usage_ledger").select("risk_tier").limit(0);
  if (probe.error) { pend("S-G", `migration 412 is not applied here (${probe.error.message}). Nothing created.`); return; }
  const price = (await admin.rpc("ai_price_at", { p_provider: "anthropic", p_model: MODEL, p_at: new Date().toISOString() })).data;
  const [scholar, pro] = [await loadProductPolicy(admin, "scholar"), await loadProductPolicy(admin, "professional")];
  const fx = (await admin.from("ai_fx_rate").select("*").eq("currency", "UGX").is("effective_to", null).maybeSingle()).data;
  const basis = (await admin.from("ai_cau_basis").select("*").eq("currency", "UGX").is("effective_to", null).maybeSingle()).data;
  if (!price?.id || !fx || !basis || scholar.policy.includedCau <= 0) { pend("S-G", "the provisional seed is not present (scripts/seed-staging-ai-fair-use.ts)"); return; }
  BUFFER = scholar.policy.fxBufferPct;
  await cleanup();
  try {
    const { data: u, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "AIFU Harness", synthetic: true } });
    if (error) throw new Error(error.message);
    const uid = u.user.id as string;
    const now = Date.now(), day = 86400000;
    // Accounts are unique per person, product and period start, so each fixture account starts a second apart.
    let opened = 0;
    const open = async (product: string, start: number, end: number, included: number, reserveCau: number) => {
      const r = await admin.from("ai_allowance_account").insert({ user_id: uid, product, period_start: new Date(start - 1000 * opened++).toISOString(), period_end: new Date(end).toISOString(),
        included_cau: included, reserve_cau: reserveCau, policy_version: "harness" }).select("id").single();
      if (r.error) throw new Error(`fixture account: ${r.error.message}`);
      return r.data.id as string;
    };

    // ── S. one engine, independent policies ──
    ok("S1. Scholar and Professional read their own published policies from the same engine",
      scholar.readable && pro.readable && Object.keys(scholar.policy.activities).includes("clarify") && !Object.keys(pro.policy.activities).includes("clarify"),
      JSON.stringify({ s: scholar.policy.version, p: pro.policy.version }));

    // ── C. concurrency: each 1000/1000 at the seeded price, room for exactly 5 ──
    const perCall = Number((row(await reserve("aifu-probe-price-0001", await open("professional", now - day, now + 29 * day, 1e9, 0), "map", "included", 1000, 1000))).max_cau);
    const accC = await open("scholar", now - day, now + 29 * day, perCall * 5 + perCall / 2, 0);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(`aifu-conc-${i.toString().padStart(4, "0")}`, accC, "explain", "included", 1000, 1000)));
    const granted = results.filter(r => row(r)?.granted).length;
    const a = await account(accC);
    ok("C1. (FI) 20 concurrent reservations against room for 5: exactly 5 granted, never more than the allowance held",
      granted === 5 && +a.reserved_cau <= +a.included_cau, `granted ${granted}, held ${a.reserved_cau} of ${a.included_cau}`);

    // ── I. idempotent retry ──
    const dup = await Promise.all(Array.from({ length: 8 }, () => reserve("aifu-dup-same-0001", accC, "explain", "included", 10, 10)));
    const dupRows = (await admin.from("ai_usage_ledger").select("id").eq("request_id", "aifu-dup-same-0001")).data ?? [];
    ok("I1. (FI) 8 concurrent retries of one request id: one ledger row", dupRows.length === 1 && dup.every(r => !r.error));

    // ── F. failure before billing, double settle ──
    const accF = await open("professional", now - day, now + 29 * day, 1e6, 0);
    await reserve("aifu-fail-0001", accF, "assistant", "included", 100, 100);
    await admin.rpc("ai_release", { p_request_id: "aifu-fail-0001", p_outcome: "error" });
    const fa = await account(accF), fl = (await admin.from("ai_usage_ledger").select("*").eq("request_id", "aifu-fail-0001").single()).data;
    ok("F1. (FI) a request that failed before billing is released at no cost", +fa.used_cau === 0 && +fa.reserved_cau === 0 && fl.status === "released" && +fl.settled_cau === 0);
    await reserve("aifu-settle-0001", accF, "assistant", "included", 100, 100);
    const s1 = await admin.rpc("ai_settle", { p_request_id: "aifu-settle-0001", p_model: MODEL, p_input_tokens: 50, p_output_tokens: 20, p_extra_usd: 0, p_outcome: "ok" });
    const s2 = await admin.rpc("ai_settle", { p_request_id: "aifu-settle-0001", p_model: MODEL, p_input_tokens: 50, p_output_tokens: 20, p_extra_usd: 0, p_outcome: "ok" });
    ok("F2. (FI) a settled request cannot be settled again", !s1.error && !!s2.error, s2.error?.message ?? "second settle accepted");
    const refusalBilled = await reserve("aifu-refusal-0001", accF, "assistant", "included", 100, 100);
    await admin.rpc("ai_settle", { p_request_id: "aifu-refusal-0001", p_model: MODEL, p_input_tokens: 40, p_output_tokens: 0, p_extra_usd: 0, p_outcome: "refusal" });
    const rl = (await admin.from("ai_usage_ledger").select("outcome, input_tokens, settled_cau").eq("request_id", "aifu-refusal-0001").single()).data;
    ok("F3. a provider-billed refusal is settled at what it consumed, no more", !!row(refusalBilled)?.granted && rl.outcome === "refusal" && rl.input_tokens === 40 && +rl.settled_cau > 0);

    // ── H. history: the reservation keeps its price ──
    await reserve("aifu-hist-0001", accF, "assistant", "included", 1000, 1000);
    const priceRow = (await admin.from("ai_usage_ledger").select("price_id").eq("request_id", "aifu-hist-0001").single()).data;
    const rewrite = await admin.from("ai_price").update({ output_per_mtok_usd: 999 }).eq("id", priceRow.price_id);
    ok("H1. a price in force cannot be rewritten (append-only history)", !!rewrite.error);
    await admin.rpc("ai_settle", { p_request_id: "aifu-hist-0001", p_model: MODEL, p_input_tokens: 1000, p_output_tokens: 1000, p_extra_usd: 0, p_outcome: "ok" });
    const hl = (await admin.from("ai_usage_ledger").select("cost_usd, price_id").eq("request_id", "aifu-hist-0001").single()).data;
    ok("H2. settlement uses the price row fixed at reservation", hl.price_id === priceRow.price_id && +hl.cost_usd === +((1000 * +price.input_per_mtok_usd + 1000 * +price.output_per_mtok_usd) / 1e6 + +price.extra_per_request_usd).toFixed(6), JSON.stringify(hl));

    // ── B. the buffer is on the hold only; the two records are immutable ──
    const bl = await ledger("aifu-hist-0001");
    const settledPerCall = +(+bl.cost_usd * +fx.per_usd / +basis.currency_per_cau).toFixed(6);
    ok("B1. (D3) the hold carries the buffer, the settled allowance consumption does not: cost x reference rate / basis",
      +bl.settled_cau === settledPerCall && Math.abs(+bl.max_cau - settledPerCall * (1 + BUFFER / 100)) < 0.01 && +bl.reserve_buffer_pct === BUFFER && !!bl.fx_rate_id && !!bl.cau_basis_id,
      JSON.stringify({ hold: bl.max_cau, settled: bl.settled_cau, expected: settledPerCall, buffer: bl.reserve_buffer_pct }));
    const rwCost = await admin.from("ai_usage_ledger").update({ cost_usd: 0 }).eq("request_id", "aifu-hist-0001").select("id");
    const rwCau = await admin.from("ai_usage_ledger").update({ settled_cau: 0 }).eq("request_id", "aifu-hist-0001").select("id");
    const rwFx = await admin.from("ai_fx_rate").update({ per_usd: 1 }).eq("id", fx.id).select("id");
    ok("B2. provider expenditure and allowance consumption cannot be rewritten, and neither can the reference rate they used",
      !!rwCost.error && !!rwCau.error && !!rwFx.error, JSON.stringify({ cost: rwCost.error?.message, cau: rwCau.error?.message, fx: rwFx.error?.message }));

    // ── X. unknown charges: the hold stays, reconciliation goes to the original account, release only on proof ──
    const accX = await open("professional", now - day, now + 29 * day, 1e6, 0);
    await reserve("aifu-unrec-0001", accX, "assistant", "included", 1000, 1000);
    const mk = await admin.rpc("ai_mark_unreconciled", { p_request_id: "aifu-unrec-0001", p_outcome: "timeout" });
    const xa = await account(accX), xl = await ledger("aifu-unrec-0001");
    const retry = row(await reserve("aifu-unrec-0001", accX, "assistant", "included", 1000, 1000));
    ok("X1. (amendment 4) an unknown charge is never settled on the estimate: the row waits as unreconciled with its hold kept",
      !mk.error && xl.status === "unreconciled" && xl.settled_at === null && +xa.reserved_cau === +xl.max_cau && +xa.used_cau === 0 && retry?.reason === "retry: unreconciled",
      JSON.stringify({ status: xl.status, held: xa.reserved_cau, retry }));
    await admin.rpc("ai_settle", { p_request_id: "aifu-unrec-0001", p_model: MODEL, p_input_tokens: 1000, p_output_tokens: 1000, p_extra_usd: 0, p_outcome: "ok" });
    const xa2 = await account(accX), xl2 = await ledger("aifu-unrec-0001");
    ok("X2. reconciliation from real provider usage settles into the original account and period",
      xl2.status === "settled" && xl2.account_id === accX && +xa2.reserved_cau === 0 && +xa2.used_cau === +xl2.settled_cau && +xl2.settled_cau === settledPerCall, JSON.stringify({ status: xl2.status, used: xa2.used_cau }));
    await reserve("aifu-unrec-0002", accX, "assistant", "included", 1000, 1000);
    await admin.rpc("ai_mark_unreconciled", { p_request_id: "aifu-unrec-0002", p_outcome: "timeout" });
    await admin.rpc("ai_release", { p_request_id: "aifu-unrec-0002", p_outcome: "error" });
    const xa3 = await account(accX), xl3 = await ledger("aifu-unrec-0002");
    ok("X3. on proof of no billing an unreconciled hold is released at no cost", xl3.status === "released" && +xl3.settled_cau === 0 && +xa3.reserved_cau === 0 && +xa3.used_cau === +xa2.used_cau);

    // ── Y. the unreconciled ceiling ──
    const cap = perCall * 2.5;
    for (const i of [1, 2]) {
      await reserve(`aifu-ceil-000${i}`, accX, "assistant", "included", 1000, 1000, { p_unreconciled_cap_cau: cap });
      await admin.rpc("ai_mark_unreconciled", { p_request_id: `aifu-ceil-000${i}`, p_outcome: "timeout" });
    }
    const y3 = row(await reserve("aifu-ceil-0003", accX, "assistant", "included", 1000, 1000, { p_unreconciled_cap_cau: cap }));
    const yNull = row(await reserve("aifu-ceil-0004", accX, "assistant", "included", 10, 10, { p_unreconciled_cap_cau: null }));
    ok("Y1. outstanding unreconciled holds stop at the per-person ceiling, and no ceiling refuses (fails closed)",
      y3?.granted === false && y3?.reason === "unreconciled_ceiling" && yNull?.granted === false && yNull?.reason === "unreconciled_ceiling", JSON.stringify({ y3, yNull }));
    for (const i of [1, 2]) await admin.rpc("ai_release", { p_request_id: `aifu-ceil-000${i}`, p_outcome: "error" });

    // ── E. clinical eligibility, by evidence ──
    const sensitiveCode = "teach";
    const e1 = row(await reserve("aifu-elig-0001", accX, sensitiveCode, "included", 100, 100, { p_risk_tier: "clinical_educational", p_risk_rule: "clinical.topics" }));
    const e2 = row(await reserve("aifu-elig-0002", accX, sensitiveCode, "included", 100, 100, { p_risk_tier: null, p_risk_rule: null }));
    const e3 = row(await reserve("aifu-elig-0003", accX, sensitiveCode, "included", 100, 100, { p_risk_tier: "standard_educational", p_risk_rule: "standard.study-and-career" }));
    const e3row = await ledger("aifu-elig-0003");
    await admin.rpc("ai_settle", { p_request_id: "aifu-elig-0003", p_model: MODEL, p_input_tokens: 10, p_output_tokens: 10, p_extra_usd: 0, p_outcome: "ok" });
    const rwTier = await admin.from("ai_usage_ledger").update({ risk_tier: "high_risk_clinical" }).eq("request_id", "aifu-elig-0003").select("id");
    const seededNo = (await admin.from("ai_model_eligibility").select("id").eq("eligible", false).is("effective_to", null).limit(1)).data?.[0];
    const rwElig = seededNo ? await admin.from("ai_model_eligibility").update({ eligible: true, evidence_ref: "harness-forged" }).eq("id", seededNo.id).select("id") : { error: { message: "no row" } };
    ok("E1. (D1) a clinical tier with no eligibility decision covering it is refused, a null tier is high risk, a standard tier runs",
      e1?.granted === false && e1?.reason === "not_eligible" && e2?.granted === false && e2?.reason === "not_eligible" && e3?.granted === true, JSON.stringify({ e1, e2, e3 }));
    ok("E3. (D1) the classified tier and the deciding rule are recorded on the ledger and cannot be rewritten",
      e3row?.risk_tier === "standard_educational" && e3row?.risk_rule === "standard.study-and-career" && !!rwTier.error, JSON.stringify({ tier: e3row?.risk_tier, rule: e3row?.risk_rule, rewrite: rwTier.error?.message }));
    ok("E2. an eligibility decision cannot be rewritten into eligible (history, evidence-based)", !!seededNo && !!rwElig.error, rwElig.error?.message ?? "rewrite accepted");

    // ── A. activities are policy data, and a level never downgrades below an activity's floor ──
    const bFull = { includedCau: 100, reserveCau: 0, usedCau: 0, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 };
    const unknown = activityAt(scholar.policy, "full", "not_a_policy_activity", bFull);
    const floored = Object.entries(scholar.policy.activities).find(([, x]) => x.minTier === x.tier && x.tier !== "cheap");
    const lvl = floored ? activityAt(scholar.policy, "optimised", floored[0], bFull) : null;
    ok("A1. (amendments 1, 2) an activity the policy does not define is refused, and one whose floor a level cannot meet is refused as level_insufficient",
      unknown.refusal === "unknown_activity" && !!lvl && lvl.refusal === "level_insufficient" && !lvl.available, JSON.stringify({ unknown: unknown.refusal, floored: floored?.[0], lvl }));

    // ── L. levels follow the balance; Continuity keeps only reserve-eligible essentials ──
    const accL = await open("scholar", now - day, now + 29 * day, settledPerCall * 10.5, perCall);
    const levels: string[] = [];
    for (let i = 0; i < 10; i++) {
      levels.push(serviceLevel(scholar.policy, toBal(await account(accL))));
      await reserve(`aifu-level-${i.toString().padStart(4, "0")}`, accL, "explain", "included", 1000, 1000);
      await admin.rpc("ai_settle", { p_request_id: `aifu-level-${i.toString().padStart(4, "0")}`, p_model: MODEL, p_input_tokens: 1000, p_output_tokens: 1000, p_extra_usd: 0, p_outcome: "ok" });
    }
    const bL = toBal(await account(accL));
    const lvlEnd = serviceLevel(scholar.policy, bL);
    ok("L1. service levels follow the configured thresholds as the allowance is used: full, then optimised, then essential, then continuity",
      levels[0] === "full" && levels.includes("optimised") && lvlEnd === "essential" && serviceLevel(scholar.policy, { ...bL, usedCau: bL.includedCau }) === "continuity", JSON.stringify([...levels, lvlEnd]));
    const exhausted = row(await reserve("aifu-after-0001", accL, "explain", "included", 1000, 1000));
    ok("L2. (s13.11) a new chargeable request is refused when no included allowance remains", exhausted?.granted === false && exhausted?.reason === "included_exhausted", JSON.stringify(exhausted));
    const cont = activityAt(scholar.policy, "continuity", "clarify", bL), contStd = activityAt(scholar.policy, "continuity", "questions", bL);
    ok("L3. (s13.9) Continuity: only reserve-eligible essential help, from the reserve; other AI activities wait for renewal", cont.available && cont.via === "reserve" && !contStd.available);

    // ── R. the reserve's hard cap ──
    const r1 = row(await reserve("aifu-reserve-0001", accL, "clarify", "reserve", 900, 900));
    const r2 = row(await reserve("aifu-reserve-0002", accL, "clarify", "reserve", 900, 900));
    ok("R1. (s13.8) the essential reserve stops at its hard cap", r1?.granted === true && r2?.granted === false && r2?.reason === "reserve_exhausted", JSON.stringify({ r1, r2 }));

    // ── P. a new period opens at zero ──
    const ent = { startsAt: new Date(now - 31 * day).toISOString(), endsAt: null };
    const period = allowancePeriod(scholar.policy, ent, new Date());
    const accP = await open("scholar", period!.start.getTime(), period!.end.getTime(), scholar.policy.includedCau, scholar.policy.reserveCau);
    const pa = await account(accP);
    ok("P1. (s13.12) the allowance resets: the next period's account opens at zero, separate from the last", +pa.used_cau === 0 && +pa.reserved_cau === 0 && period!.start.getTime() > now - 2 * day);

    // ── U. a signed-in person can do nothing to it ──
    await admin.auth.admin.updateUserById(uid, { password: PASSWORD });
    const user = createClient(url!, anon!, { auth: { persistSession: false } }) as any;
    const signIn = await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (signIn.error) ok("U0. the fixture can sign in", false, signIn.error.message);
    else {
      const read = await user.from("ai_allowance_account").select("id");
      const write = await user.from("ai_allowance_account").update({ included_cau: 1e9 }).eq("user_id", uid).select("id");
      // The real 411 signature, so a refusal is a permission refusal (42501) and not merely an unknown function.
      const call = await user.rpc("ai_reserve", { p_request_id: "aifu-browser-0001", p_account: accP, p_activity: "explain", p_pool: "included", p_provider: "anthropic", p_model: MODEL,
        p_max_input_tokens: 1, p_max_output_tokens: 1, p_policy_version: "x", p_currency: "UGX", p_buffer_pct: 0, p_risk_tier: "standard_educational", p_risk_rule: "x", p_unreconciled_cap_cau: 1e6 });
      const settle = await user.rpc("ai_settle", { p_request_id: "aifu-settle-0001", p_model: MODEL, p_input_tokens: 0, p_output_tokens: 0, p_extra_usd: 0, p_outcome: "ok" });
      const mark = await user.rpc("ai_mark_unreconciled", { p_request_id: "aifu-settle-0001", p_outcome: "timeout" });
      const denied = (e: any) => e?.code === "42501";
      ok("U1. (s13.13) a signed-in person cannot read their balance rows, raise their allowance, or call reserve, settle or mark unreconciled",
        (read.data ?? []).length === 0 && (write.data ?? []).length === 0 && denied(call.error) && denied(settle.error) && denied(mark.error),
        JSON.stringify({ read: read.data?.length, write: write.data?.length, call: call.error?.code, settle: settle.error?.code, mark: mark.error?.code }));
      await user.auth.signOut();
    }

    // ── G. governed ──
    const audit = (await admin.from("workspace_config_audit").select("action, config_path").eq("scope_ref", FAIR_USE_SCOPE.scopeRef).limit(20)).data ?? [];
    ok("G1. (s13.14) the AI policies in force were set and published through the audited configuration engine",
      audit.some((r: any) => r.config_path === "ai.fair_use.scholar") && audit.some((r: any) => r.config_path === "ai.fair_use.professional"), `${audit.length} audit rows`);
  } finally {
    await cleanup();
  }
  const left = await findUser(EMAIL);
  ok("Z1. fixtures removed (accounts and their ledger by cascade, the account)", !left);
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
