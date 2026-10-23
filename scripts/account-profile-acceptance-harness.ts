/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ACCOUNT PROFILE ACCEPTANCE HARNESS -- "My profile" (owner GO 2026-10-23, PR D), against a STAGING project.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only account-profile-acceptance
 *
 * ⚠ STAGING ONLY. assertSafeTarget refuses the production project. It creates two synthetic fixtures
 * (harness-acct-a / -b @competen.test), signs one in with the ANON key -- a real user session, the same path
 * the route now writes through -- and removes both at the end. It reads no flag and writes no flag.
 *
 * What it proves, at the database the route relies on:
 *   U  the person's own session can update their personal fields, and nothing else: every authority column
 *      and the email are refused (column grants plus RLS WITH CHECK profile_authority_unchanged)
 *   X  the person's session cannot update somebody else's row
 *   N  migration 380: given and family names are settable, checked, and never filled in for anybody
 *      (PEND, with nothing asserted, where 380 is not applied)
 *   E  an email change through Supabase's flow is PENDING, and profiles.email is not touched by it
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { assertSafeTarget } from "./production-guard";
import { isNotProvisioned } from "../src/lib/individual/access";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "account-profile-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const FIX = { a: "harness-acct-a@competen.test", b: "harness-acct-b@competen.test" };
// A test value generated for this run only, used to sign fixture A in. Never printed.
const PASSWORD = `acct-${randomBytes(12).toString("base64url")}-Aa1!`;

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
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").upsert({ id: data.user.id, email, full_name: `Harness ${email.split("@")[0]}`, role: "nurse", roles: ["nurse"] }, { onConflict: "id" });
  return data.user.id as string;
}

async function main() {
  console.log(`ACCOUNT PROFILE ACCEPTANCE HARNESS (PR D -- My profile) -- target ${ref}\n`);
  await cleanup();
  const a = await makeUser(FIX.a);
  const b = await makeUser(FIX.b);
  try {
    const me = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
    const signed = await me.auth.signInWithPassword({ email: FIX.a, password: PASSWORD });
    ok("S0. fixture A is signed in with the anon key -- a real user session", !signed.error && !!signed.data?.session);
    const row = async (id: string) => (await admin.from("profiles").select("*").eq("id", id).single()).data;
    const before = await row(a);

    // ── U. own personal fields, and nothing else ──
    const u1 = await me.from("profiles").update({ full_name: "Harness Amina Okello", phone: "+256 700 000000", country: "Uganda", specialization: "Critical care" }).eq("id", a).select("id");
    ok("U1. the person's own session updates their personal fields", !u1.error && u1.data?.length === 1, u1.error?.message ?? "");
    const after1 = await row(a);
    ok("U2. ...and the values are stored as sent", after1.full_name === "Harness Amina Okello" && after1.phone === "+256 700 000000" && after1.specialization === "Critical care");
    const refused: string[] = [];
    for (const [col, v] of [["role", "super_admin"], ["roles", ["super_admin"]], ["platform_role", "owner"], ["platform_roles", ["owner"]],
      ["org_role", "admin"], ["hospital_id", "00000000-0000-0000-0000-000000000001"], ["account_status", "suspended"], ["is_senior_assessor", true], ["managed_country", "UG"]] as const) {
      const r = await me.from("profiles").update({ [col]: v }).eq("id", a).select("id");
      if (r.error || !r.data?.length) refused.push(col);
    }
    ok("U3. ⚠ every authority column is refused for a self-update", refused.length === 9, `refused: ${refused.join(", ")}`);
    const after3 = await row(a);
    ok("U4. ⚠ ...and none of them changed", ["role", "roles", "platform_role", "platform_roles", "org_role", "hospital_id", "account_status", "is_senior_assessor", "managed_country"]
      .every(c => JSON.stringify(after3[c]) === JSON.stringify(before[c])));
    const em = await me.from("profiles").update({ email: "hijack@example.test" }).eq("id", a).select("id");
    ok("U5. ⚠ the email column is refused for a self-update", !!em.error || !em.data?.length);
    ok("U6. ...and profiles.email is unchanged", (await row(a)).email === before.email);

    // ── X. not somebody else's row ──
    const x = await me.from("profiles").update({ full_name: "Overwritten" }).eq("id", b).select("id");
    ok("X1. ⚠ the person's session cannot update another person's profile", !x.error ? (x.data ?? []).length === 0 : true);
    ok("X2. ...and the other profile is untouched", (await row(b)).full_name === "Harness harness-acct-b");

    // ── N. migration 380 ──
    const probe = await admin.from("profiles").select("given_name").limit(0);
    if (probe.error && isNotProvisioned(probe.error)) {
      console.log("  PEND  migration 380 is not applied here -- N1-N3 NOT RUN, nothing asserted");
    } else {
      const n1 = await me.from("profiles").update({ given_name: "Amina", family_name: "Okello" }).eq("id", a).select("id");
      const r1 = await row(a);
      ok("N1. given and family names are settable by the person, through their own session", !n1.error && r1.given_name === "Amina" && r1.family_name === "Okello", n1.error?.message ?? "");
      const n2 = await me.from("profiles").update({ given_name: "  padded " }).eq("id", a).select("id");
      ok("N2. the schema refuses an untrimmed name (blank is NULL, never '')", !!n2.error);
      ok("N3. ⚠ nothing fills them in for anybody else -- fixture B's are still NULL", (await row(b)).given_name === null && (await row(b)).family_name === null);
    }

    // ── E. email change is pending, profiles.email untouched ──
    const emailBefore = (await row(a)).email;
    const ch = await me.auth.updateUser({ email: "harness-acct-a-new@competen.test" });
    if (ch.error) {
      console.log(`  PEND  E1-E2: the staging Auth refused to start an email change (${ch.error.message}) -- not asserted`);
    } else {
      const au = (await admin.auth.admin.getUserById(a)).data?.user;
      ok("E1. an email change through Supabase's flow is pending until confirmed -- the sign-in email is unchanged", au?.email === FIX.a && au?.new_email === "harness-acct-a-new@competen.test", `email=${au?.email} new=${au?.new_email}`);
      ok("E2. ⚠ profiles.email is not touched by it", (await row(a)).email === emailBefore);
    }
  } finally {
    await cleanup();
    const left = await Promise.all(Object.values(FIX).map(findUser));
    ok("Z1. both fixtures are gone", left.every(u => !u));
  }
  console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
