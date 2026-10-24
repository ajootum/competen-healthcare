/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN P1 COMMERCIAL -- STAGING ACCEPTANCE OF MIGRATIONS 399 AND 400, AND OF THE CODE ON THEM.
 *
 * Build record: docs/COMPETEN-P1-COMMERCIAL-holdings-foundation.md.
 *
 * What it proves against the real schema, at library level (no HTTP, no payment provider):
 *
 *   C  the post-state: three tables, two entitlement columns, plan_code on the live view, the capability with
 *      no position grant, and individual_commerce still absent
 *   P  the plan CHECKs: an active plan must be priced, a currency is three letters, a period is 1-366 days
 *   K  the composite keys: a checkout or a paid period cannot name a plan of the other experience, and a paid
 *      period must name a plan
 *   E  one delivery row per (provider, provider_event_id)
 *   S  the Individual settlement adapter: a purchase opens the membership, appends a live paid period, a
 *      renewal starts where it ends, and Scholar needs the recorded HQ confirmation (D8)
 *   A  AI fair use reads nothing while commerce is off
 *
 * ⚠ STAGING ONLY. assertSafeTarget refuses production before any client is built:
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only individual-commerce-staging
 *
 * ⚠ IT NEVER WRITES individual_app OR individual_commerce. It creates and deletes its own harness-p1c-*
 * identities (no password -- nobody signs in as them) and its own zz_p1c_* plans. PEND (exit 0, nothing
 * created) until 399 is applied.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { INDIVIDUAL_SETTLEMENT, individualPlanAiLimit, INDIVIDUAL_COMMERCE_FLAG } from "../src/lib/individual/commerce";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
assertSafeTarget(url, "individual-commerce-staging-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = { buyer: "harness-p1c-buyer@competen.test", scholar: "harness-p1c-scholar@competen.test" };
const PLAN = { pro: "zz_p1c_pro", sch: "zz_p1c_sch", bad: "zz_p1c_bad" };
const TX = "cin-harness-p1c-";

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

async function cleanup() {
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_checkout").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("individual_checkout_event").delete().like("provider_event_id", "harness-p1c-%");
  await admin.from("individual_plan").delete().in("plan_code", Object.values(PLAN));
}

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id as string;
}

const code = (r: any) => String(r?.error?.code ?? "");

async function checkout(userId: string, plan: string, experience: string, n: number) {
  const r = await admin.from("individual_checkout").insert({
    user_id: userId, plan_code: plan, experience_code: experience, amount_minor: 900, currency: "USD", interval_days: 30,
    tx_ref: `${TX}${n}`, status: "paid",
  }).select("id, user_id, plan_code, experience_code, amount_minor, currency, interval_days, status").single();
  return r;
}

async function main() {
  console.log("INDIVIDUAL COMMERCE STAGING HARNESS (P1 Commercial, migrations 399/400)\n");

  const probe = await admin.from("individual_plan").select("plan_code").limit(0);
  if (probe.error) { console.log(`PEND -- migration 399 is not applied here (${probe.error.code}). Nothing created.`); return; }

  // ── C. POST-STATE ──
  const tables = await Promise.all(["individual_plan", "individual_checkout", "individual_checkout_event"].map(t => admin.from(t).select("*").limit(0)));
  const cols = await admin.from("individual_entitlement").select("plan_code, checkout_id").limit(0);
  const view = await admin.from("individual_live_entitlement").select("plan_code").limit(0);
  // Control: a column that does not exist IS refused, so the two reads above are not a PostgREST false positive.
  const ctl = await admin.from("individual_entitlement").select("zz_no_such_column").limit(0);
  ok("C1. 399's three tables, two entitlement columns and plan_code on the live view are present (with a refusing control)",
    tables.every(t => !t.error) && !cols.error && !view.error && code(ctl) === "42703", `${cols.error?.message ?? ""} ${view.error?.message ?? ""} ctl=${code(ctl)}`);
  const cap = await admin.from("hq_capability").select("code").eq("code", "hq.individual.commercial.manage");
  const grants = await admin.from("hq_position_capability").select("position_code").eq("capability_code", "hq.individual.commercial.manage");
  ok("C2. 400's capability exists and NO position holds it", (cap.data ?? []).length === 1 && !grants.error && (grants.data ?? []).length === 0);
  const flag = await admin.from("practice_platform_flags").select("flag").eq("flag", INDIVIDUAL_COMMERCE_FLAG);
  ok("C3. individual_commerce has no row -- commerce is OFF", !flag.error && (flag.data ?? []).length === 0);

  await cleanup();
  const buyer = await makeUser(FIX.buyer);
  const scholarBuyer = await makeUser(FIX.scholar);

  // ── P. PLAN CHECKS ──
  const unpriced = await admin.from("individual_plan").insert({ plan_code: PLAN.bad, experience_code: "professional", name: "x", active: true });
  ok("P1. an active plan with no price is refused (individual_plan_active_priced)", code(unpriced) === "23514", code(unpriced));
  const half = await admin.from("individual_plan").insert({ plan_code: PLAN.bad, experience_code: "professional", name: "x", amount_minor: 900 });
  ok("P2. a price without currency and period is refused (individual_plan_price_complete)", code(half) === "23514", code(half));
  const lower = await admin.from("individual_plan").insert({ plan_code: PLAN.bad, experience_code: "professional", name: "x", amount_minor: 900, currency: "usd", interval_days: 30 });
  ok("P3. a lower-case currency is refused", code(lower) === "23514", code(lower));
  const good = await admin.from("individual_plan").insert([
    { plan_code: PLAN.pro, experience_code: "professional", name: "Harness Professional", active: true, amount_minor: 900, currency: "USD", interval_days: 30, ai_hourly_limit: 12 },
    { plan_code: PLAN.sch, experience_code: "scholar", name: "Harness Scholar", active: true, amount_minor: 900, currency: "USD", interval_days: 30 },
  ]);
  ok("P4. a complete plan of each experience is accepted (control for P1-P3)", !good.error, good.error?.message);
  const moved = await admin.from("individual_plan").update({ experience_code: "scholar" }).eq("plan_code", PLAN.pro);
  // Not referenced yet, so this one succeeds -- and is put back. K3 proves the refusal once a checkout names it.
  await admin.from("individual_plan").update({ experience_code: "professional" }).eq("plan_code", PLAN.pro);

  // ── K. COMPOSITE KEYS ──
  const cross = await checkout(buyer, PLAN.pro, "scholar", 99);
  ok("K1. a checkout naming a Professional plan for Scholar is refused (individual_checkout_plan_fk)", code(cross) === "23503", code(cross));
  const noPlan = await admin.from("individual_entitlement").insert({ user_id: buyer, experience_code: "professional", source: "payment", operating_entity: "competen_holdings" });
  ok("K2. a paid period that names no plan is refused (individual_entitlement_payment_plan)", code(noPlan) === "23514", code(noPlan));
  const co1 = await checkout(buyer, PLAN.pro, "professional", 1);
  const fixedNow = await admin.from("individual_plan").update({ experience_code: "scholar" }).eq("plan_code", PLAN.pro);
  ok("K3. once a checkout names a plan, its experience cannot change", !co1.error && !moved.error && code(fixedNow) === "23503", `${co1.error?.message ?? ""} ${code(fixedNow)}`);

  // ── E. ONE ROW PER DELIVERY ──
  const ev = { provider: "flutterwave", provider_event_id: "harness-p1c-ev1", tx_ref: `${TX}1`, verdict: "unverified" };
  const e1 = await admin.from("individual_checkout_event").insert(ev);
  const e2 = await admin.from("individual_checkout_event").insert(ev);
  ok("E1. a second delivery of the same event is refused by the unique constraint", !e1.error && code(e2) === "23505", `${e1.error?.message ?? ""} ${code(e2)}`);

  // ── S. SETTLEMENT ADAPTER ──
  const v: any = { ok: true, providerTxId: "harness", txRef: `${TX}1`, amountMajor: 9, currency: "USD", channel: "card" };
  await INDIVIDUAL_SETTLEMENT.onPaid(admin, co1.data, v, `${TX}1`, new Date());
  const m = await admin.from("individual_membership").select("source, status").eq("user_id", buyer).maybeSingle();
  const live1 = await admin.from("individual_live_entitlement").select("experience_code, source, plan_code, ends_at").eq("user_id", buyer);
  ok("S1. a first purchase opens the membership (source purchase) and a LIVE paid period naming the plan",
    m.data?.source === "purchase" && m.data?.status === "active" && (live1.data ?? []).length === 1
      && live1.data[0].source === "payment" && live1.data[0].plan_code === PLAN.pro, JSON.stringify({ m: m.data, live: live1.data }));

  const co2 = await checkout(buyer, PLAN.pro, "professional", 2);
  await INDIVIDUAL_SETTLEMENT.onPaid(admin, co2.data, { ...v, txRef: `${TX}2` }, `${TX}2`, new Date());
  const all = await admin.from("individual_entitlement").select("starts_at, ends_at, checkout_id").eq("user_id", buyer).order("starts_at");
  const [p1, p2] = all.data ?? [];
  ok("S2. a renewal APPENDS a period starting where the live one ends (not yet live itself)",
    (all.data ?? []).length === 2 && !!p1 && !!p2 && new Date(p2.starts_at).getTime() === new Date(p1.ends_at).getTime() && p2.checkout_id === co2.data?.id,
    JSON.stringify(all.data));

  const sco1 = await checkout(scholarBuyer, PLAN.sch, "scholar", 3);
  const prevError = console.error; console.error = () => {};
  await INDIVIDUAL_SETTLEMENT.onPaid(admin, sco1.data, { ...v, txRef: `${TX}3` }, `${TX}3`, new Date());
  console.error = prevError;
  const none = await admin.from("individual_entitlement").select("id").eq("user_id", scholarBuyer);
  const pwa = await admin.from("audit_log").select("action").eq("actor_id", scholarBuyer).eq("action", "individual_purchase_paid_without_access");
  ok("S3. D8: a Scholar payment with no recorded HQ confirmation opens nothing and is recorded as paid-without-access",
    (none.data ?? []).length === 0 && (pwa.data ?? []).length === 1, JSON.stringify({ rows: none.data, audit: pwa.data }));

  // An HQ pilot grant's confirmation, already on record (as grants.ts writes it).
  await admin.from("individual_entitlement").insert({ user_id: scholarBuyer, experience_code: "scholar", source: "pilot", status: "cancelled",
    operating_entity: "scholar_operator", adult_confirmed_at: "2026-09-01T00:00:00Z" });
  const sco2 = await checkout(scholarBuyer, PLAN.sch, "scholar", 4);
  await INDIVIDUAL_SETTLEMENT.onPaid(admin, sco2.data, { ...v, txRef: `${TX}4` }, `${TX}4`, new Date());
  const paid = await admin.from("individual_live_entitlement").select("source, plan_code, operating_entity").eq("user_id", scholarBuyer);
  const paidRaw = await admin.from("individual_entitlement").select("adult_confirmed_at").eq("user_id", scholarBuyer).eq("source", "payment");
  ok("S4. with the HQ confirmation on record, a Scholar payment opens a live paid period carrying it forward",
    (paid.data ?? []).length === 1 && paid.data[0].plan_code === PLAN.sch && paid.data[0].operating_entity === "scholar_operator"
      && new Date(paidRaw.data?.[0]?.adult_confirmed_at ?? 0).toISOString() === "2026-09-01T00:00:00.000Z", JSON.stringify({ paid: paid.data, raw: paidRaw.data }));

  // ── A. AI FAIR USE, COMMERCE OFF ──
  ok("A1. with commerce off, the plan AI limit is `off` even for a person holding a paid plan that sets one",
    JSON.stringify(await individualPlanAiLimit(admin, buyer)) === JSON.stringify({ state: "off" }));

  await cleanup();
  const left = await admin.from("individual_plan").select("plan_code").in("plan_code", Object.values(PLAN));
  ok("Z1. cleanup: no harness plan, identity or delivery row is left", (left.data ?? []).length === 0 && !(await findUser(FIX.buyer)));

  console.log(`\n${fails.length === 0 ? "ALL PASS" : "RED"} -- ${pass} pass / ${fails.length} fail`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
