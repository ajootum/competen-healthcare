/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A SYNTHETIC STAGING HQ USER FOR A BROWSER CHECK -- created, used for one sign-in, and removed. STAGING ONLY.
 *
 *   npx tsx scripts/staging-hq-browser-check-user.ts --create                   Clinical Case Educator only
 *   npx tsx scripts/staging-hq-browser-check-user.ts --create --with-publisher  also Quality Council Member
 *   npx tsx scripts/staging-hq-browser-check-user.ts --status                   read only
 *   npx tsx scripts/staging-hq-browser-check-user.ts --retire                   remove it completely
 *
 * ⚠ FOR THE OWNER TO RUN, NOT AN AGENT. It creates a sign-in. The one-time password is generated here and printed
 * ONLY to the terminal that runs it, so no credential passes through any agent session. The owner never needs a
 * personal staging account (the owner's CF-FOUND GO).
 * ⚠ LEAST AUTHORITY. By default the user holds only Clinical Case Educator (hq.quality.case.author and the HQ home),
 * which opens the case studio. --with-publisher adds Quality Council Member, which the publication and intelligence
 * pages need. That position is the WHOLE Quality space, clinical review governance included, so retire the user as
 * soon as the check is done.
 * ⚠ LOOK, DO NOT WRITE. The check is read-only. --retire deletes the user, its profile and its appointments, which
 * is clean only because it changed nothing.
 * ⚠ STAGING ONLY. It refuses unless STAGING_SUPABASE_URL is a confirmed non-production project (production-guard).
 */
import { randomBytes } from "node:crypto";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const EMAIL = "hq-browser-check@staging.competen.invalid";
const NAME = "HQ browser check (synthetic, staging)";
const mode = process.argv.includes("--create") ? "create" : process.argv.includes("--retire") ? "retire" : "status";
const withPublisher = process.argv.includes("--with-publisher");

async function find() {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === EMAIL);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
const appointments = async (id: string) => (await admin.from("ogs_office_appointments").select("id, role, status").eq("person_id", id)).data ?? [];

async function main() {
  const HQ_OWNER = await fixtureOwnerId(admin);
  console.log(`staging ${verdict.ok ? verdict.ref : ""}`);
  const u = await find();
  if (mode === "status") {
    if (!u) { console.log("no browser-check user exists"); return; }
    console.log(`${EMAIL} exists (${u.id}), positions: ${(await appointments(u.id)).map((a: any) => `${a.role}:${a.status}`).join(", ") || "none"}. Retire it when done: --retire`);
    return;
  }
  if (mode === "retire") {
    if (!u) { console.log("nothing to retire: no browser-check user exists"); return; }
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    const d = await admin.auth.admin.deleteUser(u.id);
    console.log(d.error ? `COULD NOT DELETE the sign-in: ${d.error.message}` : `retired: ${EMAIL}, its profile and its appointments are gone`);
    console.log((await find()) ? "STILL PRESENT -- check by hand" : "confirmed: no browser-check user remains");
    return;
  }
  if (u) { console.error(`${EMAIL} already exists. Retire it first: --retire`); process.exit(1); }
  const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
    ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  if (!office) { console.error("staging has no active HQ office to appoint to"); process.exit(1); }
  const password = `${randomBytes(18).toString("base64url")}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: NAME, synthetic: true, purpose: "HQ case pages browser check" } });
  if (error || !data?.user) { console.error(`the sign-in could not be created: ${error?.message}`); process.exit(1); }
  await admin.from("profiles").update({ full_name: NAME }).eq("id", data.user.id);
  for (const role of ["clinical_case_educator", ...(withPublisher ? ["quality_council_member"] : [])]) {
    const a = await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(HQ_OWNER), office_id: office.id, person_id: data.user.id, person_name: NAME, role, status: "active" });
    if (a.error) { console.error(`the ${role} appointment failed (${a.error.message}). Retiring the user.`); await admin.auth.admin.deleteUser(data.user.id); process.exit(1); }
  }
  console.log(`created ${EMAIL} (${data.user.id}) as ${withPublisher ? "Clinical Case Educator + Quality Council Member" : "Clinical Case Educator"}`);
  console.log(`one-time password (shown once, never stored or logged): ${password}`);
  console.log("Sign in at http://localhost:3100/login, look, then: npx.cmd tsx scripts/staging-hq-browser-check-user.ts --retire");
}
main().catch(e => { console.error(e); process.exit(1); });
