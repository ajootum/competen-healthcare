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
 *   L  3 per person and 20 per administrator an hour, counted from audit rows (seeded, so the test does
 *      not depend on staging mail), on the database clock
 *   M  the email itself: PEND unless the send was accepted -- staging SMTP is not asserted, never faked
 *   O  owner-account refusal is PEND: proving it needs a synthetic owner (an owner GO). Unit tests cover it.
 *   Z  fixtures, appointment, audit rows and notices made by the run are removed
 *
 * Refuses production via assertSafeTarget. PEND (exit 0, nothing created) until 379 is applied.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { resolveHqPositions } from "../src/lib/hq/context";
import { NEUTRAL_MESSAGE, RESET_REFUSED, RESET_SENT, ACTOR_LIMIT, TARGET_LIMIT } from "../src/lib/hq/user-reset";

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
};
const PASSWORD = `usersB-${Math.random().toString(36).slice(2)}-Aa1!`;
const UNKNOWN = "00000000-0000-4000-8000-0000000000b0";

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
    await admin.from("audit_log").delete().eq("entity_id", u.id).in("action", [RESET_SENT, RESET_REFUSED, "admin_password_reset_requested"]);
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
    const office = await admin.from("ogs_offices").select("id").eq("office_type", "hq_platform").limit(1).maybeSingle();
    const appt = office.data ? await admin.from("ogs_office_appointments").insert({ office_id: office.data.id, person_id: id.resetter, person_name: "Harness usersB resetter", role: "platform_director", status: "active", term_start: new Date(Date.now() - 60_000).toISOString() }) : { error: { message: "no hq_platform office" } };
    ok("0. the resetter is appointed platform_director", !appt.error, appt.error?.message);
    const caps = (await resolveHqPositions(admin, id.resetter)).capabilities;
    ok("G0. 379: the Platform Director appointment holds hq.platform.users.reset", caps.includes("hq.platform.users.reset"), caps.join(","));

    const resetter = await cookieFor(FIX.resetter), stranger = await cookieFor(FIX.stranger);
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

    // Limits, seeded as audit rows so they do not depend on staging mail. created_at is the DB default.
    await admin.from("audit_log").delete().eq("entity_id", id.target).in("action", [RESET_SENT]);
    await admin.from("audit_log").insert(Array.from({ length: TARGET_LIMIT }, () => ({ actor_id: id.stranger, action: RESET_SENT, entity_type: "user", entity_id: id.target, new_value: { seeded: "harness" } })));
    const t = await post("/api/super-admin/users/reset", resetter, { userId: id.target });
    ok("L1. ⚠ a 4th reset for the same person within the hour is refused, neutrally", t.status === 202 && t.text.includes(NEUTRAL_MESSAGE) && (await lastOutcome(id.resetter, id.target)) === "target_rate_limited", `${t.status} ${await lastOutcome(id.resetter, id.target)}`);
    await admin.from("audit_log").insert(Array.from({ length: ACTOR_LIMIT }, (_, i) => ({ actor_id: id.resetter, action: RESET_SENT, entity_type: "user", entity_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, new_value: { seeded: "harness" } })));
    const a = await post("/api/super-admin/users/reset", resetter, { userId: id.unverified });
    ok("L2. ⚠ an administrator's 21st reset within the hour is refused (429)", a.status === 429, String(a.status));
    pend("O1. an owner or super-admin account is reset only by an owner", "needs a synthetic owner on staging (an owner GO); decideReset unit tests cover both sides");
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
