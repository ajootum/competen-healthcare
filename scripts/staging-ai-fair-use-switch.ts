/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * THE OWNER'S STAGING METERING SWITCH -- the ai_fair_use platform flag (src/lib/ai/allowance.ts), STAGING ONLY.
 *
 *   npx tsx scripts/staging-ai-fair-use-switch.ts --status   read only: is metering on, and since when
 *   npx tsx scripts/staging-ai-fair-use-switch.ts --on       switch metering ON for a staging test (records why)
 *   npx tsx scripts/staging-ai-fair-use-switch.ts --off      switch it back OFF (the default state)
 *
 * ⚠ FOR THE OWNER TO RUN, NOT AN AGENT. The flag is shared staging configuration and metering is the owner's to turn
 * on (AI-FAIR-USE-01). Nothing in the application can switch it (scripts/ai-fair-use-harness.ts A8), and this
 * script is not reachable from the application: it is run by hand, against staging only.
 * ⚠ STAGING ONLY. It refuses unless STAGING_SUPABASE_URL is a confirmed non-production project (production-guard).
 * ⚠ ALWAYS SWITCH IT BACK OFF after the test. --status says which state it is in.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { AI_FAIR_USE_FLAG } from "../src/lib/ai/allowance";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--on") ? "on" : process.argv.includes("--off") ? "off" : "status";

async function main() {
  const read = async () => (await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", AI_FAIR_USE_FLAG).maybeSingle());
  const before = await read();
  if (before.error) { console.error(`The flag could not be read: ${before.error.message}`); process.exit(1); }
  console.log(`staging ${verdict.ok ? verdict.ref : ""}: ai_fair_use is ${before.data?.enabled ? "ON" : "OFF"}${before.data?.note ? ` (${before.data.note})` : " (no row: off)"}`);
  if (mode === "status") return;
  const note = mode === "on"
    ? `ON for a staging metering test, by the owner, ${new Date().toISOString()}. Switch OFF after: --off.`
    : `OFF (the default), by the owner, ${new Date().toISOString()}.`;
  const w = await admin.from("practice_platform_flags").upsert({ flag: AI_FAIR_USE_FLAG, enabled: mode === "on", note });
  if (w.error) { console.error(`The flag could not be written: ${w.error.message}`); process.exit(1); }
  const after = await read();
  console.log(`now: ai_fair_use is ${after.data?.enabled ? "ON" : "OFF"}`);
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
