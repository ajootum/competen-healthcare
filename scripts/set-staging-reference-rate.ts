/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * IND-007 owner decision D4 -- set the STAGING reference rate from the Bank of Uganda's official published rate,
 * through the same governed path as the HQ page (src/lib/ai/fair-use-admin.ts changeRate: validated, history kept,
 * the previous row ended, never edited). Needs migration 412.
 *
 *   npx tsx scripts/set-staging-reference-rate.ts --rate 4303.81 --published 2026-10-23 \
 *     --source https://www.bou.or.ug/interest_rates_exchange_rates [--kind monthly|exceptional] [--note "..."]
 *
 * STAGING ONLY. It never estimates: every figure is given by the operator, read from the official source with its
 * publication date, and the row records both.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { changeRate } from "../src/lib/ai/fair-use-admin";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const body = { currency: "UGX", perUsd: arg("rate"), publishedOn: arg("published"), sourceRef: arg("source"), updateKind: arg("kind") ?? "monthly", note: arg("note") ?? null };
  console.log(`Reference rate -- target ${(verdict as any).ref}: ${JSON.stringify(body)}`);
  const r = await changeRate(admin, "fx", body, null as unknown as string);
  if (!r.ok) { console.error(`Refused: ${r.error}`); process.exit(1); }
  const { data } = await admin.from("ai_fx_rate").select("currency, per_usd, published_on, source_ref, update_kind, effective_from, effective_to, note").eq("currency", "UGX").order("effective_from", { ascending: false }).limit(3);
  console.log(JSON.stringify(data, null, 1));
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
