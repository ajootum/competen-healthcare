/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HQ-USERS-B ACCEPTANCE -- administrator password reset over HTTP, on STAGING (migration 379).
 *
 *   BASE_URL=http://localhost:<port> npx tsx scripts/privileged-harnesses.ts --staging --only hq-users-reset-acceptance-harness
 *   (BASE_URL names a dev server pointed at STAGING; no default)
 *
 * Fixtures (harness-usersb-*): a RESETTER appointed platform_director (379 grants it hq.platform.users.reset),
 * a STRANGER with no appointment, and three targets -- verified, unverified, suspended.
 *   G  the gate: a stranger is refused, the resetter is not an owner, the old owner-only reset is gone
 *   N  the neutral answer: verified, unverified, suspended and unknown targets all get the same sentence,
 *      no answer carries an address or a link, and the audit row keeps the true reason
 *   S  self-reset is refused by name
 *   L  3 REQUESTS per person and 20 per administrator an hour, reserved atomically by the database function:
 *      8 simultaneous requests for one person reserve exactly 3 (L3); seeded reservations hit both limits
 *   C  the Chief Executive sees the directory, initiates a permitted reset, and is refused every owner-only write
 *   M  the email itself: PEND unless the send was accepted -- staging SMTP is not asserted, never faked
 *   O  with HQ_OWNER_FIXTURE_GO=1: a super-admin account is refused to the CEO and passes for an owner (Z0 retires the owner)
 *   Z  fixtures, appointment, audit rows and notices made by the run are removed
 *
 * Refuses production via assertSafeTarget. PEND (exit 0, nothing created) until 379 is applied.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { resolveHqPositions } from "../src/lib/hq/context";
import { NEUTRAL_MESSAGE, RESET_REFUSED, RESET_RESERVED, RESET_SENT, RESERVE_FUNCTION, ACTOR_LIMIT, TARGET_LIMIT } from "../src/lib/hq/user-reset";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "hq-users-reset-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);

const FIX = {
  resetter: "harness-usersb-resetter@competen.test", stranger: "harness-usersb-stranger@competen.test",
  target: "harness-usersb-target@competen.test", unverified: "harness-usersb-unverified@competen.test", suspended: "harness-usersb-suspended@competen.test",
  burst: "harness-usersb-burst@competen.test", target2: "harness-usersb-target2@competen.test", ceo: "harness-usersb-ceo@competen.test", burstactor: "harness-usersb-burstactor@competen.test",
};
const PASSWORD = `usersB-${Math.random().toString(36).slice(2)}-Aa1!`;
const UNKNOWN = "00000000-0000-4000-8000-0000000000b0";
// Owner-GO identities: a temporary owner held in roles[] only, retired and KEPT for its audit rows, and a
// roles[]-only super-admin target, deleted afterwards.
const FIX_OWNER = { owner: "harness-usersb-owner@competen.test", target: "harness-usersb-ownertarget@competen.test" };
let ownerSession: string | null = null;
async function ownerFixture(): Promise<string> {
  let u = await findUser(FIX_OWNER.owner);
  if (!u) u = (await admin.auth.admin.createUser({ email: FIX_OWNER.owner, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "Harness usersB temporary owner (synthetic)", synthetic: true } })).data.user;
  else await admin.auth.admin.updateUserById(u.id, { password: PASSWORD, ban_duration: "none" });
  await admin.from("profiles").update({ role: "nurse", roles: ["nurse", "super_admin"], platform_role: null, platform_roles: null }).eq("id", u.id);
  if (!(await admin.from("platform_membership").select("id").eq("user_id", u.id).maybeSingle()).data)
    await admin.from("platform_membership").insert({ user_id: u.id, status: "active", source: "admin_grant", note: "HQ-USERS-B temporary owner fixture (owner GO). Staging only." });
  return u.id;
}
async function rolesOnlySuper(email: string): Promise<string> {
  const existing = await findUser(email); if (existing) await admin.auth.admin.deleteUser(existing.id);
  const { data } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "Harness usersB super-admin target (synthetic)", synthetic: true } });
  await admin.from("profiles").update({ role: "nurse", roles: ["nurse", "super_admin"] }).eq("id", data.user.id);
  return data.user.id;
}
async function retireOwner(id: string) {
  await admin.from("profiles").update({ role: null, roles: [], platform_role: null, platform_roles: null }).eq("id", id);
  await admin.from("platform_membership").delete().eq("user_id", id);
  await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (ownerSession) {
    const token = JSON.parse(Buffer.from(ownerSession.split("=base64-")[1], "base64").toString()).access_token;
    await admin.auth.admin.signOut(token, "global").catch(() => {});
  }
}

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
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("audit_log").delete().eq("entity_id", u.id).in("action", [RESET_SENT, RESET_REFUSED, RESET_RESERVED]);
    await admin.from("notifications").delete().eq("user_id", u.id);
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("platform_membership").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
async function cookieFor(email: string) {
  const { data } = await createClient(url!, anonKey!, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password: PASSWORD });
  return data?.session ? `sb-${new URL(url!).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}` : null;
}
const post = async (path: string, cookie: string, body: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
};
const lastOutcome = async (actorId: string, targetId: string) => {
  const { data } = await admin.from("audit_log").select("action, new_value").eq("actor_id", actorId).eq("entity_id", targetId)
    .in("action", [RESET_SENT, RESET_REFUSED]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? (data.action === RESET_SENT ? "sent" : data.new_value?.reason) : null;
};

async function main() {
  console.log(`HQ USERS RESET ACCEPTANCE (HQ-USERS-B) -- target ${ref}${BASE ? `, server ${BASE}` : ", no server"}\n`);
  const cap = await admin.from("hq_capability").select("code").eq("code", "hq.platform.users.reset").maybeSingle();
  if (!cap.data) { console.log("  PEND  migration 379 is not applied here. Nothing created."); return; }
  if (!BASE) { console.log("  PEND  every check -- BASE_URL is not set: this run is NOT acceptance. Nothing created."); return; }

  await cleanup();
  const id: Record<string, string> = {};
  try {
    for (const [k, email] of Object.entries(FIX)) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: k !== "unverified", user_metadata: { full_name: `Harness usersB ${k}`, synthetic: true } });
      if (error || !data?.user) { ok(`0. fixture ${k}`, false, error?.message); return; }
      id[k] = data.user.id;
      await admin.from("platform_membership").insert({ user_id: data.user.id, status: "active", source: "admin_grant", note: "HQ-USERS-B acceptance fixture. Staging only." });
    }
    await admin.auth.admin.updateUserById(id.suspended, { ban_duration: "876000h" });
    // 383 must be applied, or every reset is refused (503) by design. One real reservation by a fixture
    // proves it answers; its row is removed at once (and by cleanup in any case).
    const probe = await admin.rpc(RESERVE_FUNCTION, { p_actor: id.stranger, p_target: id.stranger, p_actor_name: "harness probe", p_trace: null });
    await admin.from("audit_log").delete().eq("actor_id", id.stranger).eq("action", RESET_RESERVED);
    ok("0d. the reservation function (383) answers on this project", !probe.error && (Array.isArray(probe.data) ? probe.data[0] : probe.data)?.outcome === "reserved", probe.error?.message ?? JSON.stringify(probe.data));
    if (probe.error) return;
    const office = await admin.from("ogs_offices").select("id").eq("office_type", "hq_platform").limit(1).maybeSingle();
    const appt = office.data ? await admin.from("ogs_office_appointments").insert({ office_id: office.data.id, person_id: id.resetter, person_name: "Harness usersB resetter", role: "platform_director", status: "active", term_start: new Date(Date.now() - 60_000).toISOString() }) : { error: { message: "no hq_platform office" } };
    if (office.data) await admin.from("ogs_office_appointments").insert({ office_id: office.data.id, person_id: id.burstactor, person_name: "Harness usersB second administrator", role: "platform_director", status: "active", term_start: new Date(Date.now() - 60_000).toISOString() });
    ok("0. the resetter is appointed platform_director", !appt.error, appt.error?.message);
    const caps = (await resolveHqPositions(admin, id.resetter)).capabilities;
    ok("G0. 379: the Platform Director appointment holds hq.platform.users.reset", caps.includes("hq.platform.users.reset"), caps.join(","));

    const resetter = await cookieFor(FIX.resetter), stranger = await cookieFor(FIX.stranger), burstActor = await cookieFor(FIX.burstactor);
    if (!resetter || !stranger) { ok("0c. fixtures sign in", false); return; }

    const s1 = await post("/api/super-admin/users/reset", stranger, { userId: id.target });
    ok("G1. ⚠ a person with no HQ position is refused (403)", s1.status === 403, String(s1.status));
    const old = await post("/api/super-admin/users/actions", resetter, { userId: id.target, action: "send_reset" });
    ok("G2. the old owner-only reset is not a second door: it refuses a non-owner (403)", old.status === 403, String(old.status));

    const self = await post("/api/super-admin/users/reset", resetter, { userId: id.resetter });
    ok("S1. self-reset through the administrator route is refused by name (403)", self.status === 403 && /Forgot password/.test(self.text), `${self.status} ${self.text.slice(0, 80)}`);

    const answers: Record<string, { status: number; text: string }> = {};
    for (const k of ["target", "unverified", "suspended"]) answers[k] = await post("/api/super-admin/users/reset", resetter, { userId: id[k] });
    answers.unknown = await post("/api/super-admin/users/reset", resetter, { userId: UNKNOWN });
    const texts = new Set(Object.values(answers).map(a => `${a.status} ${a.text}`));
    ok("N1. ⚠ verified, unverified, suspended and unknown targets all get the SAME answer (202, neutral)", texts.size === 1 && answers.target.status === 202 && answers.target.text.includes(NEUTRAL_MESSAGE), [...texts].join(" | ").slice(0, 200));
    ok("N2. ⚠ no answer carries an address or a link", Object.values(answers).every(a => !/@|https?:\/\/|token|access_token/i.test(a.text)));
    const reasons = { unverified: await lastOutcome(id.resetter, id.unverified), suspended: await lastOutcome(id.resetter, id.suspended), unknown: await lastOutcome(id.resetter, UNKNOWN) };
    ok("N3. the audit keeps the true reason behind each neutral answer", reasons.unverified === "unverified_email" && reasons.suspended === "suspended" && reasons.unknown === "unknown_target", JSON.stringify(reasons));
    const trail = await admin.from("audit_log").select("new_value").eq("actor_id", id.resetter);
    ok("N4. ⚠ no audit row of the run names an address, a token or a link", !(trail.data ?? []).some((r: any) => /@|https?:\/\/|token/i.test(JSON.stringify(r.new_value ?? {}))));

    const sentOutcome = await lastOutcome(id.resetter, id.target);
    if (sentOutcome === "sent") {
      ok("M1. the verified target's reset was accepted by Supabase recovery", true);
      const notice = await admin.from("notifications").select("title, body, href").eq("user_id", id.target).limit(1).maybeSingle();
      ok("M2. the person is told in-app that an administrator sent it, with no link", !!notice.data && /administrator/i.test(notice.data.title) && !notice.data.href && !/https?:\/\//.test(notice.data.body ?? ""), JSON.stringify(notice.data));
      pend("M3. the email arrived and reads as administrator-initiated", "staging SMTP delivery is not asserted; the return URL carries ?initiated=admin and the reset page states it");
    } else {
      pend("M1-M3. the email itself", `Supabase recovery did not accept the send on staging (audit reason: ${sentOutcome}); the neutral answer was still returned. Not loosened to pass.`);
    }

    // ── L. the limits: REQUESTS, counted and reserved atomically by the database function ──
    const reservedFor = async (col: "entity_id" | "actor_id", v: string) =>
      (await admin.from("audit_log").select("id", { count: "exact", head: false }).eq("action", RESET_RESERVED).eq(col, v).limit(1)).count ?? 0;
    // L3 first, while the resetter is far from its own limit: 8 simultaneous requests for a person nobody
    // has asked about yet. Exactly 3 may be reserved, however the requests interleave.
    const burst = await Promise.all(Array.from({ length: 8 }, () => post("/api/super-admin/users/reset", resetter, { userId: id.burst })));
    const burstReserved = await reservedFor("entity_id", id.burst);
    ok("L3. ⚠ 8 simultaneous requests for one person: exactly 3 reserved, all 8 answered neutrally", burstReserved === TARGET_LIMIT && burst.every(b => b.status === 202 && b.text.includes(NEUTRAL_MESSAGE)), `${burstReserved} reserved, statuses ${burst.map(b => b.status).join(",")}`);
    // L4: a fresh administrator fires 25 simultaneous requests at 25 different people. Exactly 20 may be
    // reserved, and the other 5 must be refused with 429, however they interleave.
    if (burstActor) {
      const targets = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-0000000b${String(i).padStart(4, "0")}`);
      const flood = await Promise.all(targets.map(t => post("/api/super-admin/users/reset", burstActor, { userId: t })));
      const floodReserved = await reservedFor("actor_id", id.burstactor);
      const limited = flood.filter(f => f.status === 429).length, neutral = flood.filter(f => f.status === 202).length;
      ok("L4. ⚠ 25 simultaneous requests by one administrator: exactly 20 reserved, exactly 5 refused (429)", floodReserved === ACTOR_LIMIT && limited === 25 - ACTOR_LIMIT && neutral === ACTOR_LIMIT, `${floodReserved} reserved, ${neutral}x202, ${limited}x429, others ${flood.filter(f => f.status !== 202 && f.status !== 429).map(f => f.status).join(",")}`);
    } else ok("L4. the second administrator fixture signs in", false);
    // L1: seeded reservations by someone else bring the person to the limit.
    await admin.from("audit_log").insert(Array.from({ length: TARGET_LIMIT }, () => ({ actor_id: id.stranger, action: RESET_RESERVED, entity_type: "user", entity_id: id.target, new_value: { seeded: "harness" } })));
    const t = await post("/api/super-admin/users/reset", resetter, { userId: id.target });
    ok("L1. ⚠ a 4th request for the same person within the hour is refused, neutrally", t.status === 202 && t.text.includes(NEUTRAL_MESSAGE) && (await lastOutcome(id.resetter, id.target)) === "target_rate_limited", `${t.status} ${await lastOutcome(id.resetter, id.target)}`);
    // L2: seeded reservations bring the administrator to 20.
    const mine = await reservedFor("actor_id", id.resetter);
    await admin.from("audit_log").insert(Array.from({ length: Math.max(0, ACTOR_LIMIT - mine) }, (_, i) => ({ actor_id: id.resetter, action: RESET_RESERVED, entity_type: "user", entity_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, new_value: { seeded: "harness" } })));
    const a = await post("/api/super-admin/users/reset", resetter, { userId: id.unverified });
    ok("L2. ⚠ an administrator's 21st request within the hour is refused (429)", a.status === 429, String(a.status));

    // ── C. the Chief Executive: sees the directory, may reset, may not do owner-only operations ──
    const ceoView = (await admin.from("hq_position_capability").select("capability_code").eq("position_code", "chief_executive").eq("capability_code", "hq.platform.users.view").is("effective_to", null)).data ?? [];
    const execOffice = await admin.from("ogs_offices").select("id").eq("office_type", "hq_executive").limit(1).maybeSingle();
    const ceoAppt = execOffice.data ? await admin.from("ogs_office_appointments").insert({ office_id: execOffice.data.id, person_id: id.ceo, person_name: "Harness usersB chief executive", role: "chief_executive", status: "active", term_start: new Date(Date.now() - 60_000).toISOString() }) : { error: { message: "no hq_executive office" } };
    const ceo = await cookieFor(FIX.ceo);
    const ceoCaps = (await resolveHqPositions(admin, id.ceo)).capabilities;
    ok("C0. the Chief Executive appointment holds users.reset and users.view, and no owner authority", !ceoAppt.error && !!ceo && ceoCaps.includes("hq.platform.users.reset") && ceoCaps.includes("hq.platform.users.view") && ceoView.length === 1, `${ceoAppt.error?.message ?? ""} ${ceoCaps.join(",")}`);
    if (ceo) {
      const dir = await fetch(`${BASE}/super-admin/users`, { redirect: "manual", headers: { Cookie: ceo } });
      const dirHtml = dir.status === 200 ? await dir.text() : "";
      ok("C1. the Chief Executive opens the directory, with reset offered and no owner-only controls", dir.status === 200 && dirHtml.includes("User Management") && !dirHtml.includes("+ Add User"), String(dir.status));
      const r = await post("/api/super-admin/users/reset", ceo, { userId: id.target2 });
      ok("C2. the Chief Executive initiates a permitted reset (neutral answer, reservation recorded under the CEO)", r.status === 202 && (await reservedFor("actor_id", id.ceo)) === 1, `${r.status} ${await lastOutcome(id.ceo, id.target2)}`);
      const call = async (method: string, path: string, body?: unknown) => (await fetch(`${BASE}${path}`, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: ceo }, body: body === undefined ? undefined : JSON.stringify(body) })).status;
      const w = [
        await call("POST", "/api/super-admin/users/actions", { userId: id.target2, action: "suspend" }),
        await call("PATCH", "/api/super-admin/users", { userId: id.target2, isSuperAdmin: true }),
        await call("POST", "/api/super-admin/users", { email: "harness-usersb-never@competen.test", full_name: "Never", role: "nurse", mode: "password" }),
        await call("DELETE", `/api/super-admin/users?id=${id.target2}`),
      ];
      const t2 = (await admin.from("profiles").select("role, roles").eq("id", id.target2).single()).data;
      ok("C3. ⚠ the Chief Executive cannot suspend, change roles, create or delete (403), and nothing changed", w.every(s => s === 403) && !(t2?.roles ?? []).includes("super_admin") && !(await findUser("harness-usersb-never@competen.test")), w.join(","));
    }

    // ── O. owner and super-admin ACCOUNTS: resettable by an owner only (temporary identities, owner GO) ──
    if (process.env.HQ_OWNER_FIXTURE_GO !== "1") {
      pend("O1-O2. owner accounts are reset only by an owner", "needs HQ_OWNER_FIXTURE_GO=1 under an owner GO; decideReset unit tests cover both sides");
    } else {
      const ownerTarget = await rolesOnlySuper(FIX_OWNER.target);
      const ownerActor = await ownerFixture();
      try {
        const byCeo = ceo ? await post("/api/super-admin/users/reset", ceo, { userId: ownerTarget }) : { status: 0, text: "" };
        ok("O1. ⚠ the Chief Executive's reset of a super-admin account is refused, neutrally, reason audited", byCeo.status === 202 && byCeo.text.includes(NEUTRAL_MESSAGE) && (await lastOutcome(id.ceo, ownerTarget)) === "owner_target", `${byCeo.status} ${await lastOutcome(id.ceo, ownerTarget)}`);
        const ownerCookie = await cookieFor(FIX_OWNER.owner);
        const byOwner = ownerCookie ? await post("/api/super-admin/users/reset", ownerCookie, { userId: ownerTarget }) : { status: 0, text: "" };
        const oc = await lastOutcome(ownerActor, ownerTarget);
        ok("O2. an owner's reset of a super-admin account passes the owner rule (sent, or refused only by staging mail)", byOwner.status === 202 && (oc === "sent" || oc === "send_failed"), `${byOwner.status} ${oc}`);
        ownerSession = ownerCookie;
      } finally {
        await retireOwner(ownerActor);
        // The target account goes; the audit rows about it stay, so the owner's actions remain traceable.
        const v = await findUser(FIX_OWNER.target); if (v) await admin.auth.admin.deleteUser(v.id);
        const p = (await admin.from("profiles").select("role, roles, platform_role, platform_roles").eq("id", ownerActor).single()).data;
        const pm = (await admin.from("platform_membership").select("id").eq("user_id", ownerActor)).data ?? [];
        const ban = (await admin.auth.admin.getUserById(ownerActor)).data?.user?.banned_until ?? null;
        const stale = ownerSession ? await post("/api/super-admin/users/reset", ownerSession, { userId: id.target2 }) : { status: 0, text: "" };
        ok("Z0. ⚠ the temporary owner is retired: no roles, no membership, banned, its old session refused",
          !!p && !p.role && !(p.roles ?? []).length && !p.platform_role && !(p.platform_roles ?? []).length && pm.length === 0
            && !!ban && Date.parse(ban) > Date.parse("2100-01-01") && (stale.status === 401 || stale.status === 403),
          JSON.stringify({ memberships: pm.length, ban, staleSession: stale.status }));
      }
    }
  } finally {
    // Every row the run wrote or seeded has a fixture as its actor, so cleanup() removes them all.
    await cleanup();
    ok("Z1. fixtures, appointment, audit rows and notices removed", !(await findUser(FIX.resetter)) && !(await findUser(FIX.target)));
  }
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
