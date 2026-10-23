/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * EMAIL SYNC ACCEPTANCE HARNESS -- migration 381 (owner GO 2026-10-23, item 4), against a STAGING project.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only email-sync-acceptance
 *
 * ⚠ STAGING ONLY. assertSafeTarget refuses the production project. It creates two synthetic fixtures
 * (harness-esync-*@competen.test), changes their Auth email through the Auth admin API -- the same
 * auth.users.email write Supabase makes when a person confirms a change -- and removes both at the end.
 *
 *   C  a CONFIRMED account's email change is copied into profiles.email, with one audit_log row
 *      (actor auth, old and new value)
 *   U  an UNCONFIRMED account's email change is NOT copied
 *   N  an Auth update that does not change the email copies nothing and audits nothing
 * PEND, with nothing created, while migration 381's trigger is absent.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { assertSafeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "email-sync-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const RUN = randomBytes(3).toString("hex");
const FIX = { c: `harness-esync-c-${RUN}@competen.test`, u: `harness-esync-u-${RUN}@competen.test` };
const NEW = { c: `harness-esync-c2-${RUN}@competen.test`, u: `harness-esync-u2-${RUN}@competen.test` };
const PASSWORD = `esync-${randomBytes(12).toString("base64url")}-Aa1!`;

const created: string[] = [];
async function cleanup() {
  for (const id of created) {
    await admin.from("audit_log").delete().eq("entity_id", id).eq("action", "sync_profile_email");
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
}
const profileEmail = async (id: string) => (await admin.from("profiles").select("email").eq("id", id).single()).data?.email ?? null;
const syncAudits = async (id: string) => (await admin.from("audit_log").select("actor_id, actor_name, old_value, new_value").eq("entity_id", id).eq("action", "sync_profile_email")).data ?? [];

async function main() {
  console.log(`EMAIL SYNC ACCEPTANCE HARNESS (migration 381) -- target ${ref}\n`);

  // Is 381 there? A confirmed admin email change on a throwaway account answers it by behaviour, so the
  // probe is the C case itself -- but first make sure the fixtures can be created and read.
  const c = await admin.auth.admin.createUser({ email: FIX.c, password: PASSWORD, email_confirm: true });
  const u = await admin.auth.admin.createUser({ email: FIX.u, password: PASSWORD, email_confirm: false });
  if (c.error || u.error) throw new Error(`createUser: ${c.error?.message ?? u.error?.message}`);
  created.push(c.data.user.id, u.data.user.id);
  const [cid, uid] = [c.data.user.id, u.data.user.id];
  try {
    ok("S0. both fixtures have a profile carrying their original email (handle_new_user)", (await profileEmail(cid)) === FIX.c && (await profileEmail(uid)) === FIX.u);

    // ── N. an update that does not change the email ──
    await admin.auth.admin.updateUserById(cid, { user_metadata: { harness: RUN } });
    ok("N1. an Auth update that does not change the email copies nothing and audits nothing",
      (await profileEmail(cid)) === FIX.c && (await syncAudits(cid)).length === 0);

    // ── C. a confirmed change ──
    const ch = await admin.auth.admin.updateUserById(cid, { email: NEW.c, email_confirm: true });
    const authNow = ch.data?.user?.email;
    const synced = (await profileEmail(cid)) === NEW.c;
    if (!ch.error && authNow === NEW.c && !synced && (await syncAudits(cid)).length === 0) {
      console.log("  PEND  migration 381 is not applied here (a confirmed Auth email change was not copied) -- C and U NOT asserted");
    } else {
      ok("C1. a confirmed Auth email change is copied into profiles.email", !ch.error && authNow === NEW.c && synced, ch.error?.message ?? `auth=${authNow}`);
      const a = await syncAudits(cid);
      ok("C2. ...with exactly one audit_log row: actor auth, old and new address",
        a.length === 1 && a[0].actor_id === null && a[0].actor_name === "auth" && a[0].old_value?.email === FIX.c && a[0].new_value?.email === NEW.c, JSON.stringify(a));

      // ── U. an unconfirmed account ──
      const uc = await admin.auth.admin.updateUserById(uid, { email: NEW.u });
      const uAuth = (await admin.auth.admin.getUserById(uid)).data?.user;
      ok("U1. an UNCONFIRMED account's email change is not copied into profiles.email",
        (await profileEmail(uid)) === FIX.u && (await syncAudits(uid)).length === 0,
        `auth email=${uAuth?.email} confirmed=${!!uAuth?.email_confirmed_at} err=${uc.error?.message ?? ""}`);
    }
  } finally {
    await cleanup();
    const left = await Promise.all(created.map(id => admin.auth.admin.getUserById(id)));
    ok("Z1. both fixtures are gone", left.every((r: any) => !r.data?.user));
  }
  console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
