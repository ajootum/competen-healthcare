/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * THE OWNER'S STAGING LEARNING SWITCHES -- learning_app and learning_commerce (src/lib/learning/policy.ts), STAGING ONLY.
 *
 *   npx tsx scripts/staging-learning-switch.ts --status          read only: both flags, and whether payments are TEST-only
 *   npx tsx scripts/staging-learning-switch.ts --app-on          open Competen Learning on staging (studio, catalogue, record)
 *   npx tsx scripts/staging-learning-switch.ts --app-off         close it again (the default state)
 *   npx tsx scripts/staging-learning-switch.ts --commerce-on     open paid course checkout on staging -- REFUSED unless the
 *                                                                configured Flutterwave secret is a TEST key
 *   npx tsx scripts/staging-learning-switch.ts --commerce-off    close paid course checkout (the default state)
 *
 * ⚠ FOR THE OWNER TO RUN, NOT AN AGENT. The flags are Learning's gates (CLAUDE.md lifecycle state 3): with them off,
 * nothing in Learning runs, and nothing in the application can switch them. This script is run by hand, on staging.
 * ⚠ STAGING ONLY. It refuses unless STAGING_SUPABASE_URL is a confirmed non-production project (production-guard).
 * ⚠ TEST MONEY ONLY (owner GO, payments). --commerce-on refuses unless FLW_SECRET_KEY is set AND is a Flutterwave TEST
 * key (it carries _TEST, the same rule scripts/flutterwave-sandbox.ts uses), FLW_SECRET_HASH is set, and the site URL is
 * not the production domain. It never prints a key: only "test mode: yes / no", and why. Real charging needs a
 * separate owner GO and is never opened here.
 * ⚠ SWITCH BOTH BACK OFF after the test. --status says which state they are in.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { LEARNING_APP_FLAG, LEARNING_COMMERCE_FLAG } from "../src/lib/learning/policy";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const arg = (a: string) => process.argv.includes(a);
const mode = arg("--app-on") ? "app-on" : arg("--app-off") ? "app-off" : arg("--commerce-on") ? "commerce-on" : arg("--commerce-off") ? "commerce-off" : "status";

/** Pure: whether the configured payment environment is TEST-only. Reads presence and shape, never prints a value. */
export function paymentTestMode(env: Record<string, string | undefined>): { test: boolean; why: string } {
  const k = env.FLW_SECRET_KEY, h = env.FLW_SECRET_HASH, site = env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!k) return { test: false, why: "no FLW_SECRET_KEY is configured, so every course checkout refuses NOT_CONFIGURED" };
  if (!/_TEST/i.test(k)) return { test: false, why: "FLW_SECRET_KEY is NOT a Flutterwave TEST key (no _TEST in it): it could collect real funds" };
  if (!h) return { test: false, why: "FLW_SECRET_HASH is not configured, so no webhook could be verified" };
  if (/(^|\/\/)(www\.)?competen\.(com|africa)/i.test(site)) return { test: false, why: "NEXT_PUBLIC_SITE_URL is a production domain" };
  return { test: true, why: "FLW_SECRET_KEY is a Flutterwave TEST key (_TEST), FLW_SECRET_HASH is set, and the site URL is not production" };
}

async function main() {
  const read = async (flag: string) => (await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", flag).maybeSingle());
  const show = async () => {
    for (const f of [LEARNING_APP_FLAG, LEARNING_COMMERCE_FLAG]) {
      const r = await read(f);
      if (r.error) { console.error(`${f} could not be read: ${r.error.message}`); process.exit(1); }
      console.log(`  ${f.padEnd(18)} ${r.data?.enabled ? "ON " : "OFF"}${r.data?.note ? `  (${r.data.note})` : "  (no row: off)"}`);
    }
    const t = paymentTestMode(process.env);
    console.log(`  payments           test mode: ${t.test ? "yes" : "no"} -- ${t.why}`);
  };
  console.log(`staging ${verdict.ok ? verdict.ref : ""}:`);
  await show();
  if (mode === "status") return;
  const flag = mode.startsWith("app") ? LEARNING_APP_FLAG : LEARNING_COMMERCE_FLAG;
  const on = mode.endsWith("-on");
  if (mode === "commerce-on") {
    const t = paymentTestMode(process.env);
    if (!t.test) { console.error(`\nREFUSED: course checkout stays OFF. ${t.why}.`); process.exit(1); }
    if (!(await read(LEARNING_APP_FLAG)).data?.enabled) { console.error("\nREFUSED: switch learning_app on first (--app-on)."); process.exit(1); }
  }
  const note = on ? `ON for a staging Learning test, by the owner, ${new Date().toISOString()}. Switch OFF after.` : `OFF (the default), by the owner, ${new Date().toISOString()}.`;
  const w = await admin.from("practice_platform_flags").upsert({ flag, enabled: on, note });
  if (w.error) { console.error(`The flag could not be written: ${w.error.message}`); process.exit(1); }
  console.log("\nnow:");
  await show();
}
main().catch(e => { console.error(e); process.exit(1); });
