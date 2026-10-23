/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HQ-USERS-A ACCEPTANCE -- user-management authority over HTTP, on STAGING.
 *
 *   BASE_URL=http://localhost:<port> npx tsx scripts/privileged-harnesses.ts --staging --only hq-users-authority-acceptance-harness
 *   (BASE_URL names a dev server that is itself pointed at STAGING; it has no default)
 *
 * Fixtures: a VIEWER appointed to platform_director (which holds hq.platform.users.view, migration 264) and
 * a STRANGER with no appointment. Both get platform membership, so a refusal is the HQ gate's, not the estate's.
 *   V  the viewer reads the directory API and the page, and sees no account-write controls
 *   W  every owner-only write is refused to the viewer (403) and changes nothing
 *   S  the stranger is refused the directory API
 *   O  the OWNER path is PEND: proving it needs a synthetic super admin, which needs an owner GO
 *   Z  fixtures and the appointment are removed
 *
 * Refuses production via assertSafeTarget. Creates and deletes its own harness-usersA-* identities.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { resolveHqPositions } from "../src/lib/hq/context";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "hq-users-authority-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);

const FIX = { viewer: "harness-usersa-viewer@competen.test", stranger: "harness-usersa-stranger@competen.test" };
const PASSWORD = `usersA-${Math.random().toString(36).slice(2)}-Aa1!`;
const POSITION = "platform_director";

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
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("platform_membership").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
async function cookieFor(email: string) {
  const { data } = await createClient(url!, anonKey!, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password: PASSWORD });
  return data?.session ? `sb-${new URL(url!).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}` : null;
}
const call = async (method: string, path: string, cookie: string, body?: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
};

async function main() {
  console.log(`HQ USERS AUTHORITY ACCEPTANCE (HQ-USERS-A) -- target ${ref}${BASE ? `, server ${BASE}` : ", no server"}\n`);
  if (!BASE) { console.log("  PEND  every check -- BASE_URL is not set: this run is NOT acceptance. Nothing created."); return; }
  const pos = await admin.from("hq_position_capability").select("capability_code").eq("position_code", POSITION).is("effective_to", null);
  if (!(pos.data ?? []).some((r: any) => r.capability_code === "hq.platform.users.view")) { ok("0. platform_director holds hq.platform.users.view here", false); return; }

  await cleanup();
  const made: Record<string, string> = {};
  try {
    for (const [k, email] of Object.entries(FIX)) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `Harness usersA ${k}`, synthetic: true } });
      if (error || !data?.user) { ok(`0. fixture ${k}`, false, error?.message); return; }
      made[k] = data.user.id;
      await admin.from("platform_membership").insert({ user_id: data.user.id, status: "active", source: "admin_grant", note: "HQ-USERS-A acceptance fixture. Staging only." });
    }
    const office = await admin.from("ogs_offices").select("id").eq("office_type", "hq_platform").limit(1).maybeSingle();
    const appt = office.data ? await admin.from("ogs_office_appointments").insert({ office_id: office.data.id, person_id: made.viewer, person_name: "Harness usersA viewer", role: POSITION, status: "active", term_start: new Date(Date.now() - 60_000).toISOString() }) : { error: { message: "no hq_platform office" } };
    ok("0. the viewer is appointed platform_director", !appt.error, appt.error?.message);
    const caps = (await resolveHqPositions(admin, made.viewer)).capabilities;
    ok("0b. the viewer holds hq.platform.users.view and is not an owner", caps.includes("hq.platform.users.view"), caps.join(","));

    const viewer = await cookieFor(FIX.viewer), stranger = await cookieFor(FIX.stranger);
    if (!viewer || !stranger) { ok("0c. both fixtures sign in", false); return; }

    const list = await call("GET", "/api/super-admin/users/list", viewer);
    ok("V1. the viewer reads the directory API (200), as the page's capability says", list.status === 200 && list.text.includes("\"profiles\""), String(list.status));
    const page = await call("GET", "/super-admin/users", viewer);
    ok("V2. the viewer opens /super-admin/users", page.status === 200 && page.text.includes("User Management"), String(page.status));
    ok("V3. and is shown no account-write controls", page.status === 200 && !page.text.includes("+ Add User"));

    const before = await admin.from("profiles").select("role, roles, hospital_id").eq("id", made.stranger).single();
    const writes = await Promise.all([
      call("POST", "/api/super-admin/users/actions", viewer, { userId: made.stranger, action: "send_reset" }),
      call("POST", "/api/super-admin/users/actions", viewer, { userId: made.stranger, action: "suspend" }),
      call("PATCH", "/api/super-admin/users", viewer, { userId: made.stranger, isSuperAdmin: true }),
      call("POST", "/api/super-admin/users", viewer, { email: "harness-usersa-never@competen.test", full_name: "Never", role: "nurse", mode: "password" }),
      call("DELETE", `/api/super-admin/users?id=${made.stranger}`, viewer),
    ]);
    ok("W1. ⚠ every owner-only write is refused to the viewer (403)", writes.every(w => w.status === 403), writes.map(w => w.status).join(","));
    const after = await admin.from("profiles").select("role, roles, hospital_id").eq("id", made.stranger).single();
    const banned = (await admin.auth.admin.getUserById(made.stranger)).data?.user?.banned_until ?? null;
    ok("W2. ⚠ and nothing changed: no role granted, no ban, no account created", JSON.stringify(before.data) === JSON.stringify(after.data) && !banned && !(await findUser("harness-usersa-never@competen.test")));

    const s = await call("GET", "/api/super-admin/users/list", stranger);
    ok("S1. ⚠ a person with no HQ position is refused the directory API", s.status === 403, String(s.status));
    pend("O1. an owner can still do every write", "needs a synthetic staging super admin -- an owner GO; the static harness pins the owner gate (U2/U3)");
  } finally {
    await cleanup();
    const never = await findUser("harness-usersa-never@competen.test");
    if (never) await admin.auth.admin.deleteUser(never.id);
    ok("Z1. fixtures and the appointment are removed", !(await findUser(FIX.viewer)) && !(await findUser(FIX.stranger)) && !never);
  }
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
