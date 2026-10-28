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
 *   O  the OWNER path, only with HQ_OWNER_FIXTURE_GO=1 under an owner GO: a temporary super admin held in roles[]
 *      only reads, changes a role, suspends and reactivates, creates and deletes, cannot delete itself, and the
 *      last-super-admin count includes roles[] holders; it is then retired (Z0) and kept for the audit trail
 *   Z  fixtures and the appointment are removed
 *
 * Refuses production via assertSafeTarget. Creates and deletes its own harness-usersA-* identities.
 */
import { loadEnvConfig } from "@next/env";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
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
// The owner group's identities. The owner is retired and KEPT (its audit rows keep their actor); the two
// throwaway accounts it creates and deletes are removed.
const FIX_OWNER = { owner: "harness-usersa-owner@competen.test", victim: "harness-usersa-victim@competen.test", created: "harness-usersa-created@competen.test" };
let ownerCookie: string | null = null;
async function ownerFixture(): Promise<string> {
  let u = await findUser(FIX_OWNER.owner);
  if (!u) u = (await admin.auth.admin.createUser({ email: FIX_OWNER.owner, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "Harness usersA temporary owner (synthetic)", synthetic: true } })).data.user;
  else await admin.auth.admin.updateUserById(u.id, { password: PASSWORD, ban_duration: "none" });
  await admin.from("profiles").update({ role: "nurse", roles: ["nurse", "super_admin"], platform_role: null, platform_roles: null }).eq("id", u.id);
  if (!(await admin.from("platform_membership").select("id").eq("user_id", u.id).maybeSingle()).data)
    await admin.from("platform_membership").insert({ user_id: u.id, status: "active", source: "admin_grant", note: "HQ-USERS-A temporary owner fixture (owner GO). Staging only." });
  return u.id;
}
async function rolesOnlySuper(email: string): Promise<string> {
  const { data } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "Harness usersA victim (synthetic)", synthetic: true } });
  await admin.from("profiles").update({ role: "nurse", roles: ["nurse", "super_admin"] }).eq("id", data.user.id);
  return data.user.id;
}
async function retireOwner(id: string) {
  await admin.from("profiles").update({ role: null, roles: [], platform_role: null, platform_roles: null }).eq("id", id);
  await admin.from("platform_membership").delete().eq("user_id", id);
  await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  // Revoke every session it holds: the ban stops new sign-ins, this stops the existing ones refreshing.
  if (ownerCookie) {
    const token = JSON.parse(Buffer.from(ownerCookie.split("=base64-")[1], "base64").toString()).access_token;
    await admin.auth.admin.signOut(token, "global").catch(() => {});
  }
  for (const e of [FIX_OWNER.victim, FIX_OWNER.created]) { const v = await findUser(e); if (v) await admin.auth.admin.deleteUser(v.id); }
}
const call = async (method: string, path: string, cookie: string, body?: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
};

async function main() {
  const HQ_OWNER = await fixtureOwnerId(admin);
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
    const appt = office.data ? await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(HQ_OWNER), office_id: office.data.id, person_id: made.viewer, person_name: "Harness usersA viewer", role: POSITION, status: "active", term_start: new Date(Date.now() - 60_000).toISOString() }) : { error: { message: "no hq_platform office" } };
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
    // ── O. the OWNER path, with a temporary owner-equivalent identity -- ONLY under an explicit owner GO ──
    // super_admin is held in roles[] ONLY (role is "nurse"): exactly the shape the legacy profiles.role
    // test refused. The identity is retired afterwards (roles stripped, membership removed, sessions revoked,
    // banned) and KEPT, so the audit rows it wrote keep their actor.
    if (process.env.HQ_OWNER_FIXTURE_GO !== "1") {
      pend("O. the owner path", "needs HQ_OWNER_FIXTURE_GO=1 under an owner GO -- a temporary staging super admin is a privilege grant");
    } else {
      const ownerId = await ownerFixture();
      try {
        const owner = await cookieFor(FIX_OWNER.owner);
        if (!owner) { ok("O0. the owner fixture signs in", false); return; }
        const caps = await resolveHqPositions(admin, ownerId);
        ok("O0. the owner fixture is an owner through roles[] only (role column is not super_admin)", (await admin.from("profiles").select("role").eq("id", ownerId).single()).data?.role === "nurse", JSON.stringify(caps.positions));
        const l = await call("GET", "/api/super-admin/users/list", owner);
        ok("O1. the owner reads the directory API", l.status === 200, String(l.status));
        const p = await call("PATCH", "/api/super-admin/users", owner, { userId: made.stranger, org_roles: ["healthcare_worker"] });
        const pr = (await admin.from("profiles").select("org_roles").eq("id", made.stranger).single()).data;
        ok("O2. the owner changes another person's role", p.status === 200 && (pr?.org_roles ?? []).includes("healthcare_worker"), `${p.status} ${JSON.stringify(pr)}`);
        const su = await call("POST", "/api/super-admin/users/actions", owner, { userId: made.stranger, action: "suspend" });
        const bannedNow = (await admin.auth.admin.getUserById(made.stranger)).data?.user?.banned_until ?? null;
        const un = await call("POST", "/api/super-admin/users/actions", owner, { userId: made.stranger, action: "unsuspend" });
        const bannedAfter = (await admin.auth.admin.getUserById(made.stranger)).data?.user?.banned_until ?? null;
        ok("O3. the owner suspends and reactivates an account", su.status === 200 && !!bannedNow && un.status === 200 && (!bannedAfter || Date.parse(bannedAfter) < Date.now() + 60_000), `${su.status}/${un.status} ${bannedNow} -> ${bannedAfter}`);
        const cr = await call("POST", "/api/super-admin/users", owner, { email: FIX_OWNER.created, full_name: "Harness usersA created", role: "nurse", mode: "password" });
        const created = await findUser(FIX_OWNER.created);
        const del = created ? await call("DELETE", `/api/super-admin/users?id=${created.id}`, owner) : { status: 0, text: "" };
        ok("O4. the owner creates an account and deletes it", cr.status === 201 && !!created && del.status === 200 && !(await findUser(FIX_OWNER.created)), `${cr.status}/${del.status}`);
        const self = await call("DELETE", `/api/super-admin/users?id=${ownerId}`, owner);
        ok("O5. ⚠ the owner cannot delete their own account", self.status === 400 && /your own account/.test(self.text), `${self.status} ${self.text.slice(0, 80)}`);
        // The last-super-admin guard: a roles[]-only super admin is recognised as one, and counted.
        const victimId = await rolesOnlySuper(FIX_OWNER.victim);
        const count = async (q: string) => (await admin.from("profiles").select("id", { count: "exact", head: false }).or(q).limit(1)).count ?? 0;
        const wide = await count("role.eq.super_admin,roles.cs.{super_admin}"), narrow = await count("role.eq.super_admin");
        ok("O6. the guard's count includes roles[]-only super admins (the owner fixture and the victim)", wide - narrow >= 2, `role or roles[] ${wide}, role only ${narrow}`);
        const dv = await call("DELETE", `/api/super-admin/users?id=${victimId}`, owner);
        ok("O7. a roles[]-only super admin is deletable while others remain (the guard branch ran, count above one)", dv.status === 200 && !(await findUser(FIX_OWNER.victim)), String(dv.status));
        pend("O8. the LAST super admin is refused", "would need every other staging super admin removed; not done on a shared project. O6 proves the count it decides on includes roles[]");
        const trail = await admin.from("audit_log").select("action").eq("actor_id", ownerId);
        ok("O9. the owner's account operations are audited under the owner's id", ["create_user", "delete_user", "suspend_user", "reactivate_user"].every(a => (trail.data ?? []).some((r: any) => r.action === a)), (trail.data ?? []).map((r: any) => r.action).join(","));
        ownerCookie = owner;
      } finally {
        await retireOwner(ownerId);
        const p = (await admin.from("profiles").select("role, roles, platform_role, platform_roles").eq("id", ownerId).single()).data;
        const pm = (await admin.from("platform_membership").select("id").eq("user_id", ownerId)).data ?? [];
        const ban = (await admin.auth.admin.getUserById(ownerId)).data?.user?.banned_until ?? null;
        const stale = ownerCookie ? await call("GET", "/api/super-admin/users/list", ownerCookie) : { status: 0 };
        ok("Z0. ⚠ the temporary owner is retired: no roles, no membership, banned, its old session refused",
          !!p && !p.role && !(p.roles ?? []).length && !p.platform_role && !(p.platform_roles ?? []).length && pm.length === 0
            && !!ban && Date.parse(ban) > Date.parse("2100-01-01") && (stale.status === 401 || stale.status === 403 || stale.status === 0),
          JSON.stringify({ p, memberships: pm.length, ban, staleSession: stale.status }));
      }
    }
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
