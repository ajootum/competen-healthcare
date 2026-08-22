// Verifies migration 349 actually landed. "Success. No rows returned" is what the SQL editor prints for
// DDL whether or not every statement ran -- the runner splits on semicolons, so a file can be PARTIALLY
// applied and still look successful. This asks the database instead.
// Run: node scripts/verify-payment-path.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let bad = 0;
const ok = (s) => console.log(`  OK    ${s}`);
const fail = (s, why) => { bad++; console.log(`  FAIL  ${s}\n        ${why}`); };

console.log("MIGRATION 349 - practice payment path\n");

for (const t of ["practice_checkout", "practice_checkout_event", "practice_subscription"]) {
  const r = await db.from(t).select("id").limit(1);
  r.error ? fail(`${t} exists`, r.error.message) : ok(`${t} exists`);
}

// The three price columns, read by name so a partially-applied ALTER is visible.
const p = await db.from("practice_plans").select("plan_code, amount_minor, currency, interval_unit").limit(5);
if (p.error) fail("practice_plans price columns", p.error.message);
else ok("practice_plans has amount_minor / currency / interval_unit");

// The seeded plan, and the two things about it that matter.
const seed = await db.from("practice_plans").select("plan_code, amount_minor, currency, interval_unit, active").eq("plan_code", "practice_solo_ugx").maybeSingle();
if (seed.error) fail("seeded plan readable", seed.error.message);
else if (!seed.data) fail("practice_solo_ugx seeded", "row absent - the INSERT did not run");
else {
  ok(`practice_solo_ugx = ${seed.data.amount_minor} ${seed.data.currency} / ${seed.data.interval_unit}`);
  seed.data.amount_minor === 74000
    ? ok("amount is 74000 (UGX exponent 0 - minor IS the shilling)")
    : fail("amount is 74000", `got ${seed.data.amount_minor} - a 100x error is exactly the units bug`);
  seed.data.active === false
    ? ok("plan is INACTIVE - nothing is chargeable until the price is agreed")
    : fail("plan is inactive", "it is ACTIVE and therefore sellable right now");
}

// The price-completeness CHECK must actually refuse a half-priced plan.
const badPlan = { plan_code: `zz_probe_${Date.now()}`, name: "probe", active: false, amount_minor: 100 };
const viol = await db.from("practice_plans").insert(badPlan).select("plan_code").maybeSingle();
if (viol.error) ok("price-completeness CHECK refuses amount without currency");
else { fail("price-completeness CHECK", "a plan with an amount and no currency was ACCEPTED"); await db.from("practice_plans").delete().eq("plan_code", badPlan.plan_code); }

// The idempotency constraint is the whole webhook guard - prove the database enforces it.
const evId = `probe-${Date.now()}`;
const row = { provider: "flutterwave", provider_event_id: evId, verdict: "unverified", detail: "probe" };
const first = await db.from("practice_checkout_event").insert(row).select("id").maybeSingle();
if (first.error) fail("event insert", first.error.message);
else {
  const second = await db.from("practice_checkout_event").insert(row).select("id").maybeSingle();
  second.error ? ok("unique (provider, provider_event_id) refuses a repeat delivery")
               : fail("idempotency constraint", "the SAME event id inserted TWICE - a retry would pay twice");
  await db.from("practice_checkout_event").delete().eq("provider_event_id", evId);
}

console.log(bad === 0 ? "\nALL CLEAR - 349 is applied.\n" : `\n${bad} PROBLEM(S) - 349 is NOT fully applied.\n`);
process.exit(bad === 0 ? 0 : 1);
