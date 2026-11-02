/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-CE-2026 CE-04: SEED THE SYNTHETIC DEMONSTRATION CASE INTO CASE STUDIO AS A DRAFT -- STAGING ONLY.
 *
 *   npx tsx scripts/staging-seed-ce04-demo.ts --status                     read only: is the demo case there, and in what state
 *   npx tsx scripts/staging-seed-ce04-demo.ts --educator <profile uuid>    create it as a Case Studio DRAFT authored by that person
 *
 * ⚠ FOR THE OWNER TO RUN, NOT AN AGENT. Staging only: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production
 * project (production-guard). It needs migration 423 (the case library) on that project. It creates ONE draft, code
 * CASE-DEMO-CE04, from CE04_DEMO (src/lib/cases/fixtures.ts), a SYNTHETIC case that is NOT clinically reviewed.
 *
 * ⚠ IT STAYS A DRAFT. Nothing here submits, approves or publishes. To see it played on staging the owner takes the normal
 * route: open it in Case Studio, fill the classification the case policy requires, submit it, have it independently
 * clinically approved (422) as a staging exercise, then publish it. A learner can play it only after that. Retire it
 * afterwards (retire from Case Studio). It is never library content.
 *
 * To see the features on staging also: migration 880 applied on staging, the scholar_case_conversation policy ON
 * (Individual policy, Scholar), the case library switch ON (scripts/staging-case-library-switch.ts --on, then --off),
 * AI consent and an allowance for the test learner.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { createCase } from "../src/lib/cases/studio";
import { CE04_DEMO, CE04_DEMO_CODE } from "../src/lib/cases/fixtures";
import { validateBlueprint } from "../src/lib/cases/blueprint";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const problems = validateBlueprint(CE04_DEMO, "private");
  if (problems.length) { console.error(`The demo case is not sound: ${problems.join("; ")}`); process.exit(1); }
  const { data: existing, error } = await admin.from("case_library_case").select("id, code, status, title").eq("code", CE04_DEMO_CODE).maybeSingle();
  if (error) { console.error(`The case library could not be read: ${error.message}`); process.exit(1); }
  if (existing) {
    const { data: vs } = await admin.from("case_library_version").select("id, version_no, state").eq("case_id", existing.id).order("version_no");
    console.log(`${CE04_DEMO_CODE} exists (${existing.status}): ${(vs ?? []).map((v: any) => `v${v.version_no} ${v.state}`).join(", ")}`);
    return;
  }
  console.log(`${CE04_DEMO_CODE} does not exist on staging ${verdict.ok ? verdict.ref : ""}.`);
  if (process.argv.includes("--status")) return;
  const educator = arg("--educator");
  if (!educator || !/^[0-9a-f-]{36}$/i.test(educator)) { console.error("Give --educator <profile uuid> (the author of the draft)."); process.exit(1); }
  const r = await createCase(admin, educator, { code: CE04_DEMO_CODE, title: CE04_DEMO.title, content: CE04_DEMO });
  console.log(r.ok ? `created the DRAFT: case ${r.caseId}, version ${r.versionId}. It is not submitted, approved or published.` : `could not create it: ${r.error}`);
  if (!r.ok) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
